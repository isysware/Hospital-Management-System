import { beforeEach, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
const db = vi.hoisted(() => ({ salarySlip: { findMany: vi.fn() }, salaryPayment: { findMany: vi.fn() }, doctorCommissionAccrual: { findMany: vi.fn() }, commissionPayout: { findMany: vi.fn() } }));
vi.mock('@/db/client', () => ({ prisma: db }));
import { staffFinanceSummary } from '@/modules/reports/staffFinanceSummary';
const d = (v: number) => new Decimal(v);
const start = new Date('2026-10-01T00:00:00Z'), end = new Date('2026-10-31T23:59:59Z');
const old = new Date('2026-09-01'), current = new Date('2026-10-15');
beforeEach(() => { for (const model of Object.values(db)) model.findMany.mockReset().mockResolvedValue([]); });
it('separates recognition, current payments and carried liabilities; clamps overpaid slips individually', async () => {
  db.salarySlip.findMany.mockResolvedValue([
    { approvedAt: old, createdAt: old, generatedAmount: d(1000), correctionEntries: [{ amount: d(100), createdAt: current }], payments: [{ amount: d(300) }] },
    { approvedAt: current, createdAt: old, generatedAmount: d(2000), correctionEntries: [], payments: [{ amount: d(500) }, { amount: d(-200) }] },
    { approvedAt: old, createdAt: old, generatedAmount: d(100), correctionEntries: [], payments: [{ amount: d(200) }] },
  ]);
  db.salaryPayment.findMany.mockResolvedValue([{ amount: d(300) }, { amount: d(500) }, { amount: d(-200) }]);
  const r = await staffFinanceSummary(start, end);
  expect(r.salaryGenerated.toNumber()).toBe(2100);
  expect(r.salaryPaid.toNumber()).toBe(600);
  expect(r.salaryOutstanding.toNumber()).toBe(2500);
  expect(r.commissionGenerated.toNumber()).toBe(0);
  const q = db.salarySlip.findMany.mock.calls[0][0];
  expect(q.include.payments.where.paidAt.lte).toEqual(end);
  expect(q.include.correctionEntries.where.createdAt.lte).toEqual(end);
  expect(q.where.AND[0].OR[0].approvedAt.lte).toEqual(end);
});
it('recognizes commission net of original tax, discounts/reversals and current adjustments once per accrual', async () => {
  db.doctorCommissionAccrual.findMany.mockResolvedValue([
    { approvedAt: old, createdAt: old, commissionAmount: d(1000), ruleSnapshot: { commissionTaxMethod: 'PERCENTAGE', commissionTaxValue: 10 }, reversals: [{ reversalAmount: d(200), source: 'REFUND', reversedAt: current }], adjustments: [], payouts: [{ amount: d(300) }] },
    { approvedAt: current, createdAt: old, commissionAmount: d(500), ruleSnapshot: {}, reversals: [], adjustments: [{ amount: d(50), createdAt: current }], payouts: [{ amount: d(100) }, { amount: d(-100) }] },
  ]);
  db.commissionPayout.findMany.mockResolvedValue([{ amount: d(300) }, { amount: d(100) }, { amount: d(-100) }]);
  const r = await staffFinanceSummary(start, end, 'dept', 'user');
  expect(r.commissionGenerated.toNumber()).toBe(370); // -180 reversal + 550 newly approved
  expect(r.commissionPaid.toNumber()).toBe(300);
  expect(r.commissionOutstanding.toNumber()).toBe(970);
  expect(db.doctorCommissionAccrual.findMany.mock.calls[0][0].where.approvedById).toBe('user');
  expect(db.commissionPayout.findMany.mock.calls[0][0].where.doctorCommissionAccrual.invoiceLineItem.OR).toEqual([
    { serviceRate: { departmentId: 'dept' } },
    { serviceRateId: null, hospitalInvoice: { departmentId: 'dept' } },
  ]);
});
