import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { nextCode, SEQUENCE } from '@/shared/sequence';
import type { IssuePettyCashBody, BalanceSheetQuery, SubmitSettlementBody, ReviewSettlementBody, ListSettlementsQuery } from './cash.schemas';
import { balanceSheetRange, summarizeCashEntries } from './balanceSheet.util';

/**
 * pharmacy.md §11.2 Expected Cash formula, restated as a running signed
 * ledger (every CashLedgerEntry already carries direction + isPhysicalCash,
 * so "Opening + Received + Collections − Refunds − Previous Settlements ±
 * Adjustments" collapses to: sum of physical-cash entries not yet folded
 * into an accepted settlement). Simpler and structurally can't drift the
 * way hms-backend's scattered formula can (pharmacy.md §19.3).
 */
async function expectedCash(portalUserId: string, db: Prisma.TransactionClient = prisma): Promise<Decimal> {
  const entries = await db.cashLedgerEntry.findMany({
    where: { portalUserId, isPhysicalCash: true, isSettled: false },
    select: { direction: true, amount: true },
  });
  return entries.reduce((sum, e) => sum.plus(e.direction === 'IN' ? e.amount : e.amount.negated()), new Decimal(0));
}

export const cashService = {
  expectedCash,

  async issuePettyCash(body: IssuePettyCashBody, issuerId: string) {
    const receiver = await prisma.portalUser.findUnique({ where: { id: body.toUserId } });
    if (!receiver) throw new NotFoundError('Recipient user not found');
    const amount = new Decimal(body.amount);

    return prisma.$transaction(async (tx) => {
      const referenceNo = await nextCode(tx, SEQUENCE.PETTY_CASH);
      const issued = await tx.cashLedgerEntry.create({
        data: { portalUserId: issuerId, direction: 'OUT', amount, category: 'PETTY_CASH_ISSUED', referenceNo, isPhysicalCash: true, note: body.note },
      });
      const received = await tx.cashLedgerEntry.create({
        data: { portalUserId: body.toUserId, direction: 'IN', amount, category: 'PETTY_CASH_RECEIVED', isPhysicalCash: true, issuedById: issuerId, note: body.note },
      });
      return { referenceNo, issued, received };
    });
  },

  async getBalanceSheet(userId: string, query: BalanceSheetQuery, db: Prisma.TransactionClient = prisma) {
    const range = balanceSheetRange(query);
    const lastSettlement = !range ? await db.accountSettlement.findFirst({
      where: { portalUserId: userId, status: 'ACCEPTED' }, orderBy: { submittedAt: 'desc' },
    }) : null;
    const entries = await db.cashLedgerEntry.findMany({
      where: {
        portalUserId: userId,
        ...(range ? { occurredAt: { gte: range.gte, lte: range.lte } } : {
          isSettled: false,
          OR: [{ isPhysicalCash: true }, { isPhysicalCash: false, ...(lastSettlement ? { occurredAt: { gt: lastSettlement.submittedAt } } : {}) }],
        }),
      },
      orderBy: { occurredAt: 'asc' },
    });
    const activity = entries.filter(e => e.category !== 'SETTLEMENT_HANDOVER');
    const settlements = range ? await db.accountSettlement.findMany({
      where: { portalUserId: userId, status: 'ACCEPTED', reviewedAt: { gte: range.gte, lte: range.lte } },
    }) : [];
    const pendingSettlement = await db.accountSettlement.findFirst({ where: { portalUserId: userId, status: 'SUBMITTED' }, select: { id: true } });
    const referenceIds = (table: string) => activity.filter(e => e.referenceTable === table && e.referenceId).map(e => e.referenceId!);
    const [invoices, purchases, expenses, vendorPayments] = await Promise.all([
      db.pharmacyInvoice.findMany({ where: { id: { in: referenceIds('pharmacy_invoices') } }, select: { id: true, invoiceNumber: true } }),
      db.purchase.findMany({ where: { id: { in: referenceIds('purchases') } }, select: { id: true, purchaseNumber: true } }),
      db.expense.findMany({ where: { id: { in: referenceIds('expenses') } }, select: { id: true, expenseNumber: true } }),
      db.vendorLedgerEntry.findMany({ where: { id: { in: referenceIds('vendor_ledger_entries') } }, select: { id: true, referenceNo: true } }),
    ]);
    const references = new Map<string, string | null>([
      ...invoices.map(e => [e.id, e.invoiceNumber] as const), ...purchases.map(e => [e.id, e.purchaseNumber] as const),
      ...expenses.map(e => [e.id, e.expenseNumber] as const), ...vendorPayments.map(e => [e.id, e.referenceNo] as const),
    ]);
    const summary = summarizeCashEntries(activity);
    const prior = range?.gte ? await db.cashLedgerEntry.findMany({
      where: { portalUserId: userId, isPhysicalCash: true, occurredAt: { lt: range.gte } },
      select: { direction: true, amount: true },
    }) : [];
    const priorSettlements = range?.gte ? await db.accountSettlement.findMany({ where: { portalUserId: userId, status: 'ACCEPTED', reviewedAt: { lt: range.gte } }, select: { variance: true } }) : [];
    const priorVariance = priorSettlements.reduce((sum, e) => sum.plus(e.variance), new Decimal(0));
    const openingCash = prior.reduce((sum, e) => sum.plus(e.direction === 'IN' ? e.amount : e.amount.negated()), priorVariance);
    const settledAmount = settlements.reduce((sum, e) => sum.plus(e.settlementAmount), new Decimal(0));
    const settlementVarianceAdjustment = settlements.reduce((sum,e) => sum.plus(e.variance), new Decimal(0));
    const closingCash = openingCash.plus(summary.expectedPhysicalCash).minus(settledAmount).plus(settlementVarianceAdjustment);

    const byCategory = new Map<string, Decimal>();
    for (const e of entries) {
      const signed = e.direction === 'IN' ? e.amount : e.amount.negated();
      byCategory.set(e.category, (byCategory.get(e.category) ?? new Decimal(0)).plus(signed));
    }

    return {
      // Keep the legacy property live for the settlement form.
      expectedCash: range ? await expectedCash(userId, db) : summary.expectedPhysicalCash,
      breakdown: Object.fromEntries(byCategory),
      entries: activity.map(e => ({ ...e, documentReference: e.referenceNo || references.get(e.referenceId || '') || null })),
      period: { mode: range ? 'period' : 'shift', label: range?.label || 'Current Shift (unsettled)' },
      pendingSettlement: Boolean(pendingSettlement),
      summary: {
        ...summary,
        openingCash, closingCash,
        settlementCount: settlements.length,
        settledAmount: settlements.reduce((s, e) => s.plus(e.settlementAmount ?? 0), new Decimal(0)),
        physicalCashCounted: settlements.reduce((s, e) => s.plus(e.physicalCash), new Decimal(0)),
        variance: settlements.reduce((s, e) => s.plus(e.variance), new Decimal(0)),
      },
    };
  },

  /** pharmacy.md §11.2 — Expected Cash is read-only/system-calculated; user only supplies Physical Cash. */
  async submitSettlement(userId: string, body: SubmitSettlementBody) {
    const expected = await expectedCash(userId);
    const physical = new Decimal(body.physicalCash);
    const variance = physical.minus(expected);
    if (!variance.equals(0) && !body.varianceReason) {
      throw new ValidationError('A non-zero variance requires a reason');
    }

    return prisma.$transaction(async (tx) => {
      const settlementNumber = await nextCode(tx, SEQUENCE.SETTLEMENT);
      return tx.accountSettlement.create({
        data: {
          settlementNumber,
          portalUserId: userId,
          periodFrom: body.periodFrom,
          periodTo: body.periodTo,
          expectedCash: expected,
          physicalCash: physical,
          variance,
          varianceReason: body.varianceReason,
          status: 'SUBMITTED',
        },
      });
    });
  },

  async reviewSettlement(id: string, body: ReviewSettlementBody, reviewerId: string) {
    const settlement = await prisma.accountSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundError('Settlement not found');
    if (settlement.status !== 'SUBMITTED') throw new ConflictError('This settlement has already been reviewed');

    return prisma.$transaction(async (tx) => {
      if (body.decision === 'ACCEPTED') {
        // Fold every physical-cash entry that existed as of submission into it — Expected Cash resets to 0 going
        // forward. Must use `submittedAt` (a precise timestamp), not `periodTo` (a date-only audit-period label):
        // `periodTo` parses to midnight UTC of that date, which would exclude every entry from later that same day —
        // exactly the entries `submitSettlement`'s `expectedCash()` total already included with no date filter at
        // all. Using periodTo here left same-day cash permanently unsettled even after approval.
        await tx.cashLedgerEntry.updateMany({
          where: { portalUserId: settlement.portalUserId, isPhysicalCash: true, isSettled: false, occurredAt: { lte: settlement.submittedAt } },
          data: { isSettled: true },
        });
        await tx.cashLedgerEntry.create({
          data: { portalUserId: settlement.portalUserId, direction: 'OUT', amount: settlement.physicalCash, category: 'SETTLEMENT_HANDOVER', isPhysicalCash: true, isSettled: true, note: body.note },
        });
      }
      return tx.accountSettlement.update({
        where: { id },
        data: { status: body.decision, reviewedById: reviewerId, reviewedAt: new Date(), settlementAmount: body.decision === 'ACCEPTED' ? settlement.physicalCash : 0 },
      });
    });
  },

  async listSettlements(query: ListSettlementsQuery) {
    return prisma.accountSettlement.findMany({
      where: { portalUserId: query.userId, status: query.status },
      include: { submittedByUser: { select: { id: true, fullName: true, username: true } }, reviewedByUser: { select: { id: true, fullName: true } } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
  },
};
