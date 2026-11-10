const express = require('express');
const router = express.Router();
const studentController = require('./student.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');

router.get('/', authenticateToken, studentController.getStudents);
router.put('/:id', authenticateToken, studentController.updateStudent);
router.patch('/:id', authenticateToken, studentController.updateStudent);

module.exports = router;
