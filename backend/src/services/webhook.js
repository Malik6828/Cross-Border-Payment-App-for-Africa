'use strict';

const https = require('https');
const db = require('../db');
const { sign } = require('../utils/webhookSignature');
const { validateOutboundUrl } = require('../utils/ssrf');
const { decryptSecret } = require('../utils/symmetricEncryption');
const logger = require('../utils/logger');
const { validatePublicUrl: isPublicHttpsUrl } = require('../utils/ssrf');

const MAX_ATTEMPTS = 3;

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function httpsPost(url, body, signature) {
/**
 * Perform a single HTTPS POST with the AfriPay webhook signature header.
 *
 * @param {string} url       - Fully-qualified HTTPS URL
 * @param {string} body      - JSON-serialised payload string
 * @param {string} signature - Hex HMAC-SHA256 digest of body
 * @param {import('https').Agent|undefined} agent - DNS-pinned agent (SSRF protection)
 * @returns {Promise<number>} Resolves with the HTTP status code on 2xx
 */
function httpsPost(url, body, signature, agent) {
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
      // Use the DNS-pinned agent from SSRF validation to prevent DNS rebinding
      ...(agent && { agent }),
    };
    const req = https.request(options, (res) => {
      res.resume();
      // Block redirects to prevent DNS rebinding via 3xx responses
      if (res.statusCode >= 300 && res.statusCode < 400) {
        return reject(
          new Error(`Redirect blocked (HTTP ${res.statusCode}) — follow redirects is disabled for security`)
        );
      }
      res.statusCode >= 200 && res.statusCode < 300
        ? resolve(res.statusCode)
        : reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Deliver a webhook payload to a single subscriber URL with exponential-backoff retry.
 *
 * On each failed attempt before the last one, logs a warning with metadata so
 * operators can track transient delivery failures.  After exhausting all attempts,
 * logs a single error.
 *
 * @param {string|null} webhookId - Subscriber row ID (for logging; may be null)
 * @param {string}      url       - Target HTTPS endpoint
 * @param {string}      secret    - Plain-text HMAC secret (already decrypted by caller)
 * @param {object}      payload   - Object with at minimum { event: string }
 * @param {number}      [attempt=0] - Zero-based attempt counter (used internally for retries)
 */
async function deliverWithRetry(webhookId, url, secret, payload, attempt = 0) {
  const ssrfCheck = await validateOutboundUrl(url);
  if (!ssrfCheck.valid) {
    logger.error('Webhook delivery blocked: URL failed SSRF validation', {
      url,
      reason: ssrfCheck.error,
    });
    return;
  }

  const body = JSON.stringify(payload);
  const signature = sign(secret, body);

  try {
    await httpsPost(url, body, signature, ssrfCheck.agent);
  } catch (err) {
    const errMessage = err.message.includes('Error:')
      ? err.message.replace(/^Error:\s*/, '')
      : err.message;

    if (attempt < MAX_ATTEMPTS - 1) {
      // Transient failure — log a warning and schedule a retry
      logger.warn('Webhook delivery failed, retrying', {
        url,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        error: errMessage,
      });
      const delay = Math.pow(2, attempt) * 1000;
      setTimeout(() => deliverWithRetry(webhookId, url, secret, payload, attempt + 1), delay);
    } else {
      // Final attempt failed — log an error and give up
      logger.error('Webhook delivery permanently failed', {
        url,
        event: payload.event,
        attempts: MAX_ATTEMPTS,
        error: errMessage,
      });
    }
  }
}

/**
 * Fan-out a webhook event to every active subscriber registered for that event.
 *
 * Wraps each delivery in a fire-and-forget pattern: errors are logged but never
 * propagate to the caller so a bad subscriber never disrupts the payment flow.
 *
 * @param {string} event - Event name, e.g. "payment.sent"
 * @param {object} data  - Arbitrary event-specific payload data
 * @returns {Promise<void>}
 */
async function deliver(event, data) {
  const { rows } = await db.query(
    `SELECT id, url, secret FROM webhooks WHERE active = true AND $1 = ANY(events)`,
    [event]
  );

  if (!rows.length) return;

  const payload = {
    event,
    data,
    timestamp: Date.now(),
  };

  await Promise.all(
    rows.map((wh) => {
      const plainSecret = decryptSecret(wh.secret);
      return deliverWithRetry(wh.id || null, wh.url, plainSecret, payload);
    })
  );
}

module.exports = { deliver, deliverWithRetry, sign, MAX_ATTEMPTS };
