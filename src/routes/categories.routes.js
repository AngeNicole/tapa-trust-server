const express = require('express');

const router = express.Router();

// Placeholder. Skill-category endpoints land in a later step.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'categories: not implemented yet' });
});

module.exports = router;
