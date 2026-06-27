const { pool } = require('../config/db');

// Narrow projection used ONLY by the public (unauthenticated) worker routes.
// Built explicitly — NOT derived from the authed worker object — so nothing
// sensitive can leak by default. Deliberately excludes: user_id, email, phone,
// exact location/address, verification evidence/document content, and any
// account fields. (The worker model has no location column, and we never join
// users here, so no location is exposed at all.)
function publicWorkerProjection(row) {
  return {
    worker_id: row.worker_id,
    name: row.name,
    skills: row.skills,
    bio: row.bio,
    photo: row.photo,
    rating: row.rating === null ? 0 : Number(row.rating),
    completedJobs: row.completed_jobs,
    education: row.education,
    certifications: row.certifications,
    verification: row.verification,
  };
}

// Selects only the columns the public projection needs — no user_id, no joins to
// users, no verification_request.evidence.
const PUBLIC_WORKER_SELECT = `
  SELECT w.worker_id, w.name, w.skills, w.bio, w.photo, w.rating, w.education, w.certifications,
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
`;

// GET /api/public/workers?skill=   (no auth) — available workers only.
async function listPublicWorkers(req, res, next) {
  const { skill } = req.query;
  // Available AND complete: the availability guard only stops *new* incomplete
  // workers from going available, so we also enforce non-empty skills/bio here
  // at query time — legacy rows that were marked available before the guard
  // existed must never surface on the public browse.
  const where = [
    'w.is_available = true',
    "btrim(coalesce(w.skills, '')) <> ''",
    "btrim(coalesce(w.bio, '')) <> ''",
  ];
  const params = [];
  if (skill) {
    params.push(`%${skill}%`);
    where.push(`w.skills ILIKE $${params.length}`);
  }
  try {
    const result = await pool.query(
      `${PUBLIC_WORKER_SELECT} WHERE ${where.join(' AND ')} ORDER BY w.worker_id`,
      params
    );
    return res.json(result.rows.map(publicWorkerProjection));
  } catch (err) {
    return next(err);
  }
}

// GET /api/public/workers/:id   (no auth) — one worker's public profile.
async function getPublicWorker(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  try {
    const result = await pool.query(`${PUBLIC_WORKER_SELECT} WHERE w.worker_id = $1`, [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    return res.json(publicWorkerProjection(result.rows[0]));
  } catch (err) {
    return next(err);
  }
}

// GET /api/public/workers/:id/history   (no auth) — completed jobs only.
// Public history item shape: job title, completion date, rating, comment.
async function getPublicWorkerHistory(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  try {
    const exists = await pool.query('SELECT 1 FROM workers WHERE worker_id = $1', [id]);
    if (!exists.rows[0]) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const result = await pool.query(
      `SELECT t.title AS task_title, cir.end_ts AS completed_at, rv.rating, rv.comment
       FROM bookings b
       JOIN tasks t              ON t.task_id     = b.task_id
       LEFT JOIN check_in_record cir ON cir.booking_id = b.booking_id
       LEFT JOIN reviews rv      ON rv.booking_id = b.booking_id
       WHERE b.worker_id = $1 AND b.status = 'completed'
       ORDER BY cir.end_ts DESC NULLS LAST, b.booking_id DESC`,
      [id]
    );
    return res.json(result.rows.map((r) => ({
      taskTitle: r.task_title,
      date: r.completed_at,
      rating: r.rating === null ? null : r.rating,
      comment: r.rating === null ? null : r.comment,
    })));
  } catch (err) {
    return next(err);
  }
}

module.exports = { listPublicWorkers, getPublicWorker, getPublicWorkerHistory };
