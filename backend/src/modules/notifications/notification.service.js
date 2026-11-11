const db = require('../../config/database');

class NotificationService {
  /**
   * Automatically notifies the user assigned to a student when a document is uploaded.
   * Finds the assigned user from `student_followup` (with fallback to `student` table),
   * builds the notification with student details and document info, and writes to MySQL `notification`.
   */
  async notifyAssignedUserOnDocumentUpload({
    studentId,
    studentName = '',
    docName = 'Document',
    uploadDateTime = '',
    userNotes = ''
  }) {
    if (!studentId) {
      console.warn('[NotificationService] Missing studentId. Notification skipped.');
      return null;
    }

    try {
      const assignedUser = await db.getAssignedUserForStudent(studentId);
      if (!assignedUser || !assignedUser.userId) {
        console.warn(`[NotificationService] No assigned user found for student: ${studentId}. Notification skipped.`);
        return null;
      }

      console.log(`[NotificationService] Found assigned user "${assignedUser.userName}" (ID: ${assignedUser.userId}) for student "${studentName || assignedUser.studentName}" (ID: ${studentId})`);

      const notification = await db.createDocumentUploadNotification({
        studentId,
        studentName: studentName || assignedUser.studentName,
        docName,
        uploadDateTime,
        assignedUser,
        userNotes
      });

      return notification;
    } catch (err) {
      console.warn('[NotificationService] Error notifying assigned user:', err.message);
      return null;
    }
  }

  /**
   * Retrieves notifications for a given user.
   */
  async getUserNotifications(userId, options = {}) {
    return db.getUserNotifications(userId, options);
  }

  /**
   * Marks a notification as read.
   */
  async markAsRead(notificationId, userId = null) {
    return db.markNotificationRead(notificationId, userId);
  }

  /**
   * Marks all notifications for a user as read.
   */
  async markAllAsRead(userId) {
    return db.markAllNotificationsRead(userId);
  }
}

module.exports = new NotificationService();

