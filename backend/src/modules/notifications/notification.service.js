const db = require('../../config/database');

function resolveUserId(user) {
  if (!user) return null;
  if (user.userDetailsId) return user.userDetailsId;
  const raw = String(user.id || '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : null;
}

/**
 * Triggers a notification to the assigned staff member when a student document is uploaded.
 */
async function notifyAssignedUserOnDocumentUpload({ studentId, studentName, docName, uploadDateTime }) {
  if (!studentId) return null;
  const cleanStudentId = String(studentId).replace(/^u-/, '').trim();

  try {
    const assignedStaff = await db.getAssignedStaffForStudent(cleanStudentId);
    if (!assignedStaff || !assignedStaff.userId) {
      console.log(`[Notification] No assigned user found for student ${studentName || cleanStudentId}. Skipping staff notification.`);
      return null;
    }

    const message = `A new document has been uploaded for student ${studentName || 'Student'} (ID: ${cleanStudentId}). Document: ${docName}. Please review it.`;

    const notifId = await db.createNotification({
      fromUser: cleanStudentId,
      fromUserName: studentName || 'Student',
      toUser: assignedStaff.userId,
      toUserName: assignedStaff.userName || '',
      studentId: cleanStudentId,
      studentName: studentName || '',
      description: 'Document Uploaded',
      remark: message,
      entryType: 4
    });

    console.log(`[Notification] Successfully created notification #${notifId} for assigned user ${assignedStaff.userName} (User_Id: ${assignedStaff.userId}) for student ${cleanStudentId} - Document: ${docName}`);
    return notifId;
  } catch (err) {
    console.error('[Notification] Error creating document upload notification:', err.message);
    return null;
  }
}

async function getNotificationsForUser(user, limit = 50) {
  const userId = resolveUserId(user);
  if (!userId) return [];
  return await db.getNotificationsForUser(userId, limit);
}

async function getUnreadCount(user) {
  const userId = resolveUserId(user);
  if (!userId) return { unreadCount: 0 };
  const count = await db.getUnreadNotificationCount(userId);
  return { unreadCount: count };
}

async function markAsRead(notificationId, user) {
  const userId = resolveUserId(user);
  if (!userId || !notificationId) return { success: false };
  const updated = await db.markNotificationAsRead(notificationId, userId);
  return { success: updated };
}

async function markAllAsRead(user) {
  const userId = resolveUserId(user);
  if (!userId) return { success: false };
  const updated = await db.markAllNotificationsAsRead(userId);
  return { success: updated };
}

module.exports = {
  notifyAssignedUserOnDocumentUpload,
  getNotificationsForUser,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  resolveUserId
};

