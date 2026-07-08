const { pool } = require('./config/db');

// Idempotent, prod-safe column additions applied automatically on boot so the
// deployed code and schema never drift (Render deploys code but doesn't run our
// manual `npm run alter:*`). Pure ADD COLUMN IF NOT EXISTS — no data loss, and a
// no-op once the columns exist. Kept minimal: only columns the running code
// depends on. A failure here logs but does not stop the server.
const STATEMENTS = [
  `ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS id_document TEXT`,
  `ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS selfie TEXT`,
  `ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS certification_files JSONB`,
];

async function ensureSchema() {
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error('[startup-migration] failed:', sql, '-', err.message);
    }
  }
}

module.exports = { ensureSchema };
