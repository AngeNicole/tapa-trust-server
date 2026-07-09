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
  getPaymentStatus,
  bookFromProfile,
  rebook,
  getMessages,
  postMessage,
  agreePrice,
  proposeAgreement,
  signAgreement,
  depositEscrow,
  declineBooking,
  setSafetyTimer,
} = require('../controllers/bookings.controller');
const { raiseDispute } = require('../controllers/disputes.controller');

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
router.post('/:id/checkin', auth, requireRole('worker'), checkin);
router.post('/:id/checkout', auth, requireRole('worker'), checkout);
router.post('/:id/safety-timer', auth, requireRole('worker'), setSafetyTimer);

// Requester-driven transitions.
router.post('/:id/confirm-start', auth, requireRole('requester'), confirmStart);
router.post('/:id/confirm-completion', auth, requireRole('requester'), confirmCompletion);

router.get('/:id/payment-status', auth, getPaymentStatus);

// Chat, price, digital agreement, escrow, decline — participant-only (either
// role); the controller enforces the party check and any role-specific rules.
router.get('/:id/messages', auth, getMessages);
router.post('/:id/messages', auth, postMessage);
router.post('/:id/agree-price', auth, agreePrice);
router.post('/:id/agreement', auth, proposeAgreement);
router.post('/:id/agreement/sign', auth, signAgreement);
router.post('/:id/escrow/deposit', auth, depositEscrow);
router.post('/:id/decline', auth, declineBooking);
// Either party can raise a dispute; the controller checks booking membership.
router.post('/:id/dispute', auth, raiseDispute);

module.exports = router;
