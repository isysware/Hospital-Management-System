import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationsService } from '../src/modules/notifications/notifications.service';
import { notificationsController, getAllowedPortalsForRole, getDefaultPortalForRole } from '../src/modules/notifications/notifications.controller';
import { prisma } from '../src/db/client';
import { AuthenticationError, AuthorizationError, NotFoundError } from '../src/shared/errors/AppError';

// Mock prisma for isolated multi-user testing
vi.mock('../src/db/client', () => {
  return {
    prisma: {
      hospitalNotification: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      hospitalNotificationRead: {
        findMany: vi.fn(),
        count: vi.fn(),
        upsert: vi.fn(),
        createMany: vi.fn(),
      },
      admissionRecord: { findMany: vi.fn().mockResolvedValue([]) },
      admissionPaymentRequest: { findMany: vi.fn().mockResolvedValue([]) },
      accountSettlement: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
});

describe('HMS Notification Security & Multi-User Isolation Audit Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BUG 1: Authentication & Authorization Enforcement', () => {
    it('1. Rejects anonymous requests with 401 AuthenticationError', async () => {
      const unauthReq: any = {
        user: undefined,
        query: {},
      };
      const res: any = { json: vi.fn() };

      await expect(notificationsController.listNotifications(unauthReq, res)).rejects.toThrow(AuthenticationError);
      await expect(notificationsController.getUnreadCount(unauthReq, res)).rejects.toThrow(AuthenticationError);
      await expect(notificationsController.markAsRead(unauthReq, res)).rejects.toThrow(AuthenticationError);
      await expect(notificationsController.markAllAsRead(unauthReq, res)).rejects.toThrow(AuthenticationError);
    });

    it('2. Rejects unauthorized cross-portal requests with 403 AuthorizationError', async () => {
      const frontDeskReq: any = {
        user: { sub: 'fd-user-1', role: 'FRONT_DESK_BILLING' },
        query: { portal: 'super-admin' },
      };
      const res: any = { json: vi.fn() };

      await expect(notificationsController.listNotifications(frontDeskReq, res)).rejects.toThrow(AuthorizationError);
      await expect(notificationsController.getUnreadCount(frontDeskReq, res)).rejects.toThrow(AuthorizationError);
    });

    it('3. Rejects admission staff accessing management notifications with 403', async () => {
      const admissionReq: any = {
        user: { sub: 'adm-user-1', role: 'ADMISSION' },
        query: { portal: 'admin' },
      };
      const res: any = { json: vi.fn() };

      await expect(notificationsController.listNotifications(admissionReq, res)).rejects.toThrow(AuthorizationError);
    });

    it('4. Allows legitimate portal queries for authorized roles', () => {
      expect(getAllowedPortalsForRole('SUPER_ADMIN')).toContain('super-admin');
      expect(getAllowedPortalsForRole('SUPER_ADMIN')).toContain('admin');
      expect(getAllowedPortalsForRole('SUPER_ADMIN')).toContain('front-desk');
      expect(getAllowedPortalsForRole('ADMIN')).toContain('admin');
      expect(getAllowedPortalsForRole('ADMIN')).not.toContain('super-admin');
      expect(getAllowedPortalsForRole('FRONT_DESK_BILLING')).toEqual(['front-desk', 'all']);
      expect(getAllowedPortalsForRole('ADMISSION')).toEqual(['admission', 'all']);

      expect(getDefaultPortalForRole('SUPER_ADMIN')).toBe('super-admin');
      expect(getDefaultPortalForRole('ADMIN')).toBe('admin');
      expect(getDefaultPortalForRole('FRONT_DESK_BILLING')).toBe('front-desk');
      expect(getDefaultPortalForRole('ADMISSION')).toBe('admission');
    });
  });

  describe('BUG 2: Recipient-Specific Delivery & Fail-Closed Isolation', () => {
    it('5. Front Desk A cannot see Front Desk B private notifications', async () => {
      // Setup mock notifications in DB
      const now = new Date();
      (prisma.hospitalNotification.findMany as any).mockImplementation(({ where }: any) => {
        // Evaluate the OR conditions in the mock to simulate real PostgreSQL behavior
        const mockRows = [
          {
            id: 'notif-fd-a',
            title: 'Settlement Accepted',
            message: 'Your shift settlement accepted',
            recipientUserId: 'fd-user-a',
            isBroadcast: false,
            isRead: false,
            targetPortal: 'front-desk',
            createdAt: now,
          },
          {
            id: 'notif-fd-b',
            title: 'Settlement Accepted',
            message: 'Your shift settlement accepted',
            recipientUserId: 'fd-user-b',
            isBroadcast: false,
            isRead: false,
            targetPortal: 'front-desk',
            createdAt: now,
          },
        ];

        return mockRows.filter((row) => {
          if (row.recipientUserId === where.OR[0].recipientUserId) return true;
          if (row.isBroadcast && where.OR[1].isBroadcast) return true;
          return false;
        });
      });
      (prisma.hospitalNotificationRead.findMany as any).mockResolvedValue([]);

      const userAItems = await notificationsService.listNotifications('fd-user-a', 'front-desk');
      expect(userAItems).toHaveLength(1);
      expect(userAItems[0].id).toBe('notif-fd-a');
      expect(userAItems.find((i) => i.id === 'notif-fd-b')).toBeUndefined();

      const userBItems = await notificationsService.listNotifications('fd-user-b', 'front-desk');
      expect(userBItems).toHaveLength(1);
      expect(userBItems[0].id).toBe('notif-fd-b');
      expect(userBItems.find((i) => i.id === 'notif-fd-a')).toBeUndefined();
    });

    it('6. Admin X receives only settlements addressed to Admin X; Admin Y does not', async () => {
      const now = new Date();
      (prisma.hospitalNotification.findMany as any).mockImplementation(({ where }: any) => {
        const mockRows = [
          {
            id: 'notif-settlement-x',
            title: 'Shift Settlement Submitted',
            message: 'FD User A submitted settlement to Admin X',
            recipientUserId: 'admin-x',
            isBroadcast: false,
            isRead: false,
            targetPortal: 'admin',
            createdAt: now,
          },
        ];

        return mockRows.filter((row) => {
          if (row.recipientUserId === where.OR[0].recipientUserId) return true;
          if (row.isBroadcast && where.OR[1].isBroadcast) return true;
          return false;
        });
      });
      (prisma.hospitalNotificationRead.findMany as any).mockResolvedValue([]);

      // Admin X queries
      const adminXItems = await notificationsService.listNotifications('admin-x', 'admin');
      expect(adminXItems).toHaveLength(1);
      expect(adminXItems[0].id).toBe('notif-settlement-x');

      // Admin Y queries
      const adminYItems = await notificationsService.listNotifications('admin-y', 'admin');
      expect(adminYItems).toHaveLength(0);
    });

    it('7. Historical unassigned private financial alerts fail closed and are not exposed', async () => {
      const now = new Date();
      (prisma.hospitalNotification.findMany as any).mockImplementation(({ where }: any) => {
        const mockRows = [
          // Ambiguous historical private notification without recipient
          {
            id: 'legacy-settlement-alert',
            title: 'Shift Settlement Submitted: Legacy Cashier',
            message: 'Shift settlement awaiting review',
            recipientUserId: null,
            isBroadcast: false,
            isRead: false,
            targetPortal: 'admin',
            createdAt: now,
          },
        ];

        return mockRows.filter((row) => {
          if (row.recipientUserId && row.recipientUserId === where.OR[0].recipientUserId) return true;
          if (row.isBroadcast && where.OR[1].isBroadcast) return true;
          return false;
        });
      });
      (prisma.hospitalNotificationRead.findMany as any).mockResolvedValue([]);

      const items = await notificationsService.listNotifications('any-admin-user', 'admin');
      expect(items).toHaveLength(0); // Fails closed! Zero exposure
    });

    it('8. Legitimate broadcast announcements are properly delivered to authorized portal users', async () => {
      const now = new Date();
      (prisma.hospitalNotification.findMany as any).mockImplementation(({ where }: any) => {
        const mockRows = [
          {
            id: 'broadcast-discharge',
            title: 'Discharge Clearance Needed',
            message: 'Patient clinically discharged',
            recipientUserId: null,
            isBroadcast: true,
            isRead: false,
            targetPortal: 'front-desk',
            createdAt: now,
          },
        ];

        return mockRows.filter((row) => {
          if (row.recipientUserId === where.OR[0].recipientUserId) return true;
          if (row.isBroadcast) {
            const portalMatches = where.OR[1].OR.some((p: any) => p.targetPortal === row.targetPortal);
            return portalMatches;
          }
          return false;
        });
      });
      (prisma.hospitalNotificationRead.findMany as any).mockResolvedValue([]);

      const fdItems = await notificationsService.listNotifications('fd-user-1', 'front-desk');
      expect(fdItems).toHaveLength(1);
      expect(fdItems[0].id).toBe('broadcast-discharge');

      const admItems = await notificationsService.listNotifications('adm-user-1', 'admission');
      expect(admItems).toHaveLength(0); // Front Desk broadcast is not delivered to Admission portal
    });
  });

  describe('BUG 3: Independent Read/Unread State & Authorization on Updates', () => {
    it('9. User B cannot mark User A private notification as read (AuthorizationError / 403)', async () => {
      (prisma.hospitalNotification.findUnique as any).mockResolvedValue({
        id: 'notif-private-a',
        recipientUserId: 'user-a',
        isBroadcast: false,
        isRead: false,
      });

      await expect(notificationsService.markAsRead('notif-private-a', 'user-b')).rejects.toThrow(AuthorizationError);
      expect(prisma.hospitalNotification.update).not.toHaveBeenCalled();
    });

    it('10. Authorized recipient User A successfully marks own private notification as read', async () => {
      (prisma.hospitalNotification.findUnique as any).mockResolvedValue({
        id: 'notif-private-a',
        recipientUserId: 'user-a',
        isBroadcast: false,
        isRead: false,
      });
      (prisma.hospitalNotification.update as any).mockResolvedValue({ id: 'notif-private-a', isRead: true });

      await notificationsService.markAsRead('notif-private-a', 'user-a');
      expect(prisma.hospitalNotification.update).toHaveBeenCalledWith({
        where: { id: 'notif-private-a' },
        data: { isRead: true },
      });
    });

    it('11. Broadcast notifications track independent read status per user via HospitalNotificationRead', async () => {
      (prisma.hospitalNotification.findUnique as any).mockResolvedValue({
        id: 'broadcast-planned-adm',
        recipientUserId: null,
        isBroadcast: true,
        isRead: false,
        targetPortal: 'admission',
      });
      (prisma.hospitalNotificationRead.upsert as any).mockResolvedValue({
        id: 'read-rec-1',
        notificationId: 'broadcast-planned-adm',
        userId: 'adm-user-1',
      });

      await notificationsService.markAsRead('broadcast-planned-adm', 'adm-user-1');
      expect(prisma.hospitalNotificationRead.upsert).toHaveBeenCalledWith({
        where: {
          notificationId_userId: { notificationId: 'broadcast-planned-adm', userId: 'adm-user-1' },
        },
        create: { notificationId: 'broadcast-planned-adm', userId: 'adm-user-1' },
        update: {},
      });
      // Crucially, the global isRead on hospitalNotification must NOT be modified
      expect(prisma.hospitalNotification.update).not.toHaveBeenCalled();
    });

    it('12. Individual unread counts strictly reflect only the requesting user\'s notifications', async () => {
      (prisma.hospitalNotification.count as any).mockResolvedValue(2); // 2 private unread for this user
      (prisma.hospitalNotification.findMany as any).mockResolvedValue([
        { id: 'b-1' },
        { id: 'b-2' },
      ]);
      (prisma.hospitalNotificationRead.count as any).mockResolvedValue(1); // 1 broadcast already read by this user

      const unreadCount = await notificationsService.getUnreadCount('user-1', 'front-desk');
      // 2 private + (2 broadcast - 1 read) = 3
      expect(unreadCount).toBe(3);
    });

    it('13. Mark all as read updates private notifications for caller and records per-user broadcast reads', async () => {
      (prisma.hospitalNotification.updateMany as any).mockResolvedValue({ count: 2 });
      (prisma.hospitalNotification.findMany as any).mockResolvedValue([
        { id: 'b-1' },
        { id: 'b-2' },
      ]);
      (prisma.hospitalNotificationRead.findMany as any).mockResolvedValue([
        { notificationId: 'b-1' }, // b-1 already read
      ]);
      (prisma.hospitalNotificationRead.createMany as any).mockResolvedValue({ count: 1 });

      await notificationsService.markAllAsRead('user-1', 'front-desk');

      // Verified private notifications updated ONLY for caller
      expect(prisma.hospitalNotification.updateMany).toHaveBeenCalledWith({
        where: { recipientUserId: 'user-1', isRead: false },
        data: { isRead: true },
      });

      // Verified broadcast read receipt created ONLY for unread b-2 for user-1
      expect(prisma.hospitalNotificationRead.createMany).toHaveBeenCalledWith({
        data: [{ notificationId: 'b-2', userId: 'user-1' }],
        skipDuplicates: true,
      });
    });
  });
});
