const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listUsers,
  createCategory,
  updateCategory,
  deleteCategory,
  verifyWorker,
  rejectWorker,
} = require('../controllers/admin.controller');
const { listDisputes, getDispute, ruleDispute, scheduleMeeting } = require('../controllers/disputes.controller');

const router = express.Router();

// Admin is oversight-only: read users, manage categories, approve/reject worker
// verification (simulated). No bookings/payments.
router.get('/users', auth, requireRole('admin'), listUsers);
router.post('/categories', auth, requireRole('admin'), createCategory);
// Single edit + archive/restore endpoint (name/description/status, any subset).
router.patch('/categories/:id', auth, requireRole('admin'), updateCategory);
router.delete('/categories/:id', auth, requireRole('admin'), deleteCategory);
router.post('/workers/:workerId/verify', auth, requireRole('admin'), verifyWorker);
router.post('/workers/:workerId/reject', auth, requireRole('admin'), rejectWorker);

// Dispute resolution queue + neutral admin ruling.
router.get('/disputes', auth, requireRole('admin'), listDisputes);
router.get('/disputes/:id', auth, requireRole('admin'), getDispute);
router.post('/disputes/:id/meeting', auth, requireRole('admin'), scheduleMeeting);
router.post('/disputes/:id/rule', auth, requireRole('admin'), ruleDispute);

module.exports = router;
