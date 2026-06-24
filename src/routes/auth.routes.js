const express = require('express');
const auth = require('../middleware/auth');
const { register, login, me, updateMe, changePassword } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', auth, me);
router.put('/me', auth, updateMe);
router.put('/password', auth, changePassword);

module.exports = router;
