require('dotenv').config();

const bcrypt = require('bcrypt');
const { pool } = require('../src/config/db');

// Seed (or reset) the two demo accounts used for the usability study:
//   • a requester  — demo.requester@tapa.test
//   • a worker     — demo.worker@tapa.test, made fully BOOKABLE (complete profile,
//                    available, and admin-approved) so it surfaces in browse and
//                    can be booked under the verified-only rule.
// Idempotent: re-running upserts the same emails and resets their password, so
// study logins always work. Non-destructive to all other data.
//
//   npm run seed:demo
//   DATABASE_URL="<render-external-url>" npm run seed:demo
//   DEMO_PASSWORD=Secret123 npm run seed:demo   (override the shared password)
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo1234';
const REQUESTER_EMAIL = 'demo.requester@tapa.test';
const WORKER_EMAIL = 'demo.worker@tapa.test';

async function upsertUser({ name, email, role, hash, location }) {
  const r = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, location)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, name = EXCLUDED.name
     RETURNING user_id`,
    [name, email, hash, role, location]
  );
  return r.rows[0].user_id;
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and set it,');
    console.error('or pass it inline: DATABASE_URL="<render-external-url>" npm run seed:demo');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(PASSWORD, 10);

    // 1) Requester
    const requesterId = await upsertUser({
      name: 'Demo Requester', email: REQUESTER_EMAIL, role: 'requester', hash, location: 'Kigali',
    });

    // 2) Worker (user)
    const workerUserId = await upsertUser({
      name: 'Demo Worker', email: WORKER_EMAIL, role: 'worker', hash, location: 'Kigali',
    });

    // 3) Worker profile — complete + available + Admin-Certified so it's bookable.
    const skills = 'Plumbing, Electrical';
    const bio = 'Experienced demo worker for the usability study.';
    const education = 'Diploma in Plumbing, IPRC Kigali';
    const existing = await pool.query('SELECT worker_id FROM workers WHERE user_id = $1', [workerUserId]);
    let workerId;
    if (existing.rows[0]) {
      workerId = existing.rows[0].worker_id;
      await pool.query(
        `UPDATE workers
           SET name = 'Demo Worker', skills = $2, bio = $3, education = $4,
               is_available = true, tier = 'Admin-Certified'
         WHERE worker_id = $1`,
        [workerId, skills, bio, education]
      );
    } else {
      const ins = await pool.query(
        `INSERT INTO workers (user_id, name, skills, bio, education, is_available, tier)
         VALUES ($1, 'Demo Worker', $2, $3, $4, true, 'Admin-Certified')
         RETURNING worker_id`,
        [workerUserId, skills, bio, education]
      );
      workerId = ins.rows[0].worker_id;
    }

    // 4) Approved verification so the verified-only gate lets them be booked.
    const approved = await pool.query(
      `SELECT 1 FROM verification_request WHERE worker_id = $1 AND status = 'approved' LIMIT 1`,
      [workerId]
    );
    if (!approved.rows[0]) {
      await pool.query(
        `INSERT INTO verification_request (worker_id, evidence, status)
         VALUES ($1, 'demo seed — pre-approved for the study', 'approved')`,
        [workerId]
      );
    }

    console.log('Demo accounts ready (password for both: ' + PASSWORD + '):');
    console.log(`  requester: ${REQUESTER_EMAIL}  (user_id ${requesterId})`);
    console.log(`  worker:    ${WORKER_EMAIL}  (user_id ${workerUserId}, worker_id ${workerId}) — verified, available, bookable`);
  } catch (err) {
    console.error('Demo seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
