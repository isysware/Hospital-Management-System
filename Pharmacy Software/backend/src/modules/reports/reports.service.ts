import { prisma } from '@/db/client';
import { ValidationError } from '@/shared/errors/AppError';
import type { ReportQuery } from './reports.schemas';

const ROW_LIMIT = 500;

/** Inclusive `to` — a date-only `to` from the query should still capture that whole day. */
function endOfDayIfDateOnly(to?: Date) {
  if (!to) return undefined;
  if (to.getUTCHours() === 0 && to.getUTCMinutes() === 0 && to.getUTCSeconds() === 0) {
    return new Date(to.getTime() + 86_400_000 - 1);
  }
  return to;
}

function dateRange(query: ReportQuery) {
  const to = endOfDayIfDateOnly(query.to);
  if (query.from && to) return { gte: query.from, lte: to };
  if (query.from) return { gte: query.from };
  if (to) return { lte: to };
  return undefined;
}

/** pharmacy.md §14 — every row carries the real actor (Sold/Dispensed/Entered/Paid/Approved By), never just "Pharmacy". */
export const reportsService = {
  async run(query: ReportQuery) {
    const range = dateRange(query);
    switch (query.type) {
      case 'SALES_COLLECTION':
        return salesCollection(range);
      case 'HMS_DISPENSE':
        return hmsDispense(range);
      case 'PURCHASE':
        return purchase(range);
      case 'STOCK_MOVEMENT':
        return stockMovement(range);
      case 'VENDOR_LEDGER':
        return vendorLedger(range);
      case 'EXPENSE':
        return expense(range);
      case 'RETURN_REFUND':
        return returnRefund(range);
      case 'BALANCE_SETTLEMENT':
        return balanceSettlement(range);
      default:
        throw new ValidationError(`Unknown report type`);
    }
  },
};

