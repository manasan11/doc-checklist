const { getPool } = require('../../config/database');

async function findUserByIdentifier(identifier) {
  if (!identifier) return null;
  const pool = getPool();
  if (!pool) return null;
  const clean = String(identifier).trim();
  const isEmail = clean.includes('@');
  const numPart = isEmail ? '' : clean.replace(/\D/g, '');

  try {
    let query = '';
    let params = [];
    if (isEmail) {
      query = 'SELECT * FROM student WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?)) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1';
      params = [clean];
    } else {
      query = 'SELECT * FROM student WHERE (Username = ? OR Student_Id = ? OR Unique_Id = ?';
      params = [clean, clean, clean];
      if (numPart && numPart !== clean) {
        query += ' OR Student_Id = ? OR Unique_Id = ?';
        params.push(numPart, numPart);
      }
      query += ') AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1';
    }

    const [stuRows] = await pool.query(query, params);
    if (stuRows && stuRows.length > 0) {
      const s = stuRows[0];
      const studentCode = String(s.Student_Id || s.Unique_Id || clean).trim();
      return {
        id: `u-${studentCode}`,
        email: s.Email,
        username: s.Username || s.Email,
        name: s.Student_Name || s.Username || `Student ${studentCode}`,
        password: s.Password,
        role: 'user',
        department: s.Proceeding_Course_Name || 'General Operations',
        studentCode
      };
    }
  } catch (err) {
    console.warn('[AuthRepository] findUserByIdentifier error:', err.message);
  }
  return null;
}

async function updateUserPassword(studentCode, email, username, newPassword) {
  const pool = getPool();
  if (!pool) return false;
  const cleanEmail = email ? String(email).toLowerCase().trim() : null;
  const cleanUsername = username ? String(username).toLowerCase().trim() : null;
  const cleanCode = studentCode ? String(studentCode).trim() : null;

  let updated = false;
  try {
    const [stuRes] = await pool.query(
      'UPDATE student SET Password = ? WHERE (Student_Id IS NOT NULL AND Student_Id = ?) OR (LOWER(TRIM(Email)) = ? AND Email IS NOT NULL AND Email != "") OR (LOWER(TRIM(Username)) = ? AND Username IS NOT NULL AND Username != "")',
      [newPassword, cleanCode, cleanEmail, cleanUsername || cleanEmail]
    );
    updated = Boolean(stuRes && (stuRes.affectedRows > 0 || stuRes.changedRows > 0));
  } catch (err) {
    console.warn('[AuthRepository] updateUserPassword error:', err.message);
  }
  return updated;
}

module.exports = {
  findUserByIdentifier,
  updateUserPassword
};

