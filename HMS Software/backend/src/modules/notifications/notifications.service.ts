import { prisma } from '@/db/client';
import { AuthorizationError, NotFoundError } from '@/shared/errors/AppError';

export interface CreateNotificationParams {
  title: string;
  message: string;
  type?: 'info' | 'urgent' | 'warning' | 'success' | string;
  module?: string;
  targetPortal?: 'admission' | 'front-desk' | 'all' | 'admin' | 'super-admin' | 'pharmacy' | string;
  actionUrl?: string;
  referenceId?: string;
  createdById?: string | null;
  recipientUserId?: string | null;
  isBroadcast?: boolean;
}

export const notificationsService = {
  async createNotification(params: CreateNotificationParams) {
    if (!prisma.hospitalNotification?.create) return null as any;

    const isBroadcast = params.isBroadcast ?? (!params.recipientUserId ? false : false);

    // Deduplicate: if an unread notification with same title and referenceId was created recently, skip
    if (params.referenceId && params.title) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const existing = await prisma.hospitalNotification.findFirst({
        where: {
          referenceId: params.referenceId,
          recipientUserId: params.recipientUserId || null,
          targetPortal: params.targetPortal || 'all',
          title: params.title,
          isRead: false,
          createdAt: { gte: tenMinutesAgo },
        },
      });
      if (existing) return existing;
    }

    return prisma.hospitalNotification.create({
      data: {
        title: params.title,
        message: params.message,
        type: params.type || 'info',
        module: params.module || 'General',
        targetPortal: params.targetPortal || 'all',
        actionUrl: params.actionUrl || null,
        referenceId: params.referenceId || null,
        createdById: params.createdById || null,
        recipientUserId: params.recipientUserId || null,
        isBroadcast,
      },
    });
  },

  async listNotifications(userId: string, portal: string, limit: number = 30) {
    // Auto-sync active DB states to ensure zero missed notifications
    await this.syncRealStateNotifications();

    const notifications = await prisma.hospitalNotification.findMany({
      where: {
        OR: [
          // 1. Private personal notifications explicitly addressed to this user
          { recipientUserId: userId },
          // 2. Legitimate authorized broadcast announcements for this portal
          {
            isBroadcast: true,
            OR: [
              { targetPortal: portal },
              { targetPortal: 'all' },
              { targetPortal: null },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const broadcastIds = notifications.filter((n) => n.isBroadcast).map((n) => n.id);
    let readBroadcastIds = new Set<string>();
    if (broadcastIds.length > 0) {
      const reads = await prisma.hospitalNotificationRead.findMany({
        where: {
          userId,
          notificationId: { in: broadcastIds },
        },
        select: { notificationId: true },
      });
      readBroadcastIds = new Set(reads.map((r) => r.notificationId));
    }

    return notifications.map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      type: item.type,
      module: item.module,
      targetPortal: item.targetPortal,
      actionUrl: item.actionUrl,
      referenceId: item.referenceId,
      read: item.recipientUserId ? item.isRead : readBroadcastIds.has(item.id),
      recipientUserId: item.recipientUserId,
      isBroadcast: item.isBroadcast,
      createdAt: item.createdAt.toISOString(),
    }));
  },

  async getUnreadCount(userId: string, portal: string): Promise<number> {
    // 1. Unread private notifications directly addressed to this user
    const privateUnreadCount = await prisma.hospitalNotification.count({
      where: {
        recipientUserId: userId,
        isRead: false,
      },
    });

    // 2. Broadcast notifications for this portal
    const broadcastNotifs = await prisma.hospitalNotification.findMany({
      where: {
        isBroadcast: true,
        OR: [
          { targetPortal: portal },
          { targetPortal: 'all' },
          { targetPortal: null },
        ],
      },
      select: { id: true },
      take: 200,
    });

    if (broadcastNotifs.length === 0) {
      return privateUnreadCount;
    }

    const broadcastIds = broadcastNotifs.map((b) => b.id);
    const readCount = await prisma.hospitalNotificationRead.count({
      where: {
        userId,
        notificationId: { in: broadcastIds },
      },
    });

    const broadcastUnreadCount = Math.max(0, broadcastIds.length - readCount);
    return privateUnreadCount + broadcastUnreadCount;
  },

  async markAsRead(id: string, userId: string) {
    const item = await prisma.hospitalNotification.findUnique({
      where: { id },
    });
    if (!item) {
      throw new NotFoundError('Notification not found');
    }

    if (item.recipientUserId) {
      if (item.recipientUserId !== userId) {
        throw new AuthorizationError('You are not authorized to modify another user\'s notification');
      }
      return prisma.hospitalNotification.update({
        where: { id },
        data: { isRead: true },
      });
    }

    if (item.isBroadcast) {
      return prisma.hospitalNotificationRead.upsert({
        where: {
          notificationId_userId: { notificationId: id, userId },
        },
        create: {
          notificationId: id,
          userId,
        },
        update: {},
      });
    }

    throw new AuthorizationError('Cannot modify an unassigned private notification');
  },

  async markAllAsRead(userId: string, portal: string) {
    // 1. Mark all personal private notifications for this user as read
    await prisma.hospitalNotification.updateMany({
      where: {
        recipientUserId: userId,
        isRead: false,
      },
      data: { isRead: true },
    });

    // 2. Mark active broadcast notifications for this user's portal as read
    const broadcastNotifs = await prisma.hospitalNotification.findMany({
      where: {
        isBroadcast: true,
        OR: [
          { targetPortal: portal },
          { targetPortal: 'all' },
          { targetPortal: null },
        ],
      },
      select: { id: true },
      take: 200,
    });

    if (broadcastNotifs.length > 0) {
      const alreadyRead = await prisma.hospitalNotificationRead.findMany({
        where: {
          userId,
          notificationId: { in: broadcastNotifs.map((b) => b.id) },
        },
        select: { notificationId: true },
      });
      const readSet = new Set(alreadyRead.map((r) => r.notificationId));
      const toMark = broadcastNotifs
        .filter((b) => !readSet.has(b.id))
        .map((b) => ({
          notificationId: b.id,
          userId,
        }));

      if (toMark.length > 0) {
        await prisma.hospitalNotificationRead.createMany({
          data: toMark,
          skipDuplicates: true,
        });
      }
    }
  },

  /**
   * Automatically synchronizes real database state so pending admissions from
   * Front Desk and pending discharge payments always have real notification entries.
   */
  async syncRealStateNotifications() {
    try {
      // 1. Check for PLANNED admissions (Front Desk -> Admission Portal)
      const plannedAdmissions = await prisma.admissionRecord.findMany({
        where: { status: 'PLANNED' },
        include: {
          panelPatient: { select: { fullName: true, mrNumber: true } },
          selfPayEncounter: { select: { fullName: true } },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      for (const adm of plannedAdmissions) {
        const patientName = adm.panelPatient?.fullName || adm.selfPayEncounter?.fullName || 'Patient';
        const existing = await prisma.hospitalNotification.findFirst({
          where: {
            referenceId: adm.id,
            targetPortal: 'admission',
          },
        });

        if (!existing) {
          await prisma.hospitalNotification.create({
            data: {
              title: 'New Inpatient Admission Request',
              message: `Patient ${patientName} (${adm.admissionNumber}) registered at Front Desk — awaiting bed check-in.`,
              type: 'urgent',
              module: 'Admissions',
              targetPortal: 'admission',
              actionUrl: '/admission/planned_admissions',
              referenceId: adm.id,
              isBroadcast: true,
              createdAt: adm.createdAt,
            },
          });
        }
      }

      // 2. Check for DISCHARGE_PENDING admissions (Admission Portal -> Front Desk)
      const pendingDischarges = await prisma.admissionRecord.findMany({
        where: { status: 'DISCHARGE_PENDING' },
        include: {
          panelPatient: { select: { fullName: true } },
          selfPayEncounter: { select: { fullName: true } },
        },
        take: 10,
        orderBy: { updatedAt: 'desc' },
      });

      for (const adm of pendingDischarges) {
        const patientName = adm.panelPatient?.fullName || adm.selfPayEncounter?.fullName || 'Patient';
        const existing = await prisma.hospitalNotification.findFirst({
          where: {
            referenceId: adm.id,
            targetPortal: 'front-desk',
          },
        });

        if (!existing) {
          await prisma.hospitalNotification.create({
            data: {
              title: 'Discharge Billing & Payment Clearance',
              message: `Patient ${patientName} (${adm.admissionNumber}) clinically discharged. Awaiting final billing closure at Front Desk.`,
              type: 'warning',
              module: 'Billing',
              targetPortal: 'front-desk',
              actionUrl: '/front-desk/billing_pending_discharges',
              referenceId: adm.id,
              isBroadcast: true,
              createdAt: adm.updatedAt,
            },
          });
        }
      }

      // 3. Check for active PENDING AdmissionPaymentRequests (Admission Portal -> Front Desk)
      const pendingPaymentRequests = await prisma.admissionPaymentRequest.findMany({
        where: { status: 'PENDING' },
        include: {
          admissionRecord: {
            include: {
              panelPatient: { select: { fullName: true, mrNumber: true } },
              selfPayEncounter: { select: { fullName: true } },
            },
          },
        },
        take: 10,
        orderBy: { requestedAt: 'desc' },
      });

      for (const req of pendingPaymentRequests) {
        const adm = req.admissionRecord;
        if (!adm) continue;
        const patientName = adm.panelPatient?.fullName || adm.selfPayEncounter?.fullName || 'Patient';
        const existing = await prisma.hospitalNotification.findFirst({
          where: {
            targetPortal: 'front-desk',
            OR: [
              { referenceId: req.id },
              { referenceId: adm.id },
            ],
          },
        });

        if (!existing) {
          const amountStr = Number(req.requestedAmount).toLocaleString('en-PK', { maximumFractionDigits: 0 });
          const isFinal = req.requestType === 'FINAL';
          await prisma.hospitalNotification.create({
            data: {
              title: isFinal ? `Discharge Clearance Needed: ${patientName}` : `Payment Request: ${patientName}`,
              message: isFinal
                ? `Discharge billing clearance requested for ${patientName} (${adm.admissionNumber}). Outstanding balance: Rs. ${amountStr}. Please collect clearance payment at Front Desk.`
                : `Payment request of Rs. ${amountStr} pending for ${patientName} (${adm.admissionNumber}). Please collect at Front Desk.`,
              type: 'urgent',
              module: 'Billing',
              targetPortal: 'front-desk',
              actionUrl: isFinal ? '/front-desk/billing_pending_discharges' : '/front-desk/admission_payment_requests',
              referenceId: req.id,
              isBroadcast: true,
              createdAt: req.requestedAt,
            },
          });
        }
      }

      // 4. Check for active SUBMITTED AccountSettlements (Front Desk / Staff -> Designated Receiver Admin / Super Admin)
      const pendingSettlements = await prisma.accountSettlement.findMany({
        where: { status: 'SUBMITTED' },
        include: {
          submittedByUser: { select: { id: true, username: true, displayName: true, role: true } },
          receiverUser: { select: { id: true, username: true, displayName: true, role: true } },
        },
        take: 10,
        orderBy: { submittedAt: 'desc' },
      });

      for (const st of pendingSettlements) {
        const submitterName = st.submittedByUser?.displayName || st.submittedByUser?.username || 'Cashier';
        const roleLabel = st.submittedByUser?.role === 'FRONT_DESK_BILLING' || st.moduleScope === 'BILLING' ? 'Front Desk' : st.submittedByUser?.role || 'Staff';
        const handoverNum = Number(st.handoverAmount ?? st.physicalCash);
        const amountStr = handoverNum.toLocaleString('en-PK', { maximumFractionDigits: 0 });
        const receiverId = st.receiverUserId;
        if (!receiverId) continue; // Fail closed if no receiver specified

        const receiverRole = st.receiverUser?.role;
        const targetPortal = receiverRole === 'SUPER_ADMIN' ? 'super-admin' : 'admin';

        const existing = await prisma.hospitalNotification.findFirst({
          where: {
            referenceId: st.id,
            recipientUserId: receiverId,
          },
        });

        if (!existing) {
          await prisma.hospitalNotification.create({
            data: {
              title: `Shift Settlement Submitted: ${submitterName}`,
              message: `${submitterName} (${roleLabel}) submitted a shift settlement of Rs. ${amountStr} awaiting review and acceptance.`,
              type: 'urgent',
              module: 'Finance',
              targetPortal,
              actionUrl: `/${targetPortal}/account_settlements`,
              referenceId: st.id,
              recipientUserId: receiverId,
              isBroadcast: false,
              createdById: st.portalUserId,
              createdAt: st.submittedAt || st.createdAt,
            },
          });
        }
      }
    } catch {
      // Background sync shouldn't crash notification queries
    }
  },
};
