const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const workersRoutes = require('./routes/workers.routes');
const tasksRoutes = require('./routes/tasks.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const reviewsRoutes = require('./routes/reviews.routes');
const savedWorkersRoutes = require('./routes/savedWorkers.routes');
const categoriesRoutes = require('./routes/categories.routes');
const adminRoutes = require('./routes/admin.routes');
const errorHandler = require('./middleware/error');

const app = express();

// --- core middleware ---
// In production, restrict CORS to the deployed client origin (CLIENT_ORIGIN).
// Locally, with CLIENT_ORIGIN unset, allow all origins for convenience.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());

// --- health check (proves the backend is alive; no DB required) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- feature routes (placeholders for now) ---
app.use('/api/auth', authRoutes);
app.use('/api/workers', workersRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/saved-workers', savedWorkersRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/admin', adminRoutes);

// --- 404 for unknown API routes ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- central error handler (must be last) ---
app.use(errorHandler);

module.exports = app;
