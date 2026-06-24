require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

// Applies prod-safe, idempotent schema additions (db/alter-add-worker-columns.sql)
// without the data-wiping side effects of `npm run migrate`. Same pattern as the
// category seed. Re-runnable. Never runs schema.sql.
async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and set it.');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, 'alter-add-worker-columns.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Applying prod-safe column additions (non-destructive)...');
  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'workers' AND column_name IN ('is_available', 'photo')
       ORDER BY column_name`
    );
    console.log(`Done — workers now has columns: ${rows.map((r) => r.column_name).join(', ') || '(none found!)'}`);
  } catch (err) {
    console.error('Alter failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
