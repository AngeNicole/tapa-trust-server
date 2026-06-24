require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

// Non-destructive category seed. Runs db/seed-categories.sql (pure idempotent
// INSERTs — no schema, no DDL) so production can be populated without the
// data-wiping side effects of `npm run migrate`. Never touches schema.sql.
async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and set it.');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, 'seed-categories.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Seeding skill categories (non-destructive)...');
  try {
    await pool.query(sql);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM skill_categories');
    console.log(`Seed complete — ${rows[0].n} categories present.`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
