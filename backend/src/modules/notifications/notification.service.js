const db = require('../../config/database');

async function getAssignedUserForStudent(studentIdentifier) {
  if (!studentIdentifier) return null;
  const clean = String(studentIdentifier).replace(/^u-/, '').trim();
  const numStudentId = parseInt(clean, 10);
  if (!numStudentId) return null;

  try {
    const [rows] = await db.query(
      `SELECT User_Id, UserName 
       FROM student_followup 
       WHERE Student_Id = ? 
         AND Department = 437 
         AND DeleteStatus = 0 
         AND User_Id IS NOT NULL 
       ORDER BY Entry_date DESC, Student_FollowUp_Id DESC 
       LIMIT 1`,
      [numStudentId]
    );

    if (rows && rows.length > 0) {
      return {
        userId: rows[0].User_Id,
        userName: rows[0].UserName,
        studentId: numStudentId
      };
    }
  } catch (err) {
    console.warn('[NotificationService] getAssignedUserForStudent error:', err.message);
  }

  return null;
}

async function notifyAssignedUserOnDocumentUpload({
  studentId,
  studentName = '',
  docName = 'Document',
  uploadDateTime = '',
  userNotes = ''
}) {
  if (!studentId) return null;

  try {
    const assigned = await getAssignedUserForStudent(studentId);
    if (!assigned || !assigned.userId) return null;

    const numStudentId = parseInt(String(studentId).replace(/\D/g, ''), 10) || assigned.studentId || 0;
    const cleanStudentName = String(studentName || assigned.studentName || 'Student').trim().slice(0, 45);
    const cleanAssignedName = String(assigned.userName || 'Staff').trim().slice(0, 45);
    const timeStr = uploadDateTime || new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const message = `A new document has been uploaded for student ${cleanStudentName} (ID: ${numStudentId}). Document: ${docName}. Uploaded on: ${timeStr}.${userNotes ? ` Notes: ${userNotes}` : ''}`;

    const [res] = await db.query(
      `INSERT INTO notification (
        From_User, From_User_Name, To_User, To_User_Name, Status_Id, Status_Name,
        View_Status, Remark, Entry_Date, Student_Id, Student_Name, DeleteStatus,
        Read_Status, Entry_Type, Description
      ) VALUES (?, ?, ?, ?, '0', 'Document Uploaded', 0, ?, NOW(), ?, ?, 0, 0, 4, 'Document Uploaded')`,
      [numStudentId, cleanStudentName, assigned.userId, cleanAssignedName, message, numStudentId, cleanStudentName]
    );

    return {
      notificationId: res.insertId,
      toUserId: assigned.userId,
      toUserName: cleanAssignedName,
      studentId: numStudentId,
      studentName: cleanStudentName,
      docName,
      message
    };
  } catch (err) {
    console.warn('[NotificationService] notifyAssignedUserOnDocumentUpload error:', err.message);
    return null;
  }
}

async function getUserNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const cleanId = parseInt(String(userId).replace(/\D/g, ''), 10);
  if (!cleanId) return [];

  try {
    let query = `
      SELECT 
        Notification_Id AS id,
        From_User AS fromUser,
        From_User_Name AS fromUserName,
        To_User AS toUser,
        To_User_Name AS toUserName,
        Status_Id AS statusId,
        Status_Name AS statusName,
        View_Status AS viewStatus,
        Remark AS message,
        Entry_Date AS createdAt,
        Student_Id AS studentId,
        Student_Name AS studentName,
        Read_Status AS readStatus,
        Entry_Type AS entryType,
        Description AS description
      FROM notification
      WHERE To_User = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)
    `;
    const params = [cleanId];
    if (unreadOnly) {
      query += ' AND (View_Status = 0 OR Read_Status = 0 OR View_Status IS NULL)';
    }
    query += ' ORDER BY Notification_Id DESC LIMIT ?';
    params.push(Math.min(limit || 50, 100));

    const [rows] = await db.query(query, params);
    return rows || [];
  } catch (err) {
    console.warn('[NotificationService] getUserNotifications error:', err.message);
    return [];
  }
}

async function markAsRead(notificationId, userId = null) {
  if (!notificationId) return false;
  try {
    let query = 'UPDATE notification SET View_Status = 1, Read_Status = 1 WHERE Notification_Id = ?';
    const params = [notificationId];
    if (userId) {
      const cleanId = parseInt(String(userId).replace(/\D/g, ''), 10);
      if (cleanId) {
        query += ' AND To_User = ?';
        params.push(cleanId);
      }
    }
    const [res] = await db.query(query, params);
    return Boolean(res && (res.affectedRows > 0 || res.changedRows > 0));
  } catch (err) {
    console.warn('[NotificationService] markAsRead error:', err.message);
    return false;
  }
}

async function markAllAsRead(userId) {
  const cleanId = parseInt(String(userId).replace(/\D/g, ''), 10);
  if (!cleanId) return false;

  try {
    const [res] = await db.query(
      'UPDATE notification SET View_Status = 1, Read_Status = 1 WHERE To_User = ? AND (View_Status = 0 OR Read_Status = 0 OR View_Status IS NULL)',
      [cleanId]
    );
    return Boolean(res && (res.affectedRows > 0 || res.changedRows > 0));
  } catch (err) {
    console.warn('[NotificationService] markAllAsRead error:', err.message);
    return false;
  }
}

module.exports = {
  notifyAssignedUserOnDocumentUpload,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getAssignedUserForStudent
};
