// Shared test helpers: a supertest client bound to the app, factories for
// requester/worker/admin identities, and pool teardown. Each test file calls
// closePool() in afterAll so jest exits cleanly.
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { signToken } = require('../src/config/jwt');

let n = 0;
function uniqueEmail(prefix) {
  n += 1;
  return `${prefix}_${Date.now()}_${n}_${Math.floor(Math.random() * 1e6)}@test.local`;
}

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

// Register a requester; returns { token, user }.
async function registerRequester(overrides = {}) {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Req User',
    email: uniqueEmail('req'),
    password: 'secret1',
    role: 'requester',
    ...overrides,
  });
  return res.body;
}

// Register a worker (auto-creates the worker profile); returns
// { token, user, worker_id }.
async function registerWorker(overrides = {}) {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Wrk User',
    email: uniqueEmail('wrk'),
    password: 'secret1',
    role: 'worker',
    ...overrides,
  });
  const body = res.body;
  const me = await request(app).get('/api/workers/me').set(authHeader(body.token));
  return { ...body, worker_id: me.body.worker_id };
}

// Admins can't self-register; insert one directly and sign a token.
async function createAdmin() {
  const hash = await bcrypt.hash('secret1', 4);
  const r = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Admin', $1, $2, 'admin') RETURNING user_id`,
    [uniqueEmail('admin'), hash]
  );
  return signToken({ user_id: r.rows[0].user_id, role: 'admin' });
}

// Stage an existing booking directly in the DB to a given lifecycle state, by
// writing the same columns the controllers would. Used only to set up
// preconditions for tests — it deliberately does NOT go through the HTTP
// transition routes (and never through the removed task-posting routes), so
// test setup doesn't depend on the product API for staging. The transitions
// themselves are exercised over HTTP in trustLoop.test.js.
async function stageBooking(bookingId, taskId, stage) {
  if (stage === 'pending') return;
  if (stage === 'accepted') {
    await pool.query(`UPDATE bookings SET status = 'accepted' WHERE booking_id = $1`, [bookingId]);
  } else if (stage === 'checkedIn') {
    await pool.query(`UPDATE bookings SET status = 'accepted' WHERE booking_id = $1`, [bookingId]);
    await pool.query('UPDATE check_in_record SET start_ts = now() WHERE booking_id = $1', [bookingId]);
  } else if (stage === 'in_progress') {
    await pool.query(`UPDATE bookings SET status = 'in_progress' WHERE booking_id = $1`, [bookingId]);
    await pool.query('UPDATE check_in_record SET start_ts = now(), start_confirmed = true WHERE booking_id = $1', [bookingId]);
  } else if (stage === 'checkedOut') {
    await pool.query(`UPDATE bookings SET status = 'in_progress' WHERE booking_id = $1`, [bookingId]);
    await pool.query('UPDATE check_in_record SET start_ts = now(), start_confirmed = true, end_ts = now() WHERE booking_id = $1', [bookingId]);
  } else if (stage === 'completed') {
    await pool.query(`UPDATE bookings SET status = 'completed' WHERE booking_id = $1`, [bookingId]);
    await pool.query('UPDATE check_in_record SET start_ts = now(), start_confirmed = true, end_ts = now(), end_confirmed = true WHERE booking_id = $1', [bookingId]);
    await pool.query(`UPDATE tasks SET status = 'completed' WHERE task_id = $1`, [taskId]);
  }
  // States at/after check-in imply an agreed price + escrow deposited (check-in
  // gates on escrow 'held'); a completed booking has the escrow released.
  if (['checkedIn', 'in_progress', 'checkedOut', 'completed'].includes(stage)) {
    await pool.query('UPDATE bookings SET agreed_price = 5000 WHERE booking_id = $1', [bookingId]);
    const payStatus = stage === 'completed' ? 'released' : 'held';
    await pool.query(
      `UPDATE payment_status SET amount = 5000, status = $1, deposited_at = now() WHERE booking_id = $2`,
      [payStatus, bookingId]
    );
    if (stage === 'completed') {
      await pool.query(`UPDATE payment_status SET released_at = now() WHERE booking_id = $1`, [bookingId]);
    }
  }
}

// Create a booking via the real product path (book-from-profile) and stage it to
// the requested lifecycle state. Returns ids + the current BookingView (read via
// the real GET /bookings). stages: 'pending' | 'accepted' | 'checkedIn' |
// 'in_progress' | 'checkedOut' | 'completed'.
async function makeBookingAt(stage = 'pending', opts = {}) {
  const requester = opts.requester || (await registerRequester());
  const worker = opts.worker || (await registerWorker({}));
  // give the worker a skill so booking/rebook titles are meaningful
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing, Electrical', bio: 'test' });

  const created = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
  const bookingId = created.body.booking_id;
  const taskId = created.body.task_id;

  await stageBooking(bookingId, taskId, stage);

  const list = await request(app).get('/api/bookings').set(authHeader(requester.token));
  const body = list.body.find((b) => b.booking_id === bookingId);

  return { requester, worker, taskId, bookingId, body };
}

const closePool = () => pool.end();

module.exports = {
  request,
  app,
  pool,
  authHeader,
  registerRequester,
  registerWorker,
  createAdmin,
  makeBookingAt,
  closePool,
  uniqueEmail,
};
