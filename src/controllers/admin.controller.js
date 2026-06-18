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

module.exports = { listUsers, createCategory };
