const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { createReview } = require('../controllers/reviews.controller');

const router = express.Router();

router.post('/', auth, requireRole('requester'), createReview);

module.exports = router;
