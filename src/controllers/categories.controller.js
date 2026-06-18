const { pool } = require('../config/db');

// GET /api/categories  (any authenticated user)
async function listCategories(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT category_id, name, description
       FROM skill_categories
       ORDER BY category_id`
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listCategories };
