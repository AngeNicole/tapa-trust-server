require('dotenv').config();

const bcrypt = require('bcrypt');
const { pool } = require('../src/config/db');

// Seed (or reset) an admin account. Admins can't self-register via /auth, so this
// creates one directly. Idempotent: re-running upserts the same email and resets
// its password to the known value, so admin login always works. Non-destructive
// to all other data. Configure with ADMIN_EMAIL / ADMIN_PASSWORD env vars.
//
//   npm run seed:admin
//   DATABASE_URL="<external>" ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=secret1 npm run seed:admin
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@tapa.demo').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and set it.');
    process.exit(1);
  }
  if (String(ADMIN_PASSWORD).length < 6) {
    console.error('ADMIN_PASSWORD must be at least 6 characters.');
    process.exit(1);
  }

  try {
    const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = 'admin'
       RETURNING user_id, email, role`,
      [ADMIN_NAME, ADMIN_EMAIL, password_hash]
    );
    const u = result.rows[0];
    console.log('Admin ready:');
    console.log(`  email:    ${u.email}`);
    console.log(`  password: ${ADMIN_PASSWORD}`);
    console.log(`  user_id:  ${u.user_id}  role: ${u.role}`);
  } catch (err) {
    console.error('Admin seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
