'use strict';
/**
 * SEP-31 transaction status callback delivery.
 *
 * Mirrors the SSRF hardening used for outbound webhook delivery
 * (see services/webhook.js and __tests__/webhookSsrf.test.js): the callback
 * URL is resolved and validated against the shared utils/ssrf.js allow-list
 * immediately before every delivery attempt (not just once at submission
 * time), and redirects are never auto-followed, so a public URL that later
 * redirects to an internal address cannot be used to reach it.
 */
const logger = require('../utils/logger');
const { validatePublicUrl } = require('../utils/ssrf');

const MAX_ATTEMPTS = 3;

/**
 * Validates a SEP-31 callback_url supplied by a sending anchor/client.
 * Safe to call both at transaction-creation time (reject bad input early)
 * and again right before delivery (resolve-then-validate).
 */
async function validateCallbackUrl(url) {
  return validatePublicUrl(url);
}

async function deliverCallback(url, payload, attempt = 0) {
  // Re-validate on every attempt to catch DNS rebinding / stale records.
  if (!(await validateCallbackUrl(url))) {
    logger.error('SEP-31 callback delivery blocked: URL failed SSRF validation', { url });
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual', // never silently follow a redirect to an internal host
    });

    if (response.status >= 300 && response.status < 400) {
      logger.error('SEP-31 callback delivery blocked: server returned a redirect', {
        url,
        status: response.status,
      });
      return false;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (err) {
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn('SEP-31 callback delivery failed, retrying', {
        url,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        delay,
        error: err.message,
      });
      await new Promise((r) => setTimeout(r, delay));
      return deliverCallback(url, payload, attempt + 1);
    }
    logger.error('SEP-31 callback delivery permanently failed after max retries', {
      url,
      attempts: MAX_ATTEMPTS,
      error: err.message,
    });
    return false;
  }
}

module.exports = { validateCallbackUrl, deliverCallback, MAX_ATTEMPTS };
