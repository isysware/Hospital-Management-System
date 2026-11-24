import { beforeEach, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

const db = vi.hoisted(() => Object.fromEntries([
  'hospitalInvoice', 'invoiceLineItem', 'paymentReceipt', 'panelRemittanceAllocation',
  'department', 'providerSettlement', 'hmsPharmacyCharge', 'expense', 'inventoryExpense',
  'salarySlip', 'salaryPayment', 'commissionPayout', 'doctorCommissionAccrual',
  'departmentRequisition', 'accountSettlement', 'hmsPharmacySettlementRelease', 'admissionRecord', 'bed',
].map(k => [k, { findMany: vi.fn(), aggregate: vi.fn(), count: vi.fn(), groupBy: vi.fn() }])));
vi.mock('@/db/client', () => ({ prisma: db }));
vi.mock('@/modules/expenses/expenses.service', () => ({ expensesService: { totalBetween: async () => new Decimal(0) } }));
vi.mock('@/modules/reports/staffFinanceSummary', () => ({ staffFinanceSummary: async () => ({
  sources: [], salaryGenerated: new Decimal(0), salaryPaid: new Decimal(0), salaryOutstanding: new Decimal(0),
  commissionGenerated: new Decimal(0), commissionPaid: new Decimal(0), commissionOutstanding: new Decimal(0),
}) }));

import { managementReportsService as reports } from '@/modules/reports/managementReports.service';
import { setupService } from '@/modules/setup/setup.service';
import { allocateInvoiceAmount, collectionInvoiceSelect } from '@/shared/departmentCollections';
import { projectM01Invoice } from '@/modules/reports/m01InvoiceProjection';

const D = (n: number) => new Decimal(n);
const now = new Date('2026-11-22T10:00:00Z');
const query = { preset: 'custom' as const, fromDate: '2026-11-22', toDate: '2026-11-22' };
const actor = { id: 'actor', username: 'cashier', displayName: 'Cashier', role: 'FRONT_DESK_BILLING' };
const internal = { id: 'internal', name: 'Hospital', fulfillmentOwnership: 'INTERNAL' };
const outsourced = (id: string) => ({ id, name: `Configurable ${id}`, code: id, fulfillmentOwnership: 'OUTSOURCED',
  outsourcedProviderId: `provider-${id}`, outsourcedProvider: { id: `provider-${id}`, name: `Provider ${id}` } });
let invoices: any[], receipts: any[], departments: any[], settlements: any[];
let lineSequence = 0;
const inRange = (date: Date, range: any) => !range || ((!range.gte || date >= range.gte) && (!range.lte || date <= range.lte));
function line(amount: number, options: any = {}) {
  return { id: `line-${lineSequence++}`, createdAt: now, isCompleted: true, billingSource: 'HOSPITAL_SERVICE',
    lineGross: D(amount), discountAmount: D(0), lineNet: D(amount), patientShare: D(amount), panelReceivable: D(0),
    quantity: D(1), rateSnapshot: D(amount), serviceRate: { name: 'Service', providerType: 'INTERNAL', department: internal }, ...options };
}
function invoice(lines: any[], department: any = internal, createdAt = now) {
  const total = lines.reduce((s, l) => s.plus(l.lineNet), D(0));
  const inv = { id: `invoice-${invoices.length}`, invoiceNumber: `INV-${invoices.length}`, createdAt,
    status: 'PARTIALLY_PAID', departmentId: department?.id ?? null, department, encounterType: 'OPD', sourceType: 'WALK_IN',
    subtotal: lines.reduce((s, l) => s.plus(l.lineGross), D(0)), discountTotal: lines.reduce((s, l) => s.plus(l.discountAmount), D(0)),
    total, paidTotal: D(0), panelReceivable: lines.reduce((s, l) => s.plus(l.panelReceivable), D(0)),
    createdById: actor.id, createdByUser: actor, lines, paymentReceipts: [] as any[], panelRemittanceAllocations: [] as any[],
    selfPayEncounter: null, panelPatient: null, admissionRecord: null, appointment: null, doctor: null };
  invoices.push(inv); return inv;
}
function pay(inv: any, amount: number, collectedAt = now) {
  const receipt = { id: `receipt-${receipts.length}`, receiptNumber: `REC-${receipts.length}`, amount: D(amount), collectedAt,
    method: 'CASH', isReversed: amount < 0, collectedById: actor.id, collectedBy: actor, hospitalInvoice: inv };
  inv.paymentReceipts.push(receipt); inv.paidTotal = inv.paidTotal.plus(amount); receipts.push(receipt);
}
beforeEach(() => {
  vi.clearAllMocks(); invoices = []; receipts = []; departments = [internal]; settlements = []; lineSequence = 0;
  for (const model of Object.values(db)) {
    model.findMany.mockResolvedValue([]); model.count.mockResolvedValue(0);
    model.groupBy.mockResolvedValue([]); model.aggregate.mockResolvedValue({ _sum: { amount: null } });
  }
  db.department.findMany.mockImplementation(async () => departments);
  db.providerSettlement.findMany.mockImplementation(async () => settlements);
  db.hospitalInvoice.findMany.mockImplementation(async ({ where }) => invoices.filter(i => i.status !== 'VOID' && inRange(i.createdAt, where.createdAt)));
  db.invoiceLineItem.findMany.mockImplementation(async ({ where }) => invoices.flatMap(i => i.lines.map((l: any) => ({ ...l, hospitalInvoice: i })))
    .filter(l => l.hospitalInvoice.status !== 'VOID' && inRange(l.createdAt, where.createdAt)
      && inRange(l.hospitalInvoice.createdAt, where.hospitalInvoice?.createdAt)
      && (!where.isCompleted || l.isCompleted) && (!where.billingSource?.not || l.billingSource !== where.billingSource.not)));
  db.paymentReceipt.findMany.mockImplementation(async ({ where }) => where.hospitalInvoiceId === null ? [] : receipts.filter(r => inRange(r.collectedAt, where.collectedAt)));
});

async function allReports(departmentId?: string) {
  const q = { ...query, departmentId };
  return { m01: await reports.getIncomeExpenseLedger(q), summary: await reports.getSummary(q),
    m04: await reports.getOperatingProfitStatement({ ...q, comparison: 'none' }) };
}
function expectEarnings(result: Awaited<ReturnType<typeof allReports>>, amount: number) {
  expect(result.m01.totals.hospitalRevenue.netEarnedRevenue).toBe(amount);
  expect(Number(result.summary.summary.netEarnedRevenue)).toBe(amount);
  expect(result.m04.summary.revenue).toBe(amount);
  expect(result.m01.totals.profit.operatingProfit).toBe(amount);
  expect(Number(result.summary.summary.operatingProfit)).toBe(amount);
  expect(result.m04.summary.operatingProfit).toBe(amount);
}

it('reconciles 2500 Hospital earnings across all reports while retaining 4500 patient billing and collections', async () => {
  const a = outsourced('arbitrary-a'), b = outsourced('arbitrary-b'); departments.push(a, b);
  pay(invoice([line(1000)]), 1000);
  pay(invoice([line(1500), line(1000, { billingSource: 'OUTSOURCED_SERVICE', serviceRate: { department: a, providerType: 'OUTSOURCED' } })]), 2500);
  pay(invoice([line(1000, { serviceRate: { department: b, providerType: 'OUTSOURCED' } })]), 1000);
  const res = await allReports(); expectEarnings(res, 2500);
  expect(res.m01.items).toHaveLength(3);
  expect(res.m01.columnTotals.grossBilling).toBe(4500);
  expect(res.m01.totals.collectionsReceivables.totalCollections).toBe(4500);
  expect(Number(res.summary.summary.totalBilling)).toBe(4500);
  expect(Number(res.summary.summary.collections)).toBe(4500);
  expect(res.m04.summary.totalOutsourcedBilling).toBe(2000);
  expect(res.m04.warnings).toEqual([]);
  expectEarnings(await allReports(a.id), 0);
});

it('keeps Pharmacy and incomplete lines in patient history but excludes them from earnings and earned discounts', async () => {
  const inv = invoice([line(1000, { lineGross: D(1100), discountAmount: D(100) }),
    line(700, { billingSource: 'PHARMACY', serviceRate: null }), line(300, { isCompleted: false })]);
  pay(inv, 800);
  const res = await allReports(); expectEarnings(res, 1000);
  expect(res.m01.totals.hospitalRevenue).toMatchObject({ grossEarnedBilling: 1100, discounts: 100 });
  expect(res.m01.items[0]).toMatchObject({ grossBilling: 2100, discountCredit: 100, netRevenue: 1000, collectionsReceived: 800, outstandingPayable: 1200 });
  expect(res.m01.items[0].details?.lines).toHaveLength(3);
  expect(inv.total.toNumber()).toBe(2000);
});

it.each(['ownership', 'providerType', 'billingSource', 'appointment', 'admission'])('classifies outsourcing dynamically via %s', async route => {
  const dept = outsourced(`configured-${route}`); departments.push(dept);
  const l = line(1000);
  let header: any = internal;
  if (route === 'ownership') l.serviceRate = { department: dept, providerType: 'INTERNAL' };
  if (route === 'providerType') l.serviceRate.providerType = 'OUTSOURCED';
  if (route === 'billingSource') l.billingSource = 'OUTSOURCED_SERVICE';
  if (route === 'appointment' || route === 'admission') { l.serviceRate = null; l.billingSource = 'OUTSOURCED_SERVICE'; header = null; }
  const inv = invoice([l], header);
  if (route === 'appointment') inv.appointment = { department: dept } as any;
  if (route === 'admission') inv.admissionRecord = { department: dept, admissionNumber: 'ADM-fixture' } as any;
  expectEarnings(await allReports(), 0);
  dept.name = 'Renamed without changing identity';
  expectEarnings(await allReports(dept.id), 0);
});

it.each([2500, 1000, 500])('keeps department-less internal services out of an outsourced invoice header for a %s collection', async amount => {
  const dept = outsourced('configured-provider-department'); departments.push(dept);
  const inv = invoice([
    line(1500, { serviceRate: { providerType: 'INTERNAL', department: null } }),
    line(1000, { billingSource: 'OUTSOURCED_SERVICE', serviceRate: { providerType: 'OUTSOURCED', department: dept } }),
  ], dept);
  pay(inv, amount);
  const result = await allReports(); expectEarnings(result, 1500);
  expect(result.m04.summary.totalOutsourcedBilling).toBe(1000);
  expect(result.m04.summary.totalOutsourcedPayable).toBe(amount * 0.4);
  expect(result.m01.totals.collectionsReceivables).toMatchObject({ totalCollections: amount, closingOutstanding: 2500 - amount });
  expect(result.m01.items[0]).toMatchObject({ grossBilling: 2500, netRevenue: 1500, collectionsReceived: amount, outstandingPayable: 2500 - amount });
  const payable = (await setupService.getDepartmentPayablesSummary(query)).departments.find(d => d.departmentId === dept.id)!;
  expect(payable).toMatchObject({ servicesCount: 1, periodBilled: 1000, periodRealized: amount * 0.4, remainingPayable: amount * 0.4 });
  const scoped = await allReports(dept.id); expectEarnings(scoped, 0);
  expect(scoped.m01.columnTotals.grossBilling).toBe(1000);
  expect(scoped.m01.totals.collectionsReceivables.totalCollections).toBe(amount * 0.4);
  expect(inv.total.toNumber()).toBe(2500); expect(inv.paymentReceipts).toHaveLength(1);
});

it('splits refunds and future receipts by line without reassigning internal money to the provider', async () => {
  const dept = outsourced('arbitrary-refund-department'); departments.push(dept);
  const inv = invoice([line(1500, { serviceRate: { providerType: 'INTERNAL', department: null } }),
    line(1000, { billingSource: 'OUTSOURCED_SERVICE', serviceRate: { providerType: 'OUTSOURCED', department: dept } })], dept);
  pay(inv, 1000); pay(inv, -250); pay(inv, 1750, new Date('2026-11-23T10:00:00Z'));
  expect((await allReports()).m04.summary.totalOutsourcedPayable).toBe(300);
  const next = await setupService.getDepartmentPayablesSummary({ preset: 'custom', fromDate: '2026-11-23', toDate: '2026-11-23' });
  expect(next.departments.find(d => d.departmentId === dept.id)).toMatchObject({ openingBalance: 300, periodRealized: 700, remainingPayable: 1000 });
});

it('separates multiple dynamic providers and a department-less internal line on one invoice', async () => {
  const a = outsourced('provider-a'), b = outsourced('provider-b'); departments.push(a, b);
  const inv = invoice([line(1500, { serviceRate: { providerType: 'INTERNAL', department: null } }),
    line(1000, { billingSource: 'OUTSOURCED_SERVICE', serviceRate: { providerType: 'OUTSOURCED', department: a } }),
    line(2000, { billingSource: 'OUTSOURCED_SERVICE', serviceRate: { providerType: 'OUTSOURCED', department: b } })], a);
  pay(inv, 2250);
  expectEarnings(await allReports(), 1500);
  const payable = await setupService.getDepartmentPayablesSummary(query);
  expect(payable.departments.find(d => d.departmentId === a.id)).toMatchObject({ periodBilled: 1000, remainingPayable: 500 });
  expect(payable.departments.find(d => d.departmentId === b.id)).toMatchObject({ periodBilled: 2000, remainingPayable: 1000 });
  a.name = 'Renamed provider'; b.name = 'Another new name';
  expectEarnings(await allReports(), 1500);
});

it('does not turn a direct internal charge into outsourcing when no service rate is linked', async () => {
  const dept = outsourced('header-only'); departments.push(dept);
  const inv = invoice([line(1500, { serviceRate: null, billingSource: 'HOSPITAL_SERVICE' })], dept); pay(inv, 1500);
  const result = await allReports(); expectEarnings(result, 1500);
  expect(result.m04.summary.totalOutsourcedBilling).toBe(0);
  expect(result.m04.summary.totalOutsourcedPayable).toBe(0);
});

it('earns a later completed line on its own date and does not rebook old earnings for a new collection', async () => {
  const yesterday = new Date('2026-11-21T10:00:00Z');
  const inv = invoice([line(1000, { createdAt: yesterday }), line(500)], internal, yesterday); pay(inv, 1200);
  expectEarnings(await allReports(), 500);
  inv.lines.pop();
  const res = await allReports(); expectEarnings(res, 0);
  expect(res.m01.items[0]).toMatchObject({ transactionType: 'COLLECTION', collectionsReceived: 1200, netRevenue: 0 });
});

it('does not infer completed earnings from a line-less invoice or a VOID invoice', async () => {
  const noLines = invoice([]); noLines.total = D(700); noLines.subtotal = D(700);
  const voided = invoice([line(1000)]); voided.status = 'VOID';
  expectEarnings(await allReports(), 0);
  const p = projectM01Invoice(voided, new Date('2026-11-21T19:00:00Z'), new Date('2026-11-22T18:59:59Z'));
  expect(p.row?.netRevenue).toBe(0);
});

it('excludes Pharmacy from payable billing and splits partial collections without redistributing its share', async () => {
  const dept = outsourced('dynamic-provider'); departments.push(dept);
  const inv = invoice([line(1000, { serviceRate: { department: dept, providerType: 'OUTSOURCED' } }),
    line(700, { billingSource: 'PHARMACY', serviceRate: null })], dept);
  pay(inv, 850);
  let result = await setupService.getDepartmentPayablesSummary(query);
  expect(result.departments.find(d => d.departmentId === dept.id)).toMatchObject({ periodBilled: 1000, periodRealized: 500, remainingPayable: 500 });
  expect(collectionInvoiceSelect.lines.select.billingSource).toBe(true);
  expect(db.invoiceLineItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ billingSource: { not: 'PHARMACY' } }) }));
  expect(allocateInvoiceAmount(D(850), inv, 'patientShare').reduce((s, a) => s.plus(a.amount), D(0)).toNumber()).toBe(850);
  pay(inv, -170);
  settlements.push({ id: 'settlement', departmentId: dept.id, outsourcedProviderId: dept.outsourcedProviderId, settledAt: now, settlementAmount: D(100) });
  result = await setupService.getDepartmentPayablesSummary(query);
  expect(result.departments.find(d => d.departmentId === dept.id)).toMatchObject({ periodRealized: 400, periodSettled: 100, remainingPayable: 300 });
});

