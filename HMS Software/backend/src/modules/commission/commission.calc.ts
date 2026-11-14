import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';

export function commissionDepartmentFilter(departmentId: string): Prisma.InvoiceLineItemWhereInput {
  return { OR: [
    { serviceRate: { departmentId } },
    { hospitalInvoice: { departmentId }, OR: [{ serviceRateId: null }, { serviceRate: { departmentId: null } }] },
  ] };
}

/** All consumers use the original rule snapshot, never today's edited rule. */
export function commissionBalance(row: {
  commissionAmount: Decimal;
  ruleSnapshot: unknown;
  reversals: { reversalAmount: Decimal; source?: string; taxAmount?: Decimal | null }[];
  payouts: { amount: Decimal }[];
  adjustments?: { amount: Decimal }[];
}) {
  const snapshot = (row.ruleSnapshot ?? {}) as Record<string, unknown>;
  const gross = row.commissionAmount;
  const priceChanges = row.reversals.filter(r => r.source === 'SERVICE_REPRICE').reduce((s, r) => s.plus(r.reversalAmount), new Decimal(0));
  const serviceGross = Decimal.max(gross.minus(priceChanges), 0);
  const refunds = Decimal.min(serviceGross, row.reversals.filter(r => r.source !== 'SERVICE_REPRICE').reduce((s, r) => s.plus(r.reversalAmount), new Decimal(0)));
  const reversed = priceChanges.plus(refunds);
  const earned = serviceGross.minus(refunds);
  const originalTax = new Decimal(String(snapshot.commissionTaxAmount ?? 0));
  // A reversal reverses its share of the original withholding as well.
  const serviceTax = snapshot.collectionBased ? originalTax : snapshot.commissionTaxMethod === 'PERCENTAGE'
    ? serviceGross.mul(String(snapshot.commissionTaxValue ?? 0)).div(100)
    : Decimal.min(serviceGross, originalTax);
  const explicit = row.reversals.filter(r => r.taxAmount != null);
  const implicit = Decimal.max(0, refunds.minus(explicit.reduce((s, r) => s.plus(r.reversalAmount), new Decimal(0))));
  const tax = Decimal.max(0, serviceTax.minus(explicit.reduce((s, r) => s.plus(r.taxAmount!), new Decimal(0)))
    .minus(serviceGross.gt(0) ? serviceTax.mul(implicit).div(serviceGross) : serviceTax)).toDecimalPlaces(2);
  const adjustments = (row.adjustments ?? []).reduce((s, r) => s.plus(r.amount), new Decimal(0));
  const payable = Decimal.max(earned.minus(tax).plus(adjustments), 0).toDecimalPlaces(2);
  const paid = row.payouts.reduce((s, p) => s.plus(p.amount), new Decimal(0));
  const remaining = Decimal.max(payable.minus(paid), 0);
  const overpaid = Decimal.max(paid.minus(payable), 0);
  return { gross, reversed, tax, adjustments, payable, paid, remaining, overpaid };
}

/** Period activity and carried liabilities use the same statement calculator. */
export function commissionPeriodBalance(row: Omit<Parameters<typeof commissionBalance>[0], 'reversals' | 'payouts' | 'adjustments'> & {
  periodStart: Date;
  collectionEvent?: { occurredAt: Date } | null;
  reversals: { reversalAmount: Decimal; source?: string; taxAmount?: Decimal | null; reversedAt: Date }[];
  payouts: { amount: Decimal; paidAt: Date }[];
  adjustments: { amount: Decimal; createdAt: Date }[];
}, start: Date, end: Date) {
  const recognizedAt = row.collectionEvent?.occurredAt ?? row.periodStart;
  const asOf = (date: Date) => commissionBalance({ ...row,
    commissionAmount: recognizedAt <= date ? row.commissionAmount : new Decimal(0),
    reversals: row.reversals.filter(r => r.reversedAt <= date), payouts: row.payouts.filter(p => p.paidAt <= date),
    adjustments: row.adjustments.filter(a => a.createdAt <= date),
  });
  const closing = asOf(end), opening = asOf(new Date(start.getTime() - 1));
  return { ...closing, generated: closing.payable.minus(opening.payable),
    periodGross: closing.gross.minus(opening.gross), periodTax: closing.tax.minus(opening.tax),
    periodReversed: closing.reversed.minus(opening.reversed), periodAdjustments: closing.adjustments.minus(opening.adjustments),
    periodPaid: closing.paid.minus(opening.paid) };
}
