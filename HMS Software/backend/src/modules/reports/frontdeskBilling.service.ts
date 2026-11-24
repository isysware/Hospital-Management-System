import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import type { BillingSummaryQuery } from './frontdeskReports.schemas';
import { allocateCollection, allocateInvoiceAmount, collectionSelect, collectionInvoiceSelect, signedReceiptWhere } from '@/shared/departmentCollections';
import { invoiceAsOf, receiptsThrough, remittancesThrough } from '@/shared/invoiceAsOf';

/** Billing uses invoice dates; income uses signed receipt dates; debt is as of period end. */
export const frontdeskBillingReportService = {
  async getReport(query: BillingSummaryQuery) {
    const { start, end, label } = resolveDateRange(query);
    const deptId = query.departmentId;
    const [receipts, allInvoices] = await Promise.all([
      prisma.paymentReceipt.findMany({ where: { ...signedReceiptWhere, collectedAt: { gte: start, lte: end },
        ...(query.cashierId ? { collectedById: query.cashierId } : {}) }, select: { ...collectionSelect, method: true, paymentAccount: true } }),
      prisma.hospitalInvoice.findMany({ where: { createdAt: { lte: end }, status: { not: 'VOID' },
        ...(query.cashierId ? { createdById: query.cashierId } : {}),
        ...(deptId ? { OR: [{ departmentId: deptId }, { lines: { some: { serviceRate: { departmentId: deptId } } } }] } : {}) },
        include: { department: { select: { id: true, name: true } }, lines: { select: { ...collectionInvoiceSelect.lines.select, lineGross: true, discountAmount: true } },
          paymentReceipts: receiptsThrough(end), panelRemittanceAllocations: remittancesThrough(end) } }),
    ]);
    const zero = () => new Decimal(0);
    const byMethod: Record<string, Decimal> = { CASH: zero(), CARD: zero(), BANK: zero(), ONLINE: zero() };
    const byAccount: Record<string, Decimal> = {};
    let collected = zero(), refunds = zero();
    for (const receipt of receipts) {
      const amount = allocateCollection(receipt).filter(a => !deptId || a.departmentId === deptId).reduce((sum, a) => sum.plus(a.amount), zero());
      byMethod[receipt.method] = byMethod[receipt.method]!.plus(amount);
      if (receipt.method !== 'CASH') {
        const account = receipt.paymentAccount ?? 'Legacy / account not recorded';
        byAccount[account] = (byAccount[account] ?? zero()).plus(amount);
      }
      collected = collected.plus(amount);
      if (amount.lt(0)) refunds = refunds.minus(amount);
    }
    let totalGross = zero(), totalDiscounts = zero(), totalNet = zero(), totalOutstanding = zero(), invoiceCount = 0;
    const invoiceCountsByStatus: Record<string, number> = {};

    type CategoryBucket = {
      category: string;
      invoiceCount: number;
      gross: Decimal;
      discounts: Decimal;
      net: Decimal;
      paid: Decimal;
      outstanding: Decimal;
    };
    const byCategory: Record<string, CategoryBucket> = {
      OPD: { category: 'OPD', invoiceCount: 0, gross: zero(), discounts: zero(), net: zero(), paid: zero(), outstanding: zero() },
      OBSERVATION: { category: 'Observation', invoiceCount: 0, gross: zero(), discounts: zero(), net: zero(), paid: zero(), outstanding: zero() },
      EMERGENCY: { category: 'Emergency', invoiceCount: 0, gross: zero(), discounts: zero(), net: zero(), paid: zero(), outstanding: zero() },
      ADMISSION: { category: 'Admission', invoiceCount: 0, gross: zero(), discounts: zero(), net: zero(), paid: zero(), outstanding: zero() },
      CUSTOM: { category: 'Custom Billing', invoiceCount: 0, gross: zero(), discounts: zero(), net: zero(), paid: zero(), outstanding: zero() },
    };

    const getInvCategoryKey = (inv: { sourceType: string; encounterType?: string | null }) => {
      if (inv.sourceType === 'ADMISSION') return 'ADMISSION';
      if (inv.encounterType === 'OBSERVATION') return 'OBSERVATION';
      if (inv.encounterType === 'EMERGENCY') return 'EMERGENCY';
      if (inv.encounterType === 'CUSTOM') return 'CUSTOM';
      return 'OPD';
    };

    for (const inv of allInvoices.map(invoiceAsOf)) {
      const scoped = (amount: Decimal, basis: 'patientShare' | 'panelReceivable') => allocateInvoiceAmount(amount, inv, basis)
        .filter(a => !deptId || a.departmentId === deptId).reduce((sum, a) => sum.plus(a.amount), zero());
      const invOutstanding = scoped(inv.balance.patientDue, 'patientShare').plus(scoped(inv.balance.panelDue, 'panelReceivable'));
      totalOutstanding = totalOutstanding.plus(invOutstanding);

      const catKey = getInvCategoryKey(inv);
      if (byCategory[catKey]) {
        byCategory[catKey].outstanding = byCategory[catKey].outstanding.plus(invOutstanding);
      }

      if (inv.createdAt < start) continue;
      invoiceCount++;
      invoiceCountsByStatus[inv.status] = (invoiceCountsByStatus[inv.status] ?? 0) + 1;

      let invGross = zero(), invDiscounts = zero(), invNet = zero();
      if (deptId && inv.lines.length) {
        for (const line of inv.lines.filter(l => (l.serviceRate?.department?.id ?? inv.departmentId) === deptId)) {
          invGross = invGross.plus(line.lineGross); invDiscounts = invDiscounts.plus(line.discountAmount); invNet = invNet.plus(line.lineNet);
        }
      } else { invGross = invGross.plus(inv.subtotal); invDiscounts = invDiscounts.plus(inv.discountTotal); invNet = invNet.plus(inv.total); }
      totalGross = totalGross.plus(invGross); totalDiscounts = totalDiscounts.plus(invDiscounts); totalNet = totalNet.plus(invNet);

      const invPaid = scoped(inv.paidTotal, 'patientShare').plus(scoped(inv.balance.panelPaid, 'panelReceivable'));
      if (byCategory[catKey]) {
        byCategory[catKey].invoiceCount += 1;
        byCategory[catKey].gross = byCategory[catKey].gross.plus(invGross);
        byCategory[catKey].discounts = byCategory[catKey].discounts.plus(invDiscounts);
        byCategory[catKey].net = byCategory[catKey].net.plus(invNet);
        byCategory[catKey].paid = byCategory[catKey].paid.plus(invPaid);
      }
    }
    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      collections: { total: collected, byMethod, byAccount },
      refunds: { total: refunds },
      billing: {
        invoiceCount,
        invoiceCountsByStatus,
        totalGross,
        totalDiscounts,
        totalNet,
        totalOutstanding,
        byCategory,
      },
    };
  },
};
