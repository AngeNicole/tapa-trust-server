const express = require('express');
const auth = require('../middleware/auth');
const { listNotifications, markRead } = require('../controllers/notifications.controller');

const router = express.Router();

router.get('/', auth, listNotifications);
router.post('/:id/read', auth, markRead);

module.exports = router;
