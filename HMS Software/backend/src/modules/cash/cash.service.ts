import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { resolveDateRange } from '@/modules/reports/dashboard.service';
import { resolveCashModuleScope } from './moduleScope.util';
import type { MyBalanceSheetQuery } from './financeControl.schemas';

export const cashService = {
  /**
   * Cashier Balance Sheet — §4.9, §8.12, D04 p.2–3
   * Computes opening float, cash collections, non-cash collections, refunds,
   * and net expected physical cash for the logged-in cashier.
   *
   * reporting.md §2 #8 — `preset: 'shift'` (default) is the live, unsettled
   * custody the cashier settles next. Any other preset (Day / Week / Month /
   * Custom) is a read-only historical view over every ledger entry in that
   * range, settled or not, plus the settlements submitted in it.
   */
  async getCashierBalanceSheet(portalUserId: string, query?: MyBalanceSheetQuery) {
    const isShift = !query || query.preset === 'shift';
    const range = isShift ? null : resolveDateRange({ preset: query.preset as Exclude<MyBalanceSheetQuery['preset'], 'shift'>, fromDate: query.fromDate, toDate: query.toDate });

    // Resolve scope from the TARGET user's own role, not the caller's — an
    // Admin/Super Admin viewing someone else's sheet via `getUserBalanceSheet`
    // must still see that user's real module (inventory.md §9 step 2).
    const targetUser = await prisma.portalUser.findUniqueOrThrow({
      where: { id: portalUserId },
      select: { role: true },
    });
    const moduleScope = resolveCashModuleScope(targetUser.role);
    const isManager = targetUser.role === 'ADMIN' || targetUser.role === 'SUPER_ADMIN';
    const scopeFilter = isManager ? {} : { moduleScope };

    // Shift view: unsettled entries plus the current carry-forward liability
    // (Balance Sheet & Account Settlement Guide §5.1) — the most recent
    // non-reversed settlement's `carryForwardAmount`, same lookup
    // `settlementService.submitSettlement` uses for the next expected cash.
    const [transactions, previousSettlement, periodSettlements] = await Promise.all([
      prisma.userCashBalance.findMany({
        where: {
          portalUserId,
          ...scopeFilter,
          ...(range ? { occurredAt: { gte: range.start, lte: range.end } } : { isSettled: false }),
        },
        include: {
          paymentReceipt: {
            include: {
              hospitalInvoice: {
                select: { invoiceNumber: true, status: true },
              },
            },
          },
        },
        orderBy: { occurredAt: 'desc' },
      }),
      isShift
        ? prisma.accountSettlement.findFirst({
            where: { portalUserId, ...scopeFilter, status: { not: 'REVERSED' } },
            orderBy: { createdAt: 'desc' },
            select: { carryForwardAmount: true },
          })
        : Promise.resolve(null),
      range
        ? prisma.accountSettlement.findMany({
            where: { portalUserId, ...scopeFilter, status: { not: 'REVERSED' }, createdAt: { gte: range.start, lte: range.end } },
            select: { physicalCash: true, variance: true },
          })
        : Promise.resolve([]),
    ]);

    let physicalCashIn = new Decimal(0);
    let physicalCashOut = new Decimal(0);
    let nonPhysicalTotal = new Decimal(0);
    let totalCollections = new Decimal(0);
    let totalRefunds = new Decimal(0);
    // Spec line items (reporting.md §2 #8) — physical cash only.
    let pettyCash = new Decimal(0);
    let cashCollections = new Decimal(0);
    let cashExpenses = new Decimal(0);
    let cashRefunds = new Decimal(0);
    let settlementCashIn = new Decimal(0);
    let settlementCashOut = new Decimal(0);
    let settledNet = new Decimal(0);
    let remainingNet = new Decimal(0);

    for (const tx of transactions) {
      if (tx.isPhysicalCash) {
        const signed = tx.direction === 'IN' ? tx.amount : tx.amount.negated();
        if (tx.isSettled) settledNet = settledNet.plus(signed);
        else remainingNet = remainingNet.plus(signed);
        if (tx.category === 'SALARY_PAYMENT' || tx.category === 'COMMISSION_PAYMENT') cashExpenses = cashExpenses.minus(signed);

        if (tx.direction === 'IN') {
          physicalCashIn = physicalCashIn.plus(tx.amount);
          if (tx.category === 'COLLECTION') {
            totalCollections = totalCollections.plus(tx.amount);
            cashCollections = cashCollections.plus(tx.amount);
          } else if (tx.category === 'PETTY_CASH_ISSUE') {
            pettyCash = pettyCash.plus(tx.amount);
          } else if ((tx.category === 'RECOVERY' || tx.category === 'PHARMACY_SETTLEMENT')) {
            settlementCashIn = settlementCashIn.plus(tx.amount);
          }
        } else {
          physicalCashOut = physicalCashOut.plus(tx.amount);
          if (tx.category === 'REFUND') {
            totalRefunds = totalRefunds.plus(tx.amount);
            cashRefunds = cashRefunds.plus(tx.amount);
          } else if (tx.category === 'EXPENSE') {
            cashExpenses = cashExpenses.plus(tx.amount);
          } else if ((tx.category === 'RECOVERY' || tx.category === 'PHARMACY_SETTLEMENT')) {
            settlementCashOut = settlementCashOut.plus(tx.amount);
          }
        }
      } else {
        // Digital (Card/Bank/Online): tracked separately without inflating physical cash
        nonPhysicalTotal = nonPhysicalTotal.plus(tx.direction === 'IN' ? tx.amount : tx.amount.negated());
        if (tx.category === 'COLLECTION') totalCollections = totalCollections.plus(tx.amount);
        else if (tx.category === 'REFUND') totalRefunds = totalRefunds.plus(tx.amount);
      }
    }

    const carriedForwardAmount = previousSettlement?.carryForwardAmount ?? new Decimal(0);
    const expectedPhysicalCash = physicalCashIn.minus(physicalCashOut).plus(carriedForwardAmount);

    return {
      portalUserId,
      period: range ? { mode: 'period' as const, label: range.label } : { mode: 'shift' as const, label: 'Current Shift (unsettled)' },
      summary: {
        expectedPhysicalCash,
        carriedForwardAmount,
        physicalCashIn,
        physicalCashOut,
        nonPhysicalTotal,
        totalCollections,
        totalRefunds,
        unsettledCount: transactions.filter((t) => !t.isSettled).length,
        pettyCash,
        cashCollections,
        cashExpenses,
        cashRefunds,
        settlementCashIn,
        settlementCashOut,
        settledAmount: settledNet,
        remainingAmount: remainingNet.plus(carriedForwardAmount),
        // Only meaningful for a historical period — the counted cash and
        // variance come from settlements submitted inside that period.
        settlementCount: periodSettlements.length,
        physicalCashCounted: periodSettlements.reduce((s, p) => s.plus(p.physicalCash), new Decimal(0)),
        variance: periodSettlements.reduce((s, p) => s.plus(p.variance), new Decimal(0)),
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        direction: t.direction,
        amount: t.amount,
        category: t.category,
        isPhysicalCash: t.isPhysicalCash,
        isSettled: t.isSettled,
        occurredAt: t.occurredAt,
        paymentAccount: t.paymentReceipt?.paymentAccount ?? null,
        receiptNumber: t.paymentReceipt?.receiptNumber ?? ((t.category === 'RECOVERY' || t.category === 'PHARMACY_SETTLEMENT') ? 'SETTLEMENT' : null),
        invoiceNumber: t.paymentReceipt?.hospitalInvoice?.invoiceNumber ?? null,
        paymentMethod: t.paymentReceipt?.method ?? (t.isPhysicalCash ? 'CASH' : 'NON_CASH'),
        note: t.note,
      })),
    };
  },
};
