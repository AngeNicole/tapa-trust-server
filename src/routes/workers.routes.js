const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listWorkers,
  getWorker,
  getWorkerHistory,
  getMyWorker,
  updateMyWorker,
  updateAvailability,
  submitVerification,
  getMyEarnings,
} = require('../controllers/workers.controller');

const router = express.Router();

// '/me' routes must be declared before '/:id' so they aren't captured as an id.
router.get('/me', auth, requireRole('worker'), getMyWorker);
router.put('/me', auth, requireRole('worker'), updateMyWorker);
router.put('/me/availability', auth, requireRole('worker'), updateAvailability);
router.post('/me/verification', auth, requireRole('worker'), submitVerification);
router.get('/me/earnings', auth, requireRole('worker'), getMyEarnings);

router.get('/', auth, listWorkers);
router.get('/:id', auth, getWorker);
router.get('/:id/history', auth, getWorkerHistory);

module.exports = router;
