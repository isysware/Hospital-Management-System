import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import type { BillingSummaryQuery } from './frontdeskReports.schemas';

/**
 * Front Desk / Billing Reports (HMS_V7.2_NEW_REQUIREMENTS.md §3.3) — real
 * aggregation over `UserCashBalance` (collections/refunds, moduleScope
 * `BILLING` — same ledger every Front Desk collection/refund already
 * writes to) and `HospitalInvoice` (discounts, invoice status mix) for a
 * date range. No separate reporting table — this reads the existing
 * billing ledger, it doesn't introduce a new one.
 */
export const frontdeskBillingReportService = {
  async getReport(query: BillingSummaryQuery) {
    const { start, end, label } = resolveDateRange(query);
    const dateFilter = { gte: start, lte: end };
    // Cashier = who collected/refunded (ledger owner) and who created the invoice.
    // Department = the invoice's department, reached through the receipt for ledger rows.
    const ledgerFilter = {
      ...(query.cashierId ? { portalUserId: query.cashierId } : {}),
      ...(query.departmentId ? { paymentReceipt: { hospitalInvoice: { departmentId: query.departmentId } } } : {}),
    };

    const [collections, refunds, invoices] = await Promise.all([
      prisma.userCashBalance.findMany({
        where: { moduleScope: 'BILLING', category: 'COLLECTION', direction: 'IN', occurredAt: dateFilter, ...ledgerFilter },
        select: { amount: true, isPhysicalCash: true, paymentReceipt: { select: { method: true } } },
      }),
      prisma.userCashBalance.findMany({
        where: { moduleScope: 'BILLING', category: 'REFUND', direction: 'OUT', occurredAt: dateFilter, ...ledgerFilter },
        select: { amount: true },
      }),
      prisma.hospitalInvoice.findMany({
        where: {
          createdAt: dateFilter,
          ...(query.cashierId ? { createdById: query.cashierId } : {}),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        },
        select: { status: true, subtotal: true, discountTotal: true, total: true, paidTotal: true },
      }),
    ]);

    const byMethod: Record<string, Decimal> = { CASH: new Decimal(0), CARD: new Decimal(0), BANK: new Decimal(0), ONLINE: new Decimal(0) };
    let totalCollections = new Decimal(0);
    for (const c of collections) {
      const method = c.paymentReceipt?.method ?? 'CASH';
      byMethod[method] = (byMethod[method] ?? new Decimal(0)).plus(c.amount);
      totalCollections = totalCollections.plus(c.amount);
    }

    const totalRefunds = refunds.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));

    const totalDiscounts = invoices.reduce((sum, inv) => sum.plus(inv.discountTotal), new Decimal(0));
    const totalGross = invoices.reduce((sum, inv) => sum.plus(inv.subtotal), new Decimal(0));
    const totalNet = invoices.reduce((sum, inv) => sum.plus(inv.total), new Decimal(0));
    const totalOutstanding = invoices.reduce((sum, inv) => sum.plus(inv.total.minus(inv.paidTotal)), new Decimal(0));

    const invoiceCountsByStatus: Record<string, number> = {};
    for (const inv of invoices) {
      invoiceCountsByStatus[inv.status] = (invoiceCountsByStatus[inv.status] ?? 0) + 1;
    }

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      collections: {
        total: totalCollections,
        byMethod,
      },
      refunds: { total: totalRefunds },
      billing: {
        invoiceCount: invoices.length,
        invoiceCountsByStatus,
        totalGross,
        totalDiscounts,
        totalNet,
        totalOutstanding,
      },
    };
  },
};
