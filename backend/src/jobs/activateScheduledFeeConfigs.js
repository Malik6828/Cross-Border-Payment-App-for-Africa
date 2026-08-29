const db = require('../db');

async function activateScheduledFeeConfigs() {
  const dueResult = await db.query(
    `SELECT id, fee_type, asset_code, effective_from
     FROM fee_configs
     WHERE is_active = false AND effective_from <= NOW()
     ORDER BY created_at ASC`
  );

  if (dueResult.rows.length === 0) return;

  const toActivate = [];
  const seen = new Set();

  for (const row of dueResult.rows) {
    const key = `${row.fee_type}|${row.asset_code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const latestResult = await db.query(
      `SELECT id FROM fee_configs
       WHERE fee_type = $1 AND asset_code = $2 AND effective_from <= NOW()
       ORDER BY effective_from DESC
       LIMIT 1`,
      [row.fee_type, row.asset_code]
    );

    if (latestResult.rows[0]) {
      toActivate.push({
        id: latestResult.rows[0].id,
        fee_type: row.fee_type,
        asset_code: row.asset_code,
      });
    }
  }

  if (toActivate.length === 0) return;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of toActivate) {
      await client.query(
        `UPDATE fee_configs
         SET is_active = false
         WHERE fee_type = $1 AND asset_code = $2 AND is_active = true`,
        [item.fee_type, item.asset_code]
      );
      await client.query(
        `UPDATE fee_configs SET is_active = true WHERE id = $1`,
        [item.id]
      );
    }

    await client.query('COMMIT');
    const { refreshCache } = require('../services/feeConfigService');
    await refreshCache();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { activateScheduledFeeConfigs };
