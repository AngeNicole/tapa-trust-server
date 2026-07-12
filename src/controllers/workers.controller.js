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
    education: row.education,
    certifications: row.certifications,
  };
}

const { computeTier } = require('../lib/trust');

const WORKER_COLUMNS = 'worker_id, user_id, name, skills, bio, rating, tier, is_available, photo, education, certifications';
const FREE_TEXT_CAP = 1000;

// Derive a worker's simulated verification status from their verification_request
// rows: approved -> 'verified', any pending -> 'pending', otherwise 'unverified'.
async function getVerificationStatus(workerId, db = pool) {
  const r = await db.query(
    `SELECT CASE
       WHEN bool_or(status = 'approved') THEN 'verified'
       WHEN bool_or(status = 'pending')  THEN 'pending'
       WHEN bool_or(status = 'rejected') THEN 'rejected'
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
    tier: computeTier(row.verification, row.completed_jobs, row.rating),
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
    // 1-hour auto-unavailable fallback: hide workers with a fresh active booking
    // even if is_available wasn't toggled (computed, no cron).
    where.push(`NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.worker_id = w.worker_id
        AND b.status IN ('accepted', 'in_progress')
        AND b.created_at > now() - interval '1 hour'
    )`);
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
                  WHEN bool_or(vr.status = 'rejected') THEN 'rejected'
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
    profile.tier = computeTier(profile.verification, profile.taskHistory.length, profile.rating);
    // Identity evidence (ID/selfie/certificates) is admin-only — requesters and
    // the public never receive it.
    if (req.user && req.user.role === 'admin') {
      Object.assign(profile, await getVerificationEvidence(id));
    }
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
    profile.tier = computeTier(profile.verification, (await getTaskHistory(row.worker_id)).length, profile.rating);
    return res.json(profile);
  } catch (err) {
    return next(err);
  }
}

// GET /api/workers/me/earnings  (role worker)
// The worker's income record from earnings_record (released payouts), plus a
// by-category breakdown and average rating — an informal-income statement they
// can export (financial inclusion / SDG 8).
async function getMyEarnings(req, res, next) {
  try {
    const worker = await findOrCreateMyWorker(req.user.user_id);
    const wid = worker.worker_id;
    const rows = (await pool.query(
      `SELECT er.amount, er.date, t.title AS task_title, sc.name AS category
       FROM earnings_record er
       JOIN bookings b ON b.booking_id = er.booking_id
       JOIN tasks t    ON t.task_id = b.task_id
       LEFT JOIN skill_categories sc ON sc.category_id = t.category_id
       WHERE er.worker_id = $1
       ORDER BY er.date DESC`,
      [wid]
    )).rows;

    const records = rows.map((r) => ({ date: r.date, amount: Number(r.amount), taskTitle: r.task_title, category: r.category || 'Other' }));
    const total = records.reduce((a, r) => a + r.amount, 0);
    const byCatMap = {};
    records.forEach((r) => { byCatMap[r.category] = (byCatMap[r.category] || 0) + r.amount; });
    const byCategory = Object.entries(byCatMap).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

    return res.json({
      total,
      count: records.length,
      avgRating: worker.rating === null ? 0 : Number(worker.rating),
      byCategory,
      records,
    });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/workers/me  (role worker)  body { skills?, bio?, photo?, education?, certifications? }
// Partial update: only the fields present in the body are changed. education and
// certifications are optional free text — trimmed, empty treated as null, capped
// at FREE_TEXT_CAP chars (over-cap is a 400; empty is never an error).
async function updateMyWorker(req, res, next) {
  const body = req.body || {};

  for (const key of ['education', 'certifications']) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim().length > FREE_TEXT_CAP) {
      return res.status(400).json({ error: `${key} must be at most ${FREE_TEXT_CAP} characters` });
    }
  }

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
    // New optional fields: trim and treat empty string as null.
    for (const key of ['education', 'certifications']) {
      if (body[key] !== undefined) {
        const trimmed = body[key] === null ? null : String(body[key]).trim();
        fields.push(`${key} = $${i}`);
        values.push(trimmed === '' ? null : trimmed);
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
// Completeness guard: a worker can only go available with non-empty skills AND
// bio, so an incomplete profile can never appear in browse — even via direct API
// calls. Going unavailable is always allowed.
async function updateAvailability(req, res, next) {
  const { is_available } = req.body || {};
  if (typeof is_available !== 'boolean') {
    return res.status(400).json({ error: 'is_available (boolean) is required' });
  }
  try {
    const me = await findOrCreateMyWorker(req.user.user_id);
    if (is_available === true) {
      const hasSkills = (me.skills || '').trim().length > 0;
      const hasBio = (me.bio || '').trim().length > 0;
      if (!hasSkills || !hasBio) {
        return res.status(400).json({ error: 'Add your skills and bio before going available' });
      }
    }
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

// POST /api/workers/me/verification  (role worker)
//   body { reference?, document?, idDocument?, selfie?, certificationFiles? }
// SIMULATED identity step (Tier 1) — NO real NIDA/Smile ID or ID-number checks.
// The worker uploads an ID document, a selfie, and certificate scans (base64
// data URLs) so an admin can compare the selfie against the ID by eye and
// preview the certificates. Stored on a pending verification_request.
async function submitVerification(req, res, next) {
  const { faceMatchScore, faceMatchPassed, certificationFiles, method } = req.body || {};
  const chosen = method === 'online' || method === 'physical' ? method : 'physical';
  try {
    const worker = await findOrCreateMyWorker(req.user.user_id);
    // Match-then-discard: the ID + selfie are compared IN THE WORKER'S BROWSER and
    // never sent here. We persist only the verdict — no biometric images stored.
    const score = Number.isFinite(Number(faceMatchScore)) ? Math.round(Number(faceMatchScore)) : null;
    const passed = typeof faceMatchPassed === 'boolean' ? faceMatchPassed : null;
    const marker = chosen === 'online'
      ? `SIMULATED — online: on-device face match ${score == null ? 'not conclusive' : `${score}%`} (images not stored)`
      : 'SIMULATED — in-person: awaiting admin/office confirmation';
    const certs = Array.isArray(certificationFiles) ? JSON.stringify(certificationFiles) : null;
    const result = await pool.query(
      `INSERT INTO verification_request (worker_id, evidence, status, certification_files, method, face_match_score, face_match_passed)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6)
       RETURNING request_id, worker_id, evidence, status, created_at`,
      [worker.worker_id, marker, certs, chosen, score, passed]
    );
    return res.status(201).json({ request: result.rows[0], verification: 'pending', simulated: true });
  } catch (err) {
    return next(err);
  }
}

// The evidence from a worker's most recent verification_request — ID document,
// selfie, and certificate files. Admin-only; never exposed on public/requester
// responses so identity documents stay private.
async function getVerificationEvidence(workerId, db = pool) {
  const r = await db.query(
    `SELECT certification_files, method, face_match_score, face_match_passed
     FROM verification_request
     WHERE worker_id = $1
     ORDER BY created_at DESC, request_id DESC
     LIMIT 1`,
    [workerId]
  );
  const row = r.rows[0] || {};
  // No idDocument/selfie: online biometrics are matched-then-discarded in the
  // worker's browser; only the verdict is kept.
  return {
    certificationFiles: Array.isArray(row.certification_files) ? row.certification_files : [],
    verificationMethod: row.method || null,
    faceMatchScore: row.face_match_score == null ? null : Number(row.face_match_score),
    faceMatchPassed: row.face_match_passed == null ? null : row.face_match_passed,
  };
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
  getMyEarnings,
};
