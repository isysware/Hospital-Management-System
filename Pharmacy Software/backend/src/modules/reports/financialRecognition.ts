import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/db/client";

export type FinancialRange = { gte?: Date; lte?: Date };
const zero = () => new Decimal(0);
const include = {
  dispensedByUser: { select: { fullName: true } },
  lines: { include: { batch: { select: { costRate: true } } } },
  payments: { include: { collectedByUser: { select: { fullName: true } } } },
  financialEvents: true,
} satisfies Prisma.PharmacyInvoiceInclude;
type Invoice = Prisma.PharmacyInvoiceGetPayload<{ include: typeof include }>;
type LegacyRefund = {
  id: string;
  referenceId: string | null;
  amount: Decimal;
  occurredAt: Date;
  portalUserId: string;
  isPhysicalCash: boolean;
};
type Event = {
  id: string;
  at: Date;
  sale: Decimal;
  tax: Decimal;
  gross: Decimal;
  discount: Decimal;
  cost: Decimal;
  collection: Decimal;
  method?: string | null;
  actor?: string | null;
  collector?: string;
  kind: string;
};
const inRange = (at: Date, range: FinancialRange) =>
  (!range.gte || at >= range.gte) && (!range.lte || at <= range.lte);
const add = <T>(rows: T[], fn: (row: T) => Decimal) =>
  rows.reduce((sum, row) => sum.plus(fn(row)), zero());

/** One chronological projection, shared by reports and dashboard. No balance/stock writes. */
export function projectInvoice(
  invoice: Invoice,
  range: FinancialRange = {},
  filters: { method?: string; cashierId?: string } = {},
  legacyRefunds: LegacyRefund[] = [],
) {
  const events: Event[] = [];
  const returns = invoice.financialEvents.filter((e) => e.kind === "RETURN");
  const issues: string[] = [];
  if (invoice.financialEvents.some((e) => !e.occurredAt))
    issues.push("Undated HMS collection reconciliation");
  if (
    invoice.channel === "HMS_LINKED" &&
    !add(
      invoice.financialEvents.filter((e) => e.kind.startsWith("HMS_")),
      (e) => e.collectionDelta,
    ).equals(invoice.hmsCollectedAmount)
  )
    issues.push("HMS collection history incomplete");
  const unmatchedRefunds = legacyRefunds.filter(
    (r) => !returns.some((e) => e.reference === r.id),
  );
  if (unmatchedRefunds.length)
    issues.push("Legacy return lacks dated line/tax detail");
  const originalTotal = invoice.total
    .minus(add(returns, (e) => e.saleDelta))
    .plus(add(unmatchedRefunds, (r) => r.amount));
  const originalTax = invoice.taxTotal.minus(add(returns, (e) => e.taxDelta));
  const originalGross = invoice.subtotal.minus(
    add(returns, (e) => e.grossDelta),
  );
  const originalDiscount = invoice.discountTotal.minus(
    add(returns, (e) => e.discountDelta),
  );
  const lineNet = add(invoice.lines, (l) => l.lineNet);
  const discountDifference = lineNet.minus(originalTotal); // includes invoice-level discounts
  let missingCost = false;
  invoice.lines.forEach((l, index) => {
    const rate = l.costRateSnapshot ?? l.batch?.costRate;
    if (rate == null && l.quantity.gt(0)) missingCost = true;
    events.push({
      id: "line:" + l.id,
      at: invoice.channel === "RETAIL" ? invoice.createdAt : l.dispensedAt,
      sale: l.lineNet.minus(index === 0 ? discountDifference : zero()),
      tax: l.taxAmount,
      gross: l.quantity.mul(l.rateSnapshot),
      discount: l.discountAmount.plus(
        index === 0 ? discountDifference : zero(),
      ),
      cost: l.quantity.mul(rate ?? 0),
      collection: zero(),
      kind: "SALE",
    });
  });
  if (!invoice.lines.length) {
    if (originalTotal.gt(0)) missingCost = true;
    events.push({
      id: "invoice:" + invoice.id,
      at: invoice.createdAt,
      sale: originalTotal,
      tax: originalTax,
      gross: originalGross,
      discount: originalDiscount,
      cost: zero(),
      collection: zero(),
      kind: "SALE",
    });
  }
  for (const p of invoice.payments)
    events.push({
      id: "payment:" + p.id,
      at: p.paidAt,
      sale: zero(),
      tax: zero(),
      gross: zero(),
      discount: zero(),
      cost: zero(),
      collection: p.amount,
      method: p.method,
      actor: p.collectedById,
      collector: p.collectedByUser.fullName,
      kind: "PAYMENT",
    });
  for (const e of invoice.financialEvents)
    if (e.occurredAt)
      events.push({
        id: e.eventKey,
        at: e.occurredAt,
        sale: e.saleDelta,
        tax: e.taxDelta,
        gross: e.grossDelta,
        discount: e.discountDelta,
        cost: e.costDelta,
        collection: e.collectionDelta,
        method: e.method,
        actor: e.actorId,
        collector:
          e.actorId ??
          (e.kind.startsWith("HMS_") ? "HMS Front Desk" : "Unknown"),
        kind: e.kind,
      });
  for (const r of unmatchedRefunds)
    events.push({
      id: "legacy-refund:" + r.id,
      at: r.occurredAt,
      sale: r.amount.negated(),
      tax: zero(),
      gross: zero(),
      discount: zero(),
      cost: zero(),
      collection: r.amount.negated(),
      method: r.isPhysicalCash ? "CASH" : "UNKNOWN",
      actor: r.portalUserId,
      kind: "RETURN",
    });
  events.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      (a.kind === "SALE"
        ? -1
        : b.kind === "SALE"
          ? 1
          : a.id.localeCompare(b.id)),
  );
  let sale = zero(),
    tax = zero(),
    paid = zero(),
    cost = zero(),
    recognized = zero(),
    recognizedCost = zero();
  let grossSales = zero(),
    netBilling = zero(),
    taxBilled = zero(),
    collections = zero(),
    revenue = zero(),
    cogs = zero(),
    refunded = zero();
  let recognizedAt: Date | null = null;
  const collectors = new Set<string>();
  const methods: Record<string, Decimal> = {};
  for (const e of events) {
    if (range.lte && e.at > range.lte) continue;
    sale = sale.plus(e.sale);
    tax = tax.plus(e.tax);
    paid = paid.plus(e.collection);
    cost = cost.plus(e.cost);
    const fullyPaid = sale.gt(0) && paid.gte(sale);
    let target = recognized,
      targetCost = recognizedCost;
    if (fullyPaid) {
      target = Decimal.max(0, sale.minus(tax));
      targetCost = cost;
    } else if (e.kind === "RETURN") {
      target = Decimal.min(recognized, Decimal.max(0, sale.minus(tax)));
      targetCost = recognizedCost.gt(0)
        ? Decimal.max(0, recognizedCost.plus(e.cost))
        : zero();
    } else if (e.collection.lt(0)) {
      target = zero();
      targetCost = zero();
    }
    const delta = target.minus(recognized),
      costChange = targetCost.minus(recognizedCost);
    recognized = target;
    recognizedCost = targetCost;
    if (delta.gt(0)) recognizedAt = e.at;
    if (!inRange(e.at, range)) continue;
    grossSales = grossSales.plus(e.gross);
    netBilling = netBilling.plus(e.sale.minus(e.tax));
    taxBilled = taxBilled.plus(e.tax);
    if (!issues.length) {
      revenue = revenue.plus(delta);
      cogs = cogs.plus(costChange);
    }
    if (
      (!filters.method || filters.method === e.method) &&
      (!filters.cashierId || filters.cashierId === e.actor)
    ) {
      collections = collections.plus(e.collection);
      if (e.collection.lt(0)) refunded = refunded.minus(e.collection);
      if (!e.collection.isZero()) {
        const method = e.method ?? "UNKNOWN";
        methods[method] = (methods[method] ?? zero()).plus(e.collection);
        if (e.collector) collectors.add(e.collector);
      }
    }
  }
  if (missingCost) issues.push("Historical sale cost snapshot unavailable");
  return {
    invoiceNumber: invoice.invoiceNumber,
    channel: invoice.channel,
    customerName: invoice.customerName,
    grossSales,
    netBilling,
    taxBilled,
    total: netBilling.plus(taxBilled),
    paidTotal: collections,
    collections,
    outstanding: Decimal.max(0, sale.minus(paid)),
    recognizedRevenue: revenue,
    recognizedCogs: cogs,
    grossProfit: missingCost || issues.length ? null : revenue.minus(cogs),
    totalRefunded: refunded,
    recognitionIssues: issues,
    recognitionComplete: issues.length === 0,
    recognizedAt,
    status: sale.lte(paid) ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID",
    clearanceStatus: invoice.clearanceStatus,
    soldBy: invoice.dispensedByUser.fullName,
    collectedBy: [...collectors].join(", "),
    createdAt: invoice.createdAt,
    methods,
  };
}

