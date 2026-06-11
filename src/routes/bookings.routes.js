const express = require('express');

const router = express.Router();

// Placeholder. Booking + check-in/out + payment-status endpoints land in a later step.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'bookings: not implemented yet' });
});

module.exports = router;
