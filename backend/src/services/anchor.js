const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { anchorPollDuration } = require('../utils/metrics');

const isTestnet = process.env.STELLAR_NETWORK !== 'mainnet';
const anchorUrl = process.env.ANCHOR_URL || 'https://testanchor.stellar.org';

/**
 * Circuit breaker for anchor status polling (BE-016).
 *
 * Status polling is bounded to a fixed retry count with exponential backoff
 * (via utils/retry.js) so a slow/erroring anchor never gets hammered. If an
 * anchor keeps failing, the breaker opens for COOLDOWN_MS so we stop calling
 * it entirely — protecting us from being rate-limited/blocklisted — and
 * surfaces as unhealthy via services/health.js in the meantime.
 */
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60 * 1000;
const circuitState = new Map(); // anchorUrl -> { failures, openedAt }

function isCircuitOpen(url) {
  const state = circuitState.get(url);
  if (!state || !state.openedAt) return false;
  if (Date.now() - state.openedAt > COOLDOWN_MS) {
    circuitState.delete(url); // cooldown elapsed, allow a probe through
    return false;
  }
  return true;
}

function recordSuccess(url) {
  circuitState.delete(url);
}

function recordFailure(url) {
  const state = circuitState.get(url) || { failures: 0, openedAt: null };
  state.failures += 1;
  if (state.failures >= FAILURE_THRESHOLD) state.openedAt = Date.now();
  circuitState.set(url, state);
}

function getAnchorHealth() {
  const state = circuitState.get(anchorUrl);
  return {
    anchorUrl,
    circuitOpen: isCircuitOpen(anchorUrl),
    consecutiveFailures: state?.failures || 0,
  };
}

// Get SEP-24 info
async function getAnchorInfo() {
  try {
    const response = await fetch(`${anchorUrl}/.well-known/stellar.toml`);
    const text = await response.text();
    
    // Parse TOML to find TRANSFER_SERVER
    const transferServerMatch = text.match(/TRANSFER_SERVER\s*=\s*"([^"]+)"/);
    const transferServer = transferServerMatch ? transferServerMatch[1] : null;

    return {
      transferServer,
      anchorUrl
    };
  } catch (err) {
    logger.error('Failed to get anchor info', { error: err.message });
    throw new Error('Failed to connect to anchor');
  }
}

// Initiate SEP-24 deposit
async function initiateDeposit(userPublicKey, asset) {
  try {
    const { transferServer } = await getAnchorInfo();
    if (!transferServer) throw new Error('Anchor does not support SEP-24');

    const response = await fetch(`${transferServer}/transactions/deposit/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_code: asset,
        account: userPublicKey
      })
    });

    const data = await response.json();
    return {
      url: data.url,
      id: data.id
    };
  } catch (err) {
    logger.error('Failed to initiate deposit', { error: err.message });
    throw err;
  }
}

// Initiate SEP-24 withdrawal
async function initiateWithdrawal(userPublicKey, asset) {
  try {
    const { transferServer } = await getAnchorInfo();
    if (!transferServer) throw new Error('Anchor does not support SEP-24');

    const response = await fetch(`${transferServer}/transactions/withdraw/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_code: asset,
        account: userPublicKey
      })
    });

    const data = await response.json();
    return {
      url: data.url,
      id: data.id
    };
  } catch (err) {
    logger.error('Failed to initiate withdrawal', { error: err.message });
    throw err;
  }
}

// Get transaction status. Polling callers (anchorController's status route)
// should treat this as bounded: it retries with exponential backoff up to
// MAX_ATTEMPTS and trips a circuit breaker after repeated failures rather
// than being called in a tight client-driven loop with no ceiling.
async function getTransactionStatus(transactionId) {
  if (isCircuitOpen(anchorUrl)) {
    const err = new Error('Anchor is temporarily unavailable (circuit open)');
    err.status = 503;
    throw err;
  }

  const start = Date.now();
  try {
    const data = await withRetry(
      async () => {
        const { transferServer } = await getAnchorInfo();
        if (!transferServer) throw new Error('Anchor does not support SEP-24');

        const response = await fetch(`${transferServer}/transaction?id=${transactionId}`);
        if (!response.ok) {
          const err = new Error(`Anchor status endpoint returned ${response.status}`);
          err.status = response.status;
          throw err;
        }
        return response.json();
      },
      { maxAttempts: 3, label: `anchor status poll (${anchorUrl})` }
    );
    recordSuccess(anchorUrl);
    anchorPollDuration.observe({ anchor: anchorUrl, success: 'true' }, (Date.now() - start) / 1000);
    return data.transaction;
  } catch (err) {
    recordFailure(anchorUrl);
    anchorPollDuration.observe({ anchor: anchorUrl, success: 'false' }, (Date.now() - start) / 1000);
    logger.error('Failed to get transaction status', { error: err.message });
    throw err;
  }
}

module.exports = {
  getAnchorInfo,
  initiateDeposit,
  initiateWithdrawal,
  getTransactionStatus,
  getAnchorHealth,
};
