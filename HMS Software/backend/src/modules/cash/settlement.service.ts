import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { ValidationError } from '@/shared/errors/AppError';
import type { SubmitSettlementBody } from './settlement.schemas';
import type { MySettlementsQuery } from './financeControl.schemas';
import { resolveDateRange } from '@/modules/reports/dashboard.service';
import { resolveCashModuleScope } from './moduleScope.util';
import type { PortalRole } from '@/config/constants';
import { notificationsService } from '@/modules/notifications/notifications.service';

/**
 * My Account Settlement (HMS_V7.2_NEW_REQUIREMENTS.md §3.3; Balance Sheet &
 * Account Settlement Guide §5.1) — closes out a cashier's shift: every
 * currently-unsettled `UserCashBalance` row (the same ledger
 * `cashService.getCashierBalanceSheet` reads) is bundled into one
 * `AccountSettlement` and flips `isSettled = true`.
 *
 * Scoped to the submitting user's own `moduleScope`, resolved from their
 * role (`resolveCashModuleScope` — inventory.md §9 step 2). ADMIN and SUPER_ADMIN
 * manage hospital-wide custody across all module scopes.
 */
export const settlementService = {
  /**
   * Returns active, authorized receiver accounts that the given submitter can settle to:
   * - Front Desk / Staff -> Admin OR Super Admin
   * - Admin -> Super Admin
   */
  async getEligibleReceivers(portalUserId: string) {
    const targetUser = await prisma.portalUser.findUniqueOrThrow({
      where: { id: portalUserId },
      select: { role: true },
    });
    const targetRoles: PortalRole[] =
      targetUser.role === 'ADMIN' ? ['SUPER_ADMIN'] : ['ADMIN', 'SUPER_ADMIN'];
    return prisma.portalUser.findMany({
      where: {
        role: { in: targetRoles },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
      },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });
  },

  async submitSettlement(portalUserId: string, body: SubmitSettlementBody) {
    const createdSettlement = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${portalUserId}`}))`;
      const targetUser = await tx.portalUser.findUniqueOrThrow({
        where: { id: portalUserId },
        select: { role: true },
      });
      const moduleScope = resolveCashModuleScope(targetUser.role);
      const isManager = targetUser.role === 'ADMIN' || targetUser.role === 'SUPER_ADMIN';
      const scopeFilter = isManager ? {} : { moduleScope };

      // Validate receiver if provided
      let resolvedReceiverId: string | null = null;
      if (body.receiverUserId) {
        const receiver = await tx.portalUser.findUnique({
          where: { id: body.receiverUserId },
          select: { id: true, role: true, status: true },
        });
        if (!receiver || receiver.status !== 'ACTIVE') {
          throw new ValidationError('Selected settlement receiver was not found or is inactive.');
        }
        if (targetUser.role === 'ADMIN' && receiver.role !== 'SUPER_ADMIN') {
          throw new ValidationError('Admin can only settle cash onward to a Super Admin.');
        }
        if (!['ADMIN', 'SUPER_ADMIN'].includes(receiver.role)) {
          throw new ValidationError('Settlement receiver must hold an Admin or Super Admin role.');
        }
        resolvedReceiverId = receiver.id;
      } else {
        const defaultReceiver =
          typeof tx.portalUser.findFirst === 'function'
            ? await tx.portalUser.findFirst({
                where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
                select: { id: true },
              })
            : null;
        resolvedReceiverId = defaultReceiver?.id ?? null;
      }

      const [unsettled, previousSettlement] = await Promise.all([
        tx.userCashBalance.findMany({
          where: { portalUserId, ...scopeFilter, isSettled: false },
          orderBy: { occurredAt: 'asc' },
        }),
        // The most recent non-reversed settlement carries this user's
        // current outstanding liability forward — a reversal already
        // re-opens its linked rows (`financeControlService.reverseSettlement`),
        // so a reversed settlement's carry-forward must never be counted.
        tx.accountSettlement.findFirst({
          where: { portalUserId, ...scopeFilter, status: { not: 'REVERSED' } },
          orderBy: { createdAt: 'desc' },
          select: { carryForwardAmount: true },
        }),
      ]);

      const broughtForward = previousSettlement?.carryForwardAmount ?? new Decimal(0);
      if (unsettled.length === 0 && broughtForward.isZero()) {
        throw new ValidationError('No unsettled transactions to settle.');
      }

      let physicalCashIn = new Decimal(0);
      let physicalCashOut = new Decimal(0);
      for (const t of unsettled) {
        if (t.isPhysicalCash) {
          if (t.direction === 'IN') physicalCashIn = physicalCashIn.plus(t.amount);
          else physicalCashOut = physicalCashOut.plus(t.amount);
        }
      }
      const expectedCash = physicalCashIn.minus(physicalCashOut).plus(broughtForward);
      const physicalCash = new Decimal(body.physicalCash);
      const variance = physicalCash.minus(expectedCash);
      // A shortfall (physicalCash < expectedCash) becomes next period's
      // liability; an overage never carries forward as one — it's found
      // cash, not money still owed.
      const carryForwardAmount = variance.isNegative() ? variance.abs() : new Decimal(0);

      if (!variance.isZero() && !body.varianceReason?.trim()) {
        throw new ValidationError(
          `Physical cash (${physicalCash.toString()}) does not match expected cash (${expectedCash.toString()}) — a variance reason is required.`,
        );
      }

      const now = new Date();
      const occurredDates = unsettled.map((t) => t.occurredAt.getTime());
      const periodStart = unsettled.length > 0 ? new Date(Math.min(...occurredDates)) : now;
      const periodEnd = unsettled.length > 0 ? new Date(Math.max(...occurredDates)) : now;

      const settlement = await tx.accountSettlement.create({
        data: {
          portalUserId,
          receiverUserId: resolvedReceiverId,
          moduleScope,
          periodStart,
          periodEnd,
          expectedCash,
          physicalCash,
          variance,
          varianceReason: body.varianceReason?.trim() || null,
          handoverAmount: body.handoverAmount != null ? new Decimal(body.handoverAmount) : null,
          carryForwardAmount,
          status: 'SUBMITTED',
          submittedAt: now,
          remarks: body.remarks?.trim() || null,
        },
      });

      if (unsettled.length > 0) {
        await tx.settlementTransaction.createMany({
          data: unsettled.map((t) => ({ accountSettlementId: settlement.id, userCashBalanceId: t.id })),
        });
        await tx.userCashBalance.updateMany({
          where: { id: { in: unsettled.map((t) => t.id) } },
          data: { isSettled: true },
        });
      }

      return settlement;
    });

    try {
      const submitterUser = prisma.portalUser?.findUnique
        ? await prisma.portalUser.findUnique({
            where: { id: portalUserId },
            select: { displayName: true, username: true, role: true },
          })
        : null;
      const submitterName = submitterUser?.displayName || submitterUser?.username || 'Cashier';
      const roleLabel = submitterUser?.role === 'FRONT_DESK_BILLING' || createdSettlement.moduleScope === 'BILLING' ? 'Front Desk' : submitterUser?.role || 'Staff';
      const handoverNum = Number(createdSettlement.handoverAmount ?? createdSettlement.physicalCash);
      const amountStr = handoverNum.toLocaleString('en-PK', { maximumFractionDigits: 0 });

      const receiver = createdSettlement.receiverUserId && prisma.portalUser?.findUnique
        ? await prisma.portalUser.findUnique({
            where: { id: createdSettlement.receiverUserId },
            select: { id: true, role: true },
          })
        : null;
      const targetPortal = receiver?.role === 'SUPER_ADMIN' ? 'super-admin' : 'admin';

      await notificationsService.createNotification({
        title: `Shift Settlement Submitted: ${submitterName}`,
        message: `${submitterName} (${roleLabel}) submitted a shift settlement of Rs. ${amountStr} awaiting review and acceptance.`,
        type: 'urgent',
        module: 'Finance',
        targetPortal,
        actionUrl: `/${targetPortal}/account_settlements`,
        referenceId: createdSettlement.id,
        createdById: portalUserId,
        recipientUserId: createdSettlement.receiverUserId,
        isBroadcast: false,
      });
    } catch (notifErr) {
      // eslint-disable-next-line no-console
      console.error('Failed to dispatch settlement notification:', notifErr);
    }

    return createdSettlement;
  },

  /** reporting.md §2 #9 — own settlement history, filterable by From/To (settlement creation) and Settlement Status. */
  async listMySettlements(portalUserId: string, query?: MySettlementsQuery) {
    const targetUser = await prisma.portalUser.findUniqueOrThrow({
      where: { id: portalUserId },
      select: { role: true },
    });
    const moduleScope = resolveCashModuleScope(targetUser.role);
    const isManager = targetUser.role === 'ADMIN' || targetUser.role === 'SUPER_ADMIN';
    const scopeFilter = isManager ? {} : { moduleScope };

    const range =
      query && query.preset !== 'all'
        ? resolveDateRange({ preset: query.preset as Exclude<MySettlementsQuery['preset'], 'all'>, fromDate: query.fromDate, toDate: query.toDate })
        : null;
    return prisma.accountSettlement.findMany({
      where: {
        portalUserId,
        ...scopeFilter,
        ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
        ...(query?.status ? { status: query.status } : {}),
      },
      include: {
        receiverUser: {
          select: { id: true, username: true, displayName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: range || query?.status ? 500 : 50,
    });
  },
};
