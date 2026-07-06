const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listBookings,
  acceptBooking,
  checkin,
  confirmStart,
  checkout,
  confirmCompletion,
  getBooking,
  rejectBooking,
  getPaymentStatus,
  bookFromProfile,
  rebook,
  getMessages,
  postMessage,
  agreePrice,
} = require('../controllers/bookings.controller');

const router = express.Router();

router.get('/', auth, listBookings);

// Requester entry point: book straight from a worker profile (task auto-created
// server-side — requesters never post a task). Plus one-tap rebook. Both live on
// literal segments declared before the '/:id/*' actions to keep routing
// unambiguous.
router.post('/book/:workerId', auth, requireRole('requester'), bookFromProfile);
router.post('/rebook/:workerId', auth, requireRole('requester'), rebook);

// Single booking (parties only) — opens a booking + its chat from a notification.
router.get('/:id', auth, getBooking);

// Worker-driven transitions.
router.post('/:id/accept', auth, requireRole('worker'), acceptBooking);
router.post('/:id/reject', auth, requireRole('worker'), rejectBooking);
router.post('/:id/checkin', auth, requireRole('worker'), checkin);
router.post('/:id/checkout', auth, requireRole('worker'), checkout);

// Requester-driven transitions.
router.post('/:id/confirm-start', auth, requireRole('requester'), confirmStart);
router.post('/:id/confirm-completion', auth, requireRole('requester'), confirmCompletion);

router.get('/:id/payment-status', auth, getPaymentStatus);

// Chat + structured price agreement — open to either party (any role); the
// controller enforces the party (ownership) check.
router.get('/:id/messages', auth, getMessages);
router.post('/:id/messages', auth, postMessage);
router.post('/:id/agree-price', auth, agreePrice);

module.exports = router;
