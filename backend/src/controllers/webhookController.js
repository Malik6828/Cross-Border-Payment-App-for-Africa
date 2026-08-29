const crypto = require('crypto');
const db = require('../db');
const { validatePublicUrl } = require('../utils/ssrfValidator');
const { encryptSecret, decryptSecret } = require('../utils/symmetricEncryption');

const VALID_EVENTS = ['payment.sent', 'payment.received', 'payment.failed'];

async function create(req, res, next) {
  try {
    const { url, events } = req.body;

    if (!await validatePublicUrl(url)) {
      return res.status(400).json({ error: 'Webhook URL must point to a public HTTPS endpoint' });
    }

    const invalidEvents = (events || []).filter((e) => !VALID_EVENTS.includes(e));
    if (invalidEvents.length) {
      return res.status(400).json({ error: `Invalid events: ${invalidEvents.join(', ')}` });
    }

    const plainSecret = crypto.randomBytes(32).toString('hex');
    const encryptedSecret = encryptSecret(plainSecret);

    const { rows } = await db.query(
      `INSERT INTO webhooks (user_id, url, secret, events)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url, events, active, created_at`,
      [req.user.userId, url, encryptedSecret, events || []]
    );

    // Return the plain secret once — it will not be shown again
    res.status(201).json({ ...rows[0], secret: plainSecret });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, url, events, active, created_at, secret FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.userId]
    );

    const webhooks = rows.map((wh) => {
      let secretMasked = null;
      if (wh.secret) {
        try {
          const plain = decryptSecret(wh.secret);
          secretMasked = plain.slice(0, 4) + '****';
        } catch {
          secretMasked = '****';
        }
      }
      const { secret: _omit, ...rest } = wh;
      return { ...rest, secret_masked: secretMasked };
    });

    res.json({ webhooks });
  } catch (err) {
    next(err);
  }
}

async function listDeliveries(req, res, next) {
  try {
    const { webhook_id } = req.query;
    let query = `
      SELECT wd.id, wd.webhook_id, wd.event_type, wd.target_url, wd.status_code,
             wd.response_time_ms, wd.status, wd.attempt, wd.max_attempts, wd.error_message,
             wd.created_at, wd.completed_at
      FROM webhook_deliveries wd
      JOIN webhooks w ON w.id = wd.webhook_id
      WHERE w.user_id = $1
    `;
    const params = [req.user.userId];
    if (webhook_id) {
      params.push(webhook_id);
      query += ` AND wd.webhook_id = $${params.length}`;
    }
    query += ` ORDER BY wd.created_at DESC LIMIT 100`;
    const { rows } = await db.query(query, params);
    res.json({ deliveries: rows });
  } catch (err) {
    next(err);
  }
}

const ROTATION_OVERLAP_HOURS = parseInt(process.env.WEBHOOK_SECRET_ROTATION_OVERLAP_HOURS || '24', 10);

/**
 * POST /api/webhooks/:id/rotate-secret
 * Issues a new signing secret while keeping the old one valid for a grace
 * window, so in-flight deliveries and not-yet-updated verifiers don't break.
 */
async function rotateSecret(req, res, next) {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      `SELECT id, secret FROM webhooks WHERE id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const newPlainSecret = crypto.randomBytes(32).toString('hex');
    const newEncryptedSecret = encryptSecret(newPlainSecret);

    const { rows: updated } = await db.query(
      `UPDATE webhooks
          SET secret = $1,
              previous_secret = $2,
              previous_secret_expires_at = NOW() + ($3 || ' hours')::interval
        WHERE id = $4
        RETURNING id, url, events, active, created_at, previous_secret_expires_at`,
      [newEncryptedSecret, rows[0].secret, ROTATION_OVERLAP_HOURS, id]
    );

    // Return the plain secret once — it will not be shown again
    res.json({ ...updated[0], secret: newPlainSecret });
  } catch (err) {
    next(err);
  }
}

async function retry(req, res, next) {
  try {
    const { id } = req.params;
    // Verify ownership
    const { rows } = await db.query(
      `SELECT wd.id FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       WHERE wd.id = $1 AND w.user_id = $2`,
      [id, req.user.userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Delivery not found or not owned by user' });
    }
    await retryDelivery(id);
    res.json({ message: 'Retry initiated' });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, listDeliveries, retry, rotateSecret };
