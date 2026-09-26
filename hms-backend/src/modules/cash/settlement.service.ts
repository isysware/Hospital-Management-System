import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { ValidationError } from '@/shared/errors/AppError';
import type { SubmitSettlementBody } from './settlement.schemas';
import type { MySettlementsQuery } from './financeControl.schemas';
import { resolveDateRange } from '@/modules/reports/dashboard.service';

/**
 * My Account Settlement (HMS_V7.2_NEW_REQUIREMENTS.md §3.3; Balance Sheet &
 * Account Settlement Guide §5.1) — closes out a cashier's shift: every
 * currently-unsettled `UserCashBalance` row (the same ledger
 * `cashService.getCashierBalanceSheet` reads) is bundled into one
 * `AccountSettlement` and flips `isSettled = true` — a transaction, once
 * accounted for in a settlement, is never left dangling or arbitrarily
 * picked apart.
 *
 * A cash SHORTFALL doesn't vanish, though: `carryForwardAmount` records
 * exactly what's still owed as a pure liability figure (not tied to any
 * specific transaction row), and the next call to this function — or to
 * `cashService.getCashierBalanceSheet` — folds the most recent settlement's
 * `carryForwardAmount` back into `expectedCash`, so it keeps showing up
 * until it's actually paid down. This is deliberately NOT the same thing as
 * an "Opening Float" (a fixed till amount handed to a cashier at shift
 * start) — that's a separate, not-yet-built feature.
 *
 * Scoped to `moduleScope: 'BILLING'` — the only scope a Front Desk cashier
 * ever writes to.
 */
export const settlementService = {
  async submitSettlement(portalUserId: string, body: SubmitSettlementBody) {
    return prisma.$transaction(async (tx) => {
      const [unsettled, previousSettlement] = await Promise.all([
        tx.userCashBalance.findMany({
          where: { portalUserId, isSettled: false },
          orderBy: { occurredAt: 'asc' },
        }),
        // The most recent non-reversed settlement carries this user's
        // current outstanding liability forward — a reversal already
        // re-opens its linked rows (`financeControlService.reverseSettlement`),
        // so a reversed settlement's carry-forward must never be counted.
        tx.accountSettlement.findFirst({
          where: { portalUserId, moduleScope: 'BILLING', status: { not: 'REVERSED' } },
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
          moduleScope: 'BILLING',
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
  },

  /** reporting.md §2 #9 — own settlement history, filterable by From/To (settlement creation) and Settlement Status. */
  async listMySettlements(portalUserId: string, query?: MySettlementsQuery) {
    const range =
      query && query.preset !== 'all'
        ? resolveDateRange({ preset: query.preset as Exclude<MySettlementsQuery['preset'], 'all'>, fromDate: query.fromDate, toDate: query.toDate })
        : null;
    return prisma.accountSettlement.findMany({
      where: {
        portalUserId,
        ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
        ...(query?.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: range || query?.status ? 500 : 50,
    });
  },
};
