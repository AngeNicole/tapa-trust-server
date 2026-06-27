const { pool } = require('../config/db');

// GET /api/admin/users  (role admin) → oversight list of all users
async function listUsers(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT user_id, name, email, role, location, created_at
       FROM users ORDER BY created_at DESC, user_id DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/categories  (role admin)  body { name, description? } → created category
async function createCategory(req, res, next) {
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO skill_categories (name, description)
       VALUES ($1, $2)
       RETURNING category_id, name, description`,
      [String(name).trim(), description ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // skill_categories.name is UNIQUE.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    return next(err);
  }
}

// POST /api/admin/workers/:workerId/verify  (role admin)
// Marks a worker verified in the SIMULATED verification workflow: approves their
// pending verification_request(s), or records an admin-approved one if none
// exist. Oversight only — no transactional/booking action.
async function verifyWorker(req, res, next) {
  const workerId = Number(req.params.workerId);
  if (!Number.isInteger(workerId)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  try {
    const worker = await pool.query('SELECT worker_id FROM workers WHERE worker_id = $1', [workerId]);
    if (!worker.rows[0]) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const updated = await pool.query(
      `UPDATE verification_request SET status = 'approved'
       WHERE worker_id = $1 AND status = 'pending'`,
      [workerId]
    );
    if (updated.rowCount === 0) {
      await pool.query(
        `INSERT INTO verification_request (worker_id, evidence, status)
         VALUES ($1, 'SIMULATED — admin-approved', 'approved')`,
        [workerId]
      );
    }
    return res.json({ worker_id: workerId, verification: 'verified' });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/workers/:workerId/reject  (role admin)  body { note? }
// Simulated verification workflow: rejects the worker's current verification
// request(s) so their derived status returns to 'unverified'. Stores the optional
// admin note. Runs in one transaction. A worker can resubmit afterwards.
async function rejectWorker(req, res, next) {
  const workerId = Number(req.params.workerId);
  if (!Number.isInteger(workerId)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  const { note } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const worker = await client.query('SELECT worker_id FROM workers WHERE worker_id = $1', [workerId]);
    if (!worker.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Worker not found' });
    }
    // Reject any non-rejected request(s) so the derived status returns to unverified.
    await client.query(
      `UPDATE verification_request SET status = 'rejected', note = $2
       WHERE worker_id = $1 AND status IN ('pending', 'approved')`,
      [workerId, note ?? null]
    );
    await client.query('COMMIT');
    return res.json({ worker_id: workerId, verification: 'unverified', note: note ?? null });
  } catch (err) {
    // Guard the rollback so a failed rollback can't mask the original error.
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = { listUsers, createCategory, verifyWorker, rejectWorker };
