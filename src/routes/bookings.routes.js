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
  bookFromProfile,
  rebook,
} = require('../controllers/bookings.controller');

const router = express.Router();

// Legacy/internal: task_id-based booking creation. Kept because the trust-loop
// test suite depends on it; the requester product flow uses /book/:workerId
// (no task form). Not part of the browse-and-book client surface.
router.post('/', auth, requireRole('requester'), createBooking);
router.get('/', auth, listBookings);

// Requester entry point: book straight from a worker profile (task auto-created
// server-side). Plus one-tap rebook. Both live on literal segments declared
// before the '/:id/*' actions to keep routing unambiguous.
router.post('/book/:workerId', auth, requireRole('requester'), bookFromProfile);
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
