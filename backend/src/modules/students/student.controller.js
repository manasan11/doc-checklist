const studentService = require('./student.service');

async function getStudents(req, res) {
  try {
    const students = await studentService.getAllStudents();
    return res.json({
      totalStudents: students.length,
      students
    });
  } catch (err) {
    console.error('[StudentController] getStudents error:', err);
    return res.status(500).json({ error: 'Failed to fetch students: ' + err.message });
  }
}

async function updateStudent(req, res) {
  const studentId = req.params.id;
  if (!studentId) {
    return res.status(400).json({ error: 'Student ID is required.' });
  }

  try {
    const result = await studentService.updateStudent(studentId, req.body || {});
    return res.json({
      message: 'Student details updated successfully.',
      ...result
    });
  } catch (err) {
    console.error('[StudentController] updateStudent error:', err);
    return res.status(500).json({ error: 'Failed to update student: ' + err.message });
  }
}

module.exports = {
  getStudents,
  updateStudent
};

