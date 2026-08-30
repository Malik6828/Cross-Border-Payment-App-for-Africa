const geoip = require('geoip-lite');
const logger = require('../utils/logger');

/**
 * Geo-restriction middleware for OFAC / UN sanctions compliance.
 *
 * Reads the comma-separated BLOCKED_COUNTRIES env var (ISO 3166-1 alpha-2),
 * resolves the caller's IP via geoip-lite, and returns HTTP 451 when the
 * request originates from a sanctioned jurisdiction.
 *
 * Every blocked attempt is logged at WARN level for compliance audit.
 */

// Parse blocked countries once at startup for O(1) lookups.
const blockedCountries = new Set(
  (process.env.BLOCKED_COUNTRIES || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
);

// Whether the X-Forwarded-For header may be trusted.
// Express only honors X-Forwarded-For when `trust proxy` is explicitly
// configured. Without it, the header is attacker-controlled and must never
// be used for geo-location decisions.
function isTrustProxyConfigured(req) {
  return Boolean(req.app && req.app.get('trust proxy'));
}

module.exports = function geoRestriction(req, res, next) {
  const blocked = () =>
    res.status(451).json({ error: 'Service unavailable in your jurisdiction' });

  // Determine the client IP. When `trust proxy` is configured Express has
  // already resolved req.ip from X-Forwarded-For using the configured hop
  // count, so req.ip is authoritative and no direct header access is needed.
  let ip = req.ip;
  let ipFromHeader = false;

  if (!ip && isTrustProxyConfigured(req)) {
    // Express could not resolve the address but the header is safe to parse
    // because trust proxy is explicitly enabled. Prefer req.ips (the chain
    // Express resolved) so the hop count is honored.
    ip =
      (Array.isArray(req.ips) && req.ips.length > 0 && req.ips[0]) ||
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : undefined);

    if (ip) {
      ipFromHeader = true;
      logger.warn(
        'Geo-restriction: resolved client IP from X-Forwarded-For header - verify proxy configuration',
        {
          requestId: req.requestId,
          ip,
          trustProxy: String(req.app.get('trust proxy')),
          method: req.method,
          path: req.originalUrl,
        }
      );
    }
  }

  if (!ip) {
    // Cannot reliably determine the client jurisdiction. Fail closed rather
    // than trusting a client-supplied header.
    logger.warn('Geo-restriction: unable to determine client IP - request blocked (fail closed)', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      forwarded: typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for']
        : undefined,
    });

    return blocked();
  }

  const geo = geoip.lookup(ip);
  const country = geo && geo.country ? geo.country.toUpperCase() : null;

  if (country && blockedCountries.has(country)) {
    logger.warn('Blocked request from sanctioned country', {
      requestId: req.requestId,
      ip,
      ipFromHeader,
      country,
      method: req.method,
      path: req.originalUrl,
    });

    return blocked();
  }

  next();
};
