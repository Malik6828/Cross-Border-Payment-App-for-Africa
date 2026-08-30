/**
 * Loyalty Mint Queue
 *
 * Durable queue backing on-chain loyalty point minting. Payments enqueue a
 * row here instead of firing the Soroban call inline, so a transient RPC
 * failure (or a permanently-failing mint) can't silently drop points or
 * block the request path. backend/src/jobs/loyaltyMintJob.js drains it.
 */

const db = require('../db');

async function enqueueMint({ userId, walletAddress, points }) {
  await db.query(
    `INSERT INTO loyalty_mint_queue (user_id, wallet_address, points)
     VALUES ($1, $2, $3)`,
    [userId, walletAddress, points],
  );
}

module.exports = { enqueueMint };
