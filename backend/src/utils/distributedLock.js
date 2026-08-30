const Redis = require('ioredis');
const crypto = require('crypto');
const logger = require('./logger');

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.REDIS_URL) return null;

  client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  client.on('error', (err) => {
    logger.warn('Redis error in distributed lock', { error: err.message });
  });

  return client;
}

// Lua script: only delete the key if the value matches (atomic check-and-delete)
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

async function acquireLock(lockKey, ttlSeconds, lockValue) {
  const redis = getClient();
  if (!redis) return true; // single-instance mode: no lock needed
  try {
    const result = await redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (err) {
    logger.warn('Failed to acquire distributed lock', { lockKey, error: err.message });
    return false;
  }
}

async function releaseLock(lockKey, lockValue) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, lockValue);
  } catch (err) {
    logger.warn('Failed to release distributed lock', { lockKey, error: err.message });
  }
}

/**
 * Acquire the lock, run fn, then release.
 * Returns true if the lock was acquired and fn ran, false if the lock was already held.
 */
async function withLock(lockKey, ttlSeconds, fn) {
  const lockValue = crypto.randomBytes(16).toString('hex');
  const acquired = await acquireLock(lockKey, ttlSeconds, lockValue);
  if (!acquired) return false;
  try {
    await fn();
  } finally {
    await releaseLock(lockKey, lockValue);
  }
  return true;
}

module.exports = { acquireLock, releaseLock, withLock };
