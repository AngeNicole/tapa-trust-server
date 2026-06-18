const express = require('express');
const auth = require('../middleware/auth');
const { listCategories } = require('../controllers/categories.controller');

const router = express.Router();

// Any authenticated user can read the skill categories.
router.get('/', auth, listCategories);

module.exports = router;
