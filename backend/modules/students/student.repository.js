const { getPool } = require('../../config/database');

async function loadActiveStudents() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [students] = await pool.query(
      'SELECT Student_Id, Student_Name, Email, Username, Password, Unique_Id, Proceeding_Course_Name FROM student WHERE DeleteStatus = 0 OR DeleteStatus IS NULL'
    );
    return students || [];
  } catch (err) {
    console.warn('[StudentRepository] loadActiveStudents error:', err.message);
    return [];
  }
}

async function updateStudentDetails(studentId, { name, email, username, phone, department, password } = {}) {
  const pool = getPool();
  if (!pool || !studentId) return false;
  const cleanId = String(studentId).replace(/^u-/, '').trim();
  const sets = [];
  const params = [];

  if (name !== undefined) {
    sets.push('Student_Name = ?');
    params.push(String(name).trim());
  }
  if (email !== undefined) {
    sets.push('Email = ?');
    params.push(String(email).trim());
  }
  if (username !== undefined) {
    sets.push('Username = ?');
    params.push(String(username).trim());
  }
  if (phone !== undefined) {
    sets.push('Phone_Number = ?');
    params.push(String(phone).trim());
  }
  if (department !== undefined) {
    sets.push('Proceeding_Course_Name = ?');
    params.push(String(department).trim());
  }
  if (password !== undefined && password) {
    sets.push('Password = ?');
    params.push(String(password));
  }

  if (sets.length === 0) return false;

  params.push(cleanId, cleanId);
  const query = `UPDATE student SET ${sets.join(', ')} WHERE (Student_Id = ? OR Unique_Id = ?)`;

  try {
    const [res] = await pool.query(query, params);
    return Boolean(res && (res.affectedRows > 0 || res.changedRows > 0));
  } catch (err) {
    console.warn('[StudentRepository] updateStudentDetails error:', err.message);
    return false;
  }
}

async function getFollowupUserByStudentAndDept(studentId, deptId = null) {
  const pool = getPool();
  if (!pool || !studentId) return null;
  const cleanStudent = String(studentId).replace(/^u-/, '').trim();
  const cleanDept = deptId ? String(deptId).trim() : null;

  try {
    let query = 'SELECT Student_FollowUp_Id, Student_Id, Department, Dept_Name, User_Id, UserName, Entry_date FROM student_followup WHERE Student_Id = ?';
    const params = [cleanStudent];
    if (cleanDept) {
      query += ' AND (Department = ? OR Dept_Name = ?)';
      params.push(cleanDept, cleanDept);
    }
    query += ' AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Entry_date DESC, Student_FollowUp_Id DESC LIMIT 1';

    const [rows] = await pool.query(query, params);
    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.warn('[StudentRepository] getFollowupUserByStudentAndDept error:', err.message);
  }
  return null;
}

async function upsertStudent(studentCode, name, email, username, password) {
  const pool = getPool();
  if (!pool || !studentCode) return false;
  try {
    await pool.query(`
      INSERT INTO student (Student_Id, Student_Name, Email, Username, Password, Unique_Id, Entry_date, DeleteStatus, Is_Registered)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, 1)
      ON DUPLICATE KEY UPDATE
        Student_Name=VALUES(Student_Name),
        Email=VALUES(Email),
        Username=VALUES(Username),
        Password=COALESCE(student.Password, VALUES(Password)),
        Unique_Id=VALUES(Unique_Id),
        DeleteStatus=0,
        Is_Registered=1
    `, [studentCode, name, email, username, password, studentCode]);
    return true;
  } catch (err) {
    console.warn('[StudentRepository] upsertStudent error:', err.message);
    return false;
  }
}

module.exports = {
  loadActiveStudents,
  updateStudentDetails,
  getFollowupUserByStudentAndDept,
  upsertStudent
};
