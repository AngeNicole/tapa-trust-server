const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { signToken } = require('../config/jwt');

const SALT_ROUNDS = 10;
const VALID_ROLES = ['requester', 'worker'];

// Shape the user object returned to clients. Never includes password_hash.
function publicUser(row) {
  return {
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    location: row.location,
  };
}

// POST /api/auth/register
async function register(req, res, next) {
  const { name, email, password, role, location, phone } = req.body || {};

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "role must be 'requester' or 'worker'" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  const client = await pool.connect();
  try {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    await client.query('BEGIN');

    const insertUser = await client.query(
      `INSERT INTO users (name, email, phone, password_hash, role, location)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id, name, email, phone, role, location`,
      [name, email.toLowerCase().trim(), phone || null, password_hash, role, location || null]
    );
    const user = insertUser.rows[0];

    // Supply side: every worker user gets a linked workers profile row.
    if (role === 'worker') {
      await client.query(
        `INSERT INTO workers (user_id, name, skills, bio)
         VALUES ($1, $2, $3, $4)`,
        [user.user_id, name, null, null]
      );
    }

    await client.query('COMMIT');

    const token = signToken({ user_id: user.user_id, role: user.role });
    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    await client.query('ROLLBACK');
    // Unique violation on users.email
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    return next(err);
  } finally {
    client.release();
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT user_id, name, email, phone, password_hash, role, location
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    const row = result.rows[0];

    // Same generic message whether the email is unknown or the password is wrong.
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ user_id: row.user_id, role: row.role });
    return res.json({ token, user: publicUser(row) });
  } catch (err) {
    return next(err);
  }
}

// GET /api/auth/me  (protected)
async function me(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT user_id, name, email, phone, role, location
       FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: publicUser(row) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, me };
