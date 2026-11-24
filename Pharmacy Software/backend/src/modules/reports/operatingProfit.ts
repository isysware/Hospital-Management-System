import { Prisma } from '@prisma/client';
import { financialReport, loadFinancialData, FinancialRange } from './financialRecognition';

/**
 * Operating Profit / Loss Report Engine
 * Uses the canonical full-payment revenue recognition and matched COGS policy.
 * Vendor/supplier payments and capital movements are strictly excluded from Operating Expenses.
 */
export async function operatingProfitReport(
  db: Prisma.TransactionClient,
  range: FinancialRange = {}
) {
  const [data, ledger] = await Promise.all([
    loadFinancialData(db, range),
    db.vendorLedgerEntry.findMany({
      where: {
        createdAt: { lte: range.lte },
      },
    }),
  ]);

  const { rows, totals } = financialReport(data, range);

  // ── 1. Vendor Payments & Balances (Informational reconciliation only — never in operating profit) ──
  let totalVendorPayments = new Prisma.Decimal(0);
  let supplierRefundsReceived = new Prisma.Decimal(0);
  const balances = new Map<string, Prisma.Decimal>();

  for (const entry of ledger) {
    balances.set(
      entry.vendorId,
      (balances.get(entry.vendorId) ?? new Prisma.Decimal(0)).plus(entry.amount)
    );
    if (entry.entryType === 'PAYMENT' && (!range.gte || entry.createdAt >= range.gte)) {
      if (entry.amount.isNegative()) {
        totalVendorPayments = totalVendorPayments.minus(entry.amount);
      } else {
        supplierRefundsReceived = supplierRefundsReceived.plus(entry.amount);
      }
    }
  }

  let vendorOutstanding = new Prisma.Decimal(0);
  let supplierAdvances = new Prisma.Decimal(0);
  for (const balance of balances.values()) {
    if (balance.isPositive()) {
      vendorOutstanding = vendorOutstanding.plus(balance);
    } else {
      supplierAdvances = supplierAdvances.minus(balance);
    }
  }

  // ── 2. Core Financial Metrics Breakdown ──
  const grossSales = totals.grossSales;
  const discounts = totals.grossSales.minus(totals.netBilling); // includes discounts and returns
  const netBilling = totals.netBilling;
  const taxBilled = totals.taxBilled;
  const totalInvoiced = totals.total;
  const actualCollections = totals.collections;
  const totalRefunded = totals.totalRefunded;
  const outstanding = totals.outstanding;
  const recognizedRevenue = totals.recognizedRevenue;
  const medicineCogs = totals.recognizedCogs;
  const grossProfit = totals.grossProfit;
  const operatingExpenses = totals.operatingExpenses;
  const operatingProfit = totals.operatingProfit;

  const grossMarginPercent = grossProfit && recognizedRevenue.gt(0)
    ? Number(grossProfit.div(recognizedRevenue).mul(100).toFixed(2))
    : 0;
  const operatingMarginPercent = operatingProfit && recognizedRevenue.gt(0)
    ? Number(operatingProfit.div(recognizedRevenue).mul(100).toFixed(2))
    : 0;
  const collectionsRatioPercent = totalInvoiced.gt(0)
    ? Number(actualCollections.div(totalInvoiced).mul(100).toFixed(2))
    : 0;

  // ── 3. Filter Invoices for Drill-Down ──
  // Include invoices that either have gross sales, collections, recognized revenue, or were created in range
  const rawInvoiceMap = new Map<string, (typeof data.invoices)[number]>();
  for (const inv of data.invoices) {
    rawInvoiceMap.set(inv.invoiceNumber, inv);
  }

  const invoicesList = rows
    .filter((r) => {
      if (r.grossSales.gt(0) || r.collections.gt(0) || r.recognizedRevenue.gt(0) || r.outstanding.gt(0)) return true;
      if (range.gte && r.createdAt < range.gte) return false;
      if (range.lte && r.createdAt > range.lte) return false;
      return true;
    })
    .map((r) => {
      const rawInv = rawInvoiceMap.get(r.invoiceNumber);
      return {
        id: rawInv?.id,
        invoiceNumber: r.invoiceNumber,
        channel: r.channel,
        customerName: r.customerName || 'Walk-In Customer',
        createdAt: r.createdAt,
        status: r.status,
        clearanceStatus: r.clearanceStatus,
        grossSales: r.grossSales,
        discount: r.grossSales.minus(r.netBilling),
        netBilling: r.netBilling,
        taxBilled: r.taxBilled,
        total: r.total,
        collections: r.collections,
        outstanding: r.outstanding,
        recognizedRevenue: r.recognizedRevenue,
        recognizedCogs: r.recognizedCogs,
        grossProfit: r.grossProfit,
        recognizedAt: r.recognizedAt,
        soldBy: r.soldBy,
        collectedBy: r.collectedBy,
        recognitionComplete: r.recognitionComplete,
        recognitionIssues: r.recognitionIssues,
        payments: (rawInv?.payments || []).map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          paidAt: p.paidAt,
          isInitial: p.isInitial,
          collectedByName: p.collectedByUser?.fullName || 'Staff',
          collectedById: p.collectedById,
        })),
        financialEvents: (rawInv?.financialEvents || []).map((e) => ({
          id: e.id,
          eventKey: e.eventKey,
          kind: e.kind,
          occurredAt: e.occurredAt,
          saleDelta: Number(e.saleDelta),
          collectionDelta: Number(e.collectionDelta),
          reference: e.reference,
          method: e.method,
          actorId: e.actorId,
        })),
      };
    });

  // ── 4. Filter Operating Expenses for Drill-Down ──
  const inRange = (at: Date) =>
    (!range.gte || at >= range.gte) && (!range.lte || at <= range.lte);

  const expensesList = data.expenses
    .filter((e: any) => inRange(e.date))
    .map((e: any) => ({
      id: e.id,
      expenseNumber: e.expenseNumber,
      date: e.date,
      category: e.category,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
      payeeOrVendor: e.payeeOrVendor || '—',
      description: e.description,
      enteredBy: e.enteredByUser?.fullName || 'Pharmacy Staff',
      approvedBy: e.approvedByUser?.fullName || 'Pending Approval',
      createdAt: e.createdAt,
    }));

  // ── 5. Periodic Trend Grouping (By Day) ──
  const dailyMap = new Map<
    string,
    {
      date: string;
      label: string;
      grossSales: Prisma.Decimal;
      recognizedRevenue: Prisma.Decimal;
      medicineCogs: Prisma.Decimal;
      grossProfit: Prisma.Decimal;
      operatingExpenses: Prisma.Decimal;
      operatingProfit: Prisma.Decimal;
      collections: Prisma.Decimal;
      invoiceCount: number;
    }
  >();

  const getOrCreateDay = (d: Date) => {
    const key = d.toISOString().slice(0, 10);
    let entry = dailyMap.get(key);
    if (!entry) {
      const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      entry = {
        date: key,
        label,
        grossSales: new Prisma.Decimal(0),
        recognizedRevenue: new Prisma.Decimal(0),
        medicineCogs: new Prisma.Decimal(0),
        grossProfit: new Prisma.Decimal(0),
        operatingExpenses: new Prisma.Decimal(0),
        operatingProfit: new Prisma.Decimal(0),
        collections: new Prisma.Decimal(0),
        invoiceCount: 0,
      };
      dailyMap.set(key, entry);
    }
    return entry;
  };

  // Group invoice revenue & COGS
  for (const inv of invoicesList) {
    const targetDate = inv.recognizedAt ?? inv.createdAt;
    if (inRange(targetDate)) {
      const day = getOrCreateDay(targetDate);
      day.grossSales = day.grossSales.plus(inv.grossSales);
      day.recognizedRevenue = day.recognizedRevenue.plus(inv.recognizedRevenue);
      day.medicineCogs = day.medicineCogs.plus(inv.recognizedCogs);
      day.collections = day.collections.plus(inv.collections);
      day.invoiceCount += 1;
    }
  }

  // Group operating expenses
  for (const exp of expensesList) {
    const expDate = new Date(exp.date);
    if (inRange(expDate)) {
      const day = getOrCreateDay(expDate);
      day.operatingExpenses = day.operatingExpenses.plus(exp.amount);
    }
  }

  // Calculate day-level Gross Profit and Operating Profit
  const trend = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const gp = day.recognizedRevenue.minus(day.medicineCogs);
      const op = gp.minus(day.operatingExpenses);
      return {
        ...day,
        grossProfit: gp,
        operatingProfit: op,
      };
    });

  const metrics = [
    ['1. Revenue & Sales', 'Gross Sales (Dispensed Value)', grossSales],
    ['1. Revenue & Sales', 'Discounts & Returns', discounts],
    ['1. Revenue & Sales', 'Net Sales / Billing (excluding tax)', netBilling],
    ['1. Revenue & Sales', 'Actual Collections Received', actualCollections],
    ['1. Revenue & Sales', 'Sales Returns & Cash Refunds', totalRefunded],
    ['1. Revenue & Sales', 'Outstanding Receivables (as of report end)', outstanding],
    ['2. Revenue Recognition', 'Recognized Revenue (Earned Sales, excl. tax)', recognizedRevenue],
    ['3. Cost of Goods Sold', 'Medicine COGS (Historical Batch Cost)', medicineCogs],
    ['4. Gross Margin', 'Gross Profit (Recognized Revenue − COGS)', grossProfit],
    ['5. Operating Overheads', 'Operating Expenses (Overhead & Operations)', operatingExpenses],
    ['5. Operating Overheads', 'Inventory / Stock Losses (Damaged / Expired)', totals.inventoryLosses],
    ['6. Operating Result', 'Net Operating Profit / Loss', operatingProfit],
    ['7. Vendor Settlements (Informational)', 'Total Vendor Payments (Capital movement — not an expense)', totalVendorPayments],
    ['7. Vendor Settlements (Informational)', 'Supplier Refunds Received', supplierRefundsReceived],
    ['7. Vendor Settlements (Informational)', 'Vendor Outstanding Balance', vendorOutstanding],
    ['7. Vendor Settlements (Informational)', 'Supplier Advances / Credits', supplierAdvances],
  ] as const;

  const tableRows = metrics.map(([section, metric, amount]) => ({
    section,
    metric,
    amount,
  }));

  const totalsObj = {
    ...totals,
    vendorPayments: totalVendorPayments,
    vendorRefunds: supplierRefundsReceived,
    vendorOutstanding,
    supplierAdvances,
  };

  return {
    rows: tableRows,
    totals: totalsObj,
    breakdown: {
      grossSales,
      discounts,
      netBilling,
      taxBilled,
      totalInvoiced,
      actualCollections,
      totalRefunded,
      outstanding,
      recognizedRevenue,
      medicineCogs,
      grossProfit,
      operatingExpenses,
      operatingProfit,
      grossMarginPercent,
      operatingMarginPercent,
      collectionsRatioPercent,
      incompleteInvoices: totals.incompleteInvoices,
    },
    vendorSummary: {
      totalVendorPayments,
      supplierRefundsReceived,
      vendorOutstanding,
      supplierAdvances,
    },
    trend,
    invoices: invoicesList,
    expenses: expensesList,
    reportPeriod: {
      from: range.gte ? range.gte.toISOString() : null,
      to: range.lte ? range.lte.toISOString() : null,
    },
  };
}

