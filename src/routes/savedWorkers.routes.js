const express = require('express');

const router = express.Router();

// Placeholder. Saved-worker + rebook endpoints land in a later step.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'saved-workers: not implemented yet' });
});

module.exports = router;
