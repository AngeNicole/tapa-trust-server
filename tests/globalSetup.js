// Runs once before the whole suite. Ensures an isolated test database exists,
// then loads the real schema + category seed into it — so tests never touch the
// dev or production database. The test DATABASE_URL is set by the npm "test"
// script (db name: tapa_trust_test).
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

module.exports = async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set for tests (see the npm "test" script).');
  const target = new URL(url).pathname.replace(/^\//, '');

  // 1) Ensure the test database exists. CREATE DATABASE must run from another
  //    database, so connect to a maintenance DB and create it if missing.
  let created = false;
  let lastErr;
  for (const maint of ['postgres', 'template1']) {
    try {
      const admin = new Client({ connectionString: withDb(url, maint) });
      await admin.connect();
      try {
        await admin.query(`CREATE DATABASE ${target}`);
      } catch (e) {
        if (e.code !== '42P04') throw e; // 42P04 = database already exists
      }
      await admin.end();
      created = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!created) {
    throw new Error(`Could not create/verify test database "${target}": ${lastErr && lastErr.message}`);
  }

  // 2) Load schema (idempotent: drops + recreates) and seed categories.
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await client.query(schema);
  const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed-categories.sql'), 'utf8');
  await client.query(seed);
  await client.end();

  // 3) Apply the idempotent startup migrations (dispute mediation, verification
  //    evidence + method + face-match, safety check-in, escrow timestamps, MoMo
  //    reference) so the test DB matches what the deployed app runs on boot.
  const { ensureSchema } = require('../src/startupMigrations');
  await ensureSchema();
};
