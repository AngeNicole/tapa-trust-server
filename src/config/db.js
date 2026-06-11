const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Managed Postgres providers (Render, Railway) require SSL on external
// connections; local Postgres usually does not. Default behaviour:
//   - SSL off when the host is localhost / 127.0.0.1
//   - SSL on otherwise (the managed case)
// Override explicitly with DATABASE_SSL=true or DATABASE_SSL=false.
function useSsl() {
  if (process.env.DATABASE_SSL === 'true') return true;
  if (process.env.DATABASE_SSL === 'false') return false;
  if (!connectionString) return false;
  return !/localhost|127\.0\.0\.1/.test(connectionString);
}

// Single shared connection pool. Not connected to until a query is issued, so
// the rest of the API (e.g. the health check) runs fine without a database.
const pool = new Pool({
  connectionString,
  ssl: useSsl() ? { rejectUnauthorized: false } : false,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
