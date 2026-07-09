const { pool } = require('../config/db');
const { createNotification } = require('./notifications.controller');

// Plain-language, low-literacy-friendly categories — matched to the disputes the
// platform's captured data can actually speak to.
const CATEGORIES = ['duration disagreement', 'work quality', 'no-show', 'payment amount', 'other'];
const OUTCOMES = ['release', 'refund', 'dismiss']; // release→worker, refund→requester, dismiss→no change

// Load a booking with the identities + payment needed to authorize a dispute.
async function loadBookingParties(bookingId, db = pool) {
  const r = await db.query(
    `SELECT b.booking_id, b.task_id, b.status, b.user_id AS requester_user_id,
            w.worker_id, w.user_id AS worker_user_id, ps.status AS payment_status
     FROM bookings b
     JOIN workers w ON w.worker_id = b.worker_id
     LEFT JOIN payment_status ps ON ps.booking_id = b.booking_id
     WHERE b.booking_id = $1`,
    [bookingId]
  );
  return r.rows[0] || null;
}

// POST /api/bookings/:id/dispute  (worker or requester on the booking)
// body { category, description }
async function raiseDispute(req, res, next) {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
  const { category, description } = req.body || {};
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  }
  try {
    const booking = await loadBookingParties(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    let raisedBy;
    if (req.user.user_id === booking.requester_user_id) raisedBy = 'requester';
    else if (req.user.user_id === booking.worker_user_id) raisedBy = 'worker';
    else return res.status(403).json({ error: 'You are not part of this booking' });

    if (!['in_progress', 'completed'].includes(booking.status)) {
      return res.status(400).json({ error: 'You can raise a dispute once work is underway (in progress or completed).' });
    }
    const existing = await pool.query(
      `SELECT 1 FROM dispute_resolution WHERE booking_id = $1 AND status = 'open' LIMIT 1`,
      [bookingId]
    );
    if (existing.rows[0]) return res.status(409).json({ error: 'A dispute is already open on this booking.' });

    const result = await pool.query(
      `INSERT INTO dispute_resolution (booking_id, category, reason, raised_by, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING dispute_id, booking_id, category, reason, raised_by, status, created_at`,
      [bookingId, category, (description || '').trim() || null, raisedBy]
    );
    // Freezing the payment is what gives the dispute teeth: escrow stays 'held'
    // (never advances to 'released') until an admin rules. Status only — with real
    // escrow this would freeze the funds themselves (future work).
    const notifyUser = raisedBy === 'requester' ? booking.worker_user_id : booking.requester_user_id;
    await createNotification(pool, notifyUser, 'dispute_opened', 'A dispute was opened on your booking. Payment is frozen pending admin review.', bookingId);

    return res.status(201).json({ dispute: result.rows[0], paymentFrozen: true });
  } catch (err) {
    return next(err);
  }
}

// The platform-captured evidence for a booking: the confirmation timeline with
// timestamps, the agreed price, and the full chat thread. This is the edge —
// the admin rules on data the system recorded, not he-said-she-said.
async function bookingEvidence(bookingId, db = pool) {
  const b = await db.query(
    `SELECT b.booking_id, t.title AS task_title, b.status, b.agreed_price,
            b.created_at AS booked_at, b.accepted_at,
            ru.name AS requester_name, wu.name AS worker_name,
            cir.start_ts, cir.start_confirmed_at, cir.end_ts, cir.end_confirmed_at,
            ps.status AS payment_status, ps.amount
     FROM bookings b
     JOIN tasks t   ON t.task_id = b.task_id
     JOIN workers w ON w.worker_id = b.worker_id
     JOIN users ru  ON ru.user_id = b.user_id
     JOIN users wu  ON wu.user_id = w.user_id
     LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
     LEFT JOIN payment_status ps ON ps.booking_id = b.booking_id
     WHERE b.booking_id = $1`,
    [bookingId]
  );
  const row = b.rows[0];
  if (!row) return null;

  const msgs = await db.query(
    `SELECT m.sender_user_id, u.name AS sender_name, m.body, m.amount, m.created_at
     FROM messages m JOIN users u ON u.user_id = m.sender_user_id
     WHERE m.booking_id = $1 ORDER BY m.created_at ASC, m.message_id ASC`,
    [bookingId]
  );

  // Ordered confirmation timeline — each event with the time the platform recorded.
  const timeline = [
    { key: 'booked', label: 'Booking requested', at: row.booked_at },
    { key: 'accepted', label: 'Worker accepted', at: row.accepted_at },
    { key: 'checkin', label: 'Worker checked in', at: row.start_ts },
    { key: 'start_confirmed', label: 'Requester confirmed start', at: row.start_confirmed_at },
    { key: 'checkout', label: 'Worker checked out', at: row.end_ts },
    { key: 'completion_confirmed', label: 'Requester confirmed completion', at: row.end_confirmed_at },
  ];

  return {
    bookingId: row.booking_id,
    taskTitle: row.task_title,
    status: row.status,
    requesterName: row.requester_name,
    workerName: row.worker_name,
    agreedPrice: row.agreed_price === null ? null : Number(row.agreed_price),
    payment: { status: row.payment_status, amount: row.amount === null ? null : Number(row.amount) },
    timeline,
    messages: msgs.rows.map((m) => ({
      senderName: m.sender_name,
      body: m.body,
      amount: m.amount === null ? null : Number(m.amount),
      created_at: m.created_at,
    })),
  };
}

