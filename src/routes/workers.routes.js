const express = require('express');

const router = express.Router();

// Placeholder. Worker profile endpoints land in a later step.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'workers: not implemented yet' });
});

module.exports = router;
