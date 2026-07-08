require('dotenv').config();

const app = require('./app');
const { ensureSchema } = require('./startupMigrations');

const PORT = process.env.PORT || 4000;

// Apply idempotent column additions before accepting traffic so the deployed
// code and DB schema stay in sync (never blocks startup on failure).
ensureSchema().finally(() => {
  app.listen(PORT, () => {
    console.log(`TaPa Trust API listening on http://localhost:${PORT}`);
    console.log(`Health check:           http://localhost:${PORT}/api/health`);
  });
});
