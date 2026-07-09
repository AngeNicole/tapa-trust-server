const { pool } = require('../config/db');
const { createNotification } = require('./notifications.controller');

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
    ru.name  AS "requesterName",
    ru.phone AS "requesterPhone",
    wu.phone AS "workerPhone",
    b.status,
    b.cancel_reason AS "cancelReason",
    b.agreed_price AS "agreedPrice",
    (cir.start_ts IS NOT NULL)           AS "checkedIn",
    COALESCE(cir.start_confirmed, false) AS "startConfirmed",
    (cir.end_ts IS NOT NULL)             AS "checkedOut",
    COALESCE(cir.end_confirmed, false)   AS "endConfirmed",
    cir.start_ts AS "startTs",
    cir.end_ts   AS "endTs",
    b.accepted_at          AS "acceptedAt",
    cir.start_confirmed_at AS "startConfirmedAt",
    cir.end_confirmed_at   AS "endConfirmedAt",
    ps.status AS payment,
    ch.chat_id AS "chatId",
    CASE WHEN rv.review_id IS NOT NULL
         THEN json_build_object('rating', rv.rating, 'comment', rv.comment)
         ELSE NULL END AS review,
    CASE WHEN ag.agreement_id IS NOT NULL
         THEN json_build_object(
           'agreementId', ag.agreement_id,
           'agreedPrice', ag.agreed_price,
           'status', ag.status,
           'requesterSigned', ag.requester_signature IS NOT NULL,
           'workerSigned', ag.worker_signature IS NOT NULL,
           'requesterSignature', ag.requester_signature,
           'workerSignature', ag.worker_signature)
         ELSE NULL END AS agreement,
    json_build_object('status', ps.status, 'amount', ps.amount) AS escrow,
    (SELECT CASE WHEN d.dispute_id IS NOT NULL THEN json_build_object(
        'disputeId', d.dispute_id, 'status', d.status, 'category', d.category,
        'raisedBy', d.raised_by, 'outcome', d.outcome, 'createdAt', d.created_at)
      ELSE NULL END
     FROM dispute_resolution d WHERE d.booking_id = b.booking_id
     ORDER BY d.created_at DESC LIMIT 1) AS dispute
  FROM bookings b
  JOIN tasks   t  ON t.task_id   = b.task_id
  JOIN workers w  ON w.worker_id = b.worker_id
  JOIN users   ru ON ru.user_id  = b.user_id
  JOIN users   wu ON wu.user_id  = w.user_id
  LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
  LEFT JOIN payment_status  ps  ON ps.booking_id  = b.booking_id
  LEFT JOIN reviews         rv  ON rv.booking_id  = b.booking_id
  LEFT JOIN chat            ch  ON ch.booking_id  = b.booking_id
  LEFT JOIN agreement       ag  ON ag.booking_id  = b.booking_id
