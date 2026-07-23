const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  createJob, listMyJobs, closeJob, browseJobs,
  expressInterest, getJobInterests, listMyInterests,
  getInterestMessages, postInterestMessage,
} = require('../controllers/jobs.controller');

const router = express.Router();

// Static paths first so they aren't captured by '/:id'.
router.post('/', auth, requireRole('requester'), createJob);
router.get('/mine', auth, requireRole('requester'), listMyJobs);
router.get('/interests/mine', auth, requireRole('worker'), listMyInterests);
router.get('/interests/:interestId/messages', auth, getInterestMessages);
router.post('/interests/:interestId/messages', auth, postInterestMessage);
router.post('/:id/close', auth, requireRole('requester'), closeJob);
router.get('/:id/interests', auth, requireRole('requester'), getJobInterests);
router.post('/:id/interest', auth, requireRole('worker'), expressInterest);
router.get('/', auth, browseJobs);

module.exports = router;
