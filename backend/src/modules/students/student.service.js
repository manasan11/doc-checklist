const dataStore = require('../../dataStore');
const db = require('../../config/database');

async function getAllStudents() {
  return await dataStore.getStudentList();
}

async function updateStudent(studentId, details) {
  const cleanId = String(studentId).replace(/^u-/, '').trim();
  const dbSuccess = await db.updateStudentDetails(cleanId, details);

  const updates = {};
  if (details.name !== undefined) updates.name = details.name;
  if (details.email !== undefined) updates.email = details.email;
  if (details.username !== undefined) updates.username = details.username;
  if (details.department !== undefined) updates.department = details.department;

  dataStore.updateStudentInCache(cleanId, updates);

  return {
    studentId: cleanId,
    dbUpdated: dbSuccess,
    updatedFields: updates
  };
}

module.exports = {
  getAllStudents,
  updateStudent
};