`;

async function bookingViewById(bookingId, db = pool) {
  const r = await db.query(`${BOOKING_VIEW_SQL} WHERE b.booking_id = $1`, [bookingId]);
  return r.rows[0] || null;
}

// Load a booking with everything the auth + ordering checks need.
async function loadBooking(bookingId, db = pool) {
  const r = await db.query(
    `SELECT b.booking_id, b.task_id, b.worker_id, b.user_id AS requester_user_id, b.status,
            b.agreed_price,
            w.user_id AS worker_user_id,
            cir.start_ts, cir.end_ts, cir.start_confirmed, cir.end_confirmed,
            ps.status AS payment_status, ps.amount,
            ch.chat_id,
            ag.agreement_id, ag.status AS agreement_status
     FROM bookings b
     JOIN workers w ON w.worker_id = b.worker_id
     LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
     LEFT JOIN payment_status  ps  ON ps.booking_id  = b.booking_id
     LEFT JOIN chat            ch  ON ch.booking_id  = b.booking_id
     LEFT JOIN agreement       ag  ON ag.booking_id  = b.booking_id
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
    await pool.query(`UPDATE bookings SET status = 'accepted', accepted_at = now() WHERE booking_id = $1`, [booking.booking_id]);
    // Auto-unavailable while committed to this job.
    await pool.query('UPDATE workers SET is_available = false WHERE worker_id = $1', [booking.worker_id]);
    await createNotification(pool, booking.requester_user_id, 'booking_accepted', 'Your booking was accepted.', booking.booking_id);
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
    if (booking.payment_status !== 'held') {
      return res.status(400).json({ error: 'Requester must deposit to escrow before work starts.' });
    }
    if (booking.start_ts) {
      return res.status(400).json({ error: 'Worker has already checked in' });
    }
    await pool.query('UPDATE check_in_record SET start_ts = now() WHERE booking_id = $1', [booking.booking_id]);
    await createNotification(pool, booking.requester_user_id, 'checkin', 'The worker checked in. Confirm start to proceed.', booking.booking_id);
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/confirm-start  (role requester)
//   → start_confirmed = true, status 'in_progress'. Escrow stays 'held'
//   (deposited earlier) until completion releases it.
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
      'UPDATE check_in_record SET start_confirmed = true, start_confirmed_at = now() WHERE booking_id = $1',
      [booking.booking_id]
    );
    await client.query(`UPDATE bookings SET status = 'in_progress' WHERE booking_id = $1`, [booking.booking_id]);
    await createNotification(client, booking.worker_user_id, 'start_confirmed', 'The requester confirmed start. You can begin work.', booking.booking_id);
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
    await createNotification(pool, booking.requester_user_id, 'checkout', 'The worker checked out. Confirm completion to release payment.', booking.booking_id);
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/confirm-completion  (role requester)
//   → end_confirmed = true, status 'completed', task 'completed'. Releases held
//   escrow (status 'released' + released_at), writes the worker's earnings_record,
//   and marks the worker available again.
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
    // Payment freeze: an open dispute blocks completion/release until an admin rules.
    const openDispute = await pool.query(
      `SELECT 1 FROM dispute_resolution WHERE booking_id = $1 AND status = 'open' LIMIT 1`,
      [booking.booking_id]
    );
    if (openDispute.rows[0]) {
      return res.status(409).json({ error: 'This booking is under dispute — an admin must resolve it before payment is released.' });
    }
    await client.query('BEGIN');
    await client.query(
      'UPDATE check_in_record SET end_confirmed = true, end_confirmed_at = now() WHERE booking_id = $1',
      [booking.booking_id]
    );
    await client.query(`UPDATE bookings SET status = 'completed' WHERE booking_id = $1`, [booking.booking_id]);
    await client.query(`UPDATE tasks SET status = 'completed' WHERE task_id = $1`, [booking.task_id]);
    // Release held escrow and record the worker's earnings.
    if (booking.payment_status === 'held') {
      const pay = await client.query(
        `UPDATE payment_status SET status = 'released', released_at = now()
         WHERE booking_id = $1 RETURNING amount`,
        [booking.booking_id]
      );
      await client.query(
        'INSERT INTO earnings_record (worker_id, booking_id, amount) VALUES ($1, $2, $3)',
        [booking.worker_id, booking.booking_id, pay.rows[0] ? pay.rows[0].amount : 0]
      );
    }
    // Worker is free again.
    await client.query('UPDATE workers SET is_available = true WHERE worker_id = $1', [booking.worker_id]);
    await createNotification(client, booking.worker_user_id, 'completed', 'The requester confirmed completion. Payment released.', booking.booking_id);
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
// Book-from-profile & rebook (no task form — task auto-created server-side)
// =====================================================================