export async function loadFinancialData(
  db: Pick<
    Prisma.TransactionClient,
    "pharmacyInvoice" | "cashLedgerEntry" | "expense"
  > = prisma,
) {
  const [invoices, refunds, expenses] = await Promise.all([
    db.pharmacyInvoice.findMany({ include, orderBy: { createdAt: "desc" } }),
    db.cashLedgerEntry.findMany({
      where: { category: "REFUND", referenceTable: "pharmacy_invoices" },
      select: {
        id: true,
        referenceId: true,
        amount: true,
        occurredAt: true,
        portalUserId: true,
        isPhysicalCash: true,
      },
    }),
    db.expense.findMany({ select: { date: true, amount: true } }),
  ]);
  return { invoices, refunds, expenses };
}
export function financialReport(
  data: Awaited<ReturnType<typeof loadFinancialData>>,
  range: FinancialRange = {},
  filters: { method?: string; cashierId?: string } = {},
) {
  const rows = data.invoices
    .filter((i) => !range.lte || i.createdAt <= range.lte)
    .map((i) =>
      projectInvoice(
        i,
        range,
        filters,
        data.refunds.filter((r) => r.referenceId === i.id),
      ),
    );
  const expenses = add(
    data.expenses.filter((e) => inRange(e.date, range)),
    (e) => e.amount,
  );
  const recognizedRevenue = add(rows, (r) => r.recognizedRevenue),
    recognizedCogs = add(rows, (r) => r.recognizedCogs);
  const incomplete = rows.filter((r) => !r.recognitionComplete).length;
  const totals = {
    grossSales: add(rows, (r) => r.grossSales),
    netBilling: add(rows, (r) => r.netBilling),
    taxBilled: add(rows, (r) => r.taxBilled),
    total: add(rows, (r) => r.total),
    collections: add(rows, (r) => r.collections),
    paidTotal: add(rows, (r) => r.collections),
    netCollected: add(rows, (r) => r.collections),
    totalRefunded: add(rows, (r) => r.totalRefunded),
    outstanding: add(rows, (r) => r.outstanding),
    recognizedRevenue,
    recognizedCogs,
    operatingExpenses: expenses,
    operatingProfit: incomplete
      ? null
      : recognizedRevenue.minus(recognizedCogs).minus(expenses),
    incompleteInvoices: incomplete,
  };
  return { rows, totals };
}
