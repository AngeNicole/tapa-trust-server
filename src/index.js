require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`TaPa Trust API listening on http://localhost:${PORT}`);
  console.log(`Health check:           http://localhost:${PORT}/api/health`);
});
