import { prisma } from '@/db/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { PaymentMethod } from '@prisma/client';
import { salaryBalance } from '@/modules/payroll/payroll.balance';
import { commissionBalance, commissionDepartmentFilter } from '@/modules/commission/commission.calc';

const approvedStatuses = ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as const;
const zero = () => new Decimal(0);

/** Salary recognition remains approval-date based. Collection commission uses receipt dates.
 * Legacy approved rows without an approval
 * timestamp use their creation date; later adjustments are recognized when posted.
 * Payments use paidAt, independently of the earning/approval period. */
export async function staffFinanceSummary(start: Date, end: Date, departmentId?: string, portalUserId?: string, method?: PaymentMethod) {
  const salaryDepartment = departmentId ? { OR: [
    { payrollRun: { departmentId } },
    { AND: [{ OR: [{ payrollRunId: null }, { payrollRun: { departmentId: null } }] }, { staff: { staffDepartments: { some: { departmentId } } } }] },
  ] } : {};
  const commissionDepartment = departmentId ? { invoiceLineItem: commissionDepartmentFilter(departmentId) } : {};
  const approval = { OR: [
    { approvedAt: { lte: end } },
    { approvedAt: null, status: { in: [...approvedStatuses] }, createdAt: { lte: end } },
  ] };
  const [salary, commission, salaryPayments, commissionPayments] = await Promise.all([
    prisma.salarySlip.findMany({ where: { AND: [approval, salaryDepartment], ...(portalUserId ? { approvedById: portalUserId } : {}) },
      include: { payments: { where: { paidAt: { lte: end } } }, correctionEntries: { where: { createdAt: { lte: end } } } } }),
    prisma.doctorCommissionAccrual.findMany({ where: { AND: [{ OR: [
      { collectionEventId: { not: null }, collectionEvent: { occurredAt: { lte: end } } },
      { collectionEventId: null, ...approval },
    ] }, commissionDepartment], ...(portalUserId ? { approvedById: portalUserId } : {}) },
      include: { collectionEvent: true, payouts: { where: { paidAt: { lte: end } } }, reversals: { where: { reversedAt: { lte: end } } }, adjustments: { where: { createdAt: { lte: end } } } } }),
    prisma.salaryPayment.findMany({ where: { paidAt: { gte: start, lte: end }, ...(method ? { method } : {}), ...(portalUserId ? { OR: [{ reversalOfId: null, paidById: portalUserId }, { reversalOf: { paidById: portalUserId } }] } : {}), salarySlip: salaryDepartment }, select: { amount: true } }),
    prisma.commissionPayout.findMany({ where: { paidAt: { gte: start, lte: end }, ...(method ? { method } : {}), ...(portalUserId ? { OR: [{ reversalOfId: null, paidById: portalUserId }, { reversalOf: { paidById: portalUserId } }] } : {}), doctorCommissionAccrual: commissionDepartment }, select: { amount: true } }),
  ]);
  let salaryGenerated = zero(), salaryOutstanding = zero(), commissionGenerated = zero(), commissionOutstanding = zero();
  for (const row of salary) {
    const balance = salaryBalance(row);
    const before = (row.approvedAt ?? row.createdAt) < start
      ? salaryBalance({ ...row, correctionEntries: row.correctionEntries.filter(a => a.createdAt < start) }).payable : zero();
    salaryGenerated = salaryGenerated.plus(balance.payable.minus(before));
    salaryOutstanding = salaryOutstanding.plus(balance.remaining);
  }
  // Sum receipt earnings exactly once; run totals are presentation snapshots.
  for (const row of commission) {
    const balance = commissionBalance(row);
    const before = (row.collectionEvent?.occurredAt ?? row.approvedAt ?? row.createdAt) < start
      ? commissionBalance({ ...row, reversals: row.reversals.filter(r => r.reversedAt < start), adjustments: row.adjustments.filter(a => a.createdAt < start) }).payable : zero();
    commissionGenerated = commissionGenerated.plus(balance.payable.minus(before));
    commissionOutstanding = commissionOutstanding.plus(balance.remaining);
  }
  return { salaryGenerated, salaryPaid: salaryPayments.reduce((s, p) => s.plus(p.amount), zero()), salaryOutstanding,
    commissionGenerated, commissionPaid: commissionPayments.reduce((s, p) => s.plus(p.amount), zero()), commissionOutstanding };
}
