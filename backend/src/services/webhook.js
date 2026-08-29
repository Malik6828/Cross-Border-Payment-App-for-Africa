const https = require('https');
const db = require('../db');
const logger = require('../utils/logger');
const { isPrivateIp } = require('../utils/ssrfValidator');
const { decryptSecret } = require('../utils/symmetricEncryption');
const { sign, buildSignatureHeader } = require('../utils/webhookSignature');

const MAX_ATTEMPTS = 3;

/**
 * Check if a URL is a valid public HTTPS endpoint
 * Re-validates before each delivery to catch DNS rebinding attacks
 */
async function isPublicHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname;

  // Reject bare private IPs
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && isPrivateIp(hostname)) {
    return false;
  }

  // Resolve and check returned IP
  try {
    const { address } = await require('dns').promises.lookup(hostname);
    if (isPrivateIp(address)) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

function httpsPost(url, body, signature) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-AfriPay-Signature-256': `sha256=${signature}`,
      },
    };
    const req = https.request(options, (res) => {
      res.resume();
      res.statusCode >= 200 && res.statusCode < 300 ? resolve(res.statusCode) : reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function createDeliveryLog(webhookId, eventType, targetUrl, attempt, maxAttempts, payload) {
  const { rows } = await db.query(
    `INSERT INTO webhook_deliveries (webhook_id, event_type, target_url, status, attempt, max_attempts, payload)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6)
     RETURNING id`,
    [webhookId, eventType, targetUrl, attempt, maxAttempts, JSON.stringify(payload)]
  );
  return rows[0].id;
}

async function updateDeliveryLog(deliveryId, status, statusCode, responseTimeMs, errorMessage) {
  await db.query(
    `UPDATE webhook_deliveries
     SET status = $1, status_code = $2, response_time_ms = $3, error_message = $4, completed_at = NOW()
     WHERE id = $5`,
    [status, statusCode || null, responseTimeMs || null, errorMessage || null, deliveryId]
  );
}

// Build the list of plaintext secrets a delivery should be signed with: the
// current secret, plus the previous one if it's still inside its rotation
// overlap window — lets a merchant who hasn't rolled their verification key
// yet keep validating deliveries sent right after a rotation.
function activeSecrets(row) {
  const secrets = [decryptSecret(row.secret)];
  if (row.previous_secret && row.previous_secret_expires_at && new Date(row.previous_secret_expires_at) > new Date()) {
    secrets.push(decryptSecret(row.previous_secret));
  }
  return secrets;
}

async function deliverWithRetry(webhookId, url, secrets, payload, attempt = 0) {
  // Re-validate URL before each delivery to catch DNS rebinding / stale records
  if (!await isPublicHttpsUrl(url)) {
    logger.error('Webhook delivery blocked: URL failed SSRF validation', { url });
    await createDeliveryLog(webhookId, payload.event, url, attempt + 1, MAX_ATTEMPTS, payload)
      .then((id) => updateDeliveryLog(id, 'failed', null, null, 'SSRF validation failed'));
    return;
  }
  const body = JSON.stringify(payload);
  const signature = buildSignatureHeader(secrets, body);
  const deliveryId = await createDeliveryLog(webhookId, payload.event, url, attempt + 1, MAX_ATTEMPTS, payload);
  const start = Date.now();
  try {
    const statusCode = await httpsPost(url, body, signature);
    const responseTime = Date.now() - start;
    await updateDeliveryLog(deliveryId, 'delivered', statusCode, responseTime, null);
  } catch (err) {
    const responseTime = Date.now() - start;
    const statusCodeMatch = err.message.match(/HTTP (\d+)/);
    const statusCode = statusCodeMatch ? parseInt(statusCodeMatch[1]) : null;
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn('Webhook delivery failed, retrying', {
        url,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        delay,
        error: err.message,
      });
      await new Promise((r) => setTimeout(r, delay));
      return deliverWithRetry(webhookId, url, secrets, payload, attempt + 1);
    }
    // All attempts exhausted
    await updateDeliveryLog(deliveryId, 'failed', statusCode, responseTime, err.message);
    logger.error('Webhook delivery permanently failed after max retries', {
      url,
      event: payload.event,
      attempts: MAX_ATTEMPTS,
      error: err.message,
    });
  }
}

async function retryDelivery(deliveryId) {
  const { rows } = await db.query(
    `SELECT wd.webhook_id, wd.target_url, wd.payload, wd.event_type,
            w.url, w.secret, w.previous_secret, w.previous_secret_expires_at
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.id = $1 AND wd.status = 'failed'`,
    [deliveryId]
  );
  if (!rows.length) throw new Error('Delivery not found or not failed');
  const row = rows[0];
  const parsedPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  await deliverWithRetry(row.webhook_id, row.url, activeSecrets(row), { ...parsedPayload, event: row.event_type });
}

async function deliver(event, data) {
  const { rows } = await db.query(
    `SELECT id, url, secret, previous_secret, previous_secret_expires_at
     FROM webhooks WHERE active = true AND $1 = ANY(events)`,
    [event]
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = { timestamp, event, data };
  await Promise.all(rows.map((wh) => deliverWithRetry(wh.id, wh.url, activeSecrets(wh), payload)));
}

module.exports = { deliver, sign, retryDelivery, MAX_ATTEMPTS };
