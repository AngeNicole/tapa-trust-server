const express = require('express');
const {
  listPublicWorkers,
  getPublicWorker,
  getPublicWorkerHistory,
} = require('../controllers/public.controller');

// Public, UNAUTHENTICATED worker browse. No auth middleware — these expose only
// the narrow public projection (see public.controller). The authed /api/workers
// routes are unchanged and remain the in-app experience.
const router = express.Router();

router.get('/workers', listPublicWorkers);
router.get('/workers/:id', getPublicWorker);
router.get('/workers/:id/history', getPublicWorkerHistory);

module.exports = router;
