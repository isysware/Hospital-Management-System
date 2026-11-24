import { apiClient } from './apiClient';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'urgent' | 'warning' | 'info' | 'success' | string;
  module: string;
  targetPortal?: string;
  actionUrl?: string | null;
  referenceId?: string | null;
  read: boolean;
  createdAt: string;
  time?: string;
  recipientUserId?: string | null;
  isBroadcast?: boolean;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'Recent';
  }
}

export const notificationService = {
  async getNotifications(portal?: string): Promise<NotificationItem[]> {
    try {
      const res = await apiClient.get<{ data: NotificationItem[] }>('/notifications', {
        params: { portal: portal || undefined },
      });
      const items = res.data?.data || [];
      return items.map((item) => ({
        ...item,
        time: formatRelativeTime(item.createdAt),
      }));
    } catch (err) {
      console.warn('Failed to load notifications from backend, using empty list:', err);
      return [];
    }
  },

  async markAsRead(id: string): Promise<boolean> {
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      return true;
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
      return false;
    }
  },

  async markAllAsRead(portal?: string): Promise<boolean> {
    try {
      await apiClient.post('/notifications/mark-all-read', { portal });
      return true;
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
      return false;
    }
  },
};
