const { pool } = require('../config/db');

// GET /api/categories  (any authenticated user)  ?status=active|archived|all
// Defaults to active only (so pickers never show archived categories); the admin
// status tabs pass ?status=archived or ?status=all.
async function listCategories(req, res, next) {
  const status = (req.query.status || 'active').toLowerCase();
  if (!['active', 'archived', 'all'].includes(status)) {
    return res.status(400).json({ error: "status must be 'active', 'archived', or 'all'" });
  }
  try {
    const where = status === 'all' ? '' : 'WHERE status = $1';
    const params = status === 'all' ? [] : [status];
    const result = await pool.query(
      `SELECT category_id, name, description, status
       FROM skill_categories
       ${where}
       ORDER BY category_id`,
      params
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listCategories };
