'use strict';

const crypto = require('crypto');

/**
 * Compute an HMAC-SHA256 signature over a payload string.
 *
 * @param {string} secret  - The shared secret used to sign
 * @param {string} payload - The raw string to sign (usually JSON)
 * @returns {string} Lowercase hex-encoded 64-character digest
 */
function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

module.exports = { sign };
