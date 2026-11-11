const db = require('../../config/database');

let cachedStudentList = null;

async function getAllStudents() {
  if (cachedStudentList && cachedStudentList.length > 0) {
    return cachedStudentList;
  }
  try {
    const students = await db.loadActiveStudents();
    cachedStudentList = (students || []).map(s => {
      const studentCode = String(s.Student_Id || s.Unique_Id || '').trim();
      return {
        id: `u-${studentCode}`,
        studentCode: studentCode,
        name: s.Student_Name || s.name || `Student ${studentCode}`,
        email: s.Email || s.email || '',
        username: s.Email || s.email || `student_${studentCode}`,
        role: 'user',
        department: s.Department_Name || s.department || 'General Operations',
        assignedStaff: s.Assigned_Staff || null,
        staffName: s.Staff_Name || null,
        staffEmail: s.Staff_Email || null,
        documents: []
      };
    });
    return cachedStudentList;
  } catch (err) {
    console.warn('[StudentService] Notice loading student list from MySQL:', err.message);
    return [];
  }
}

function updateStudentInCache(studentId, updates = {}) {
  const cleanId = String(studentId).replace(/^u-/, '').trim().toLowerCase();
  if (cachedStudentList && Array.isArray(cachedStudentList)) {
    const idx = cachedStudentList.findIndex(s => {
      const code = String(s.studentCode || s.id || '').replace(/^u-/, '').trim().toLowerCase();
      return code === cleanId;
    });
    if (idx !== -1) {
      cachedStudentList[idx] = { ...cachedStudentList[idx], ...updates };
    }
  }
}

async function updateStudent(studentId, details) {
  const cleanId = String(studentId).replace(/^u-/, '').trim();
  const dbSuccess = await db.updateStudentDetails(cleanId, details);

  const updates = {};
  if (details.name !== undefined) updates.name = details.name;
  if (details.email !== undefined) updates.email = details.email;
  if (details.username !== undefined) updates.username = details.username;
  if (details.department !== undefined) updates.department = details.department;

  updateStudentInCache(cleanId, updates);

  return {
    studentId: cleanId,
    dbUpdated: dbSuccess,
    updatedFields: updates
  };
}

module.exports = {
  getAllStudents,
  getStudentList: getAllStudents,
  updateStudent,
  updateStudentInCache
};
