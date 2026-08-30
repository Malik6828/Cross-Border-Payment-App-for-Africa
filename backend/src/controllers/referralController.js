const db = require('../db');

const REFERRAL_CREDIT_BPS = parseInt(process.env.REFERRAL_CREDIT_BPS || '50', 10); // 0.5% fee discount
const REFERRAL_EXPIRY_DAYS = 90;

async function getStats(req, res, next) {
  try {
    const userId = req.user.userId;

    const userResult = await db.query(
      'SELECT referral_code FROM users WHERE id = $1',
      [userId]
    );
    const { referral_code } = userResult.rows[0] || {};

    const referralsResult = await db.query(
      `SELECT COUNT(*) AS referral_count FROM users WHERE referred_by = $1`,
      [referral_code || '']
    );

    const creditsResult = await db.query(
      `SELECT COALESCE(SUM(amount_bps), 0) AS total_bps,
              COUNT(*) FILTER (WHERE NOT used AND expires_at > NOW()) AS active_credits
       FROM referral_credits WHERE user_id = $1`,
      [userId]
    );

    const rewardsResult = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'credited') AS first_payments_completed,
              COALESCE(SUM(reward_amount) FILTER (WHERE status = 'credited'), 0) AS total_rewards_earned
       FROM referral_rewards WHERE referrer_id = $1`,
      [userId]
    );

    res.json({
      referral_code,
      referral_count: parseInt(referralsResult.rows[0].referral_count, 10),
      total_credits_bps: parseInt(creditsResult.rows[0].total_bps, 10),
      active_credits: parseInt(creditsResult.rows[0].active_credits, 10),
      credit_per_referral_bps: REFERRAL_CREDIT_BPS,
      first_payments_completed: parseInt(rewardsResult.rows[0].first_payments_completed, 10),
      total_rewards_earned: parseInt(rewardsResult.rows[0].total_rewards_earned, 10),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Called after a referred user's first transaction completes.
 * Awards fee-discount credit to the referrer.
 */
async function awardReferralCredit(referredUserId) {
  const result = await db.query(
    `SELECT u.id AS referrer_id
     FROM users referred
     JOIN users u ON u.referral_code = referred.referred_by
     WHERE referred.id = $1`,
    [referredUserId]
  );
  if (!result.rows[0]) return;

  const referrerId = result.rows[0].referrer_id;

  // Only award once per referred user
  const existing = await db.query(
    'SELECT id FROM referral_credits WHERE referred_user_id = $1',
    [referredUserId]
  );
  if (existing.rows.length > 0) return;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFERRAL_EXPIRY_DAYS);

  await db.query(
    `INSERT INTO referral_credits (user_id, referred_user_id, amount_bps, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [referrerId, referredUserId, REFERRAL_CREDIT_BPS, expiresAt]
  );
}

module.exports = { getStats, awardReferralCredit };

/**
 * POST /api/referrals/award
 * Admin/internal endpoint — awards referral credit for a given referred user.
 * Body: { referred_user_id: string }
 */
async function awardReferralCreditHandler(req, res, next) {
  try {
    const { referred_user_id } = req.body;
    if (!referred_user_id) {
      return res.status(400).json({ error: 'referred_user_id is required' });
    }
    await awardReferralCredit(referred_user_id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStats, awardReferralCredit, awardReferralCreditHandler };
