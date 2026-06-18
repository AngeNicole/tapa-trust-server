const { pool } = require('../config/db');

// POST /api/reviews  (role requester, owns booking)  body { booking_id, rating(1-5), comment? }
async function createReview(req, res, next) {
  const { booking_id, rating, comment } = req.body || {};
  if (!booking_id) {
    return res.status(400).json({ error: 'booking_id is required' });
  }
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
  }

  const client = await pool.connect();
  try {
    const booking = await client.query(
      `SELECT b.booking_id, b.user_id, b.worker_id, b.status
       FROM bookings b WHERE b.booking_id = $1`,
      [booking_id]
    );
    if (!booking.rows[0]) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (booking.rows[0].user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'You can only review your own bookings' });
    }
    if (booking.rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'You can only review a completed booking' });
    }

    await client.query('BEGIN');
    const review = await client.query(
      `INSERT INTO reviews (booking_id, rating, comment)
       VALUES ($1, $2, $3)
       RETURNING review_id, booking_id, rating, comment, created_at`,
      [booking_id, r, comment ?? null]
    );

    // Nudge the worker's rating: recompute their average across all reviews.
    await client.query(
      `UPDATE workers w
       SET rating = COALESCE((
         SELECT ROUND(AVG(rv.rating)::numeric, 1)
         FROM reviews rv
         JOIN bookings b ON b.booking_id = rv.booking_id
         WHERE b.worker_id = w.worker_id
       ), 0)
       WHERE w.worker_id = $1`,
      [booking.rows[0].worker_id]
    );

    await client.query('COMMIT');
    return res.status(201).json(review.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    // One review per booking (reviews.booking_id is UNIQUE).
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This booking has already been reviewed' });
    }
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = { createReview };
