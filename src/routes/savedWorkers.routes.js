const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listSaved, saveWorker, removeSaved } = require('../controllers/savedWorkers.controller');

const router = express.Router();

router.get('/', auth, requireRole('requester'), listSaved);
router.post('/', auth, requireRole('requester'), saveWorker);
router.delete('/:workerId', auth, requireRole('requester'), removeSaved);

module.exports = router;
