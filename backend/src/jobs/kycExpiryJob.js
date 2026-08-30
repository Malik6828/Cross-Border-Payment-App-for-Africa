const db = require('../db');
const { sendKycExpiryReminderEmail } = require('../services/email');
const logger = require('../utils/logger');

const REMINDER_DAYS = [30, 14, 7];

async function checkKycDocumentExpiry() {
  // Mark verified documents whose expiry date has passed as expired
  const { rows: expired } = await db.query(`
    UPDATE users
       SET kyc_status = 'expired', updated_at = NOW()
     WHERE kyc_status = 'verified'
       AND kyc_document_expiry_date IS NOT NULL
       AND kyc_document_expiry_date < NOW()
     RETURNING id
  `);

  if (expired.length > 0) {
    logger.info('KYC documents marked expired', { count: expired.length });
  }

  // Send reminder emails for documents expiring in exactly 30, 14, and 7 days.
  // kyc_reminders_sent stores the calendar date when each reminder was last sent
  // e.g. { "30": "2024-01-01" } — prevents duplicate sends within the same day.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (const days of REMINDER_DAYS) {
    const { rows } = await db.query(
      `SELECT id, email, full_name, kyc_document_expiry_date, kyc_reminders_sent
         FROM users
        WHERE kyc_status = 'verified'
          AND kyc_document_expiry_date IS NOT NULL
          AND kyc_document_expiry_date::date = (NOW() + ($1 || ' days')::interval)::date`,
      [days],
    );

    for (const user of rows) {
      const reminders = user.kyc_reminders_sent || {};
      if (reminders[String(days)] === today) continue; // already sent today

      try {
        await sendKycExpiryReminderEmail(
          user.email,
          user.full_name || user.email,
          days,
        );

        await db.query(
          `UPDATE users
              SET kyc_reminders_sent = kyc_reminders_sent || $1::jsonb,
                  updated_at = NOW()
            WHERE id = $2`,
          [JSON.stringify({ [String(days)]: today }), user.id],
        );

        logger.info('KYC expiry reminder sent', { userId: user.id, daysRemaining: days });
      } catch (err) {
        logger.error('Failed to send KYC expiry reminder', { userId: user.id, error: err.message });
      }
    }
  }
}

module.exports = { checkKycDocumentExpiry };
