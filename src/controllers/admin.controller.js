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
       RETURNING category_id, name, description, status`,
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

// PATCH /api/admin/categories/:id  (role admin)  body { name?, description?, status? }
// Single edit + archive/restore endpoint. Only the fields present in the body are
// changed. status (if present) must be 'active' | 'archived'. Returns the updated
// row (same shape as GET /categories). 400 on empty/invalid, 404 if missing,
// 409 on a duplicate name.
async function updateCategory(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'category id must be an integer' });
  }
  const body = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  if (body.name !== undefined) {
    if (!String(body.name).trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    fields.push(`name = $${i}`); values.push(String(body.name).trim()); i += 1;
  }
  if (body.description !== undefined) {
    fields.push(`description = $${i}`); values.push(body.description ?? null); i += 1;
  }
  if (body.status !== undefined) {
    if (!['active', 'archived'].includes(body.status)) {
      return res.status(400).json({ error: "status must be 'active' or 'archived'" });
    }
    fields.push(`status = $${i}`); values.push(body.status); i += 1;
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: 'Provide at least one of: name, description, status' });
  }
  try {
    values.push(id);
    const result = await pool.query(
      `UPDATE skill_categories SET ${fields.join(', ')} WHERE category_id = $${i}
       RETURNING category_id, name, description, status`,
      values
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Category not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    return next(err);
  }
}

// DELETE /api/admin/categories/:id  (role admin)
// Removes a category. Tasks referencing it keep their row (category_id set null).
async function deleteCategory(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'category id must be an integer' });
  }
  try {
    const result = await pool.query(
      'DELETE FROM skill_categories WHERE category_id = $1 RETURNING category_id',
      [id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Category not found' });
    }
    return res.json({ category_id: id, deleted: true });
  } catch (err) {
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
    // Reject the worker's non-rejected request(s). The derived status then
    // becomes 'rejected' (distinct from 'unverified' — the admin's Rejected tab).
    // If none exist, record an admin-initiated rejected request.
    const updated = await client.query(
      `UPDATE verification_request SET status = 'rejected', note = $2
       WHERE worker_id = $1 AND status IN ('pending', 'approved')`,
      [workerId, note ?? null]
    );
    if (updated.rowCount === 0) {
      await client.query(
        `INSERT INTO verification_request (worker_id, evidence, status, note)
         VALUES ($1, 'SIMULATED — admin-rejected', 'rejected', $2)`,
        [workerId, note ?? null]
      );
    }
    await client.query('COMMIT');
    return res.json({ worker_id: workerId, verification: 'rejected', note: note ?? null });
  } catch (err) {
    // Guard the rollback so a failed rollback can't mask the original error.
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  listUsers,
  createCategory,
  updateCategory,
  deleteCategory,
  verifyWorker,
  rejectWorker,
};