// GET /api/admin/disputes  (admin) — the queue.
async function listDisputes(req, res, next) {
  try {
    const r = await pool.query(
      `SELECT d.dispute_id, d.booking_id, d.category, d.reason, d.raised_by, d.status,
              d.outcome, d.ruling, d.created_at, d.resolved_at,
              t.title AS task_title, wu.name AS worker_name, ru.name AS requester_name,
              b.agreed_price
       FROM dispute_resolution d
       JOIN bookings b ON b.booking_id = d.booking_id
       JOIN tasks t    ON t.task_id = b.task_id
       JOIN workers w  ON w.worker_id = b.worker_id
       JOIN users wu   ON wu.user_id = w.user_id
       JOIN users ru   ON ru.user_id = b.user_id
       ORDER BY (d.status = 'open') DESC, d.created_at DESC`
    );
    return res.json(r.rows.map((d) => ({
      disputeId: d.dispute_id,
      bookingId: d.booking_id,
      category: d.category,
      description: d.reason,
      raisedBy: d.raised_by,
      status: d.status,
      outcome: d.outcome,
      ruling: d.ruling,
      createdAt: d.created_at,
      resolvedAt: d.resolved_at,
      taskTitle: d.task_title,
      workerName: d.worker_name,
      requesterName: d.requester_name,
      agreedPrice: d.agreed_price === null ? null : Number(d.agreed_price),
    })));
  } catch (err) {
    return next(err);
  }
}

// GET /api/admin/disputes/:id  (admin) — one dispute + auto-attached evidence +
// each party's prior-dispute counts (the accountability trail / repeat patterns).
async function getDispute(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid dispute id' });
  try {
    const r = await pool.query(
      `SELECT d.*, b.worker_id, b.user_id AS requester_user_id
       FROM dispute_resolution d JOIN bookings b ON b.booking_id = d.booking_id
       WHERE d.dispute_id = $1`,
      [id]
    );
    const d = r.rows[0];
    if (!d) return res.status(404).json({ error: 'Dispute not found' });

    const evidence = await bookingEvidence(d.booking_id);

    // Repeat patterns: how many disputes each party has been involved in.
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM dispute_resolution dd JOIN bookings bb ON bb.booking_id = dd.booking_id WHERE bb.worker_id = $1) AS worker_total,
         (SELECT COUNT(*)::int FROM dispute_resolution dd JOIN bookings bb ON bb.booking_id = dd.booking_id WHERE bb.user_id = $2) AS requester_total`,
      [d.worker_id, d.requester_user_id]
    );

    return res.json({
      disputeId: d.dispute_id,
      bookingId: d.booking_id,
      category: d.category,
      description: d.reason,
      raisedBy: d.raised_by,
      status: d.status,
      outcome: d.outcome,
      ruling: d.ruling,
      createdAt: d.created_at,
      resolvedAt: d.resolved_at,
      evidence,
      history: { workerDisputes: counts.rows[0].worker_total, requesterDisputes: counts.rows[0].requester_total },
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/disputes/:id/rule  (admin)  body { outcome, note }
// Neutral, oversight-only ruling (no stake in the transaction). Records the
// outcome + note and performs the simulated payment action.
async function ruleDispute(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid dispute id' });
  const { outcome, note } = req.body || {};
  if (!OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` });
  }
  const client = await pool.connect();
  try {
    const dr = await client.query(`SELECT * FROM dispute_resolution WHERE dispute_id = $1`, [id]);
    const dispute = dr.rows[0];
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (dispute.status === 'resolved') return res.status(409).json({ error: 'This dispute is already resolved.' });

    const booking = await loadBookingParties(dispute.booking_id, client);
    await client.query('BEGIN');

    if (outcome === 'release') {
      // Funds to the worker; finalize the booking + earnings if not already.
      if (booking.payment_status === 'held') {
        const pay = await client.query(
          `UPDATE payment_status SET status = 'released', released_at = now() WHERE booking_id = $1 RETURNING amount`,
          [booking.booking_id]
        );
        await client.query(
          'INSERT INTO earnings_record (worker_id, booking_id, amount) VALUES ($1, $2, $3)',
          [booking.worker_id, booking.booking_id, pay.rows[0] ? pay.rows[0].amount : 0]
        );
      }
      await client.query(`UPDATE bookings SET status = 'completed' WHERE booking_id = $1 AND status <> 'completed'`, [booking.booking_id]);
      await client.query('UPDATE workers SET is_available = true WHERE worker_id = $1', [booking.worker_id]);
    } else if (outcome === 'refund') {
      await client.query(`UPDATE payment_status SET status = 'refunded' WHERE booking_id = $1`, [booking.booking_id]);
      await client.query(`UPDATE bookings SET status = 'cancelled', cancel_reason = 'Dispute resolved: refunded' WHERE booking_id = $1`, [booking.booking_id]);
      await client.query('UPDATE workers SET is_available = true WHERE worker_id = $1', [booking.worker_id]);
    }
    // dismiss → no payment change; the normal loop can resume once unfrozen.

    await client.query(
      `UPDATE dispute_resolution SET status = 'resolved', outcome = $1, ruling = $2, admin_id = $3, resolved_at = now()
       WHERE dispute_id = $4`,
      [outcome, (note || '').trim() || null, req.user.admin_id || null, id]
    );

    await createNotification(client, booking.requester_user_id, 'dispute_resolved', `The dispute was resolved by an admin (${outcome}).`, booking.booking_id);
    await createNotification(client, booking.worker_user_id, 'dispute_resolved', `The dispute was resolved by an admin (${outcome}).`, booking.booking_id);

    await client.query('COMMIT');
    return res.json({ disputeId: id, status: 'resolved', outcome });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = { raiseDispute, listDisputes, getDispute, ruleDispute, CATEGORIES, OUTCOMES };
