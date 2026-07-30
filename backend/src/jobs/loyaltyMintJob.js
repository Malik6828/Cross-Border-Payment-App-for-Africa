'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const logger = require('../utils/logger');
const { mintPoints } = require('../services/loyaltyToken');
const { persistAndBroadcast } = require('../services/notificationInbox');
const { withLock } = require('../utils/distributedLock');

const XLM_USD_RATE = parseFloat(process.env.XLM_USD_RATE || '0.11');

function estimateXlmEquivalent(amount, asset) {
  const num = parseFloat(amount);
  if (asset === 'XLM') return num;
  if (asset === 'USDC' || asset === 'USD') return num / XLM_USD_RATE;
  return 0;
}

/**
 * Claim the next pending loyalty-mint job from the queue and advance it to
 * status='processing' atomically.
 *
 * Runs SELECT … FOR UPDATE SKIP LOCKED and the immediately-following
 * UPDATE status='processing' inside a single explicit BEGIN/COMMIT
 * transaction on a dedicated pg client so that the row lock is held
 * continuously across both statements. Without this, the auto-committed
 * db.query() path releases the FOR UPDATE lock the moment the SELECT
 * returns, allowing two concurrent workers to claim the same row.
 *
 * Returns the claimed job row (with retry_count already incremented by the
 * UPDATE), or null if no pending row is available.
 */
async function claimNextJob(client) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      `SELECT lq.id,
              lq.user_id,
              lq.sender_wallet,
              lq.amount,
              lq.asset,
              lq.retry_count,
              t.status  AS tx_status,
              t.tx_hash
         FROM loyalty_mint_queue lq
         JOIN transactions t ON t.id = lq.id
        WHERE lq.status = 'pending'
          AND t.status  = 'completed'
        ORDER BY lq.created_at ASC
        LIMIT 1
          FOR UPDATE OF lq SKIP LOCKED`,
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const job = rows[0];

    // Advance status to 'processing' and bump retry_count while we still
    // hold the row lock inside this transaction.
    await client.query(
      `UPDATE loyalty_mint_queue
          SET status      = 'processing',
              retry_count = retry_count + 1
        WHERE id = $1`,
      [job.id],
    );

    await client.query('COMMIT');

    // Return the row with the pre-increment retry_count so callers can
    // make retry decisions without an extra round-trip.
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function processLoyaltyMintQueue() {
  const CONCURRENCY = parseInt(process.env.LOYALTY_MINT_CONCURRENCY || '5', 10);

  for (let i = 0; i < CONCURRENCY; i++) {
    // Defense-in-depth: acquire a per-slot distributed lock so that if
    // multiple replicas race on the same concurrency slot they still
    // serialise the claim step. withLock returns false (without calling fn)
    // when Redis reports the slot is already held; it returns true (and runs
    // fn) in single-instance / no-Redis mode, relying on FOR UPDATE SKIP
    // LOCKED alone.
    const lockKey = `loyalty_mint:slot:${i}`;

    await withLock(lockKey, 30, async () => {
      const client = await db.pool.connect();
      try {
        const job = await claimNextJob(client);
        if (!job) return;

        const points = Math.max(
          1,
          Math.floor(estimateXlmEquivalent(job.amount, job.asset)),
        );

        try {
          const result = await mintPoints({
            recipientWallet: job.sender_wallet,
            points,
          });

          if (result) {
            await db.query(
              `UPDATE loyalty_mint_queue
                  SET status       = 'completed',
                      tx_hash      = $1,
                      completed_at = NOW()
                WHERE id = $2`,
              [result.txHash, job.id],
            );

            // Record the mint in the loyalty_points off-chain ledger.
            await db.query(
              `INSERT INTO loyalty_points
                     (id, user_id, wallet_address, event_type, points,
                      transaction_id, tx_hash)
               VALUES ($1, $2, $3, 'mint', $4, $5, $6)`,
              [
                uuidv4(),
                job.user_id,
                job.sender_wallet,
                points,
                job.id,
                result.txHash,
              ],
            );

            await persistAndBroadcast(
              job.user_id,
              'loyalty_points_earned',
              'Loyalty Points Earned',
              `You earned ${points} loyalty points for your recent payment!`,
              { points, tx_hash: result.txHash },
            ).catch(() => {});
          } else {
            // mintPoints returned null — contract not configured, treat as
            // a successful no-op so the job doesn't stay in 'processing'.
            await db.query(
              `UPDATE loyalty_mint_queue
                  SET status       = 'completed',
                      completed_at = NOW()
                WHERE id = $1`,
              [job.id],
            );
          }
        } catch (err) {
          // retry_count was already incremented by claimNextJob's UPDATE,
          // so compare against the value read before that increment.
          const retriesUsed = (job.retry_count || 0) + 1;

          if (retriesUsed < 3) {
            await db.query(
              `UPDATE loyalty_mint_queue
                  SET status      = 'pending',
                      last_error  = $1,
                      retry_count = retry_count + 1
                WHERE id = $2`,
              [err.message, job.id],
            );
            logger.warn('Loyalty mint deferred, will retry', {
              jobId: job.id,
              error: err.message,
              retriesUsed,
            });
          } else {
            await db.query(
              `UPDATE loyalty_mint_queue
                  SET status       = 'failed',
                      last_error   = $1,
                      completed_at = NOW()
                WHERE id = $2`,
              [err.message, job.id],
            );
            logger.error('Loyalty mint failed after max retries', {
              jobId: job.id,
              error: err.message,
              retriesUsed,
            });
          }
        }
      } catch (err) {
        logger.warn('Loyalty mint queue processing error', {
          error: err.message,
        });
      } finally {
        client.release();
      }
    });
  }
}

async function enqueueLoyaltyMint(txId, userId, senderWallet, amount, asset) {
  if (!process.env.LOYALTY_TOKEN_CONTRACT_ID) return null;

  const { rows } = await db.query(
    `INSERT INTO loyalty_mint_queue (id, user_id, sender_wallet, amount, asset)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [txId, userId, senderWallet, amount, asset],
  );
  return rows[0]?.id ?? null;
}

module.exports = { processLoyaltyMintQueue, enqueueLoyaltyMint };
