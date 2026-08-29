const db = require('../db');
const logger = require('../utils/logger');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

async function persistNotification(userId, type, title, body, data = {}) {
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, type, title, body, data && Object.keys(data).length > 0 ? JSON.stringify(data) : null]
  );
  return rows[0];
}

async function persistAndBroadcast(userId, type, title, body, data = {}) {
  const notification = await persistNotification(userId, type, title, body, data);
  broadcast(userId, notification);
  return notification;
}

async function broadcast(userId, notification) {
  if (!io) return;
  try {
    const { rows } = await db.query(
      `SELECT public_key FROM wallets WHERE user_id = $1`,
      [userId]
    );
    for (const row of rows) {
      io.to(row.public_key).emit('notification:new', notification);
    }
  } catch (err) {
    logger.warn('Failed to broadcast notification', { error: err.message, userId });
  }
}

module.exports = {
  setSocketIO,
  persistNotification,
  persistAndBroadcast,
  broadcast,
};