// Shared: auto-create a minimal internal task for a worker (title derived from
// the worker's first skill), then a pending booking with its payment + check-in
// records, mark the task assigned, and notify the worker. Returns
// { bookingId } or { error } (caller decides the HTTP status). Must run inside
// a transaction (pass the client). This is the one place both book-from-profile
// (first booking) and rebook (repeat booking) create bookings, so they stay
// identical to the original rebook pattern.
async function createWorkerBooking(client, { requesterUserId, workerId, titlePrefix }) {
  const worker = await client.query('SELECT worker_id, user_id, skills FROM workers WHERE worker_id = $1', [workerId]);
  if (!worker.rows[0]) {
    return { error: 'Worker not found', status: 404 };
  }

  // Guard against double-booking: one active (non-terminal) booking per
  // requester+worker pair. Checked in-transaction so the public-profile →
  // signup → book path can't bypass the client-side disable.
  const active = await client.query(
    `SELECT 1 FROM bookings
     WHERE user_id = $1 AND worker_id = $2 AND status IN ('pending', 'accepted', 'in_progress')
     LIMIT 1`,
    [requesterUserId, workerId]
  );
  if (active.rows[0]) {
    return { error: 'You already have an active booking with this worker', status: 409 };
  }

  // Title derives from the worker's first listed skill (comma-separated).
  const firstSkill = (worker.rows[0].skills || '').split(',')[0].trim();
  const title = `${titlePrefix}: ${firstSkill || 'task'}`;

  const task = await client.query(
    `INSERT INTO tasks (user_id, title, status) VALUES ($1, $2, 'open') RETURNING task_id`,
    [requesterUserId, title]
  );
  const taskId = task.rows[0].task_id;

  const booking = await client.query(
    `INSERT INTO bookings (task_id, worker_id, user_id, status)
     VALUES ($1, $2, $3, 'pending') RETURNING booking_id`,
    [taskId, workerId, requesterUserId]
  );
  const bookingId = booking.rows[0].booking_id;

  await client.query(`INSERT INTO payment_status (booking_id, status) VALUES ($1, 'pending')`, [bookingId]);
  await client.query('INSERT INTO check_in_record (booking_id) VALUES ($1)', [bookingId]);
  await client.query('INSERT INTO chat (booking_id) VALUES ($1)', [bookingId]);
  await client.query(`UPDATE tasks SET status = 'assigned' WHERE task_id = $1`, [taskId]);
  await createNotification(client, worker.rows[0].user_id, 'booking_request', 'You have a new booking request.', bookingId);

  return { bookingId };
}

