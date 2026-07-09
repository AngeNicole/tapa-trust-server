const express = require('express');
const auth = require('../middleware/auth');
const { getDisputeMessages, postDisputeMessage } = require('../controllers/disputes.controller');

const router = express.Router();

// In-app mediation thread — open to the two parties AND the admin. The
// controller enforces membership (participant-or-admin) per dispute.
router.get('/:id/messages', auth, getDisputeMessages);
router.post('/:id/messages', auth, postDisputeMessage);

module.exports = router;
