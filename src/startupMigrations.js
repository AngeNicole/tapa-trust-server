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
  `ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS method VARCHAR(20)`, // 'physical' | 'online'
  // Dispute resolution: category + who raised + lifecycle status/outcome.
  // (reason = free-text description, ruling = admin note already exist.)
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS category VARCHAR(40)`,
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS raised_by VARCHAR(20)`,
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open'`,
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)`,
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
  // Full timestamped loop timeline (check-in/out already have start_ts/end_ts).
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`,
  `ALTER TABLE check_in_record ADD COLUMN IF NOT EXISTS start_confirmed_at TIMESTAMPTZ`,
  `ALTER TABLE check_in_record ADD COLUMN IF NOT EXISTS end_confirmed_at TIMESTAMPTZ`,
  // Safety check-in: worker's expected finish time + whether we've alerted yet.
  // Data-minimizing — no location stored, no public link; overdue just alerts the
  // platform operator (admin) in-app.
  `ALTER TABLE check_in_record ADD COLUMN IF NOT EXISTS safety_expected_at TIMESTAMPTZ`,
  `ALTER TABLE check_in_record ADD COLUMN IF NOT EXISTS safety_alerted BOOLEAN NOT NULL DEFAULT false`,
  // MTN MoMo sandbox: reference id of the collection request for a deposit.
  `ALTER TABLE payment_status ADD COLUMN IF NOT EXISTS momo_reference TEXT`,
  // Dispute mediation: a meeting is scheduled (mode + detail + time) and both
  // parties are heard before the admin rules.
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS meeting_mode VARCHAR(20)`,
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS meeting_detail TEXT`,
  `ALTER TABLE dispute_resolution ADD COLUMN IF NOT EXISTS meeting_at TIMESTAMPTZ`,
  // In-app mediation thread — admin + both parties, recorded in the app.
  `CREATE TABLE IF NOT EXISTS dispute_message (
     message_id SERIAL PRIMARY KEY,
     dispute_id INTEGER NOT NULL REFERENCES dispute_resolution(dispute_id) ON DELETE CASCADE,
     sender_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
     body TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
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