// Run createWorkerBooking in its own transaction and return the BookingView.
async function bookWorker(req, res, next, titlePrefix) {
  const workerId = parseId(req.params.workerId);
  if (workerId === null) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createWorkerBooking(client, {
      requesterUserId: req.user.user_id,
      workerId,
      titlePrefix,
    });
    if (result.error) {
      await client.query('ROLLBACK');
      return res.status(result.status || 404).json({ error: result.error });
    }
    const view = await bookingViewById(result.bookingId, client);
    await client.query('COMMIT');
    return res.status(201).json(view);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

// POST /api/bookings/book/:workerId  (role requester)
//   The requester's entry into the loop: book a worker straight from their
//   profile. The task is created internally — requesters never post a task.
function bookFromProfile(req, res, next) {
  return bookWorker(req, res, next, 'Booking');
}

// POST /api/bookings/rebook/:workerId  (role requester)
//   One-tap rebook — the same flow as a first booking, with a "Rebooking:" title.
function rebook(req, res, next) {
  return bookWorker(req, res, next, 'Rebooking');
}

// =====================================================================
// Booking chat + structured price agreement
// =====================================================================

// Either party (requester or the booked worker) to a booking.
function isParty(booking, user) {
  return booking.requester_user_id === user.user_id || booking.worker_user_id === user.user_id;
}

// The other party's user_id, given the caller.
function otherPartyId(booking, userId) {
  return userId === booking.requester_user_id ? booking.worker_user_id : booking.requester_user_id;
}

// Load a booking and enforce that the caller is a party. Returns the booking, or
// null after sending 400/404/403. Shared by the single-GET + chat + price
// endpoints (both parties, either role — used instead of the role-based guard()).
async function partyGuard(req, res) {
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
  if (!isParty(booking, req.user)) {
    res.status(403).json({ error: 'This booking does not belong to you' });
    return null;
  }
  return booking;
}

// GET /api/bookings/:id — a single BookingView (parties only). Lets the client
// open a booking (and its chat) straight from a notification.
async function getBooking(req, res, next) {
  try {
    const booking = await partyGuard(req, res);
    if (!booking) return undefined;
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// GET /api/bookings/:id/messages — { agreedPrice, messages[] } oldest→newest
// (parties only). Each message carries sender identity + role and an optional
// price offer (amount).
async function getMessages(req, res, next) {
  try {
    const booking = await partyGuard(req, res);
    if (!booking) return undefined;
    const result = await pool.query(
      `SELECT m.message_id, m.sender_user_id, u.name AS sender_name, m.body, m.amount, m.created_at
       FROM messages m
       JOIN users u ON u.user_id = m.sender_user_id
       WHERE m.booking_id = $1
       ORDER BY m.created_at ASC, m.message_id ASC`,
      [booking.booking_id]
    );
    const messages = result.rows.map((m) => ({
      message_id: m.message_id,
      body: m.body,
      amount: m.amount === null ? null : Number(m.amount),
      created_at: m.created_at,
      senderUserId: m.sender_user_id,
      senderName: m.sender_name,
      senderRole: m.sender_user_id === booking.requester_user_id ? 'requester' : 'worker',
    }));
    return res.json({
      chatId: booking.chat_id ?? null,
      agreedPrice: booking.agreed_price === null ? null : Number(booking.agreed_price),
      messages,
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/messages  body { body, amount } — send a message and/or
// a price offer (parties only). At least one of body/amount must be present;
// amount, if present, must be > 0. An offer notifies the other party.
async function postMessage(req, res, next) {
  try {
    const booking = await partyGuard(req, res);
    if (!booking) return undefined;
    const raw = req.body || {};
    const body = (raw.body !== undefined && raw.body !== null && String(raw.body).trim() !== '')
      ? String(raw.body).trim() : null;
    let amount = null;
    if (raw.amount !== undefined && raw.amount !== null) {
      amount = Number(raw.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }
    }
    if (body === null && amount === null) {
      return res.status(400).json({ error: 'a message must have a body and/or an amount' });
    }
    const result = await pool.query(
      `INSERT INTO messages (booking_id, chat_id, sender_user_id, body, amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING message_id, booking_id, chat_id, sender_user_id, body, amount, created_at`,
      [booking.booking_id, booking.chat_id ?? null, req.user.user_id, body, amount]
    );
    const type = amount !== null ? 'offer' : 'message';
    const note = amount !== null ? `New price offer: ${amount}` : 'You have a new message';
    await createNotification(pool, otherPartyId(booking, req.user.user_id), type, note, booking.booking_id);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/agree-price  body { amount } — records the agreed price
// (parties only): sets bookings.agreed_price AND writes payment_status.amount, in
// one transaction. Returns the BookingView (carrying agreedPrice). Gates check-in.
async function agreePrice(req, res, next) {
  const booking = await partyGuard(req, res);
  if (!booking) return undefined;
  const amount = Number((req.body || {}).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE bookings SET agreed_price = $1 WHERE booking_id = $2', [amount, booking.booking_id]);
    await client.query('UPDATE payment_status SET amount = $1 WHERE booking_id = $2', [amount, booking.booking_id]);
    const view = await bookingViewById(booking.booking_id, client);
    await client.query('COMMIT');
    await createNotification(pool, otherPartyId(booking, req.user.user_id), 'price_agreed', `Price agreed: ${amount}`, booking.booking_id);
    return res.json(view);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    return next(err);
  } finally {
    client.release();
  }
}

// =====================================================================
// Digital agreement (finalize) + escrow + decline
// =====================================================================

// POST /api/bookings/:id/agreement  (requester)  { amount, signature }
// Requester proposes + signs the agreement (simulated e-signature = typed name).
// Creates/updates the one-per-booking agreement (status 'proposed') and sets
// bookings.agreed_price. Notifies the worker to review + sign.
async function proposeAgreement(req, res, next) {
  const booking = await partyGuard(req, res);
  if (!booking) return undefined;
  if (booking.requester_user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'Only the requester can propose the agreement' });
  }
  const { amount, signature } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (!signature || !String(signature).trim()) {
    return res.status(400).json({ error: 'signature is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO agreement (chat_id, booking_id, worker_id, requester_id, agreed_price,
                              requester_signature, requester_signed_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 'proposed')
       ON CONFLICT (booking_id) DO UPDATE SET
         agreed_price = EXCLUDED.agreed_price,
         requester_signature = EXCLUDED.requester_signature,
         requester_signed_at = now(),
         worker_signature = NULL,
         worker_signed_at = NULL,
         status = 'proposed'`,
      [booking.chat_id, booking.booking_id, booking.worker_id, booking.requester_user_id,
        amt, String(signature).trim()]
    );
    await client.query('UPDATE bookings SET agreed_price = $1 WHERE booking_id = $2', [amt, booking.booking_id]);
    const view = await bookingViewById(booking.booking_id, client);
    await client.query('COMMIT');
    await createNotification(pool, booking.worker_user_id, 'agreement_proposed', `Agreement proposed at RWF ${amt} — review and sign.`, booking.booking_id);
    return res.json(view);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    return next(err);
  } finally {
    client.release();
  }
}

// POST /api/bookings/:id/agreement/sign  (worker)  { signature }
// Worker signs a proposed agreement → status 'signed'. Notifies the requester to deposit.
async function signAgreement(req, res, next) {
  const booking = await partyGuard(req, res);
  if (!booking) return undefined;
  if (booking.worker_user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'Only the worker can sign the agreement' });
  }
  if (booking.agreement_status !== 'proposed') {
    return res.status(400).json({ error: 'No proposed agreement to sign' });
  }
  const { signature } = req.body || {};
  if (!signature || !String(signature).trim()) {
    return res.status(400).json({ error: 'signature is required' });
  }
  try {
    await pool.query(
      `UPDATE agreement SET worker_signature = $1, worker_signed_at = now(), status = 'signed'
       WHERE booking_id = $2`,
      [String(signature).trim(), booking.booking_id]
    );
    await createNotification(pool, booking.requester_user_id, 'agreement_signed', 'Agreement signed — deposit to start.', booking.booking_id);
    return res.json(await bookingViewById(booking.booking_id));
  } catch (err) {
    return next(err);
  }
}

// POST /api/bookings/:id/escrow/deposit  (requester)
// Precondition: agreement 'signed'. Holds the agreed price in escrow.
async function depositEscrow(req, res, next) {
  const booking = await partyGuard(req, res);
  if (!booking) return undefined;
  if (booking.requester_user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'Only the requester can deposit' });
  }
  if (booking.agreement_status !== 'signed') {
    return res.status(400).json({ error: 'Both parties must sign the agreement before deposit' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE payment_status SET amount = $1, status = 'held', deposited_at = now()
       WHERE booking_id = $2`,
      [booking.agreed_price, booking.booking_id]
    );
    const view = await bookingViewById(booking.booking_id, client);
    await client.query('COMMIT');
    await createNotification(pool, booking.worker_user_id, 'escrow_deposited', 'Deposit held in escrow — you can start work.', booking.booking_id);
    return res.json(view);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    return next(err);
  } finally {
    client.release();
  }
}

// POST /api/bookings/:id/decline  (either party)  { reason }
// Cancel a booking (before completion) with a reason. Refunds held escrow, voids
// any agreement, frees the worker, and notifies the other party.
async function declineBooking(req, res, next) {
  const booking = await partyGuard(req, res);
  if (!booking) return undefined;
  if (!['pending', 'accepted', 'in_progress'].includes(booking.status)) {
    return res.status(400).json({ error: `Cannot decline a booking with status '${booking.status}'` });
  }
  const reason = (req.body || {}).reason;
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'reason is required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = $1 WHERE booking_id = $2`,
      [String(reason).trim(), booking.booking_id]
    );
    // Refund held escrow; void any agreement; free the worker.
    if (booking.payment_status === 'held') {
      await client.query(`UPDATE payment_status SET status = 'refunded' WHERE booking_id = $1`, [booking.booking_id]);
    }
    if (booking.agreement_id) {
      await client.query(`UPDATE agreement SET status = 'void' WHERE booking_id = $1`, [booking.booking_id]);
    }
    await client.query('UPDATE workers SET is_available = true WHERE worker_id = $1', [booking.worker_id]);
    const view = await bookingViewById(booking.booking_id, client);
    await client.query('COMMIT');
    await createNotification(pool, otherPartyId(booking, req.user.user_id), 'booking_declined', `Booking cancelled: ${String(reason).trim()}`, booking.booking_id);
    return res.json(view);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  listBookings,
  getBooking,
  acceptBooking,
  checkin,
  confirmStart,
  checkout,
  confirmCompletion,
  getPaymentStatus,
  bookFromProfile,
  rebook,
  getMessages,
  postMessage,
  agreePrice,
  proposeAgreement,
  signAgreement,
  depositEscrow,
  declineBooking,
  bookingViewById,
};
