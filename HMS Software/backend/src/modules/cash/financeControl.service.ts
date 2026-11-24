import { lockMainFund } from '@/shared/mainFundLock';
import { Decimal } from '@prisma/client/runtime/library';
import type { CashModuleScope } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError, BusinessRuleError, AuthorizationError } from '@/shared/errors/AppError';
import { resolveDateRange } from '@/modules/reports/dashboard.service';
import { resolveCashModuleScope } from './moduleScope.util';
import { notificationsService } from '@/modules/notifications/notifications.service';
import type {
  ListBalanceSheetsQuery,
  ListSettlementsQuery,
  FinanceKpisQuery,
  ReviewSettlementBody,
  ReverseSettlementBody,
  IssuePettyCashBody,
} from './financeControl.schemas';

const userSummarySelect = { id: true, displayName: true, username: true, role: true } as const;

// HMS-side oversight scopes (inventory.md §7.3, §9 step 2) — Billing and
// Inventory both settle through Admin/Super Admin's Finance Control screen.
// Deliberately excludes PHARMACY: Standalone Pharmacy is its own project
// with its own oversight hierarchy (Pharmacy Super Admin/Manager,
// PROJECT_MASTER_SPEC.md §4.10) — not this screen's job to review.
const HMS_OVERSIGHT_SCOPES: CashModuleScope[] = ['BILLING', 'INVENTORY'];

/**
 * Roles Super Admin's "Issue Petty Cash" screen may target — Inventory Store
 * Managers and Front Desk Cashiers per the feature spec. Deliberately
 * narrower than `HMS_OVERSIGHT_SCOPES`/`CASH_ROLES` elsewhere: Pharmacy cash
 * users have their own oversight hierarchy (see the module-scope note above)
 * and are not issued petty cash from this screen.
 */
const ISSUABLE_ROLES = ['INVENTORY_MANAGEMENT', 'FRONT_DESK_BILLING'] as const;

const REVIEW_ACTION_TO_STATUS = {
  ACCEPT: 'ACCEPTED',
  PARTIALLY_ACCEPT: 'PARTIALLY_ACCEPTED',
  RETURN: 'RETURNED',
  REJECT: 'REJECTED',
} as const;

/**
 * Every cash-handling user's CURRENT outstanding liability — their most
 * recent non-REVERSED settlement's `carryForwardAmount` (same lookup
 * `settlementService.submitSettlement` and `cashService.getCashierBalanceSheet`
 * use). Not date-range scoped: a shortfall from last week still shows up
 * today until it's actually settled, same as guide §5.1's "carried as
 * unsettled" semantics.
 */
async function getLatestCarryForwardsByUser(portalUserId?: string) {
  const rows = await prisma.accountSettlement.findMany({
    where: {
      moduleScope: { in: HMS_OVERSIGHT_SCOPES },
      status: { not: 'REVERSED' },
      ...(portalUserId ? { portalUserId } : {}),
    },
    distinct: ['portalUserId'],
    orderBy: [{ portalUserId: 'asc' }, { createdAt: 'desc' }],
    select: { portalUserId: true, carryForwardAmount: true, submittedByUser: { select: userSummarySelect } },
  });

  const map = new Map<string, { amount: Decimal; user: { id: string; displayName: string | null; username: string; role: string } }>();
  for (const r of rows) {
    map.set(r.portalUserId, { amount: r.carryForwardAmount, user: r.submittedByUser });
  }
  return map;
}

/**
 * Admin / Super Admin "Finance Control" oversight (Balance Sheet & Account
 * Settlement Guide §6) — sits alongside `cash.service.ts` (a user's own
 * balance sheet) and `settlement.service.ts` (a user's own settlement
 * submission), but reads *across every cash-handling user* instead of the
 * one attached to the request. Scoped to `HMS_OVERSIGHT_SCOPES` (Billing +
 * Inventory, inventory.md §9 step 2) — Pharmacy is deliberately excluded,
 * it has its own oversight hierarchy.
 */
