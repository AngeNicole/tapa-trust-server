const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const workersRoutes = require('./routes/workers.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const reviewsRoutes = require('./routes/reviews.routes');
const savedWorkersRoutes = require('./routes/savedWorkers.routes');
const categoriesRoutes = require('./routes/categories.routes');
const adminRoutes = require('./routes/admin.routes');
const disputesRoutes = require('./routes/disputes.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const publicRoutes = require('./routes/public.routes');
const jobsRoutes = require('./routes/jobs.routes');
const errorHandler = require('./middleware/error');

const app = express();

// --- core middleware ---
// In production, restrict CORS to the deployed client origin (CLIENT_ORIGIN).
// Locally, with CLIENT_ORIGIN unset, allow all origins for convenience.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
// Verification uploads (ID photo, selfie, certificate scans) are sent as base64
// data URLs, so raise the body limit well above the 100kb default.
app.use(express.json({ limit: '15mb' }));

// --- health check (proves the backend is alive; no DB required) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- feature routes (placeholders for now) ---
app.use('/api/auth', authRoutes);
app.use('/api/workers', workersRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/saved-workers', savedWorkersRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/disputes', disputesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/jobs', jobsRoutes);

// --- 404 for unknown API routes ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- central error handler (must be last) ---
app.use(errorHandler);

module.exports = app;
