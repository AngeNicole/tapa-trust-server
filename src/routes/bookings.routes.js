const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  createBooking,
  listBookings,
  acceptBooking,
  checkin,
  confirmStart,
  checkout,
  confirmCompletion,
  getPaymentStatus,
  rebook,
} = require('../controllers/bookings.controller');

const router = express.Router();

router.post('/', auth, requireRole('requester'), createBooking);
router.get('/', auth, listBookings);

// Rebook lives on a literal 'rebook' segment; declared before the '/:id/*'
// actions to keep routing unambiguous.
router.post('/rebook/:workerId', auth, requireRole('requester'), rebook);

// Worker-driven transitions.
router.post('/:id/accept', auth, requireRole('worker'), acceptBooking);
router.post('/:id/checkin', auth, requireRole('worker'), checkin);
router.post('/:id/checkout', auth, requireRole('worker'), checkout);

// Requester-driven transitions.
router.post('/:id/confirm-start', auth, requireRole('requester'), confirmStart);
router.post('/:id/confirm-completion', auth, requireRole('requester'), confirmCompletion);

router.get('/:id/payment-status', auth, getPaymentStatus);

module.exports = router;
