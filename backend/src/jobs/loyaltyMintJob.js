/**
 * Loyalty Mint Queue Worker
 *
 * Drains backend/src/services/loyaltyMintQueue.js. A queued mint that keeps
 * panicking on-chain (e.g. a sanctioned/blocked wallet, or an amount that
 * would exceed the loyalty-token contract's max_supply) is retried a bounded
 * number of times and then moved to 'dead_letter' so it stops blocking every
 * other mint behind it in the queue. Dead-lettering pages ops via alerting.js.
 */

const db = require('../db');
const { mintPoints } = require('../services/loyaltyToken');
const { notifyOps } = require('../utils/alerting');
const logger = require('../utils/logger');

const BATCH_SIZE = 25;

async function processLoyaltyMintQueue() {
  // Claim a batch atomically so multiple worker instances don't double-process
  const { rows: batch } = await db.query(
    `UPDATE loyalty_mint_queue
        SET status = 'processing', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM loyalty_mint_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, user_id, wallet_address, points, attempts, max_attempts`,
    [BATCH_SIZE],
  );

  for (const item of batch) {
    try {
      const result = await mintPoints({ recipientWallet: item.wallet_address, points: Number(item.points) });
      await db.query(
        `UPDATE loyalty_mint_queue
            SET status = 'completed', tx_hash = $1, processed_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        [result?.txHash || null, item.id],
      );
    } catch (err) {
      const attempts = item.attempts + 1;
      const isDead = attempts >= item.max_attempts;

      await db.query(
        `UPDATE loyalty_mint_queue
            SET attempts = $1,
                status = $2,
                last_error = $3,
                updated_at = NOW(),
                processed_at = CASE WHEN $2 = 'dead_letter' THEN NOW() ELSE processed_at END
          WHERE id = $4`,
        [attempts, isDead ? 'dead_letter' : 'pending', err.message, item.id],
      );

      if (isDead) {
        logger.error('Loyalty mint permanently failed — dead-lettered', {
          queueId: item.id,
          userId: item.user_id,
          attempts,
          error: err.message,
        });
        await notifyOps('Loyalty mint dead-lettered after max retries', {
          queueId: item.id,
          userId: item.user_id,
          walletAddress: item.wallet_address,
          points: item.points,
          attempts,
          error: err.message,
        });
      } else {
        logger.warn('Loyalty mint failed, will retry', {
          queueId: item.id,
          userId: item.user_id,
          attempts,
          maxAttempts: item.max_attempts,
          error: err.message,
        });
      }
    }
  }

  return { processed: batch.length };
}

module.exports = { processLoyaltyMintQueue };
