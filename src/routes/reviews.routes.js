const express = require('express');

const router = express.Router();

// Placeholder. Review endpoints land in a later step.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'reviews: not implemented yet' });
});

module.exports = router;
