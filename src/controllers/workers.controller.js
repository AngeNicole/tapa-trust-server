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
    is_available: row.is_available,
    photo: row.photo,
  };
}

const WORKER_COLUMNS = 'worker_id, user_id, name, skills, bio, rating, tier, is_available, photo';

// Derive a worker's simulated verification status from their verification_request
// rows: approved -> 'verified', any pending -> 'pending', otherwise 'unverified'.
async function getVerificationStatus(workerId, db = pool) {
  const r = await db.query(
    `SELECT CASE
       WHEN bool_or(status = 'approved') THEN 'verified'
       WHEN bool_or(status = 'pending')  THEN 'pending'
       ELSE 'unverified' END AS verification
     FROM verification_request WHERE worker_id = $1`,
    [workerId]
  );
  return (r.rows[0] && r.rows[0].verification) || 'unverified';
}

// Shape a row from the browse query — what a requester needs to evaluate and
// pick a worker, without pulling the full profile.
function browseWorker(row) {
  return {
    worker_id: row.worker_id,
    user_id: row.user_id,
    name: row.name,
    photo: row.photo,
    skills: row.skills,
    rating: row.rating === null ? 0 : Number(row.rating),
    tier: row.tier,
    is_available: row.is_available,
    completedJobs: row.completed_jobs,
    verification: row.verification,
  };
}

// GET /api/workers   ?skill=<text>  ?all=true
// The requester's browse entry point. Returns only available workers by default;
// ?all=true returns everyone (admin/testing). ?skill filters on the skills text.
async function listWorkers(req, res, next) {
  const { skill, all } = req.query;
  const where = [];
  const params = [];

  if (all !== 'true') {
    where.push('w.is_available = true');
  }
  if (skill) {
    params.push(`%${skill}%`);
    where.push(`w.skills ILIKE $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT w.worker_id, w.user_id, w.name, w.skills, w.bio, w.rating, w.tier,
              w.is_available, w.photo,
              (SELECT COUNT(*)::int FROM bookings b
                 WHERE b.worker_id = w.worker_id AND b.status = 'completed') AS completed_jobs,
              COALESCE((
                SELECT CASE
                  WHEN bool_or(vr.status = 'approved') THEN 'verified'
                  WHEN bool_or(vr.status = 'pending')  THEN 'pending'
                  ELSE 'unverified' END
                FROM verification_request vr WHERE vr.worker_id = w.worker_id
              ), 'unverified') AS verification
       FROM workers w
       ${whereSql}
       ORDER BY w.worker_id`,
      params
    );
    return res.json(result.rows.map(browseWorker));
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
    profile.verification = await getVerificationStatus(id);
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
    const profile = publicWorker(row);
    profile.verification = await getVerificationStatus(row.worker_id);
    return res.json(profile);
  } catch (err) {
    return next(err);
  }
}

// PUT /api/workers/me  (role worker)  body { skills?, bio?, photo? }
// Partial update: only the fields present in the body are changed.
async function updateMyWorker(req, res, next) {
  const body = req.body || {};
  try {
    await findOrCreateMyWorker(req.user.user_id);

    const fields = [];
    const values = [];
    let i = 1;
    for (const key of ['skills', 'bio', 'photo']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = $${i}`);
        values.push(body[key] ?? null);
        i += 1;
      }
    }
    if (fields.length === 0) {
      const current = await pool.query(`SELECT ${WORKER_COLUMNS} FROM workers WHERE user_id = $1`, [req.user.user_id]);
      return res.json(publicWorker(current.rows[0]));
    }

    values.push(req.user.user_id);
    const result = await pool.query(
      `UPDATE workers SET ${fields.join(', ')} WHERE user_id = $${i} RETURNING ${WORKER_COLUMNS}`,
      values
    );
    return res.json(publicWorker(result.rows[0]));
  } catch (err) {
    return next(err);
  }
}

// PUT /api/workers/me/availability  (role worker)  body { is_available: boolean }
async function updateAvailability(req, res, next) {
  const { is_available } = req.body || {};
  if (typeof is_available !== 'boolean') {
    return res.status(400).json({ error: 'is_available (boolean) is required' });
  }
  try {
    await findOrCreateMyWorker(req.user.user_id);
    const result = await pool.query(
      `UPDATE workers SET is_available = $1 WHERE user_id = $2 RETURNING ${WORKER_COLUMNS}`,
      [is_available, req.user.user_id]
    );
    const profile = publicWorker(result.rows[0]);
    profile.verification = await getVerificationStatus(profile.worker_id);
    return res.json(profile);
  } catch (err) {
    return next(err);
  }
}

// POST /api/workers/me/verification  (role worker)  body { reference?, document? }
// SIMULATED digital-ID step (Tier 1). Stores only a clearly-labelled mock marker
// in a pending verification_request — NO real NIDA/Smile ID, NO ID-number
// validation, NO document storage. Admin approves it to mark the worker verified.
async function submitVerification(req, res, next) {
  const { reference, document } = req.body || {};
  try {
    const worker = await findOrCreateMyWorker(req.user.user_id);
    const marker = document
      ? 'SIMULATED — document uploaded (demo placeholder)'
      : `SIMULATED — reference: ${reference || 'demo'}`;
    const result = await pool.query(
      `INSERT INTO verification_request (worker_id, evidence, status)
       VALUES ($1, $2, 'pending')
       RETURNING request_id, worker_id, evidence, status, created_at`,
      [worker.worker_id, marker]
    );
    return res.status(201).json({ request: result.rows[0], verification: 'pending', simulated: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listWorkers,
  getWorker,
  getWorkerHistory,
  getMyWorker,
  updateMyWorker,
  updateAvailability,
  submitVerification,
  getVerificationStatus,
};
