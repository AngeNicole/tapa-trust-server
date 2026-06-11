const express = require('express');

const router = express.Router();

// Placeholder. Minimal admin (list users, manage categories) lands in a later step.
// Admin is oversight-only — no transactional actions.
router.all('*', (req, res) => {
  res.status(501).json({ error: 'admin: not implemented yet' });
});

module.exports = router;
