'use strict';

const db = require('../db');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const RULES_CACHE_KEY = 'fraud:rules';
const RULES_CACHE_TTL = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Rule loading
// ---------------------------------------------------------------------------

async function loadRules() {
  const cached = await cache.get(RULES_CACHE_KEY);
  if (cached) return cached;

  const { rows } = await db.query(
    `SELECT id, name, rule_type, parameters FROM fraud_rules WHERE is_active = true`
  );
  await cache.set(RULES_CACHE_KEY, rows, RULES_CACHE_TTL);
  return rows;
}

async function invalidateRulesCache() {
  await cache.del(RULES_CACHE_KEY);
}

// ---------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------

async function evaluateVelocity(rule, walletAddress) {
  const { max_transactions, window_minutes } = rule.parameters;
  const { rows } = await db.query(
    `SELECT COUNT(*) FROM transactions
     WHERE sender_wallet = $1 AND created_at > NOW() - ($2 * INTERVAL '1 minute')`,
    [walletAddress, window_minutes]
  );
  const count = parseInt(rows[0].count, 10);
  if (count >= max_transactions) {
    return {
      triggered: true,
      message: `Exceeded ${max_transactions} transactions in ${window_minutes} minutes`,
    };
  }
  return { triggered: false };
}

async function evaluateAmount(rule, _walletAddress, amount, asset) {
  const { max_usd } = rule.parameters;
  const usdValue = toUsd(amount, asset);
  if (usdValue > max_usd) {
    return {
      triggered: true,
      message: `Transaction amount $${usdValue.toFixed(2)} exceeds single-transaction limit of $${max_usd}`,
    };
  }
  return { triggered: false };
}

async function evaluateDailyLimit(rule, walletAddress, amount, asset) {
  const { max_usd } = rule.parameters;
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
     WHERE sender_wallet = $1 AND created_at > NOW() - INTERVAL '24 hours' AND status != 'cancelled'`,
    [walletAddress]
  );
  const sentUsd = toUsd(rows[0].total, asset);
  const newUsd = toUsd(amount, asset);
  if (sentUsd + newUsd > max_usd) {
    return {
      triggered: true,
      message: `Daily limit of $${max_usd} would be exceeded ($${(sentUsd + newUsd).toFixed(2)} total)`,
    };
  }
  return { triggered: false };
}

function toUsd(amount, asset) {
  const n = parseFloat(amount) || 0;
  if (asset === 'USDC') return n;
  if (asset === 'XLM') return n * parseFloat(process.env.XLM_USD_RATE || '0.10');
  return 0;
}

const EVALUATORS = {
  velocity: evaluateVelocity,
  amount: evaluateAmount,
  daily_limit: evaluateDailyLimit,
};

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * Evaluate all active fraud rules against a payment.
 * Returns { blocked, rule, message } where blocked=false if no rule triggers.
 */
async function checkFraud(walletAddress, amount, asset, paymentId = null) {
  let rules;
  try {
    rules = await loadRules();
  } catch (err) {
    logger.warn('Failed to load fraud rules, falling back to pass-through', { error: err.message });
    return { blocked: false };
  }

  for (const rule of rules) {
    const evaluator = EVALUATORS[rule.rule_type];
    if (!evaluator) continue;

    let result;
    try {
      result = await evaluator(rule, walletAddress, amount, asset);
    } catch (err) {
      logger.warn('Fraud rule evaluation error', { rule: rule.name, error: err.message });
      continue;
    }

    const outcome = result.triggered ? 'blocked' : 'passed';
    // Log to audit table (fire-and-forget)
    db.query(
      `INSERT INTO fraud_checks (rule_name, rule_type, outcome, payment_id, wallet_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rule.name, rule.rule_type, outcome, paymentId || null, walletAddress,
       JSON.stringify({ amount, asset, ...result })]
    ).catch(e => logger.warn('fraud_checks insert failed', { error: e.message }));

    if (result.triggered) {
      return { blocked: true, rule: rule.name, message: result.message };
    }
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Legacy compatibility (checkVelocity / checkDailyLimit used by old tests)
// ---------------------------------------------------------------------------

async function checkVelocity(walletAddress) {
  const windowHours = parseInt(process.env.DAILY_LIMIT_WINDOW_HOURS || '24', 10);
  const maxTx = parseInt(process.env.FRAUD_MAX_TX_PER_WINDOW || '5', 10);
  const { rows } = await db.query(
    `SELECT COUNT(*) FROM transactions
     WHERE sender_wallet = $1 AND created_at > NOW() - ($2 * INTERVAL '1 hour')`,
    [walletAddress, windowHours]
  );
  return parseInt(rows[0].count, 10) >= maxTx;
}

async function checkDailyLimit(walletAddress, amount, asset) {
  const limitUsd = parseFloat(process.env.FRAUD_DAILY_LIMIT_USD || '1000');
  const windowHours = parseInt(process.env.DAILY_LIMIT_WINDOW_HOURS || '24', 10);
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
     WHERE sender_wallet = $1 AND created_at > NOW() - ($2 * INTERVAL '1 hour')`,
    [walletAddress, windowHours]
  );
  const sentUsd = toUsd(rows[0].total, asset);
  const newUsd = toUsd(amount, asset);
  return sentUsd + newUsd > limitUsd;
}

async function logFraudBlock(walletAddress, reason, amount, asset) {
  await db.query(
    `INSERT INTO fraud_blocks (wallet_address, reason, amount, asset)
     VALUES ($1, $2, $3, $4)`,
    [walletAddress, reason, amount, asset]
  );
}

module.exports = {
  checkFraud,
  checkVelocity,
  checkDailyLimit,
  logFraudBlock,
  loadRules,
  invalidateRulesCache,
};
