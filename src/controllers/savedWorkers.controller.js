const { pool } = require('../config/db');

// GET /api/saved-workers  (role requester) → [{ worker_id, name, skills }]
async function listSaved(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT w.worker_id, w.name, w.skills
       FROM saved_worker s
       JOIN workers w ON w.worker_id = s.worker_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC, s.saved_id DESC`,
      [req.user.user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

// POST /api/saved-workers  (role requester)  body { worker_id } → idempotent
async function saveWorker(req, res, next) {
  const { worker_id } = req.body || {};
  if (!worker_id) {
    return res.status(400).json({ error: 'worker_id is required' });
  }
  try {
    const worker = await pool.query('SELECT worker_id FROM workers WHERE worker_id = $1', [worker_id]);
    if (!worker.rows[0]) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    // Idempotent: the UNIQUE (user_id, worker_id) means re-saving is a no-op.
    await pool.query(
      `INSERT INTO saved_worker (user_id, worker_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, worker_id) DO NOTHING`,
      [req.user.user_id, worker_id]
    );
    return res.status(201).json({ worker_id: Number(worker_id), saved: true });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/saved-workers/:workerId  (role requester)
async function removeSaved(req, res, next) {
  const workerId = Number(req.params.workerId);
  if (!Number.isInteger(workerId)) {
    return res.status(400).json({ error: 'worker id must be an integer' });
  }
  try {
    await pool.query(
      'DELETE FROM saved_worker WHERE user_id = $1 AND worker_id = $2',
      [req.user.user_id, workerId]
    );
    return res.json({ worker_id: workerId, saved: false });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listSaved, saveWorker, removeSaved };