async function salesCollection(range?: { gte?: Date; lte?: Date }) {
  const invoices = await prisma.pharmacyInvoice.findMany({
    where: { createdAt: range },
    include: {
      dispensedByUser: { select: { fullName: true, role: true } },
      payments: { include: { collectedByUser: { select: { fullName: true } } } },
      lines: { select: { returnedQuantity: true, returnedValue: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: ROW_LIMIT,
  });

  const refunds = await prisma.cashLedgerEntry.findMany({
    where: { category: 'REFUND', occurredAt: range },
    select: { amount: true },
  });
  const totalRefundAmount = sumDecimal(refunds.map((r) => r.amount));

  const rows = invoices.map((inv) => {
    const totalReturnedVal = inv.lines.reduce((s, l) => s + Number(l.returnedValue || 0), 0);
    return {
      invoiceNumber: inv.invoiceNumber,
      channel: inv.channel,
      customerName: inv.customerName,
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      taxTotal: inv.taxTotal,
      total: inv.total,
      paidTotal: inv.paidTotal,
      returnedTotal: totalReturnedVal,
      outstanding: inv.outstanding,
      status: inv.status,
      soldBy: inv.dispensedByUser.fullName,
      collectedBy: [...new Set(inv.payments.map((p) => p.collectedByUser.fullName))].join(', ') || null,
      createdAt: inv.createdAt,
    };
  });

  const totals = {
    total: sumDecimal(invoices.map((i) => i.total)),
    paidTotal: sumDecimal(invoices.map((i) => i.paidTotal)),
    totalRefunded: totalRefundAmount,
    netCollected: sumDecimal(invoices.map((i) => i.paidTotal)) - totalRefundAmount,
    outstanding: sumDecimal(invoices.map((i) => i.outstanding)),
  };
  return { rows, totals };
}

async function hmsDispense(range?: { gte?: Date; lte?: Date }) {
  const requests = await prisma.medicineRequest.findMany({
    where: { requestedAt: range },
    include: {
      lines: { include: { medicine: { select: { name: true, code: true } } } },
      invoice: { select: { invoiceNumber: true, total: true, paidTotal: true, outstanding: true, clearanceStatus: true } },
      handledByUser: { select: { fullName: true } },
    },
    orderBy: { requestedAt: 'desc' },
    take: ROW_LIMIT,
  });
  const rows = requests.map((r) => ({
    requestNumber: r.requestNumber,
    admissionRef: r.externalAdmissionRef,
    patientName: r.patientNameSnapshot,
    medicines: r.lines.map((l) => `${l.medicine.name} (req ${l.requestedQuantity}, disp ${l.dispensedQuantity})`).join('; '),
    status: r.status,
    requestedByExternal: r.requestedByExternal,
    dispensedBy: r.handledByUser?.fullName ?? null,
    invoiceNumber: r.invoice?.invoiceNumber ?? null,
    invoiceTotal: r.invoice?.total ?? null,
    outstanding: r.invoice?.outstanding ?? null,
    clearanceStatus: r.invoice?.clearanceStatus ?? null,
    requestedAt: r.requestedAt,
  }));
  return { rows, totals: null };
}

async function purchase(range?: { gte?: Date; lte?: Date }) {
  const purchases = await prisma.purchase.findMany({
    where: { purchaseDate: range },
    include: { vendor: { select: { name: true, code: true } }, createdByUser: { select: { fullName: true } } },
    orderBy: { purchaseDate: 'desc' },
    take: ROW_LIMIT,
  });
  const rows = purchases.map((p) => ({
    purchaseNumber: p.purchaseNumber,
    vendor: p.vendor.name,
    purchaseDate: p.purchaseDate,
    vendorInvoiceNo: p.vendorInvoiceNo,
    paymentType: p.paymentType,
    total: p.total,
    paidNow: p.paidNow,
    vendorDue: p.vendorDue,
    status: p.status,
    receivedBy: p.createdByUser.fullName,
  }));
  const totals = { total: sumDecimal(purchases.map((p) => p.total)), paidNow: sumDecimal(purchases.map((p) => p.paidNow)), vendorDue: sumDecimal(purchases.map((p) => p.vendorDue)) };
  return { rows, totals };
}

async function stockMovement(range?: { gte?: Date; lte?: Date }) {
  const entries = await prisma.stockLedgerEntry.findMany({
    where: { createdAt: range },
    include: { medicine: { select: { name: true, code: true } }, batch: { select: { batchNumber: true } }, actor: { select: { fullName: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: ROW_LIMIT,
  });
  const rows = entries.map((e) => ({
    itemCode: e.medicine.code,
    medicine: e.medicine.name,
    batch: e.batch?.batchNumber ?? null,
    movementType: e.movementType,
    quantityDelta: e.quantityDelta,
    note: e.note,
    performedBy: e.actor.fullName,
    createdAt: e.createdAt,
  }));
  return { rows, totals: null };
}

async function vendorLedger(range?: { gte?: Date; lte?: Date }) {
  const entries = await prisma.vendorLedgerEntry.findMany({
    where: { createdAt: range },
    include: { vendor: { select: { name: true, code: true } }, actor: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: ROW_LIMIT,
  });
  const rows = entries.map((e) => ({
    vendor: e.vendor.name,
    entryType: e.entryType,
    amount: e.amount,
    description: e.description,
    actor: e.actor.fullName,
    createdAt: e.createdAt,
  }));
  const totals = { amount: sumDecimal(entries.map((e) => e.amount)) };
  return { rows, totals };
}

async function expense(range?: { gte?: Date; lte?: Date }) {
  const expenses = await prisma.expense.findMany({
    where: { date: range },
    include: { enteredByUser: { select: { fullName: true } }, approvedByUser: { select: { fullName: true } } },
    orderBy: { date: 'desc' },
    take: ROW_LIMIT,
  });
  const rows = expenses.map((e) => ({
    category: e.category,
    date: e.date,
    amount: e.amount,
    paymentMethod: e.paymentMethod,
    payeeOrVendor: e.payeeOrVendor,
    description: e.description,
    enteredBy: e.enteredByUser.fullName,
    approvedBy: e.approvedByUser?.fullName ?? null,
  }));
  const totals = { amount: sumDecimal(expenses.map((e) => e.amount)) };
  return { rows, totals };
}

async function returnRefund(range?: { gte?: Date; lte?: Date }) {
  const refunds = await prisma.cashLedgerEntry.findMany({
    where: { category: 'REFUND', occurredAt: range },
    include: { portalUser: { select: { fullName: true } } },
    orderBy: { occurredAt: 'desc' },
    take: ROW_LIMIT,
  });

  const invoiceIds = refunds
    .filter((r) => r.referenceTable === 'pharmacy_invoices' && r.referenceId)
    .map((r) => r.referenceId as string);

  const invoices = invoiceIds.length > 0
    ? await prisma.pharmacyInvoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, invoiceNumber: true, customerName: true },
      })
    : [];
  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

  const salesReturnRows = refunds.map((r) => {
    const inv = r.referenceId ? invoiceMap.get(r.referenceId) : null;
    return {
      type: 'Sales Return',
      returnNumber: r.referenceNo ?? '—',
      returnReferenceNo: r.referenceNo ?? '—',
      originalRef: inv?.invoiceNumber ?? '—',
      invoiceNumber: inv?.invoiceNumber ?? '—',
      party: inv?.customerName ?? 'Walk-In Customer',
      customerName: inv?.customerName ?? 'Walk-In Customer',
      refundAmount: r.amount,
      amount: r.amount,
      isPhysicalCash: r.isPhysicalCash,
      paymentMethod: r.isPhysicalCash ? 'CASH' : 'NON_CASH',
      reason: r.note ? r.note.replace(/^RET-\d+:\s*/, '') : 'Sales Return Refund',
      processedBy: r.portalUser?.fullName ?? 'Pharmacy Staff',
      createdAt: r.occurredAt,
      occurredAt: r.occurredAt,
    };
  });

  // Also include Vendor Returns (Purchase Returns) if any exist
  const vendorReturns = await prisma.vendorLedgerEntry.findMany({
    where: { entryType: 'RETURN_CREDIT', createdAt: range },
    include: { vendor: { select: { name: true } }, actor: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: ROW_LIMIT,
  });

  const purchaseReturnRows = vendorReturns.map((vr) => ({
    type: 'Purchase Return',
    returnNumber: vr.referenceNo ?? '—',
    returnReferenceNo: vr.referenceNo ?? '—',
    originalRef: vr.referenceTable === 'purchases' && vr.referenceId ? vr.referenceId : '—',
    invoiceNumber: '—',
    party: vr.vendor?.name ?? 'Vendor',
    customerName: vr.vendor?.name ?? 'Vendor',
    refundAmount: vr.amount,
    amount: vr.amount,
    isPhysicalCash: false,
    paymentMethod: 'VENDOR_CREDIT',
    reason: vr.description ?? 'Purchase Return Credit',
    processedBy: vr.actor?.fullName ?? 'Pharmacy Staff',
    createdAt: vr.createdAt,
    occurredAt: vr.createdAt,
  }));

  const allRows = [...salesReturnRows, ...purchaseReturnRows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const totalRefund = sumDecimal(allRows.map((r) => r.refundAmount));
  const totals = {
    refundAmount: totalRefund,
    amount: totalRefund,
  };

  return { rows: allRows, totals };
}

async function balanceSettlement(range?: { gte?: Date; lte?: Date }) {
  const settlements = await prisma.accountSettlement.findMany({
    where: { submittedAt: range },
    include: { submittedByUser: { select: { fullName: true } }, reviewedByUser: { select: { fullName: true } } },
    orderBy: { submittedAt: 'desc' },
    take: ROW_LIMIT,
  });
  const rows = settlements.map((s) => ({
    submittedBy: s.submittedByUser.fullName,
    periodFrom: s.periodFrom,
    periodTo: s.periodTo,
    expectedCash: s.expectedCash,
    physicalCash: s.physicalCash,
    variance: s.variance,
    settlementAmount: s.settlementAmount,
    status: s.status,
    reviewedBy: s.reviewedByUser?.fullName ?? null,
    submittedAt: s.submittedAt,
  }));
  return { rows, totals: null };
}

function sumDecimal(values: { toString(): string }[]) {
  return values.reduce((s: number, v) => s + Number(v), 0);
}
