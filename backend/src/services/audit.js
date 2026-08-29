const db = require('../db');

function anonymizeIp(ip) {
  if (!ip) return null;
  const v4 = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (v4) return `${v4[1]}.0`;
  const v6 = ip.match(/^(.*):[\da-fA-F]+$/);
  if (v6) return `${v6[1]}:0`;
  return ip;
}

// Legacy helper — kept for backward compatibility with existing callers.
async function log(userId, action, ipAddress, userAgent, metadata = null) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, anonymizeIp(ipAddress), userAgent || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch {
    // fail silently — audit logging must never break the main request flow
  }
}

/**
 * Structured audit log entry used by all admin and auth controller actions.
 *
 * @param {object} ctx         - Express request (or object with user, ip, headers)
 * @param {string} action      - Machine-readable action name, e.g. 'kyc_approved'
 * @param {object} [resource]  - { type, id, oldValue, newValue }
 */
async function auditLog(ctx, action, resource = {}) {
  try {
    const userId = ctx.user?.userId || ctx.user?.id || null;
    const role = ctx.user?.role || null;
    const ip = anonymizeIp(ctx.ip || ctx.connection?.remoteAddress || null);
    const userAgent = ctx.headers?.['user-agent'] || null;

    await db.query(
      `INSERT INTO audit_logs
         (user_id, actor_role, action, resource_type, resource_id,
          old_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        role,
        action,
        resource.type || null,
        resource.id != null ? String(resource.id) : null,
        resource.oldValue != null ? JSON.stringify(resource.oldValue) : null,
        resource.newValue != null ? JSON.stringify(resource.newValue) : null,
        ip,
        userAgent,
      ]
    );
  } catch {
    // fail silently
  }
}

module.exports = { log, auditLog };
