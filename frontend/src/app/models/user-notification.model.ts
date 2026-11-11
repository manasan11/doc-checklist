export interface UserNotification {
  id: number;
  fromUser?: number | string;
  fromUserName?: string;
  toUser?: number | string;
  toUserName?: string;
  studentId?: number | string;
  studentName?: string;
  description?: string;
  remark?: string;
  entryDate?: string;
  viewStatus?: number;
  readStatus?: number;
  entryType?: number;
  isRead?: boolean;
}

export interface NotificationResponse {
  success: boolean;
  notifications: UserNotification[];
}

export interface UnreadCountResponse {
  success: boolean;
  unreadCount: number;
}
