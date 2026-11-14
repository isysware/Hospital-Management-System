import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { allocateInvoiceLines, signedReceiptWhere } from '@/shared/departmentCollections';
import { commissionBalance } from './commission.calc';
import { ConflictError } from '@/shared/errors/AppError';

type Snapshot = Record<string, any>;
const zero = () => new Decimal(0);
const day = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Contract amount is capped by the proportion of the net service actually collected.
 * Gross-basis discounts remain contractual; neither tax nor invoice outstanding is cash. */
export function collectedCommission(rule: Snapshot, line: { lineNet: Decimal; lineGross: Decimal; quantity: Decimal }, collected: Decimal) {
  const ratio = line.lineNet.gt(0) ? Decimal.min(1, Decimal.max(0, collected).div(line.lineNet)) : zero();
  const contracted = rule.ruleType === 'FIXED_PER_SERVICE' ? new Decimal(rule.rate).times(line.quantity)
    : (rule.basis === 'GROSS' ? line.lineGross : line.lineNet).times(rule.rate).div(100);
  const gross = contracted.times(ratio).toDecimalPlaces(2);
  const fullTax = Decimal.min(contracted, rule.commissionTaxMethod === 'PERCENTAGE'
    ? contracted.times(rule.commissionTaxValue ?? 0).div(100)
    : rule.commissionTaxMethod === 'FIXED' ? new Decimal(rule.commissionTaxValue ?? 0) : zero());
  return { gross, tax: Decimal.min(gross, fullTax.times(ratio)).toDecimalPlaces(2) };
}

/** One line lock serializes receipt callbacks, service changes and commission generation.
 * The journal is append-only. Positive deltas get independently approvable run lines;
 * negative deltas reference existing statements, including already-paid statements. */
