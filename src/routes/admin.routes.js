const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listUsers, createCategory, verifyWorker } = require('../controllers/admin.controller');

const router = express.Router();

// Admin is oversight-only: read users, manage categories, mark workers verified
// (simulated). No bookings/payments.
router.get('/users', auth, requireRole('admin'), listUsers);
router.post('/categories', auth, requireRole('admin'), createCategory);
router.post('/workers/:workerId/verify', auth, requireRole('admin'), verifyWorker);

module.exports = router;
