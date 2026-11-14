import { expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

const db = vi.hoisted(() => ({
  inventoryExpense: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
  salarySlip: { findMany: vi.fn().mockResolvedValue([]) },
  salaryPayment: { findMany: vi.fn().mockResolvedValue([]) },
  doctorCommissionAccrual: { findMany: vi.fn().mockResolvedValue([]) },
  commissionPayout: { findMany: vi.fn().mockResolvedValue([]) },
  paymentReceipt: { findMany: vi.fn() },
  panelRemittanceAllocation: { findMany: vi.fn().mockResolvedValue([]) },
  userCashBalance: { findMany: vi.fn(), aggregate: vi.fn() },
  hospitalInvoice: { findMany: vi.fn() },
  admissionRecord: { groupBy: vi.fn() },
  bed: { count: vi.fn() },
  accountSettlement: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/db/client', () => ({ prisma: db }));
vi.mock('@/modules/expenses/expenses.service', () => ({ expensesService: { totalBetween: async () => new Decimal(0) } }));
import { financeControlService } from '@/modules/cash/financeControl.service';
import { managementReportsService } from '@/modules/reports/managementReports.service';

it.each([true, false])('nets the user-wise balance settlement report, physical = %s', async (isPhysicalCash) => {
  db.accountSettlement.findMany.mockResolvedValue([]);
  db.userCashBalance.findMany.mockResolvedValue([2200, 1000, -1000, 1000].map(amount => ({
    portalUserId: 'frontdesk', moduleScope: 'BILLING', portalUser: { displayName: 'frontdesk', username: 'frontdesk' },
    amount: new Decimal(Math.abs(amount)), direction: amount < 0 ? 'OUT' : 'IN',
    category: amount < 0 ? 'REFUND' : 'COLLECTION', isPhysicalCash,
  })));
  const report = await managementReportsService.getBalanceSettlements({ preset: 'today' });
  expect(report.rows[0].cashCollections.toNumber()).toBe(isPhysicalCash ? 3200 : 0);
  expect(report.rows[0].expectedCash.toNumber()).toBe(isPhysicalCash ? 3200 : 0);
  expect(report.rows[0].remaining.toNumber()).toBe(isPhysicalCash ? 3200 : 0);
  expect(report.rows[0].nonCash.toNumber()).toBe(isPhysicalCash ? 0 : 3200);
});

it.each([true, false])('nets Super Admin finance collections, physical = %s', async (isPhysicalCash) => {
  const row = (amount: number) => ({ amount: new Decimal(amount), isPhysicalCash, paymentReceipt: { method: isPhysicalCash ? 'CASH' : 'CARD' } });
  db.accountSettlement.findMany.mockResolvedValue([]);
  db.userCashBalance.findMany.mockImplementation(async ({ where }) =>
    where.category === 'COLLECTION' ? [row(2200), row(1000), row(1000)] : where.category === 'REFUND' ? [row(1000)] : []);
  const report = await financeControlService.getFinanceKpis({ preset: 'today' });
  expect(report.totalCashCollectedToday.toNumber()).toBe(isPhysicalCash ? 3200 : 0);
  expect(report.totalNonCashCollectedToday.toNumber()).toBe(isPhysicalCash ? 0 : 3200);
  expect(report.totalRefundsToday.toNumber()).toBe(1000);
});

it('includes negative refunds in department-filtered management collections', async () => {
  db.hospitalInvoice.findMany.mockResolvedValue([]);
  db.admissionRecord.groupBy.mockResolvedValue([]);
  db.bed.count.mockResolvedValue(0);
  db.accountSettlement.count.mockResolvedValue(0);
  db.userCashBalance.aggregate.mockResolvedValue({ _sum: { amount: null } });
  db.paymentReceipt.findMany.mockImplementation(async ({ where }) => {
    expect(where.AND).toEqual([{ OR: [{ isReversed: false }, { amount: { lt: 0 } }] }]);
    expect(where.OR[0]).toEqual({ hospitalInvoice: { departmentId: 'department' } });
    return [2200, 1000, -1000, 1000].map(amount => ({ amount: new Decimal(amount), hospitalInvoice: { departmentId: 'department', department: { id: 'department', name: 'OPD' }, lines: [] } }));
  });
  const report = await managementReportsService.getSummary({ preset: 'today', departmentId: 'department' });
  expect(report.summary.collections.toNumber()).toBe(3200);
  expect(report.rows[0].collected.toNumber()).toBe(3200);
});

it('uses receipt date, method and collector for mixed-department collections independently of invoice billing', async () => {
  db.hospitalInvoice.findMany.mockResolvedValue([{
    id: 'new-unpaid', createdAt: new Date(), paymentReceipts: [{ amount: new Decimal(900) }], departmentId: 'opd', department: { id: 'opd', name: 'OPD' },
    total: new Decimal(1000), paidTotal: new Decimal(900), subtotal: new Decimal(1000), discountTotal: new Decimal(0),
    lines: [{
      lineGross: new Decimal(1000), discountAmount: new Decimal(0), lineNet: new Decimal(1000),
      serviceRate: { department: { id: 'lab', name: 'LAB' } },
    }],
  }]);
  db.admissionRecord.groupBy.mockResolvedValue([]);
  db.bed.count.mockResolvedValue(0);
  db.accountSettlement.count.mockResolvedValue(0);
  db.userCashBalance.aggregate.mockResolvedValue({ _sum: { amount: null } });
  db.paymentReceipt.findMany.mockImplementation(async ({ where }) => {
    expect(where.method).toBe('CASH');
    expect(where.collectedById).toBe('cashier');
    expect(where.collectedAt.gte).toBeInstanceOf(Date);
    return [{
      amount: new Decimal(200),
      hospitalInvoice: {
        departmentId: 'opd', department: { id: 'opd', name: 'OPD' },
        lines: [
          { lineNet: new Decimal(600), serviceRate: { department: { id: 'lab', name: 'LAB' } } },
          { lineNet: new Decimal(400), serviceRate: { department: { id: 'opd', name: 'OPD' } } },
        ],
      },
    }];
  });
  const report = await managementReportsService.getSummary({
    preset: 'today', departmentId: 'lab', method: 'CASH', portalUserId: 'cashier',
  });
  expect(report.summary.totalBilling.toNumber()).toBe(1000);
  expect(report.summary.collections.toNumber()).toBe(120);
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].department).toBe('LAB');
});

it('reconciles company and patient collections without double counting and clears paid panel debt', async () => {
  const lab = { id: 'lab', name: 'LAB' }, opd = { id: 'opd', name: 'OPD' };
  const invoice = {
    id: 'panel-invoice', createdAt: new Date(), paymentReceipts: [{ amount: new Decimal(200) }], departmentId: 'opd', department: opd, total: new Decimal(1000),
    subtotal: new Decimal(1000), discountTotal: new Decimal(0), paidTotal: new Decimal(200),
    panelReceivable: new Decimal(800), panelRemittanceAllocations: [{ allocatedAmount: new Decimal(800) }],
    lines: [
      { lineGross: new Decimal(600), lineNet: new Decimal(600), discountAmount: new Decimal(0), patientShare: new Decimal(0), panelReceivable: new Decimal(600), serviceRate: { department: lab } },
      { lineGross: new Decimal(400), lineNet: new Decimal(400), discountAmount: new Decimal(0), patientShare: new Decimal(200), panelReceivable: new Decimal(200), serviceRate: { department: opd } },
    ],
  };
  db.hospitalInvoice.findMany.mockResolvedValue([invoice]);
  db.admissionRecord.groupBy.mockResolvedValue([]);
  db.bed.count.mockResolvedValue(0);
  db.accountSettlement.count.mockResolvedValue(0);
  db.userCashBalance.aggregate.mockResolvedValue({ _sum: { amount: null } });
  db.paymentReceipt.findMany.mockResolvedValue([{ amount: new Decimal(200), hospitalInvoice: invoice }]);
  db.panelRemittanceAllocation.findMany.mockResolvedValue([{
    allocatedAmount: new Decimal(800), hospitalInvoice: invoice, panelRemittance: { receivedAt: new Date() },
  }]);
  const all = await managementReportsService.getSummary({ preset: 'today' });
  expect(all.summary.collections.toNumber()).toBe(1000);
  expect(all.summary.outstanding.toNumber()).toBe(0);
  expect(all.rows.map(row => [row.department, row.collected.toNumber()])).toEqual([['LAB', 600], ['OPD', 400]]);
  db.paymentReceipt.findMany.mockResolvedValue([]);
  const labOnly = await managementReportsService.getSummary({ preset: 'today', departmentId: 'lab', method: 'BANK' });
  expect(labOnly.summary.collections.toNumber()).toBe(600);
  expect(labOnly.summary.outstanding.toNumber()).toBe(0);
  expect(labOnly.rows).toHaveLength(1);
});