it('uses panel coverage weights, excluding Pharmacy panel collections from provider entitlement', async () => {
  const dept = outsourced('panel-provider'); departments.push(dept);
  const inv = invoice([line(1000, { serviceRate: { department: dept }, patientShare: D(800), panelReceivable: D(200) }),
    line(700, { billingSource: 'PHARMACY', serviceRate: null, patientShare: D(0), panelReceivable: D(700) })], dept);
  pay(inv, 400);
  db.panelRemittanceAllocation.findMany.mockResolvedValue([{ hospitalInvoice: inv, allocatedAmount: D(450), panelRemittance: { receivedAt: now } }]);
  const result = await setupService.getDepartmentPayablesSummary(query);
  expect(result.departments.find(d => d.departmentId === dept.id)).toMatchObject({ periodRealized: 500, remainingPayable: 500 });
});

it('never gives a Pharmacy-only invoice or unweighted Pharmacy invoice a provider fallback balance', () => {
  const inv = invoice([line(700, { billingSource: 'PHARMACY', serviceRate: null })], outsourced('fallback'));
  expect(allocateInvoiceAmount(D(700), inv, 'patientShare', { excludePharmacy: true })).toEqual([]);
  inv.lines[0].lineNet = D(0); inv.lines[0].patientShare = D(0);
  expect(allocateInvoiceAmount(D(700), inv, 'patientShare', { excludePharmacy: true })).toEqual([]);
});

it('preserves cent allocation and signed reversals for multiple provider departments with Pharmacy', () => {
  const a = outsourced('a'), b = outsourced('b');
  const inv = invoice([line(1, { serviceRate: { department: a } }), line(1, { serviceRate: { department: b } }), line(1, { billingSource: 'PHARMACY' })]);
  const positive = allocateInvoiceAmount(D(0.07), inv, 'patientShare', { excludePharmacy: true });
  const negative = allocateInvoiceAmount(D(-0.07), inv, 'patientShare', { excludePharmacy: true });
  expect(positive.map(r => r.amount.toNumber())).toEqual(negative.map(r => r.amount.negated().toNumber()));
  expect(positive.reduce((s, r) => s.plus(r.amount), D(0)).lte(0.07)).toBe(true);
  expect(positive.every(r => r.amount.gte(0))).toBe(true);
  const original = allocateInvoiceAmount(D(0.07), inv, 'patientShare');
  // The Pharmacy line falls back to the internal invoice header, so neither provider's rounding changes.
  for (const row of positive) expect(row.amount.eq(original.find(r => r.departmentId === row.departmentId)!.amount)).toBe(true);
});
