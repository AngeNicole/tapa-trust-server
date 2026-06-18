const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listWorkers,
  getWorker,
  getWorkerHistory,
  getMyWorker,
  updateMyWorker,
} = require('../controllers/workers.controller');

const router = express.Router();

// '/me' must be declared before '/:id' so it isn't captured as an id.
router.get('/me', auth, requireRole('worker'), getMyWorker);
router.put('/me', auth, requireRole('worker'), updateMyWorker);

router.get('/', auth, listWorkers);
router.get('/:id', auth, getWorker);
router.get('/:id/history', auth, getWorkerHistory);

module.exports = router;
