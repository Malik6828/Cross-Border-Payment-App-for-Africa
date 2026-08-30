/**
 * Agent Escrow Controller
 *
 * Handles trustless agent payout escrow via the Soroban agent-escrow contract.
 *
 * Routes:
 *   POST /api/escrow/create          — sender creates escrow
 *   POST /api/escrow/:id/confirm     — agent confirms payout
 *   POST /api/escrow/:id/cancel      — sender cancels after 48 h
 *   GET  /api/escrow/:id             — fetch escrow record from DB
 */

const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { createEscrow, confirmPayout, cancelEscrow } = require("../services/agentEscrow");
const { enqueueEmail } = require("../services/email");
const audit = require("../services/audit");

const DEFAULT_FEE_BPS = parseInt(process.env.ESCROW_FEE_BPS || "250", 10);

/**
 * POST /api/escrow/create
 * Body: { agent_wallet, recipient_wallet, amount, asset }
 */
async function create(req, res, next) {
  const escrowDbId = uuidv4();
  try {
    const { agent_wallet, recipient_wallet, amount, asset = "USDC" } = req.body;

    // Validate that the agent is a registered, approved AfriPay agent
    const agentResult = await db.query(
      "SELECT id FROM agents WHERE wallet_address = $1 AND status = 'approved'",
      [agent_wallet]
    );
    if (!agentResult.rows[0]) {
      return res.status(400).json({ error: "Agent is not registered in the AfriPay network" });
    }

    const walletResult = await db.query(
      "SELECT public_key, encrypted_secret_key FROM wallets WHERE user_id = $1",
      [req.user.userId]
    );
    if (!walletResult.rows[0]) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    const { public_key, encrypted_secret_key } = walletResult.rows[0];

    const { escrowId, txHash } = await createEscrow({
      encryptedSecretKey: encrypted_secret_key,
      recipient: recipient_wallet,
      agent: agent_wallet,
      amount: Math.round(parseFloat(amount) * 1e7), // convert to stroops
      feeBps: DEFAULT_FEE_BPS,
    });

    await db.query(
      `INSERT INTO agent_escrows
         (id, contract_escrow_id, sender_wallet, recipient_wallet, agent_wallet,
          amount, asset, fee_bps, status, tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [
        escrowDbId,
        escrowId,
        public_key,
        recipient_wallet,
        agent_wallet,
        amount,
        asset,
        DEFAULT_FEE_BPS,
        txHash,
      ]
    );

    res.status(201).json({
      message: "Escrow created",
      escrow: { id: escrowDbId, contract_escrow_id: escrowId, tx_hash: txHash, status: "pending" },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/agent-escrow/:id/confirm-payout
 * Agent confirms off-chain fiat delivery. Requires role: 'agent'.
 */
async function confirm(req, res, next) {
  try {
    if (req.user.role !== "agent") {
      return res.status(403).json({ error: "Only agents can confirm payouts" });
    }

    const { id } = req.params;

    const escrowResult = await db.query(
      "SELECT * FROM agent_escrows WHERE id = $1",
      [id]
    );
    if (!escrowResult.rows[0]) {
      return res.status(404).json({ error: "Escrow not found" });
    }
    const escrow = escrowResult.rows[0];

    if (escrow.status !== "pending") {
      return res.status(400).json({ error: "Escrow is not pending" });
    }

    // Verify the authenticated agent is the assigned agent for this escrow
    const agentWalletResult = await db.query(
      "SELECT public_key FROM wallets WHERE user_id = $1",
      [req.user.userId]
    );
    if (!agentWalletResult.rows[0] || agentWalletResult.rows[0].public_key !== escrow.agent_wallet) {
      return res.status(403).json({ error: "You are not the assigned agent for this escrow" });
    }

    // Fetch the service account key — the backend signs the on-chain tx
    const walletResult = await db.query(
      "SELECT encrypted_secret_key FROM wallets WHERE public_key = $1",
      [escrow.agent_wallet]
    );
    if (!walletResult.rows[0]) {
      return res.status(403).json({ error: "Agent wallet not registered on this platform" });
    }

    // Call Soroban confirm_payout — only update DB if this succeeds
    let txHash;
    try {
      ({ txHash } = await confirmPayout({
        encryptedSecretKey: walletResult.rows[0].encrypted_secret_key,
        escrowId: escrow.contract_escrow_id,
      }));
    } catch (stellarErr) {
      return res.status(502).json({ error: "On-chain confirmation failed", detail: stellarErr.message });
    }

    await db.query(
      "UPDATE agent_escrows SET status = 'completed', confirm_tx_hash = $1, confirmed_at = NOW() WHERE id = $2",
      [txHash, id]
    );

    // Notify sender
    const senderResult = await db.query(
      "SELECT u.email, u.full_name, a.full_name AS agent_name FROM users u JOIN wallets w ON w.user_id = u.id LEFT JOIN agents a ON a.wallet_address = $2 WHERE w.public_key = $1 LIMIT 1",
      [escrow.sender_wallet, escrow.agent_wallet]
    );
    if (senderResult.rows[0]) {
      const { email, full_name, agent_name } = senderResult.rows[0];
      enqueueEmail({
        to: email,
        subject: "Your AfriPay payment has been delivered",
        html: `<p>Hi ${full_name},</p><p>Your payment of <strong>${escrow.amount} ${escrow.asset}</strong> has been delivered to ${escrow.recipient_wallet} by agent <strong>${agent_name || escrow.agent_wallet}</strong>.</p>`,
      }).catch(() => {});
    }

    await audit.log(
      req.user.userId,
      "agent_escrow_confirmed",
      req.ip,
      req.headers["user-agent"],
      { escrow_id: id, agent_id: req.user.userId, tx_hash: txHash }
    );

    res.json({ message: "Payout confirmed", tx_hash: txHash });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/escrow/:id/cancel
 * Sender cancels after the 48-hour window.
 */
async function cancel(req, res, next) {
  try {
    const { id } = req.params;

    const escrowResult = await db.query(
      "SELECT * FROM agent_escrows WHERE id = $1",
      [id]
    );
    if (!escrowResult.rows[0]) {
      return res.status(404).json({ error: "Escrow not found" });
    }
    const escrow = escrowResult.rows[0];

    if (escrow.status !== "pending") {
      return res.status(400).json({ error: "Escrow is not pending" });
    }
    if (escrow.sender_wallet !== req.user.walletAddress) {
      return res.status(403).json({ error: "Only the sender can cancel this escrow" });
    }

    const walletResult = await db.query(
      "SELECT encrypted_secret_key FROM wallets WHERE user_id = $1",
      [req.user.userId]
    );

    const { txHash } = await cancelEscrow({
      encryptedSecretKey: walletResult.rows[0].encrypted_secret_key,
      escrowId: escrow.contract_escrow_id,
    });

    await db.query(
      "UPDATE agent_escrows SET status = 'cancelled', confirm_tx_hash = $1 WHERE id = $2",
      [txHash, id]
    );

    res.json({ message: "Escrow cancelled, funds refunded", tx_hash: txHash });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contracts/escrow/:id/partial-release
 * Body: { amount }
 *
 * Sender releases part of a pending escrow to the agent (issue #657).
 * Validates the amount against the remaining balance, applies the platform fee,
 * records the cumulative released amount, and returns the new remaining balance.
 */
async function partialRelease(req, res, next) {
  const { id } = req.params;
  const amount = parseFloat(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0" });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the escrow row for the duration of the transaction so concurrent
    // partial-release requests serialize instead of racing on a stale read.
    const escrowResult = await client.query(
      "SELECT * FROM agent_escrows WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!escrowResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Escrow not found" });
    }
    const escrow = escrowResult.rows[0];

    if (escrow.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only pending escrows can be partially released" });
    }
    if (escrow.sender_wallet !== req.user.walletAddress) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only the sender can release this escrow" });
    }

    const total = parseFloat(escrow.amount);
    const alreadyReleased = parseFloat(escrow.released_amount || 0);
    const remaining = total - alreadyReleased;

    if (amount > remaining + 1e-7) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Amount exceeds remaining escrow balance (${remaining})`,
      });
    }

    const feeBps = escrow.fee_bps || DEFAULT_FEE_BPS;
    const feeAmount = (amount * feeBps) / 10000;
    const netToAgent = amount - feeAmount;

    const newReleased = alreadyReleased + amount;
    const newRemaining = total - newReleased;
    // Fully drained escrows transition to completed.
    const fullyReleased = newRemaining <= 1e-7;

    const updated = await client.query(
      `UPDATE agent_escrows
         SET released_amount = $1,
             status = CASE WHEN $2 THEN 'completed' ELSE status END
       WHERE id = $3
       RETURNING *`,
      [newReleased, fullyReleased, id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Partial release successful",
      escrow: updated.rows[0],
      released: amount,
      fee: feeAmount,
      net_to_agent: netToAgent,
      remaining_balance: newRemaining,
      status: updated.rows[0].status,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/**
 * GET /api/escrow/:id
 */
async function getEscrow(req, res, next) {
  try {
    const result = await db.query(
      "SELECT * FROM agent_escrows WHERE id = $1",
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Escrow not found" });
    }
    const escrow = result.rows[0];

    const isParty =
      req.user.walletAddress === escrow.sender_wallet ||
      req.user.walletAddress === escrow.agent_wallet;
    if (!isParty && req.user.role !== "admin") {
      return res.status(403).json({ error: "You are not authorized to view this escrow" });
    }

    res.json({ escrow });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, confirm, cancel, getEscrow, partialRelease };
