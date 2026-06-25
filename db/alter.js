require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

// Applies a prod-safe, idempotent ALTER file (pure ADD COLUMN IF NOT EXISTS)
// without the data-wiping side effects of `npm run migrate`. Same pattern as the
// category seed. Re-runnable. Never runs schema.sql.
//
// The SQL file is the first CLI arg, defaulting to the original worker-columns
// migration:  node db/alter.js [alter-file.sql]
const sqlFile = process.argv[2] || 'alter-add-worker-columns.sql';

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and set it.');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, sqlFile);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log(`Applying ${sqlFile} (non-destructive)...`);
  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'workers' AND column_name IN ('is_available', 'photo', 'education', 'certifications'))
          OR (table_name = 'verification_request' AND column_name = 'note')
       ORDER BY table_name, column_name`
    );
    console.log('Done — relevant columns now present:');
    for (const r of rows) console.log(`  ${r.table_name}.${r.column_name}`);
  } catch (err) {
    console.error('Alter failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
