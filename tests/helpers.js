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

// Drive a brand-new booking to a given stage. Returns ids + the latest body.
// stages: 'pending' | 'accepted' | 'checkedIn' | 'in_progress' | 'checkedOut' | 'completed'
async function makeBookingAt(stage = 'pending', opts = {}) {
  const requester = opts.requester || (await registerRequester());
  const worker = opts.worker || (await registerWorker({ }));
  // give the worker a skill so rebook titles are meaningful
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing, Electrical', bio: 'test' });

  const task = await request(app).post('/api/tasks').set(authHeader(requester.token)).send({ title: 'Test task' });
  const taskId = task.body.task_id;
  let res = await request(app).post('/api/bookings').set(authHeader(requester.token))
    .send({ task_id: taskId, worker_id: worker.worker_id });
  const bookingId = res.body.booking_id;

  const steps = {
    accepted: () => request(app).post(`/api/bookings/${bookingId}/accept`).set(authHeader(worker.token)),
    checkedIn: () => request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token)),
    in_progress: () => request(app).post(`/api/bookings/${bookingId}/confirm-start`).set(authHeader(requester.token)),
    checkedOut: () => request(app).post(`/api/bookings/${bookingId}/checkout`).set(authHeader(worker.token)),
    completed: () => request(app).post(`/api/bookings/${bookingId}/confirm-completion`).set(authHeader(requester.token)),
  };
  const order = ['accepted', 'checkedIn', 'in_progress', 'checkedOut', 'completed'];
  const target = order.indexOf(stage);
  for (let i = 0; i <= target; i += 1) {
    res = await steps[order[i]]();
  }

  return { requester, worker, taskId, bookingId, body: res.body };
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
