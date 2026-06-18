const { pool } = require('../config/db');

// =====================================================================
// BookingView — the exact JSON the client expects for a booking.
// Reused by list, create, rebook, and every lifecycle transition so the
// client always gets the same shape back.
// =====================================================================
const BOOKING_VIEW_SQL = `
  SELECT
    b.booking_id,
    b.task_id,
    t.title AS "taskTitle",
    b.worker_id,
    w.name  AS "workerName",
    ru.name AS "requesterName",
    b.status,
    (cir.start_ts IS NOT NULL)           AS "checkedIn",
    COALESCE(cir.start_confirmed, false) AS "startConfirmed",
    (cir.end_ts IS NOT NULL)             AS "checkedOut",
    COALESCE(cir.end_confirmed, false)   AS "endConfirmed",
    ps.status AS payment,
    CASE WHEN rv.review_id IS NOT NULL
         THEN json_build_object('rating', rv.rating, 'comment', rv.comment)
         ELSE NULL END AS review
  FROM bookings b
  JOIN tasks   t  ON t.task_id   = b.task_id
  JOIN workers w  ON w.worker_id = b.worker_id
  JOIN users   ru ON ru.user_id  = b.user_id
  LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
  LEFT JOIN payment_status  ps  ON ps.booking_id  = b.booking_id
  LEFT JOIN reviews         rv  ON rv.booking_id  = b.booking_id
`;

async function bookingViewById(bookingId, db = pool) {
  const r = await db.query(`${BOOKING_VIEW_SQL} WHERE b.booking_id = $1`, [bookingId]);
  return r.rows[0] || null;
}

// Load a booking with everything the auth + ordering checks need.
async function loadBooking(bookingId, db = pool) {
  const r = await db.query(
    `SELECT b.booking_id, b.task_id, b.worker_id, b.user_id AS requester_user_id, b.status,
            w.user_id AS worker_user_id,
            cir.start_ts, cir.end_ts, cir.start_confirmed, cir.end_confirmed,
            ps.status AS payment_status, ps.amount
     FROM bookings b
     JOIN workers w ON w.worker_id = b.worker_id
     LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
     LEFT JOIN payment_status  ps  ON ps.booking_id  = b.booking_id
     WHERE b.booking_id = $1`,
    [bookingId]
  );
  return r.rows[0] || null;
}

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

// =====================================================================
// Create
// =====================================================================

