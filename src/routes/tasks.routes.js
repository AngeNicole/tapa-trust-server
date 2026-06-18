const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { createTask, listMyTasks, getTask } = require('../controllers/tasks.controller');

const router = express.Router();

router.post('/', auth, requireRole('requester'), createTask);
router.get('/', auth, requireRole('requester'), listMyTasks);
router.get('/:id', auth, getTask);

module.exports = router;
