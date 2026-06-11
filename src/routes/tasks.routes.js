const express = require('express');

const router = express.Router();

// Placeholder. Task posting/listing endpoints land in a later step.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'tasks: not implemented yet' });
});

module.exports = router;
