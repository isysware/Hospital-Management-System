import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { readFileSync } from 'node:fs';
vi.mock('../src/db/client', () => ({ prisma: Object.fromEntries(['hospitalInvoice', 'paymentReceipt', 'expense', 'inventoryExpense', 'salarySlip', 'doctorCommissionAccrual', 'departmentRequisition', 'accountSettlement', 'hmsPharmacySettlementRelease'].map(k => [k, { findMany: vi.fn().mockResolvedValue([]) }])) }));
import { prisma } from '../src/db/client';
import { managementReportsService, resolveExtendedDateRange } from '../src/modules/reports/managementReports.service';
import { projectM01Invoice } from '../src/modules/reports/m01InvoiceProjection';
import { incomeExpenseLedgerQuerySchema } from '../src/modules/reports/managementReports.schemas';
const D = (n: number) => new Decimal(n);
const date = (day: number) => new Date(`2026-11-${day}T10:00:00+05:00`);
const actor = { id: 'cashier', username: 'cashier', displayName: 'Cashier', role: 'FRONT_DESK_BILLING' };
const department = { id: 'clinical', name: 'Configured Hospital Services' };
const line = (amount = 1000, dept = department) => ({ id: 'line', createdAt: date(20), isCompleted: true, billingSource: 'HOSPITAL_SERVICE', lineGross: D(amount), discountAmount: D(0), lineNet: D(amount), patientShare: D(amount), panelReceivable: D(0), quantity: D(1), rateSnapshot: D(amount), descriptionSnapshot: 'Consultation', serviceRate: { name: 'Consultation', department: dept } });
const receipt = (amount: number, day = 20, id = 'r1', method = 'CASH') => ({ id, receiptNumber: `REC-${id}`, amount: D(amount), collectedAt: date(day), method, collectedById: actor.id, collectedBy: actor, isReversed: false });
const invoice = (payments = [receipt(500)]): any => ({ id: 'invoice-db-id', invoiceNumber: 'INV-26-0001', createdAt: date(20), createdById: 'creator', createdByUser: { ...actor, id: 'creator' }, status: 'PAID', subtotal: D(1000), discountTotal: D(0), total: D(1000), paidTotal: D(1000), panelReceivable: D(0), departmentId: null, department: null, doctor: { fullName: 'Actual Doctor' }, encounterType: 'OPD', sourceType: 'WALK_IN', selfPayEncounter: { fullName: 'HUZAIFA', mrNumber: 'MR-1' }, panelPatient: null, admissionRecord: null, lines: [line()], paymentReceipts: payments, panelRemittanceAllocations: [] });
const range = (from = 20, to = from) => resolveExtendedDateRange({ preset: 'custom', fromDate: `2026-11-${from}`, toDate: `2026-11-${to}` });
const query = (extra = {}) => incomeExpenseLedgerQuerySchema.parse({ preset: 'custom', fromDate: '2026-11-20', toDate: '2026-11-20', ...extra });
const project = (inv: any, from = 20, to = from, filters = {}) => { const { start, end } = range(from, to); return projectM01Invoice(inv, start, end, filters); };
beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(prisma) as any[]) model.findMany.mockResolvedValue([]);
  vi.spyOn(managementReportsService, 'getSummary').mockResolvedValue({ summary: { hospitalExpenses: D(0), salaryPaid: D(0), commissionPaid: D(0), directServiceCosts: D(0), payrollCost: D(0), doctorCommissionCost: D(0), expenses: D(0), totalOperatingCosts: D(0), hasIncompleteCost: false, missingCostCount: 0, salaryOutstanding: D(0), commissionOutstanding: D(0) } } as any);
});
describe('M01 consolidated reporting regressions', () => {
  it('shows each old-invoice receipt newest first with actual received and remaining due, without new revenue', async () => {
    const inv = invoice([receipt(200), receipt(300,21,'later-one'), receipt(100,22,'later-two')]);
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([inv]);
    const report = await managementReportsService.getIncomeExpenseLedger(query({fromDate:'2026-11-21',toDate:'2026-11-22'}));
    expect(report.items.map(r => [r.reference,r.collectionsReceived,r.outstandingPayable,r.netRevenue])).toEqual([
      ['REC-later-two',100,400,0], ['REC-later-one',300,400,0],
    ]);
    expect(report.items.every(r => r.transactionType === 'COLLECTION' && r.details?.invoiceId === inv.id)).toBe(true);
    expect(report.columnTotals).toMatchObject({collectionsReceived:400,outstandingPayable:400,netRevenue:0,cashIn:400});
    expect(report.totals.hospitalRevenue.netEarnedRevenue).toBe(0);
    expect(report.totals.collectionsReceivables).toMatchObject({totalCollections:400,closingOutstanding:400});
  });
  it('keeps the original invoice updated alongside its new receipts without duplicating financial totals', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice([receipt(200),receipt(300,21,'later'),receipt(100,22,'last')])]);
    const report = await managementReportsService.getIncomeExpenseLedger(query({toDate:'2026-11-22'}));
    expect(report.items).toHaveLength(3);
    expect(report.items[0]).toMatchObject({reference:'REC-last',collectionsReceived:100,outstandingPayable:400,netRevenue:0});
    expect(report.items.find(r => r.transactionType === 'REVENUE')).toMatchObject({collectionsReceived:600,outstandingPayable:400,netRevenue:1000});
    expect(report.columnTotals).toMatchObject({collectionsReceived:600,outstandingPayable:400,netRevenue:1000});
    expect(report.totals.collectionsReceivables.totalCollections).toBe(600);
    expect(report.totals.profit.operatingProfit).toBe(1000);
  });
  it('does not synthesize a collection without a new receipt and does not leak future receipts', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice([receipt(200),receipt(800,22,'future')])]);
    const report = await managementReportsService.getIncomeExpenseLedger(query());
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({collectionsReceived:200,outstandingPayable:800});
    const quietDay = await managementReportsService.getIncomeExpenseLedger(query({fromDate:'2026-11-21',toDate:'2026-11-21'}));
    expect(quietDay.items).toHaveLength(0);
    expect(quietDay.totals.collectionsReceivables.closingOutstanding).toBe(800);
  });
  it('retains receipt method/collector filters and shows a first payment on an older unpaid invoice', async () => {
    const inv = invoice([receipt(300,21,'cash'),receipt(700,22,'bank','BANK')]);
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([inv]);
    const result = await managementReportsService.getIncomeExpenseLedger({...query({fromDate:'2026-11-21',toDate:'2026-11-22',method:'BANK'}),portalUserId:'cashier'});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({reference:'REC-bank',collectionsReceived:700,outstandingPayable:0,status:'PAID',paymentMethod:'BANK',portalUser:'Cashier'});
    expect(result.items[0].details?.payments).toHaveLength(2);
    expect(result.totals.collectionsReceivables.totalCollections).toBe(1000);
  });
  it('keeps signed refunds and reversed receipts consistent with the existing payment history', async () => {
    const inv = invoice([receipt(500),receipt(-200,21,'refund'),{...receipt(999,21,'void'),isReversed:true}]);
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([inv]);
    const report = await managementReportsService.getIncomeExpenseLedger(query({toDate:'2026-11-21'}));
    expect(report.items).toHaveLength(2);
    expect(report.items[0]).toMatchObject({collectionsReceived:-200,outstandingPayable:700,netRevenue:0});
    expect(report.columnTotals).toMatchObject({collectionsReceived:300,cashIn:300,outstandingPayable:700});
    expect(report.totals.hospitalRevenue.netEarnedRevenue).toBe(1000);
  });
  it('paginates new collection entries only after deduplicating totals and exports the full result', async () => {
    const payments = [receipt(100),...Array.from({length:26},(_,i)=>receipt(10,21,`installment-${i}`))];
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice(payments)]);
    const screen = await managementReportsService.getIncomeExpenseLedger(query({fromDate:'2026-11-21',toDate:'2026-11-21'}));
    const exported = await managementReportsService.getIncomeExpenseLedger(query({fromDate:'2026-11-21',toDate:'2026-11-21',exportAll:'true'}));
    expect(screen.items).toHaveLength(25); expect(screen.totalRecords).toBe(26); expect(exported.items).toHaveLength(26);
    expect(screen.columnTotals).toMatchObject({collectionsReceived:260,outstandingPayable:640,netRevenue:0});
    expect(screen.columnTotals).toEqual(exported.columnTotals);
  });
  it('reuses existing department and panel allocation for individual collection entries', async () => {
    const inv = invoice([receipt(500),receipt(200,21,'later')]);
    inv.lines = [line(600),{...line(400,{id:'other',name:'Other'}),id:'other-line'}];
    const scoped = project(inv,21,21,{departmentId:'clinical'});
    expect(scoped.collectionRows[0]).toMatchObject({collectionsReceived:120,outstandingPayable:180,netRevenue:0});
    const panel = invoice([]); panel.lines[0].patientShare=D(0); panel.lines[0].panelReceivable=D(1000); panel.panelReceivable=D(1000);
    panel.panelRemittanceAllocations=[{allocatedAmount:D(300),panelRemittance:{id:'panel',remittanceNumber:'PR-1',amount:D(900),receivedAt:date(21),method:'Bank Transfer',receivedById:'cashier',receivedByUser:actor}}];
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([panel]);
    const report=await managementReportsService.getIncomeExpenseLedger(query({fromDate:'2026-11-21',toDate:'2026-11-21'}));
    expect(report.items[0]).toMatchObject({reference:'PR-1',collectionsReceived:300,outstandingPayable:700,cashIn:0});
    expect(report.columnTotals).toMatchObject({collectionsReceived:300,outstandingPayable:700,netRevenue:0});
  });
  it('A: one invoice / partial cash payment, historical status, department and detail receipt', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice()]);
    const res = await managementReportsService.getIncomeExpenseLedger(query());
    expect(res.totalRecords).toBe(1);
    expect(res.items[0]).toMatchObject({ reference: 'INV-26-0001', typeLabel: 'OPD / Hospital Billing', department: department.name, status: 'PARTIALLY_PAID', grossBilling: 1000, collectionsReceived: 500, outstandingPayable: 500 });
    expect(res.items[0].details?.payments).toHaveLength(1);
    expect(res.totals.hospitalRevenue.netEarnedRevenue).toBe(1000);
    expect(res.totals.cashMovement.netPhysicalCashMovement).toBe(500);
    expect(res.totals.collectionsReceivables.closingOutstanding).toBe(500);
    expect(res.totals.profit.operatingProfit).toBe(1000);
    expect(prisma.paymentReceipt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ hospitalInvoiceId: null }) }));
  });
  it('B: multiple installments aggregate without duplicating the invoice', () => {
    const { row } = project(invoice([receipt(200), receipt(300,20,'r2'), receipt(100,20,'r3')]));
    expect(row).toMatchObject({ collectionsReceived: 600, outstandingPayable: 400 });
    expect(row?.details.payments).toHaveLength(3);
  });
  it('C: prior-day collection does not rebook revenue or leak future payments', () => {
    const inv = invoice([receipt(500), receipt(500,21,'r2')]);
    expect(project(inv).row).toMatchObject({ grossBilling: 1000, collectionsReceived: 500, outstandingPayable: 500 });
    expect(project(inv,21).row).toMatchObject({ typeLabel: 'Prior-Period Invoice Collection', grossBilling: 0, netRevenue: 0, collectionsReceived: 500, outstandingPayable: 0, status: 'PAID' });
    expect(project(inv,20,21).row).toMatchObject({ grossBilling: 1000, collectionsReceived: 1000, outstandingPayable: 0 });
  });
  it('D: actual service departments and allocated filters reconcile', () => {
    const inv = invoice(); inv.department = { id: 'portal', name: 'Wrong header department' }; inv.lines = [line(600), { ...line(400, { id: 'lab', name: 'Laboratory' }), id: 'line2' }];
    expect(project(inv).row?.department).toBe('Multiple Departments');
    expect(project(inv,20,20,{ departmentId: 'clinical' }).row).toMatchObject({ grossBilling: 600, collectionsReceived: 300, outstandingPayable: 300 });
    expect(project(inv,20,20,{ departmentId: 'lab' }).row).toMatchObject({ grossBilling: 400, collectionsReceived: 200, outstandingPayable: 200 });
    expect(project(inv,20,20,{ departmentId: 'portal' }).row).toBeNull();
  });
  it('E: unpaid invoice remains one row', () => expect(project(invoice([])).row).toMatchObject({ status: 'UNPAID', outstandingPayable: 1000, collectionsReceived: 0 }));
  it('F: recognized expense and unpaid commission stay independent', async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([{ id:'exp', expenseDate:date(20), expenseNumber:'EXP-1', amount:D(80), status:'ACTIVE', paymentMethod:'CASH', createdByUser:actor }] as any);
    vi.mocked(prisma.doctorCommissionAccrual.findMany).mockResolvedValue([{ id:'commission', commissionAmount:D(100), payouts:[], approvedAt:date(20), createdAt:date(20), status:'APPROVED', doctor:{fullName:'Doctor',employeeId:'D1',staffDepartments:[]}, approvedByUser:actor }] as any);
    const res=await managementReportsService.getIncomeExpenseLedger(query());
    expect(res.totalRecords).toBe(2);
    expect(res.items.find(r=>r.transactionType==='COMMISSION')).toMatchObject({ recognizedExpense:100, expensePaid:0, outstandingPayable:100, cashOut:0 });
    expect(res.columnTotals.recognizedExpense).toBe(180);
  });
  it('G: internal settlement has zero revenue, cost and hospital cash effect', async () => {
    vi.mocked(prisma.accountSettlement.findMany).mockResolvedValue([{ id:'settlement', submittedAt:date(20), createdAt:date(20), handoverAmount:D(500),status:'ACCEPTED',submittedByUser:actor,receiverUser:actor }] as any);
    const res=await managementReportsService.getIncomeExpenseLedger(query());
    expect(res.items[0]).toMatchObject({ netRevenue:0, recognizedExpense:0, cashIn:0,cashOut:0 });
    expect(res.totals.cashMovement.netPhysicalCashMovement).toBe(0);
  });
  it('H: count and totals are grouped before pagination; full export is untruncated', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue(Array.from({length: 501},(_,i)=>({...invoice(),id:`inv-${i}`})));
    const screen=await managementReportsService.getIncomeExpenseLedger(query());
    const exported=await managementReportsService.getIncomeExpenseLedger(query({exportAll:'true'}));
    expect(screen.items).toHaveLength(25); expect(screen.totalRecords).toBe(501); expect(exported.items).toHaveLength(501);
    expect(exported.columnTotals).toEqual(screen.columnTotals); expect(exported.totals).toEqual(screen.totals);
  });
  it('I: M01 keeps 12 column table, 25 rows, details, full exports and bordered footer', () => {
    const ui=readFileSync('../frontend/src/features/superAdmin/reports/IncomeExpenseLedgerView.tsx','utf8');
    expect(ui).toContain('useState<number>(25)'); expect(ui).toContain('Payment History'); expect(ui).toContain('Historical Rate');
    expect(ui).toContain('m01SummaryRows(data.totals)'); expect(ui).not.toContain('Collections & Cash'); expect(ui).toContain('<colgroup>'); expect(ui).toContain('min-w-[1430px]'); expect(ui).toContain('overflow-x-auto'); expect(ui).toContain('filters, 1, 500, true');
    for(const kind of ['excel','csv','pdf','print']) expect(ui).toContain(`handleExport('${kind}')`);
    expect(ui).toContain('border-collapse');
  });
  it('payment method filters use eligible receipts while cutoff debt remains authoritative', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice([receipt(200),receipt(300,20,'card','CARD')])]);
    const res=await managementReportsService.getIncomeExpenseLedger(query({method:'CARD',search:'REC-card'}));
    expect(res.items[0]).toMatchObject({ collectionsReceived:300, outstandingPayable:500, cashIn:0 });
    expect(res.totals.cashMovement.netPhysicalCashMovement).toBe(200);
  });
  it('panel remittances use per-invoice allocation, never whole remittance amount', () => {
    const inv=invoice([]); inv.panelReceivable=D(1000); inv.lines[0].panelReceivable=D(1000); inv.lines[0].patientShare=D(0);
    inv.panelRemittanceAllocations=[{allocatedAmount:D(300),panelRemittance:{id:'panel',remittanceNumber:'PR-1',amount:D(900),receivedAt:date(20),method:'Bank Transfer',receivedById:'cashier',receivedByUser:actor}}];
    expect(project(inv).row).toMatchObject({collectionsReceived:300,outstandingPayable:700,paymentMethod:'BANK',cashIn:0});
  });
  it('signed refunds follow approved receipt rules and zero never becomes negative zero', () => {
    const inv=invoice([receipt(500),receipt(-200,20,'refund')]);
    expect(project(inv).row).toMatchObject({collectionsReceived:300,outstandingPayable:700,cashIn:300});
    inv.paymentReceipts=[{...receipt(500),isReversed:true}];
    expect(project(inv).row?.collectionsReceived).toBe(0);
  });
  it('search finds linked receipt and actor finds actual collector', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice()]);
    expect((await managementReportsService.getIncomeExpenseLedger({...query(),portalUserId:'cashier',search:'REC-r1'})).totalRecords).toBe(1);
  });
  it('Karachi custom day starts at 19:00 UTC on previous day', () => expect(range().start.toISOString()).toBe('2026-11-19T19:00:00.000Z'));
  it('later commission payout reduces payable without recognizing the cost again', async () => {
    vi.mocked(prisma.doctorCommissionAccrual.findMany).mockResolvedValue([{ id:'commission', commissionAmount:D(100), payouts:[{id:'payout',amount:D(60),paidAt:date(21),method:'CASH',paidById:'cashier'}], approvedAt:date(20), createdAt:date(20), status:'PARTIALLY_PAID', doctor:{fullName:'Doctor',employeeId:'D1',staffDepartments:[]}, approvedByUser:actor }] as any);
    const res=await managementReportsService.getIncomeExpenseLedger(query({fromDate:'2026-11-21',toDate:'2026-11-21'}));
    expect(res.items[0]).toMatchObject({recognizedExpense:0,expensePaid:60,outstandingPayable:40,cashOut:60});
  });
  it('profit deducts genuine costs once and retains incomplete-cost flag', async () => {
    vi.mocked(prisma.hospitalInvoice.findMany).mockResolvedValue([invoice()]);
    const base=await managementReportsService.getSummary({} as any);
    vi.mocked(managementReportsService.getSummary).mockResolvedValue({...base,summary:{...base.summary,totalOperatingCosts:D(150),directServiceCosts:D(50),doctorCommissionCost:D(100),hasIncompleteCost:true,missingCostCount:1}} as any);
    const res=await managementReportsService.getIncomeExpenseLedger(query());
    expect(res.totals.profit).toMatchObject({grossProfit:950,operatingProfit:850});
    expect(res.totals.hospitalCosts).toMatchObject({totalOperatingCosts:100,hasIncompleteCost:true});
  });

  it('uses the linked appointment department only when invoice/service department is absent', () => {
    const inv = invoice(); inv.lines[0].serviceRate.department = null;
    inv.appointment = { department: { id: 'opd', name: 'Configured OPD Department' } };
    expect(project(inv,20,20,{departmentId:'opd'}).row).toMatchObject({ department: 'Configured OPD Department', grossBilling:1000,collectionsReceived:500,outstandingPayable:500 });
    inv.lines[0].serviceRate.department = department;
    expect(project(inv).row?.department).toBe(department.name);
    inv.lines[0].serviceRate.department = null; inv.appointment = null;
    expect(project(inv).row?.department).toBe('Unassigned');
  });

});
