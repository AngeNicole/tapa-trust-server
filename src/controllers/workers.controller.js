const { pool } = require('../config/db');

// Shape a workers row for clients. rating is NUMERIC in Postgres (returned as a
// string by node-pg), so coerce it to a number for the JSON the client expects.
function publicWorker(row) {
  return {
    worker_id: row.worker_id,
    user_id: row.user_id,
    name: row.name,
    skills: row.skills,
    bio: row.bio,
    rating: row.rating === null ? 0 : Number(row.rating),
    tier: row.tier,
  };
}

const WORKER_COLUMNS = 'worker_id, user_id, name, skills, bio, rating, tier';

// GET /api/workers
async function listWorkers(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT ${WORKER_COLUMNS} FROM workers ORDER BY worker_id`
    );
    return res.json(result.rows.map(publicWorker));
  } catch (err) {
    return next(err);
  }
}

// A worker's track record: COMPLETED bookings only — the work a requester is
// actually evaluating. Each row carries the completion date (check_in_record
// .end_ts, when the job finished) and the requester's review, so the history
// surfaces the evidence, not just a list of titles. Requester identity is
// intentionally omitted — a public profile shows what was done and how it was
// rated, not who hired the worker. Ordered most-recently-finished first.
async function getTaskHistory(workerId, db = pool) {
  const result = await db.query(
    `SELECT b.booking_id, t.title AS task_title, cir.end_ts AS completed_at,
            rv.rating, rv.comment
     FROM bookings b
     JOIN tasks t              ON t.task_id     = b.task_id
     LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
     LEFT JOIN reviews rv      ON rv.booking_id = b.booking_id
     WHERE b.worker_id = $1 AND b.status = 'completed'
     ORDER BY cir.end_ts DESC NULLS LAST, b.booking_id DESC`,
    [workerId]
  );
  return result.rows.map((row) => ({
    booking_id: row.booking_id,
    taskTitle: row.task_title,
    status: 'completed',
    date: row.completed_at,
    review: row.rating === null ? null : { rating: row.rating, comment: row.comment },
  }));
}

// Currently in-flight work, as a scalar signal only — never the bookings
// themselves, so this can't leak which jobs a worker is on or who hired them.
async function getActiveJobsCount(workerId, db = pool) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM bookings
     WHERE worker_id = $1 AND status IN ('pending', 'accepted', 'in_progress')`,
    [workerId]
  );
  return result.rows[0].n;
}

// GET /api/workers/:id
async function getWorker(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  try {
    const result = await pool.query(
      `SELECT ${WORKER_COLUMNS} FROM workers WHERE worker_id = $1`,
      [id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const profile = publicWorker(result.rows[0]);
    profile.taskHistory = await getTaskHistory(id);
    profile.activeJobsCount = await getActiveJobsCount(id);
    return res.json(profile);
  } catch (err) {
    return next(err);
  }
}

// GET /api/workers/:id/history
// A worker's completed-only track record as a standalone list. Same data as
// the profile's taskHistory field, exposed on its own route so the client can
// fetch a worker's record without pulling the whole profile. Returns [] for a
// worker with no completed jobs (404 only if the worker itself doesn't exist).
async function getWorkerHistory(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  try {
    const exists = await pool.query('SELECT 1 FROM workers WHERE worker_id = $1', [id]);
    if (!exists.rows[0]) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    return res.json(await getTaskHistory(id));
  } catch (err) {
    return next(err);
  }
}

// Find the caller's worker row, creating it lazily if missing. Every worker
// user normally gets a row at registration, but this keeps /workers/me robust.
async function findOrCreateMyWorker(userId, client = pool) {
  const existing = await client.query(
    `SELECT ${WORKER_COLUMNS} FROM workers WHERE user_id = $1`,
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const user = await client.query('SELECT name FROM users WHERE user_id = $1', [userId]);
  const name = user.rows[0] ? user.rows[0].name : 'Worker';
  const created = await client.query(
    `INSERT INTO workers (user_id, name) VALUES ($1, $2)
     RETURNING ${WORKER_COLUMNS}`,
    [userId, name]
  );
  return created.rows[0];
}

// GET /api/workers/me  (role worker)
async function getMyWorker(req, res, next) {
  try {
    const row = await findOrCreateMyWorker(req.user.user_id);
    return res.json(publicWorker(row));
  } catch (err) {
    return next(err);
  }
}

// PUT /api/workers/me  (role worker)  body { skills, bio }
async function updateMyWorker(req, res, next) {
  const { skills, bio } = req.body || {};
  try {
    // Ensure the row exists, then update only the editable fields.
    await findOrCreateMyWorker(req.user.user_id);
    const result = await pool.query(
      `UPDATE workers SET skills = $1, bio = $2
       WHERE user_id = $3
       RETURNING ${WORKER_COLUMNS}`,
      [skills ?? null, bio ?? null, req.user.user_id]
    );
    return res.json(publicWorker(result.rows[0]));
  } catch (err) {
    return next(err);
  }
}

module.exports = { listWorkers, getWorker, getWorkerHistory, getMyWorker, updateMyWorker };
