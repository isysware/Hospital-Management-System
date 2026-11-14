import { Decimal } from '@prisma/client/runtime/library';

export function summarizeCashEntries(entries: { direction: string; amount: Decimal; category: string; isPhysicalCash: boolean; isSettled: boolean }[]) {
  let vendorPayments = new Decimal(0), posCashCollections = new Decimal(0), hmsCashCollections = new Decimal(0), otherCashIn = new Decimal(0), otherCashOut = new Decimal(0);
  let physicalCashIn = new Decimal(0), physicalCashOut = new Decimal(0), nonPhysicalTotal = new Decimal(0);
  let pettyCash = new Decimal(0), cashCollections = new Decimal(0), cashExpenses = new Decimal(0), cashRefunds = new Decimal(0);
  let totalCollections = new Decimal(0), totalRefunds = new Decimal(0), adjustments = new Decimal(0), remainingAmount = new Decimal(0);
  for (const e of entries) {
    // Handovers are settlement transfers, not a second expense against the same collections.
    if (e.category === 'SETTLEMENT_HANDOVER') continue;
    const signed = e.direction === 'IN' ? e.amount : e.amount.negated();
    const collection = ['POS_COLLECTION', 'HMS_COLLECTION'].includes(e.category);
    if (collection) totalCollections = totalCollections.plus(signed);
    if (e.category === 'REFUND') totalRefunds = totalRefunds.minus(signed);
    if (!e.isPhysicalCash) { nonPhysicalTotal = nonPhysicalTotal.plus(signed); continue; }
    if (!e.isSettled) remainingAmount = remainingAmount.plus(signed);
    if (e.direction === 'IN') physicalCashIn = physicalCashIn.plus(e.amount);
    else physicalCashOut = physicalCashOut.plus(e.amount);
    if (e.category === "POS_COLLECTION") posCashCollections = posCashCollections.plus(signed);
    if (e.category === "HMS_COLLECTION") hmsCashCollections = hmsCashCollections.plus(signed);
    if (!["POS_COLLECTION", "HMS_COLLECTION", "REFUND", "EXPENSE_PAYMENT", "VENDOR_PAYMENT"].includes(e.category)) {
      if (e.direction === "IN") otherCashIn = otherCashIn.plus(e.amount); else otherCashOut = otherCashOut.plus(e.amount);
    }
    if (collection) cashCollections = cashCollections.plus(signed);
    else if (e.category === 'REFUND') cashRefunds = cashRefunds.minus(signed);
    else if (['PETTY_CASH_RECEIVED', 'PETTY_CASH_ISSUED'].includes(e.category)) pettyCash = pettyCash.plus(signed);
    else if (e.category === "EXPENSE_PAYMENT") cashExpenses = cashExpenses.minus(signed);
    else if (e.category === "VENDOR_PAYMENT") vendorPayments = vendorPayments.minus(signed);
    else adjustments = adjustments.plus(signed);
  }
  return { vendorPayments, posCashCollections, hmsCashCollections, otherCashIn, otherCashOut, physicalCashIn, physicalCashOut, nonPhysicalTotal, pettyCash, cashCollections, cashExpenses, cashRefunds,
    totalCollections, totalRefunds, adjustments, remainingAmount, expectedPhysicalCash: physicalCashIn.minus(physicalCashOut),
    unsettledCount: entries.filter(e => e.isPhysicalCash && !e.isSettled).length };
}

/** Pharmacy business dates use Pakistan time, independent of the server timezone. */
export function balanceSheetRange(query: { preset?: string; fromDate?: string; toDate?: string; from?: Date; to?: Date }, now = new Date()) {
  const preset = query.preset || (query.from || query.to ? 'legacy' : 'shift');
  if (preset === 'shift') return null;
  if (preset === 'legacy') return { gte: query.from, lte: query.to, label: 'Selected period' };
  const today = new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  let from = today, to = today;
  const day = new Date(`${today}T00:00:00Z`);
  if (preset === 'yesterday') { day.setUTCDate(day.getUTCDate() - 1); from = to = day.toISOString().slice(0, 10); }
  if (preset === 'this_week') { day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7); from = day.toISOString().slice(0, 10); }
  if (preset === 'this_month') from = `${today.slice(0, 7)}-01`;
  if (preset === 'custom') { from = query.fromDate!; to = query.toDate!; }
  return { gte: new Date(`${from}T00:00:00+05:00`), lte: new Date(`${to}T23:59:59.999+05:00`), label: `${from} to ${to} (Pakistan time)` };
}
