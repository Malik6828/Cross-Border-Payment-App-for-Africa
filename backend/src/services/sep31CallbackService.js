const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');

const PRIVATE_IP_PATTERN = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc|fd)/;
const MAX_ATTEMPTS = 5;

function validateCallbackUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (PRIVATE_IP_PATTERN.test(parsed.hostname)) return false;
  const lower = parsed.hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) return false;
  return true;
}

function signPayload(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(body));
  return `sha256=${hmac.digest('hex')}`;
}

async function deliverCallback(transaction, attempt = 1) {
  const { id, callback_url, shared_secret, status, status_message, stellar_transaction_id, refunded } = transaction;
  if (!callback_url) return;

  const body = { id, status };
  if (status_message) body.status_message = status_message;
  if (stellar_transaction_id) body.stellar_transaction_id = stellar_transaction_id;
  if (refunded) body.refunded = refunded;

  const signature = signPayload(body, shared_secret || '');
  const start = Date.now();
  let httpStatus = null;

  try {
    const resp = await fetch(callback_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stellar-Signature': signature,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = resp.status;
  } catch (err) {
    logger.warn('SEP-31 callback delivery failed', { txId: id, attempt, error: err.message });
  }

  const responseTimeMs = Date.now() - start;

  await db.query(
    `INSERT INTO sep31_callbacks (transaction_id, url, http_status, response_time_ms, attempt_number)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, callback_url, httpStatus, responseTimeMs, attempt]
  ).catch((err) => logger.warn('Failed to log sep31 callback', { error: err.message }));

  const success = httpStatus && httpStatus >= 200 && httpStatus < 300;
  if (!success && attempt < MAX_ATTEMPTS) {
    const delay = Math.pow(2, attempt) * 1000;
    setTimeout(() => deliverCallback(transaction, attempt + 1), delay);
  }
}

module.exports = { validateCallbackUrl, deliverCallback };
