const { pool } = require('../config/db');

const TASK_COLUMNS = 'task_id, user_id, category_id, title, description, status, location, created_at';

// POST /api/tasks  (role requester)  body { title, category_id?, description?, location? }
async function createTask(req, res, next) {
  const { title, category_id, description, location } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO tasks (user_id, category_id, title, description, location, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING ${TASK_COLUMNS}`,
      [req.user.user_id, category_id ?? null, String(title).trim(), description ?? null, location ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // Bad category_id reference → foreign key violation.
    if (err.code === '23503') {
      return res.status(400).json({ error: 'category_id does not exist' });
    }
    return next(err);
  }
}

// GET /api/tasks  (role requester) → the caller's own tasks
async function listMyTasks(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 ORDER BY created_at DESC, task_id DESC`,
      [req.user.user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

// GET /api/tasks/:id
async function getTask(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'task id must be an integer' });
  }
  try {
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE task_id = $1`,
      [id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
}

module.exports = { createTask, listMyTasks, getTask };
