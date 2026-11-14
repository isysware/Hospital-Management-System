import { Prisma } from '@prisma/client';
import { financialReport, loadFinancialData } from './financialRecognition';

/** One recognition engine; supplier cash movements never enter operating profit. */
export async function incomeExpenseReport(db: Prisma.TransactionClient, range: { gte?: Date; lte?: Date } = {}) {
  const [data, ledger] = await Promise.all([
    loadFinancialData(db),
    db.vendorLedgerEntry.findMany({ where: { createdAt: { lte: range.lte } } }),
  ]);
  const { totals } = financialReport(data, range);
  let vendorPayments = new Prisma.Decimal(0), vendorRefunds = new Prisma.Decimal(0);
  const balances = new Map<string, Prisma.Decimal>();
  for (const entry of ledger) {
    balances.set(entry.vendorId, (balances.get(entry.vendorId) ?? new Prisma.Decimal(0)).plus(entry.amount));
    if (entry.entryType === 'PAYMENT' && (!range.gte || entry.createdAt >= range.gte)) {
      if (entry.amount.isNegative()) vendorPayments = vendorPayments.minus(entry.amount); else vendorRefunds = vendorRefunds.plus(entry.amount);
    }
  }
  let vendorOutstanding = new Prisma.Decimal(0), supplierAdvances = new Prisma.Decimal(0);
  for (const balance of balances.values()) {
    if (balance.isPositive()) vendorOutstanding = vendorOutstanding.plus(balance);
    else supplierAdvances = supplierAdvances.minus(balance);
  }
  const metrics = [
    ['Income', 'Gross Sales', totals.grossSales],
    ['Income', 'Discounts & Returns', totals.grossSales.minus(totals.netBilling)],
    ['Income', 'Net Sales / Billing (excluding tax)', totals.netBilling],
    ['Income', 'Actual Collections', totals.collections],
    ['Income', 'Outstanding Receivables', totals.outstanding],
    ['Income', 'Recognized Revenue', totals.recognizedRevenue],
    ['Expenses', 'Medicine COGS (matched to recognized sales)', totals.recognizedCogs],
    ['Expenses', 'Operating Expenses', totals.operatingExpenses],
    ['Vendor Payments', 'Total Vendor Payments', vendorPayments],
    ['Vendor Payments', 'Supplier Refunds Received', vendorRefunds],
    ['Vendor Payments', 'Vendor Outstanding', vendorOutstanding],
    ['Vendor Payments', 'Supplier Advances / Credits', supplierAdvances],
    ['Profit', 'Net Operating Profit / Loss', totals.operatingProfit],
  ] as const;
  return { rows: metrics.map(([section, metric, amount]) => ({ section, metric, amount })),
    totals: { ...totals, vendorPayments, vendorRefunds, vendorOutstanding, supplierAdvances } };
}
