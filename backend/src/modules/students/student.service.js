const db = require('../../config/database');

async function getAllStudents() {
  try {
    const [students] = await db.query(
      'SELECT Student_Id, Student_Name, Email, Username, Password, Unique_Id, Proceeding_Course_Name FROM student WHERE DeleteStatus = 0 OR DeleteStatus IS NULL'
    );

    return (students || []).map(s => {
      const studentCode = String(s.Student_Id || s.Unique_Id || '').trim();
      return {
        id: `u-${studentCode}`,
        studentCode,
        name: s.Student_Name || `Student ${studentCode}`,
        email: s.Email || '',
        username: s.Username || s.Email || `student_${studentCode}`,
        role: 'user',
        department: s.Proceeding_Course_Name || 'General Operations',
        documents: []
      };
    });
  } catch (err) {
    console.warn('[StudentService] Error loading students from MySQL:', err.message);
    return [];
  }
}

async function updateStudent(studentId, details = {}) {
  const cleanId = String(studentId).replace(/^u-/, '').trim();
  const sets = [];
  const params = [];

  if (details.name !== undefined) {
    sets.push('Student_Name = ?');
    params.push(String(details.name).trim());
  }
  if (details.email !== undefined) {
    sets.push('Email = ?');
    params.push(String(details.email).trim());
  }
  if (details.username !== undefined) {
    sets.push('Username = ?');
    params.push(String(details.username).trim());
  }
  if (details.phone !== undefined) {
    sets.push('Phone_Number = ?');
    params.push(String(details.phone).trim());
  }
  if (details.department !== undefined) {
    sets.push('Proceeding_Course_Name = ?');
    params.push(String(details.department).trim());
  }
  if (details.password) {
    sets.push('Password = ?');
    params.push(String(details.password));
  }

  if (sets.length > 0) {
    params.push(cleanId, cleanId);
    const query = `UPDATE student SET ${sets.join(', ')} WHERE (Student_Id = ? OR Unique_Id = ?)`;
    await db.query(query, params);
  }

  return {
    studentId: cleanId,
    updatedFields: details
  };
}

module.exports = {
  getAllStudents,
  updateStudent
};