export async function syncLineCollections(tx: Prisma.TransactionClient, lineId: string, actorId: string) {
  await tx.$queryRaw`SELECT id FROM invoice_line_items WHERE id = ${lineId} FOR UPDATE`;
  const line = await tx.invoiceLineItem.findUniqueOrThrow({ where: { id: lineId }, include: {
    hospitalInvoice: { include: {
      department: { select: { id: true, name: true } },
      lines: { include: { serviceRate: { select: { department: { select: { id: true, name: true } } } } } },
      paymentReceipts: { where: signedReceiptWhere, orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }] },
      panelRemittanceAllocations: { include: { panelRemittance: true } },
    } },
  } });
  const contract = await tx.commissionCollectionEvent.findUnique({ where: { sourceKey: `CONTRACT:${lineId}` } });
  if (!contract) return null;
  const rule = contract.ruleSnapshot as Snapshot;
  const invoice = line.hospitalInvoice;
  const eligible = !['PHARMACY', 'ROOM_BED'].includes(line.billingSource) && line.isCompleted && invoice.status !== 'VOID' && line.performedByStaffId === rule.staffId;
  const events = [
    ...invoice.paymentReceipts.map(r => ({ key: `RECEIPT:${r.id}`, amount: r.amount, at: r.collectedAt, basis: 'patientShare' as const })),
    ...invoice.panelRemittanceAllocations.map(a => ({ key: `PANEL:${a.id}`, amount: a.allocatedAmount, at: a.panelRemittance.receivedAt, basis: 'panelReceivable' as const })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
  const postedReceipts = await tx.commissionCollectionEvent.findMany({ where: {
    invoiceLineItemId: lineId, OR: [
      { sourceKey: { startsWith: `${lineId}:RECEIPT:` } }, { sourceKey: { startsWith: `${lineId}:PANEL:` } },
    ],
  }, select: { sourceKey: true, occurredAt: true } });
  const postedKeys = new Set(postedReceipts.map(event => event.sourceKey));
  const lastReceiptTime = Math.max(0, ...postedReceipts.map(event => event.occurredAt.getTime()));
  if (events.some(event => !postedKeys.has(`${lineId}:${event.key}`)
    && Math.max(event.at.getTime(), line.createdAt.getTime()) < lastReceiptTime)) {
    throw new ConflictError('This backdated collection precedes an existing commission posting. A reviewed historical commission correction is required; no receipt or commission changes were committed.');
  }
  let patient = zero(), panel = zero();
  const allocated = () => {
    // A panel guarantee alone is not collection. Never allocate patient receipts to
    // fully panel-covered lines (legacy invoices without coverage use net weights).
    const hasCoverage = invoice.lines.some(l => l.panelReceivable.gt(0));
    const share = (amount: Decimal, basis: 'patientShare' | 'panelReceivable') => {
      const capacity = invoice.lines.reduce((s, l) => s.plus(hasCoverage ? l[basis] : basis === 'patientShare' ? l.lineNet : 0), zero());
      if (!capacity.gt(0)) return zero();
      return allocateInvoiceLines(Decimal.min(capacity, Decimal.max(0, amount)), invoice, basis).find(a => a.id === line.id)?.amount ?? zero();
    };
    return share(patient, 'patientShare').plus(share(panel, 'panelReceivable'));
  };
  const post = async (key: string, at: Date, collected: Decimal, baseline = false) => {
    const sourceKey = `${lineId}:${key}`;
    if (await tx.commissionCollectionEvent.findUnique({ where: { sourceKey } })) return;
    const rows = await tx.doctorCommissionAccrual.findMany({ where: { invoiceLineItemId: lineId }, include: { collectionEvent: true, reversals: true, payouts: true, adjustments: true }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] });
    rows.sort((a, b) => (b.collectionEvent?.occurredAt ?? b.periodStart).getTime() - (a.collectionEvent?.occurredAt ?? a.periodStart).getTime());
    const earned = rows.reduce((s, row) => s.plus(commissionBalance(row).gross.minus(commissionBalance(row).reversed)), zero());
    const tax = rows.reduce((s, row) => s.plus(commissionBalance(row).tax), zero());
    const target = eligible ? collectedCommission(rule, line, collected) : { gross: zero(), tax: zero() };
    const delta = baseline ? zero() : target.gross.minus(earned);
    if (key.startsWith('STATE:') && delta.isZero() && target.tax.equals(tax)) return;
    const event = await tx.commissionCollectionEvent.create({ data: {
      sourceKey, invoiceLineItemId: lineId, occurredAt: at, collectedAmount: collected,
      commissionAmount: delta, ruleSnapshot: { ...rule, source: key, targetCommission: target.gross.toNumber(), targetTax: target.tax.toNumber() },
    } });
    if (baseline) return;
    if (delta.gt(0)) {
      await tx.doctorCommissionAccrual.create({ data: {
        staffId: rule.staffId, invoiceLineItemId: lineId, collectionEventId: event.id,
        periodType: 'DAILY', periodStart: day(at), periodEnd: day(at), commissionAmount: delta,
        ruleSnapshot: { ...rule, collectionBased: true, commissionAmount: delta.toNumber(), commissionTaxAmount: Decimal.max(0, target.tax.minus(tax)).toNumber(),
          collectedAmount: collected.toNumber(), collectionSource: key, collectedAt: at.toISOString(), postedById: actorId },
      } });
    } else if (delta.lt(0)) {
      let remaining = delta.negated(), taxRemaining = Decimal.max(0, tax.minus(target.tax));
      for (const row of rows) {
        const balance = commissionBalance(row);
        const available = balance.gross.minus(balance.reversed);
        const reversal = Decimal.min(remaining, available);
        if (!reversal.gt(0)) continue;
        const reversedTax = Decimal.min(taxRemaining, balance.tax,
          remaining.equals(reversal) ? taxRemaining : balance.tax.times(reversal).div(available).toDecimalPlaces(2));
        await tx.commissionReversal.create({ data: {
          doctorCommissionAccrualId: row.id, collectionEventId: event.id, reversalAmount: reversal, taxAmount: reversedTax,
          source: 'COLLECTION', reason: `Collection reconciliation: ${key}`, reversedById: actorId, reversedAt: at,
        } });
        remaining = remaining.minus(reversal); taxRemaining = taxRemaining.minus(reversedTax);
      }
    }
    // Cumulative rounding (and fixed withholding) can leave a tax-only cent.
    // Record that cent explicitly, rather than taxing each receipt independently.
    const closingRows = await tx.doctorCommissionAccrual.findMany({ where: { invoiceLineItemId: lineId }, include: { reversals: true, payouts: true, adjustments: true } });
    let taxCorrection = closingRows.reduce((sum, row) => sum.plus(commissionBalance(row).tax), zero()).minus(target.tax);
    for (const row of closingRows) {
      if (taxCorrection.isZero()) break;
      const balance = commissionBalance(row);
      const capacity = taxCorrection.gt(0) ? balance.tax : balance.gross.minus(balance.reversed).minus(balance.tax);
      const amount = Decimal.min(taxCorrection.abs(), Decimal.max(0, capacity)).times(taxCorrection.gt(0) ? 1 : -1);
      if (amount.isZero()) continue;
      await tx.commissionReversal.create({ data: {
        doctorCommissionAccrualId: row.id, collectionEventId: event.id, reversalAmount: 0, taxAmount: amount,
        source: 'COLLECTION_TAX', reason: `Collection withholding reconciliation: ${key}`, reversedById: actorId, reversedAt: at,
      } });
      taxCorrection = taxCorrection.minus(amount);
    }
    if (!taxCorrection.isZero()) throw new ConflictError('Commission withholding could not reconcile; review the service contract.');
  };
  // A legacy statement is retained verbatim. Mark its existing receipts as the
  // opening ledger and append only a current correction/recovery, never re-accrue them.
  const legacy = rule.legacy === true;
  const openingIds = new Set<string>(rule.openingSources ?? []);
  for (const event of events) {
    if (event.basis === 'patientShare') patient = patient.plus(event.amount); else panel = panel.plus(event.amount);
    await post(event.key, new Date(Math.max(event.at.getTime(), line.createdAt.getTime())), allocated(), legacy && openingIds.has(event.key));
  }
  const state = createHash('sha256').update(JSON.stringify({
    receipts: events.map(e => [e.key, e.amount.toString()]), net: line.lineNet.toString(), gross: line.lineGross.toString(),
    quantity: line.quantity.toString(), eligible, allocations: invoice.lines.map(l => [l.id, l.lineNet.toString(), l.patientShare.toString(), l.panelReceivable.toString()]).sort(),
  })).digest('hex');
  const revision = await tx.commissionCollectionEvent.count({ where: { invoiceLineItemId: lineId } });
  await post(`STATE:${state}:${revision}`, new Date(), allocated());
  return tx.doctorCommissionAccrual.findFirst({ where: { invoiceLineItemId: lineId }, orderBy: { createdAt: 'desc' } });
}