export const financeControlService = {
  async listBalanceSheets(query: ListBalanceSheetsQuery) {
    // `all` (default) — the full live custody picture, not one day's slice
    // (Petty Cash Oversight needs cumulative total issued/spent since ever).
    const range =
      query.preset === 'all'
        ? null
        : resolveDateRange({ preset: query.preset, fromDate: query.fromDate, toDate: query.toDate });
    const period = range
      ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() }
      : { label: 'All Time', start: null, end: null };

    const [rows, carryForwards] = await Promise.all([
      prisma.userCashBalance.findMany({
        where: {
          moduleScope: { in: HMS_OVERSIGHT_SCOPES },
          ...(range ? { occurredAt: { gte: range.start, lte: range.end } } : {}),
          ...(query.portalUserId ? { portalUserId: query.portalUserId } : {}),
        },
        include: { portalUser: { select: userSummarySelect } },
        orderBy: { occurredAt: 'desc' },
      }),
      getLatestCarryForwardsByUser(query.portalUserId),
    ]);

    type Bucket = {
      portalUserId: string;
      user: { id: string; displayName: string | null; username: string; role: string };
      physicalCashIn: Decimal;
      physicalCashOut: Decimal;
      nonPhysicalTotal: Decimal;
      totalCollections: Decimal;
      totalRefunds: Decimal;
      pettyCashIssued: Decimal;
      cashExpenses: Decimal;
      settledCount: number;
      unsettledCount: number;
    };
    const byUser = new Map<string, Bucket>();

    for (const row of rows) {
      let bucket = byUser.get(row.portalUserId);
      if (!bucket) {
        bucket = {
          portalUserId: row.portalUserId,
          user: row.portalUser,
          physicalCashIn: new Decimal(0),
          physicalCashOut: new Decimal(0),
          nonPhysicalTotal: new Decimal(0),
          totalCollections: new Decimal(0),
          totalRefunds: new Decimal(0),
          pettyCashIssued: new Decimal(0),
          cashExpenses: new Decimal(0),
          settledCount: 0,
          unsettledCount: 0,
        };
        byUser.set(row.portalUserId, bucket);
      }

      if (row.isPhysicalCash) {
        if (row.category === 'SALARY_PAYMENT' || row.category === 'COMMISSION_PAYMENT') bucket.cashExpenses = bucket.cashExpenses.plus(row.direction === 'OUT' ? row.amount : row.amount.negated());
        if (row.direction === 'IN') {
          bucket.physicalCashIn = bucket.physicalCashIn.plus(row.amount);
          if (row.category === 'COLLECTION') bucket.totalCollections = bucket.totalCollections.plus(row.amount);
          else if (row.category === 'PETTY_CASH_ISSUE') bucket.pettyCashIssued = bucket.pettyCashIssued.plus(row.amount);
        } else {
          bucket.physicalCashOut = bucket.physicalCashOut.plus(row.amount);
          if (row.category === 'REFUND') bucket.totalRefunds = bucket.totalRefunds.plus(row.amount);
          else if (row.category === 'EXPENSE') bucket.cashExpenses = bucket.cashExpenses.plus(row.amount);
        }
      } else {
        bucket.nonPhysicalTotal = bucket.nonPhysicalTotal.plus(row.direction === 'IN' ? row.amount : row.amount.negated());
        if (row.category === 'COLLECTION') bucket.totalCollections = bucket.totalCollections.plus(row.amount);
        else if (row.category === 'REFUND') bucket.totalRefunds = bucket.totalRefunds.plus(row.amount);
      }
      if (row.isSettled) bucket.settledCount += 1;
      else bucket.unsettledCount += 1;
    }

    // A user can owe a carry-forward liability with zero NEW activity in
    // this period — they still need a row, or their debt goes invisible.
    for (const [portalUserId, cf] of carryForwards) {
      if (!byUser.has(portalUserId) && !cf.amount.isZero()) {
        byUser.set(portalUserId, {
          portalUserId,
          user: cf.user,
          physicalCashIn: new Decimal(0),
          physicalCashOut: new Decimal(0),
          nonPhysicalTotal: new Decimal(0),
          totalCollections: new Decimal(0),
          totalRefunds: new Decimal(0),
          pettyCashIssued: new Decimal(0),
          cashExpenses: new Decimal(0),
          settledCount: 0,
          unsettledCount: 0,
        });
      }
    }

    const sheets = Array.from(byUser.values())
      .map((b) => {
        const carriedForwardAmount = carryForwards.get(b.portalUserId)?.amount ?? new Decimal(0);
        return {
          portalUserId: b.portalUserId,
          user: b.user,
          carriedForwardAmount,
          expectedPhysicalCash: b.physicalCashIn.minus(b.physicalCashOut).plus(carriedForwardAmount),
          nonPhysicalTotal: b.nonPhysicalTotal,
          totalCollections: b.totalCollections.minus(b.totalRefunds),
          totalRefunds: b.totalRefunds,
          pettyCashIssued: b.pettyCashIssued,
          cashExpenses: b.cashExpenses,
          settledCount: b.settledCount,
          unsettledCount: b.unsettledCount,
        };
      })
      .filter((b) => !query.onlyUnsettled || b.unsettledCount > 0 || !b.carriedForwardAmount.isZero())
      .sort((a, b) => b.expectedPhysicalCash.comparedTo(a.expectedPhysicalCash));

    return { period, sheets };
  },

  async listSettlements(query: ListSettlementsQuery) {
    const range =
      query.preset === 'all'
        ? null
        : resolveDateRange({ preset: query.preset, fromDate: query.fromDate, toDate: query.toDate });

    const rows = await prisma.accountSettlement.findMany({
      where: {
        moduleScope: { in: HMS_OVERSIGHT_SCOPES },
        ...(range ? { submittedAt: { gte: range.start, lte: range.end } } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.portalUserId ? { portalUserId: query.portalUserId } : {}),
      },
      include: {
        submittedByUser: { select: userSummarySelect },
        receiverUser: { select: userSummarySelect },
        reviewedByUser: { select: userSummarySelect },
        reversedByUser: { select: userSummarySelect },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const period = range
      ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() }
      : { label: 'All Time', start: null, end: null };
    return { period, settlements: rows };
  },

  async reviewSettlement(id: string, body: ReviewSettlementBody, reviewerPortalUserId: string) {
    const reviewerUser = await prisma.portalUser.findUnique({
      where: { id: reviewerPortalUserId },
      select: userSummarySelect,
    });
    if (!reviewerUser) throw new NotFoundError('Reviewer portal user not found');

    const settlement = await prisma.accountSettlement.findUnique({
      where: { id },
      include: {
        submittedByUser: { select: userSummarySelect },
        receiverUser: { select: userSummarySelect },
      },
    });
    if (!settlement) throw new NotFoundError('Settlement not found');
    if (settlement.status !== 'SUBMITTED') {
      throw new BusinessRuleError(`Only a SUBMITTED settlement can be reviewed (current status: ${settlement.status}).`);
    }

    // STRICT APPROVED RULE: Only the designated receiving user can Accept/Reject/Return.
    // Other Admin/Super Admin accounts have view oversight only; role alone is never enough.
    if (settlement.receiverUserId && settlement.receiverUserId !== reviewerPortalUserId) {
      throw new AuthorizationError(
        'Only the designated settlement receiver is authorized to review, accept, or reject this settlement.',
      );
    }

    const actualReceiverId = settlement.receiverUserId ?? body.receiverPortalUserId ?? reviewerPortalUserId;
    const receiverUser = await prisma.portalUser.findUnique({
      where: { id: actualReceiverId },
      select: userSummarySelect,
    });
    if (!receiverUser) throw new NotFoundError('Receiver portal user not found');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(receiverUser.role)) {
      throw new ValidationError('Settlement receiver must hold an Admin or Super Admin role.');
    }

    const newStatus = REVIEW_ACTION_TO_STATUS[body.action];

    const reviewed = await prisma.$transaction(async (tx) => {
      await lockMainFund(tx);
      const current = await tx.accountSettlement.findUnique({ where: { id } });
      if (current?.status !== 'SUBMITTED') throw new BusinessRuleError('Only a submitted settlement can be reviewed.');
      if (current.receiverUserId && current.receiverUserId !== reviewerPortalUserId) {
        throw new AuthorizationError(
          'Only the designated settlement receiver is authorized to review, accept, or reject this settlement.',
        );
      }
      const reviewed = await tx.accountSettlement.update({
        where: { id },
        data: {
          status: newStatus,
          receiverUserId: actualReceiverId,
          reviewedById: reviewerPortalUserId,
          reviewedAt: new Date(),
          ...(body.remarks?.trim() ? { remarks: body.remarks.trim() } : {}),
        },
      });

      // If returned or rejected, restore underlying transactions to unsettled so submitter can recount/resubmit
      if (newStatus === 'REJECTED' || newStatus === 'RETURNED') {
        const links = await tx.settlementTransaction.findMany({
          where: { accountSettlementId: id },
          select: { userCashBalanceId: true },
        });
        if (links.length > 0) {
          await tx.userCashBalance.updateMany({
            where: { id: { in: links.map((l) => l.userCashBalanceId) } },
            data: { isSettled: false },
          });
        }
      }

      // Accepting a settlement is the cashier physically handing custody
      // back — that cash re-enters the Main Cash Fund (`mainFund.service.ts`)
      // and posts Sender Cash OUT and Receiver Cash IN in UserCashBalance.
      // `handoverAmount` is the explicit "cash actually handed over" figure
      // when the cashier keeps part of what they counted; falls back to the
      // full counted `physicalCash` when not specified.
      if (newStatus === 'ACCEPTED' || newStatus === 'PARTIALLY_ACCEPTED') {
        const returnedAmount = reviewed.handoverAmount ?? reviewed.physicalCash;
        if (returnedAmount.greaterThan(0)) {
          await tx.mainCashFundEntry.create({
            data: {
              direction: 'IN',
              amount: returnedAmount,
              type: 'SETTLEMENT_RETURN',
              note: `Settlement handover from ${settlement.submittedByUser.displayName || settlement.submittedByUser.username}`,
              performedById: reviewerPortalUserId,
              relatedAccountSettlementId: reviewed.id,
            },
          });

          const occurredAt = reviewed.reviewedAt ?? new Date();
          const senderName = settlement.submittedByUser.displayName || settlement.submittedByUser.username;
          const receiverName = receiverUser.displayName || receiverUser.username;
          const approverName = reviewerUser.displayName || reviewerUser.username;

          // 1. Sender Cash OUT (drawer deduction, marked settled)
          await tx.userCashBalance.create({
            data: {
              portalUserId: settlement.portalUserId,
              moduleScope: settlement.moduleScope,
              direction: 'OUT',
              amount: returnedAmount,
              category: 'RECOVERY',
              isPhysicalCash: true,
              isSettled: true,
              issuedById: reviewerPortalUserId,
              note: `Settlement handover to ${receiverName} [settlement:${reviewed.id}]`,
              occurredAt,
            },
          });

          // 2. Receiver Cash IN (unsettled in receiver's live drawer)
          const receiverScope = resolveCashModuleScope(receiverUser.role);
          await tx.userCashBalance.create({
            data: {
              portalUserId: actualReceiverId,
              moduleScope: receiverScope,
              direction: 'IN',
              amount: returnedAmount,
              category: 'RECOVERY',
              isPhysicalCash: true,
              isSettled: false,
              issuedById: settlement.portalUserId,
              note: `Settlement received from ${senderName} (Approved by ${approverName}) [settlement:${reviewed.id}]`,
              occurredAt,
            },
          });
        }
      }

      return reviewed;
    });

    try {
      // Auto mark pending review notifications for this settlement as read for this reviewer
      await prisma.hospitalNotification.updateMany({
        where: { referenceId: id, recipientUserId: reviewerPortalUserId },
        data: { isRead: true },
      });

      const submitterRole = settlement.submittedByUser.role;
      const targetPortal = submitterRole === 'FRONT_DESK_BILLING' || settlement.moduleScope === 'BILLING' ? 'front-desk' : submitterRole === 'ADMIN' ? 'admin' : 'super-admin';
      const returnedAmount = reviewed.handoverAmount ?? reviewed.physicalCash;
      const amountStr = Number(returnedAmount).toLocaleString('en-PK', { maximumFractionDigits: 0 });
      const reviewerName = reviewerUser.displayName || reviewerUser.username;

      if (newStatus === 'ACCEPTED' || newStatus === 'PARTIALLY_ACCEPTED') {
        await notificationsService.createNotification({
          title: `Settlement ${newStatus === 'ACCEPTED' ? 'Accepted' : 'Partially Accepted'}`,
          message: `Your shift settlement of Rs. ${amountStr} has been accepted by ${reviewerName}.`,
          type: 'success',
          module: 'Finance',
          targetPortal,
          actionUrl: '/front-desk/my_account_settlement',
          referenceId: reviewed.id,
          createdById: reviewerPortalUserId,
          recipientUserId: settlement.portalUserId,
          isBroadcast: false,
        });
      } else if (newStatus === 'RETURNED' || newStatus === 'REJECTED') {
        await notificationsService.createNotification({
          title: `Settlement ${newStatus === 'RETURNED' ? 'Returned' : 'Rejected'}`,
          message: `Your shift settlement of Rs. ${amountStr} was returned by ${reviewerName}. Remarks: ${body.remarks || 'Please recount cash and resubmit.'}`,
          type: 'warning',
          module: 'Finance',
          targetPortal,
          actionUrl: '/front-desk/my_account_settlement',
          referenceId: reviewed.id,
          createdById: reviewerPortalUserId,
          recipientUserId: settlement.portalUserId,
          isBroadcast: false,
        });
      }
    } catch (notifErr) {
      // eslint-disable-next-line no-console
      console.error('Failed to dispatch settlement review notification:', notifErr);
    }

    return reviewed;
  },

  /**
   * Reverses a posted settlement — never edits or deletes the original
   * amounts (Guide §4.2, §12 rule 3). The underlying `UserCashBalance` rows
   * that were locked into this settlement go back to `isSettled: false` so
   * the money reappears on the owning cashier's balance sheet and can be
   * re-settled — a reversal must never make custody disappear.
   */
  async reverseSettlement(id: string, body: ReverseSettlementBody, actorPortalUserId: string) {
    const settlement = await prisma.accountSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundError('Settlement not found');
    if (settlement.status !== 'ACCEPTED' && settlement.status !== 'PARTIALLY_ACCEPTED') {
      throw new BusinessRuleError('Only an ACCEPTED or PARTIALLY_ACCEPTED settlement can be reversed.');
    }
    if (!body.reason.trim()) throw new ValidationError('A reversal reason is required.');

    return prisma.$transaction(async (tx) => {
      await lockMainFund(tx);
      const current = await tx.accountSettlement.findUnique({ where: { id } });
      if (!current || !['ACCEPTED', 'PARTIALLY_ACCEPTED'].includes(current.status)) throw new BusinessRuleError('Only an accepted settlement can be reversed.');
      const reversed = await tx.accountSettlement.update({
        where: { id },
        data: {
          status: 'REVERSED',
          reversalReason: body.reason.trim(),
          reversedById: actorPortalUserId,
          reversedAt: new Date(),
        },
      });

      // Undo any settlement-linked Cash OUT / Cash IN entries
      await tx.userCashBalance.deleteMany({
        where: {
          category: 'RECOVERY',
          note: { contains: `[settlement:${id}]` },
        },
      });

      const links = await tx.settlementTransaction.findMany({
        where: { accountSettlementId: id },
        select: { userCashBalanceId: true },
      });
      if (links.length > 0) {
        await tx.userCashBalance.updateMany({
          where: { id: { in: links.map((l) => l.userCashBalanceId) } },
          data: { isSettled: false },
        });
      }

      // Undo the Main Cash Fund credit this settlement's acceptance posted
      // (`reviewSettlement` above) — the cash handover it represented never
      // really happened, so the fund's balance must give it back. Always
      // proceeds even if it takes the fund negative: the reversal itself
      // must never be blocked (same rule as the `UserCashBalance` side above).
      const priorCredits = await tx.mainCashFundEntry.findMany({
        where: { relatedAccountSettlementId: id, direction: 'IN' },
        select: { amount: true },
      });
      const creditedAmount = priorCredits.reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
      if (creditedAmount.greaterThan(0)) {
        await tx.mainCashFundEntry.create({
          data: {
            direction: 'OUT',
            amount: creditedAmount,
            type: 'SETTLEMENT_RETURN',
            note: `Reversal of settlement handover — ${body.reason.trim()}`,
            performedById: actorPortalUserId,
            relatedAccountSettlementId: id,
          },
        });
      }

      return reversed;
    });
  },

  /** Guide §6.3 KPI set — hospital-wide, scoped to `HMS_OVERSIGHT_SCOPES` (Billing + Inventory). */
  async getFinanceKpis(query: FinanceKpisQuery) {
    const { start, end, label } = resolveDateRange(query);
    const dateFilter = { gte: start, lte: end };

    const [collectionRows, refundRows, allTimeUnsettled, settlementsInRange, carryForwards] = await Promise.all([
      prisma.userCashBalance.findMany({
        where: { moduleScope: { in: HMS_OVERSIGHT_SCOPES }, category: 'COLLECTION', direction: 'IN', occurredAt: dateFilter },
        select: { amount: true, isPhysicalCash: true, paymentReceipt: { select: { method: true } } },
      }),
      prisma.userCashBalance.findMany({
        where: { moduleScope: { in: HMS_OVERSIGHT_SCOPES }, category: 'REFUND', direction: 'OUT', occurredAt: dateFilter },
        select: { amount: true, isPhysicalCash: true, paymentReceipt: { select: { method: true } } },
      }),
      prisma.userCashBalance.findMany({
        where: { moduleScope: { in: HMS_OVERSIGHT_SCOPES }, isSettled: false },
        select: { amount: true, direction: true, isPhysicalCash: true, portalUserId: true },
      }),
      prisma.accountSettlement.findMany({
        where: { moduleScope: { in: HMS_OVERSIGHT_SCOPES }, submittedAt: dateFilter },
        select: { status: true, variance: true, expectedCash: true, physicalCash: true },
      }),
      getLatestCarryForwardsByUser(),
    ]);

    let totalCashCollectedToday = new Decimal(0);
    const byMethod: Record<string, Decimal> = { CARD: new Decimal(0), BANK: new Decimal(0), ONLINE: new Decimal(0) };
    for (const c of collectionRows) {
      if (c.isPhysicalCash) {
        totalCashCollectedToday = totalCashCollectedToday.plus(c.amount);
      } else {
        const method = c.paymentReceipt?.method ?? 'CARD';
        if (!byMethod[method]) byMethod[method] = new Decimal(0);
        byMethod[method] = byMethod[method].plus(c.amount);
      }
    }
    for (const refund of refundRows) {
      if (refund.isPhysicalCash) {
        totalCashCollectedToday = totalCashCollectedToday.minus(refund.amount);
      } else {
        const method = refund.paymentReceipt?.method ?? 'CARD';
        byMethod[method] = (byMethod[method] ?? new Decimal(0)).minus(refund.amount);
      }
    }
    const totalNonCashCollectedToday = Object.values(byMethod).reduce((s, v) => s.plus(v), new Decimal(0));
    const totalRefundsToday = refundRows.reduce((s, r) => s.plus(r.amount), new Decimal(0));

    let totalUnsettledCash = new Decimal(0);
    const usersPendingSettlement = new Set<string>();
    for (const u of allTimeUnsettled) {
      if (u.isPhysicalCash) {
        totalUnsettledCash = u.direction === 'IN' ? totalUnsettledCash.plus(u.amount) : totalUnsettledCash.minus(u.amount);
      }
      usersPendingSettlement.add(u.portalUserId);
    }
    // Carry-forward liabilities (Guide §5.1) — money already accounted for
    // in a past settlement's shortfall, still outstanding today even if the
    // user has zero raw unsettled transactions right now.
    for (const [portalUserId, cf] of carryForwards) {
      if (cf.amount.isZero()) continue;
      totalUnsettledCash = totalUnsettledCash.plus(cf.amount);
      usersPendingSettlement.add(portalUserId);
    }

    let totalExpectedCash = new Decimal(0);
    let totalSettledCash = new Decimal(0);
    let settlementsCompletedToday = 0;
    let settlementDifferences = 0;
    for (const s of settlementsInRange) {
      totalExpectedCash = totalExpectedCash.plus(s.expectedCash);
      if (s.status === 'ACCEPTED' || s.status === 'PARTIALLY_ACCEPTED') {
        totalSettledCash = totalSettledCash.plus(s.physicalCash);
        settlementsCompletedToday += 1;
      }
      if (!s.variance.isZero()) settlementDifferences += 1;
    }

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      totalCashCollectedToday,
      totalNonCashCollectedToday,
      collectionsByMethod: byMethod,
      totalRefundsToday,
      totalExpectedCash,
      totalSettledCash,
      totalUnsettledCash,
      usersPendingSettlementCount: usersPendingSettlement.size,
      settlementDifferencesCount: settlementDifferences,
      settlementsCompletedTodayCount: settlementsCompletedToday,
    };
  },

  /** Staff a Super Admin may issue petty cash to — Inventory Store Managers and Front Desk Cashiers only. */
  async listIssuableUsers() {
    const users = await prisma.portalUser.findMany({
      where: { role: { in: [...ISSUABLE_ROLES] }, status: 'ACTIVE' },
      select: userSummarySelect,
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });
    return users;
  },

  /**
   * Super Admin issues petty cash (Opening Float / Top-Up) to a staff user —
   * posts a `UserCashBalance` row exactly like any other cash-in entry so it
   * shows up on the recipient's own Balance Sheet / "Petty Cash Received"
   * total (`cash.service.ts`'s `pettyCash` line) with no separate model.
   */
  async issuePettyCash(body: IssuePettyCashBody, issuedByPortalUserId: string) {
    const target = await prisma.portalUser.findUnique({
      where: { id: body.portalUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundError('Staff user not found.');
    if (target.status !== 'ACTIVE') throw new BusinessRuleError('Cannot issue petty cash to an inactive staff user.');
    if (!(ISSUABLE_ROLES as readonly string[]).includes(target.role)) {
      throw new ValidationError('Petty cash can only be issued to Inventory Store Managers or Front Desk Cashiers.');
    }

    const issueLabel = body.issueType === 'OPENING_FLOAT' ? 'Opening Float' : 'Top-Up';

    // Petty cash issued to a staff user must come FROM somewhere — the
    // hospital's Main Cash Fund (`mainFund.service.ts`). Both ledger writes
    // happen in one transaction: the recipient's `UserCashBalance` credit and
    // the fund's matching debit, linked by `relatedUserCashBalanceId` so
    // every issuance traces back to the fund entry that paid for it.
    return prisma.$transaction(async (tx) => {
      await lockMainFund(tx);
      const fundRows = await tx.mainCashFundEntry.findMany({ select: { direction: true, amount: true } });
      const fundBalance = fundRows.reduce(
        (sum, r) => (r.direction === 'IN' ? sum.plus(r.amount) : sum.minus(r.amount)),
        new Decimal(0),
      );
      if (fundBalance.lessThan(body.amount)) {
        throw new BusinessRuleError(
          `Insufficient Main Cash Fund balance — PKR ${fundBalance.toFixed(2)} available. Deposit funds into the Main Fund before issuing petty cash.`,
        );
      }

      const entry = await tx.userCashBalance.create({
        data: {
          portalUserId: target.id,
          moduleScope: resolveCashModuleScope(target.role),
          direction: 'IN',
          amount: body.amount,
          category: 'PETTY_CASH_ISSUE',
          isPhysicalCash: true,
          note: `[${issueLabel}] ${body.note}`,
          issuedById: issuedByPortalUserId,
        },
        include: { portalUser: { select: userSummarySelect } },
      });

      await tx.mainCashFundEntry.create({
        data: {
          direction: 'OUT',
          amount: body.amount,
          type: 'PETTY_CASH_ISSUE',
          note: `${issueLabel} to ${entry.portalUser.displayName || entry.portalUser.username}`,
          performedById: issuedByPortalUserId,
          relatedUserCashBalanceId: entry.id,
        },
      });

      return entry;
    });
  },
};
