import { beforeEach, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
const db = vi.hoisted(() => ({
  hospitalInvoice: { findMany: vi.fn() }, paymentReceipt: { findMany: vi.fn() },
  panelRemittanceAllocation: { findMany: vi.fn().mockResolvedValue([]) },
  inventoryExpense: { aggregate: vi.fn() }, userCashBalance: { aggregate: vi.fn() },
  admissionRecord: { groupBy: vi.fn().mockResolvedValue([]) }, bed: { count: vi.fn().mockResolvedValue(0) },
  accountSettlement: { count: vi.fn().mockResolvedValue(0) },
}));
const costs = vi.hoisted(() => ({ totalBetween: vi.fn(), staff: vi.fn() }));
vi.mock('@/db/client', () => ({ prisma: db }));
vi.mock('@/modules/expenses/expenses.service', () => ({ expensesService: costs }));
vi.mock('@/modules/reports/staffFinanceSummary', () => ({ staffFinanceSummary: costs.staff }));
import { managementReportsService } from '@/modules/reports/managementReports.service';
const d = (v: number) => new Decimal(v);
const jan = { preset: 'custom' as const, fromDate: '2026-01-01', toDate: '2026-01-31' };
const feb = { preset: 'custom' as const, fromDate: '2026-02-01', toDate: '2026-02-28' };
let invoices: any[], receipts: any[];
function invoice(total: number, lines?: any[]) {
  const row = { id: String(invoices.length), createdAt: new Date('2026-01-10T12:00:00Z'),
    departmentId: null, department: null, subtotal: d(total), discountTotal: d(0), total: d(total), paidTotal: d(0),
    panelReceivable: d(0), panelRemittanceAllocations: [],
    lines: lines ?? [{ lineGross: d(total), discountAmount: d(0), lineNet: d(total), patientShare: d(total), panelReceivable: d(0), serviceRate: null }] };
  invoices.push(row); return row;
}
function pay(i: any, amount: number, date = '2026-01-15T12:00:00Z', method = 'CASH', reversed = amount < 0) {
  receipts.push({ amount: d(amount), hospitalInvoice: i, collectedAt: new Date(date), method, isReversed: reversed });
  if (!reversed || amount < 0) i.paidTotal = i.paidTotal.plus(amount);
}
beforeEach(() => {
  invoices = []; receipts = [];
  costs.totalBetween.mockResolvedValue(d(0));
  costs.staff.mockResolvedValue({ salaryGenerated: d(0), commissionGenerated: d(0) });
  db.inventoryExpense.aggregate.mockResolvedValue({ _sum: { amount: d(0) } });
  db.hospitalInvoice.findMany.mockImplementation(async ({ where, select, include }) => {
    expect(where.createdAt.gte).toBeUndefined(); // cumulative debt
    expect(where.AND).toBeUndefined(); // payment method never filters billing
    const relations = select ?? include;
    const cutoff = relations.paymentReceipts.where.collectedAt.lte;
    expect(relations.panelRemittanceAllocations.where.panelRemittance.receivedAt.lte).toEqual(cutoff);
    return invoices.filter(i => i.createdAt <= where.createdAt.lte).map(i => ({ ...i,
      paymentReceipts: receipts.filter(r => r.hospitalInvoice === i && r.collectedAt <= cutoff && (!r.isReversed || r.amount.lt(0))) }));
  });
  db.paymentReceipt.findMany.mockImplementation(async ({ where }) => receipts.filter(r =>
    r.collectedAt >= where.collectedAt.gte && r.collectedAt <= where.collectedAt.lte &&
    (!where.method || where.method === r.method) && (!r.isReversed || r.amount.lt(0))));
});
it('recognizes 1500 collected on 2000 billed, then only 500 next month; historical debt survives later payment', async () => {
  pay(invoice(1000), 1000); const partial = invoice(1000); pay(partial, 500);
  pay(partial, 500, '2026-02-10T12:00:00Z');
  const a = await managementReportsService.getSummary(jan);
  expect([a.summary.totalBilling, a.summary.collections, a.summary.collectedIncome, a.summary.outstanding, a.summary.operatingResult].map(Number)).toEqual([2000,1500,1500,500,1500]);
  expect(a.rows.map(r => r.department)).toEqual(['General Hospital Services']);
  expect(Number(a.rows[0].collected)).toBe(1500);
  const b = await managementReportsService.getSummary(feb);
  expect([b.summary.totalBilling,b.summary.collectedIncome,b.summary.outstanding,b.summary.operatingResult].map(Number)).toEqual([0,500,0,500]);
  const register = await managementReportsService.getOutstandingPanel(jan);
  expect(register.rows.map(r => Number(r.due))).toEqual([500]);
});
it('never recognizes an unpaid 5000 invoice as income', async () => {
  invoice(5000); const r = await managementReportsService.getSummary(jan);
  expect(Number(r.summary.collectedIncome)).toBe(0); expect(Number(r.summary.operatingResult)).toBe(0);
  expect(Number(r.summary.outstanding)).toBe(5000);
});
it('counts vouchers and approved staff costs once, excluding cash mirrors and inventory purchases', async () => {
  pay(invoice(10000),10000); costs.totalBetween.mockResolvedValue(d(1000));
  db.inventoryExpense.aggregate.mockResolvedValue({ _sum: { amount: d(500) } });
  costs.staff.mockResolvedValue({ salaryGenerated: d(1000), commissionGenerated: d(500), salaryPaid: d(1000), commissionPaid: d(500) });
  const r = await managementReportsService.getSummary(jan);
  expect(Number(r.summary.totalOperatingCosts)).toBe(3000); expect(Number(r.summary.operatingResult)).toBe(7000);
  expect(db.userCashBalance.aggregate).not.toHaveBeenCalled();
});
it('allocates discounted mixed-department partial payments and refunds to the penny', async () => {
  const lines = [600,400].map((n,j) => ({ lineGross:d(n+100), discountAmount:d(100), lineNet:d(n), patientShare:d(n), panelReceivable:d(0), serviceRate:{ department:{ id:String(j), name:'Dept '+j } } }));
  const i=invoice(1000,lines); i.subtotal=d(1200); i.discountTotal=d(200);
  pay(i,333.33); pay(i,-33.33,'2026-02-10T12:00:00Z');
  const r=await managementReportsService.getSummary(jan);
  expect(r.rows.map(x=>Number(x.collected))).toEqual([200,133.33]);
  expect(Number(r.summary.outstanding)).toBe(666.67);
  expect(Number(r.summary.grossBilling.minus(r.summary.discounts))).toBe(1000);
  const next=await managementReportsService.getSummary(feb);
  expect(next.rows.map(x=>Number(x.collected))).toEqual([-20,-13.33]);
  expect(Number(next.summary.outstanding)).toBe(700);
});
it('reconciles Cash/Online/Bank separately with signed refunds and excludes void positive receipts', async () => {
  const i=invoice(1000);pay(i,300);pay(i,400,undefined,'ONLINE');pay(i,300,undefined,'BANK');pay(i,-50);pay(i,999,undefined,'CASH',true);
  const amounts=[];
  for (const method of ['CASH','ONLINE','BANK'] as const) {
    const r=await managementReportsService.getSummary({...jan,method});
    expect(Number(r.summary.totalBilling)).toBe(1000);expect(Number(r.summary.outstanding)).toBe(50);
    amounts.push(Number(r.summary.collectedIncome));
  }
  expect(amounts).toEqual([250,400,300]);
  expect(Number((await managementReportsService.getSummary(jan)).summary.collectedIncome)).toBe(950);
});
