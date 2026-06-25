const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listUsers, createCategory, verifyWorker, rejectWorker } = require('../controllers/admin.controller');

const router = express.Router();

// Admin is oversight-only: read users, manage categories, approve/reject worker
// verification (simulated). No bookings/payments.
router.get('/users', auth, requireRole('admin'), listUsers);
router.post('/categories', auth, requireRole('admin'), createCategory);
router.post('/workers/:workerId/verify', auth, requireRole('admin'), verifyWorker);
router.post('/workers/:workerId/reject', auth, requireRole('admin'), rejectWorker);

module.exports = router;
