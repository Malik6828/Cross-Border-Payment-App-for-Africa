const StellarSdk = require('@stellar/stellar-sdk');
const db = require('../db');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

const server = new StellarSdk.Horizon.Server(
  process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org'
);

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_FAILURES_BEFORE_ALERT = 10;

const activeStreams = new Map();
let io = null;

const healthState = {
  status: 'connected',
  last_event_at: null,
  reconnect_attempts: 0,
};

function setSocketIO(socketIO) {
  io = socketIO;
}

function getHealth() {
  return { ...healthState };
}

function backoffMs(attempt) {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

async function fireAlert(message) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const body = JSON.stringify({ text: message });
    await new Promise((resolve) => {
      const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, resolve);
      req.on('error', () => {});
      req.write(body);
      req.end();
    });
  } catch {}
}

async function startStreamForAccount(publicKey, attempt = 0) {
  if (activeStreams.has(publicKey)) return;

  if (attempt > 0) {
    healthState.status = 'reconnecting';
    healthState.reconnect_attempts = attempt;
    const delay = backoffMs(attempt - 1);
    logger.info('Reconnecting transaction stream', { publicKey, attempt, delayMs: delay });
    await new Promise((r) => setTimeout(r, delay));
    if (attempt >= MAX_FAILURES_BEFORE_ALERT) {
      fireAlert(`LedgerListener: ${MAX_FAILURES_BEFORE_ALERT} consecutive tx stream failures for ${publicKey}`);
    }
  }

  logger.info('Starting transaction stream', { publicKey });

  let pagingToken = 'now';
  try {
    const cached = await cache.get(`ledger:cursor:tx:${publicKey}`);
    if (cached) pagingToken = cached;
  } catch {}

  const close = server
    .transactions()
    .forAccount(publicKey)
    .cursor(pagingToken)
    .stream({
      onmessage: async (tx) => {
        healthState.last_event_at = new Date().toISOString();
        healthState.status = 'connected';
        healthState.reconnect_attempts = 0;
        cache.set(`ledger:cursor:tx:${publicKey}`, tx.paging_token, 3600).catch(() => {});
        try {
          await db.query(
            `UPDATE transactions SET status = 'completed', confirmed_at = NOW()
             WHERE transaction_hash = $1 AND status = 'pending'`,
            [tx.hash]
          );
          if (io) {
            io.to(publicKey).emit('payment:confirmed', {
              hash: tx.hash,
              account: publicKey,
              timestamp: tx.created_at,
            });
          }
          logger.info('Transaction confirmed', { hash: tx.hash, account: publicKey });
        } catch (err) {
          logger.warn('Failed to process transaction', { hash: tx.hash, error: err.message });
        }
      },
      onerror: (err) => {
        logger.warn('Transaction stream error', { publicKey, attempt, error: err.message });
        activeStreams.delete(publicKey);
        startStreamForAccount(publicKey, attempt + 1);
      },
    });

  activeStreams.set(publicKey, close);
  if (attempt === 0) {
    healthState.status = 'connected';
    healthState.reconnect_attempts = 0;
  }
}

async function startPaymentStream(publicKey, attempt = 0) {
  const key = `${publicKey}:payments`;
  if (activeStreams.has(key)) return;

  if (attempt > 0) {
    const delay = backoffMs(attempt - 1);
    logger.info('Reconnecting payment stream', { publicKey, attempt, delayMs: delay });
    await new Promise((r) => setTimeout(r, delay));
    if (attempt >= MAX_FAILURES_BEFORE_ALERT) {
      fireAlert(`LedgerListener: ${MAX_FAILURES_BEFORE_ALERT} consecutive payment stream failures for ${publicKey}`);
    }
  }

  logger.info('Starting payment stream', { publicKey });

  let pagingToken = 'now';
  try {
    const cached = await cache.get(`ledger:cursor:pay:${publicKey}`);
    if (cached) pagingToken = cached;
  } catch {}

  const close = server
    .payments()
    .forAccount(publicKey)
    .cursor(pagingToken)
    .stream({
      onmessage: async (payment) => {
        healthState.last_event_at = new Date().toISOString();
        cache.set(`ledger:cursor:pay:${publicKey}`, payment.paging_token, 3600).catch(() => {});
        if (payment.type !== 'payment' || payment.to !== publicKey) return;
        const amount = payment.amount;
        const asset = payment.asset_type === 'native' ? 'XLM' : payment.asset_code;
        const from = payment.from;
        if (io) {
          io.to(publicKey).emit('payment:received', {
            from, to: publicKey, amount, asset,
            hash: payment.transaction_hash,
            timestamp: payment.created_at,
          });
        }
        logger.info('Payment received', { to: publicKey, amount, asset, from });
      },
      onerror: (err) => {
        logger.warn('Payment stream error', { publicKey, attempt, error: err.message });
        activeStreams.delete(key);
        startPaymentStream(publicKey, attempt + 1);
      },
    });

  activeStreams.set(key, close);
}

let heartbeatTimer = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!healthState.last_event_at) return;
    const sinceLastEvent = Date.now() - new Date(healthState.last_event_at).getTime();
    if (sinceLastEvent > HEARTBEAT_INTERVAL_MS) {
      logger.warn('Heartbeat: no event received, triggering reconnect', { sinceLastEventMs: sinceLastEvent });
      for (const [key, close] of activeStreams) {
        try { close(); } catch {}
        activeStreams.delete(key);
      }
      initStreams().catch(() => {});
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopStream(publicKey) {
  const txClose = activeStreams.get(publicKey);
  const payClose = activeStreams.get(`${publicKey}:payments`);
  if (txClose) { txClose(); activeStreams.delete(publicKey); }
  if (payClose) { payClose(); activeStreams.delete(`${publicKey}:payments`); }
}

async function initStreams() {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT w.public_key
       FROM wallets w
       JOIN users u ON u.id = w.user_id
       WHERE u.email_verified = TRUE`
    );
    for (const row of rows) {
      startStreamForAccount(row.public_key);
      startPaymentStream(row.public_key);
    }
    startHeartbeat();
    logger.info('Ledger streams initialized', { count: rows.length });
  } catch (err) {
    logger.error('Failed to init ledger streams', { error: err.message });
  }
}

module.exports = {
  setSocketIO,
  startStreamForAccount,
  startPaymentStream,
  stopStream,
  initStreams,
  getHealth,
};
