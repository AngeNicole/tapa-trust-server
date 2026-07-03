const { pool } = require('../config/db');

// Insert an in-app notification for a user. `db` may be the pool or a
// transaction client (so lifecycle transitions can notify within their
// existing transaction). In-app only — no web push / service workers.
async function createNotification(db, userId, type, message, bookingId = null) {
  await db.query(
    'INSERT INTO notifications (user_id, type, message, booking_id) VALUES ($1, $2, $3, $4)',
    [userId, type, message, bookingId]
  );
}

// GET /api/notifications  (auth) → the caller's notifications, newest first.
async function listNotifications(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT notif_id, message, type, booking_id AS "bookingId", read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, notif_id DESC`,
      [req.user.user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

// POST /api/notifications/:id/read  (auth, owner only)
async function markRead(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'notification id must be an integer' });
  }
  try {
    const found = await pool.query('SELECT user_id FROM notifications WHERE notif_id = $1', [id]);
    if (!found.rows[0]) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    if (found.rows[0].user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'This notification does not belong to you' });
    }
    const result = await pool.query(
      `UPDATE notifications SET read = true WHERE notif_id = $1
       RETURNING notif_id, message, type, booking_id AS "bookingId", read, created_at`,
      [id]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
}

module.exports = { createNotification, listNotifications, markRead };