// POST /api/bookings  (role requester)  body { task_id, worker_id }
async function createBooking(req, res, next) {
  const { task_id, worker_id } = req.body || {};
  if (!task_id || !worker_id) {
    return res.status(400).json({ error: 'task_id and worker_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const task = await client.query('SELECT user_id FROM tasks WHERE task_id = $1', [task_id]);
    if (!task.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.rows[0].user_id !== req.user.user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only book your own tasks' });
    }

    const worker = await client.query('SELECT worker_id FROM workers WHERE worker_id = $1', [worker_id]);
    if (!worker.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Worker not found' });
    }

    const booking = await client.query(
      `INSERT INTO bookings (task_id, worker_id, user_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING booking_id`,
      [task_id, worker_id, req.user.user_id]
    );
    const bookingId = booking.rows[0].booking_id;

    // Every booking gets its payment row and check-in record up front.
    await client.query(
      `INSERT INTO payment_status (booking_id, status) VALUES ($1, 'pending')`,
      [bookingId]
    );
    await client.query(
      'INSERT INTO check_in_record (booking_id) VALUES ($1)',
      [bookingId]
    );
    await client.query(`UPDATE tasks SET status = 'assigned' WHERE task_id = $1`, [task_id]);

    const view = await bookingViewById(bookingId, client);
    await client.query('COMMIT');
    return res.status(201).json(view);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

// =====================================================================
// List (scoped to caller)
// =====================================================================

// GET /api/bookings → BookingView[] for the caller (requester or worker).
async function listBookings(req, res, next) {
  try {
    let where;
    if (req.user.role === 'worker') {
      where = 'WHERE w.user_id = $1';
    } else if (req.user.role === 'requester') {
      where = 'WHERE b.user_id = $1';
    } else {
      // Admin is oversight-only and has no bookings of its own.
      return res.json([]);
    }
    const result = await pool.query(
      `${BOOKING_VIEW_SQL} ${where} ORDER BY b.booking_id DESC`,
      [req.user.user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

// =====================================================================
// Lifecycle transitions
//
// Each transition: validate id → load → authorize ownership → enforce
// ordering → mutate → return the refreshed BookingView.
// =====================================================================

// Shared guard. Returns the loaded booking, or null after sending a response.
async function guard(req, res, { role }) {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'booking id must be an integer' });
    return null;
  }
  const booking = await loadBooking(id);
  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return null;
  }
  if (role === 'worker' && booking.worker_user_id !== req.user.user_id) {
    res.status(403).json({ error: 'This booking does not belong to you' });
    return null;
  }
  if (role === 'requester' && booking.requester_user_id !== req.user.user_id) {
    res.status(403).json({ error: 'This booking does not belong to you' });
    return null;
  }
  return booking;
}

// POST /api/bookings/:id/accept  (role worker)
async function acceptBooking(req, res, next) {
  try {
    const booking = await guard(req, res, { role: 'worker' });
    if (!booking) return undefined;
    if (booking.status !== 'pending') {
      return res.status(400).json({ error: `Cannot accept a booking with status '${booking.status}'` });
    }
    await pool.query(`UPDATE bookings SET status = 'accepted' WHERE booking_id = $1`, [booking.booking_id]);
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/checkin  (role worker) → start_ts = now()
async function checkin(req, res, next) {
  try {
    const booking = await guard(req, res, { role: 'worker' });
    if (!booking) return undefined;
    if (booking.status !== 'accepted') {
      return res.status(400).json({ error: 'Worker must accept the booking before checking in' });
    }
    if (booking.start_ts) {
      return res.status(400).json({ error: 'Worker has already checked in' });
    }
    await pool.query('UPDATE check_in_record SET start_ts = now() WHERE booking_id = $1', [booking.booking_id]);
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/confirm-start  (role requester)
//   → start_confirmed = true, status 'in_progress', payment 'confirmed'
async function confirmStart(req, res, next) {
  const client = await pool.connect();
  try {
    const booking = await guard(req, res, { role: 'requester' });
    if (!booking) return undefined;
    if (!booking.start_ts) {
      return res.status(400).json({ error: 'Worker has not checked in yet' });
    }
    if (booking.start_confirmed) {
      return res.status(400).json({ error: 'Start already confirmed' });
    }
    await client.query('BEGIN');
    await client.query(
      'UPDATE check_in_record SET start_confirmed = true WHERE booking_id = $1',
      [booking.booking_id]
    );
    await client.query(`UPDATE bookings SET status = 'in_progress' WHERE booking_id = $1`, [booking.booking_id]);
    await client.query(`UPDATE payment_status SET status = 'confirmed' WHERE booking_id = $1`, [booking.booking_id]);
    const view = await bookingViewById(booking.booking_id, client);
    await client.query('COMMIT');
    return res.json(view);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

// POST /api/bookings/:id/checkout  (role worker) → end_ts = now()
async function checkout(req, res, next) {
  try {
    const booking = await guard(req, res, { role: 'worker' });
    if (!booking) return undefined;
    if (booking.status !== 'in_progress') {
      return res.status(400).json({ error: 'Requester must confirm start before checkout' });
    }
    if (booking.end_ts) {
      return res.status(400).json({ error: 'Worker has already checked out' });
    }
    await pool.query('UPDATE check_in_record SET end_ts = now() WHERE booking_id = $1', [booking.booking_id]);
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/confirm-completion  (role requester)
//   → end_confirmed = true, status 'completed', payment 'released', task 'completed'
async function confirmCompletion(req, res, next) {
  const client = await pool.connect();
  try {
    const booking = await guard(req, res, { role: 'requester' });
    if (!booking) return undefined;
    if (!booking.end_ts) {
      return res.status(400).json({ error: 'Worker has not checked out yet' });
    }
    if (booking.end_confirmed) {
      return res.status(400).json({ error: 'Completion already confirmed' });
    }
    await client.query('BEGIN');
    await client.query(
      'UPDATE check_in_record SET end_confirmed = true WHERE booking_id = $1',
      [booking.booking_id]
    );
    await client.query(`UPDATE bookings SET status = 'completed' WHERE booking_id = $1`, [booking.booking_id]);
    await client.query(`UPDATE payment_status SET status = 'released' WHERE booking_id = $1`, [booking.booking_id]);
    await client.query(`UPDATE tasks SET status = 'completed' WHERE task_id = $1`, [booking.task_id]);
    const view = await bookingViewById(booking.booking_id, client);
    await client.query('COMMIT');
    return res.json(view);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

// GET /api/bookings/:id/payment-status → { status, amount }
// Readable by either party to the booking (requester or the booked worker),
// but not by unrelated users — otherwise any logged-in user could read a
// booking's payment status by guessing its integer id.
async function getPaymentStatus(req, res, next) {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'booking id must be an integer' });
  }
  try {
    const booking = await loadBooking(id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    const isParty =
      booking.requester_user_id === req.user.user_id ||
      booking.worker_user_id === req.user.user_id;
    if (!isParty) {
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    return res.json({ status: booking.payment_status, amount: Number(booking.amount) });
  } catch (err) {
    return next(err);
  }
}

// =====================================================================
// Rebook
// =====================================================================

// POST /api/bookings/rebook/:workerId  (role requester)
//   → fresh open task + new pending booking with that worker. Returns BookingView.
async function rebook(req, res, next) {
  const workerId = parseId(req.params.workerId);
  if (workerId === null) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const worker = await client.query('SELECT worker_id, skills FROM workers WHERE worker_id = $1', [workerId]);
    if (!worker.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Title derives from the worker's first listed skill (comma-separated).
    const firstSkill = (worker.rows[0].skills || '').split(',')[0].trim();
    const title = `Rebooking: ${firstSkill || 'task'}`;

    const task = await client.query(
      `INSERT INTO tasks (user_id, title, status) VALUES ($1, $2, 'open') RETURNING task_id`,
      [req.user.user_id, title]
    );
    const taskId = task.rows[0].task_id;

    const booking = await client.query(
      `INSERT INTO bookings (task_id, worker_id, user_id, status)
       VALUES ($1, $2, $3, 'pending') RETURNING booking_id`,
      [taskId, workerId, req.user.user_id]
    );
    const bookingId = booking.rows[0].booking_id;

    await client.query(`INSERT INTO payment_status (booking_id, status) VALUES ($1, 'pending')`, [bookingId]);
    await client.query('INSERT INTO check_in_record (booking_id) VALUES ($1)', [bookingId]);
    await client.query(`UPDATE tasks SET status = 'assigned' WHERE task_id = $1`, [taskId]);

    const view = await bookingViewById(bookingId, client);
    await client.query('COMMIT');
    return res.status(201).json(view);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  createBooking,
  listBookings,
  acceptBooking,
  checkin,
  confirmStart,
  checkout,
  confirmCompletion,
  getPaymentStatus,
  rebook,
  bookingViewById,
};
