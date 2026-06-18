require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

// The seven Tier-1 skill categories. Seeded only when skill_categories is
// empty, so re-running migrate never duplicates or clobbers edited rows.
const SKILL_CATEGORIES = [
  ['Plumbing', 'Leaks, taps, drains, and general plumbing fixes.'],
  ['Cleaning', 'Home and space cleaning jobs.'],
  ['Moving / Lifting', 'Carrying, loading, and moving heavy items.'],
  ['Electrical', 'Wiring, fixtures, and basic electrical work.'],
  ['Furniture assembly', 'Assembling flat-pack and other furniture.'],
  ['Mounting / Installation', 'Mounting TVs, shelves, and fittings.'],
  ['Basic tech setup', 'Setting up devices, networks, and software.'],
];

async function seedCategories() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM skill_categories');
  if (rows[0].n > 0) {
    console.log(`Skill categories already present (${rows[0].n}) — skipping seed.`);
    return;
  }
  for (const [name, description] of SKILL_CATEGORIES) {
    await pool.query(
      'INSERT INTO skill_categories (name, description) VALUES ($1, $2)',
      [name, description]
    );
  }
  console.log(`Seeded ${SKILL_CATEGORIES.length} skill categories.`);
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and set it.');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running schema migration...');
  try {
    await pool.query(sql);
    console.log('Migration complete — all tables created.');
    await seedCategories();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
