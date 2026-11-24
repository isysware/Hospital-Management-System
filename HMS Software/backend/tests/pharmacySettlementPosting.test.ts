import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// Explicit opt-in only; never use DATABASE_URL or an operational database.
vi.mock('@/db/client', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.P1_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55439/postgres' } } }) };
});
const bridge = vi.hoisted(() => vi.fn());
vi.mock('@/shared/pharmacyBridgeClient', () => ({ pharmacyBridgeClient: { releaseSettlement: bridge } }));
import { prisma } from '@/db/client';
import { releasePharmacySettlement as release } from '@/modules/pharmacy-bridge/settlementRelease';
import { managementReportsService as reports } from '@/modules/reports/managementReports.service';
import { cashService } from '@/modules/cash/cash.service';
import { pharmacyBridgeService } from '@/modules/pharmacy-bridge/pharmacy-bridge.service';

describe.skipIf(!process.env.P1_TEST_DATABASE_URL)('P1 isolated PostgreSQL payment integrity', () => {
  let actor: string, department: string, admission: string, charge: string, settlement: string;
  beforeAll(async () => {
    const url = new URL(process.env.P1_TEST_DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/postgres') throw new Error('Only isolated P1 PostgreSQL is allowed');
    const rows = await prisma.$queryRawUnsafe<Array<{ data_directory: string }>>('SHOW data_directory');
    if (!rows[0].data_directory.includes('hms-p1-postgres-')) throw new Error('Not the temporary P1 cluster');
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    bridge.mockReset(); bridge.mockResolvedValue({});
    actor = (await prisma.portalUser.create({ data: { username: randomUUID(), passwordHash: 'isolated-fixture', role: 'ADMIN' } })).id;
    department = (await prisma.department.create({ data: { code: randomUUID(), name: 'Isolated clinical department', departmentType: 'CLINICAL' } })).id;
    admission = (await prisma.admissionRecord.create({ data: { admissionNumber: randomUUID(), departmentId: department } })).id;
    charge = (await prisma.hmsPharmacyCharge.create({ data: { admissionRecordId: admission, pharmacyInvoiceNumber: randomUUID(), totalAmount: 1000, patientPaid: 1000 } })).id;
    settlement = (await prisma.hmsPharmacySettlement.create({ data: { settlementNumber: randomUUID(), pharmacyChargeId: charge,
      pharmacyInvoiceNumber: randomUUID(), requestedAmount: 1000, remainingAmount: 1000, status: 'REQUESTED' } })).id;
    await prisma.userCashBalance.create({ data: { portalUserId: actor, moduleScope: 'BILLING', direction: 'IN', amount: 1000, category: 'COLLECTION', isPhysicalCash: true } });
  });
  const pay = (amount: number, method: 'CASH' | 'BANK' | 'ONLINE', key = randomUUID(), reference?: string) =>
    release(settlement, { releasedAmount: amount, paymentMethod: method, idempotencyKey: key, paymentReference: reference }, actor, 'ADMIN');
  const releases = () => prisma.hmsPharmacySettlementRelease.findMany({ where: { settlementId: settlement }, orderBy: { releasedAt: 'asc' } });
  const balance = () => cashService.getCashierBalanceSheet(actor);

  it.each(['CASH', 'BANK', 'ONLINE'] as const)('full %s payment posts once without an Expense', async method => {
    const result = await pay(1000, method);
    expect(Number(result.remainingAmount)).toBe(0); expect(result.status).toBe('SETTLED');
    expect(await releases()).toHaveLength(1);
    expect(await prisma.expense.count({ where: { createdById: actor } })).toBe(0);
    expect(Number((await balance()).summary.expectedPhysicalCash)).toBe(method === 'CASH' ? 0 : 1000);
    expect(result.release.releasedById).toBe(actor);
    expect(result.release.cashEntryId !== null).toBe(method === 'CASH');
  });
  it('preserves 300 Cash + 400 Bank and a 300 remaining obligation', async () => {
    await pay(300, 'CASH', randomUUID(), 'cash-A');
    const key = randomUUID(); await pay(400, 'BANK', key, 'bank-B');
    const replay = await pay(400, 'BANK', key, 'bank-B');
    expect(replay.replayed).toBe(true);
    expect(Number(replay.releasedAmount)).toBe(700); expect(Number(replay.remainingAmount)).toBe(300);
    expect((await releases()).map(r => [Number(r.amount), r.paymentMethod])).toEqual([[300, 'CASH'], [400, 'BANK']]);
    const sheet = await balance(); expect(Number(sheet.summary.expectedPhysicalCash)).toBe(700);
    expect(Number(sheet.summary.cashExpenses)).toBe(0); expect(Number(sheet.summary.settlementCashOut)).toBe(300);
    const oversight = await reports.getBalanceSettlements({ preset: 'today', portalUserId: actor });
    expect(Number(oversight.rows[0].expenses)).toBe(0);
    expect(Number(oversight.rows[0].pharmacySettlementOut)).toBe(300);
    expect(Number(oversight.rows[0].remaining)).toBe(700);
    expect(bridge).toHaveBeenCalledTimes(2);
  });
  it('serializes concurrent identical requests, including fully settled retries', async () => {
    const key = randomUUID(); const result = await Promise.all([pay(1000, 'CASH', key), pay(1000, 'CASH', key)]);
    expect(result.filter(r => r.replayed)).toHaveLength(1); expect(await releases()).toHaveLength(1);
    expect(Number((await balance()).summary.expectedPhysicalCash)).toBe(0); expect(bridge).toHaveBeenCalledOnce();
  });
  it('serializes distinct concurrent payments and prevents overpayment', async () => {
    const result = await Promise.allSettled([pay(700, 'BANK'), pay(700, 'BANK')]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await releases()).toHaveLength(1);
    expect(Number((await prisma.hmsPharmacySettlement.findUniqueOrThrow({ where: { id: settlement } })).remainingAmount)).toBe(300);
  });
  it('rejects key reuse with a different amount or method', async () => {
    const key = randomUUID(); await pay(300, 'BANK', key);
    await expect(pay(301, 'BANK', key)).rejects.toThrow('different payment data');
    await expect(pay(300, 'CASH', key)).rejects.toThrow('different payment data');
    expect(await releases()).toHaveLength(1);
  });
  it('deduplicates a payment reference even if an old client sends a new key', async () => {
    await pay(300, 'BANK', randomUUID(), 'bank-reference');
    expect((await pay(300, 'BANK', randomUUID(), 'bank-reference')).replayed).toBe(true);
    await expect(pay(400, 'BANK', randomUUID(), 'bank-reference')).rejects.toThrow('different payment data');
    expect(await releases()).toHaveLength(1);
  });
  it('rejects overpayment, non-admin actors and insufficient custody', async () => {
    await expect(pay(1001, 'BANK')).rejects.toThrow('remaining amount');
    await expect(release(settlement, { releasedAmount: 100, paymentMethod: 'BANK', idempotencyKey: randomUUID() }, actor, 'FRONT_DESK_BILLING')).rejects.toThrow('Only Super Admin');
    await prisma.userCashBalance.create({ data: { portalUserId: actor, moduleScope: 'BILLING', direction: 'OUT', amount: 900, category: 'RECOVERY', isPhysicalCash: true } });
    await expect(pay(300, 'CASH')).rejects.toThrow('Insufficient cash'); expect(await releases()).toHaveLength(0);
  });
  it('rolls back cash and release history if a required charge update fails', async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION p1_fail_charge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'P1 injected failure'; END; $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER p1_fail_charge BEFORE UPDATE ON hms_pharmacy_charges FOR EACH ROW EXECUTE FUNCTION p1_fail_charge()');
    try { await expect(pay(300, 'CASH')).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER p1_fail_charge ON hms_pharmacy_charges'); await prisma.$executeRawUnsafe('DROP FUNCTION p1_fail_charge()'); }
    expect(await releases()).toHaveLength(0); expect(Number((await balance()).summary.expectedPhysicalCash)).toBe(1000);
    expect(Number((await prisma.hmsPharmacySettlement.findUniqueOrThrow({ where: { id: settlement } })).releasedAmount)).toBe(0);
    expect(bridge).not.toHaveBeenCalled();
  });
  it('keeps a committed payment and flags ambiguous bridge delivery without resending', async () => {
    bridge.mockRejectedValue(new Error('timeout after remote commit')); const key = randomUUID();
    const result = await pay(300, 'BANK', key);
    expect(result.release.bridgeStatus).toBe('RECONCILIATION_REQUIRED');
    await pay(300, 'BANK', key); expect(bridge).toHaveBeenCalledOnce(); expect(await releases()).toHaveLength(1);
  });
  it('protects immutable financial history in PostgreSQL', async () => {
    const result = await pay(100, 'BANK');
    await expect(prisma.hmsPharmacySettlementRelease.update({ where: { id: result.release.id }, data: { amount: 200 } })).rejects.toThrow('immutable');
    await expect(prisma.hmsPharmacySettlementRelease.delete({ where: { id: result.release.id } })).rejects.toThrow('append-only');
  });
  it('blocks unreconciled historical balances without modifying legacy vouchers', async () => {
    await prisma.hmsPharmacySettlement.update({ where: { id: settlement }, data: { releasedAmount: 300, remainingAmount: 700, status: 'PARTIALLY_RELEASED' } });
    await expect(pay(100, 'BANK')).rejects.toThrow('Historical settlement'); expect(await releases()).toHaveLength(0);
    expect((await pharmacyBridgeService.listSettlements()).find(s => s.id === settlement)?.reconciliationRequired).toBe(true);
  });
  it('does not reset partial-payment balances when the Pharmacy request is retried', async () => {
    await pay(300, 'BANK');
    const parent = await prisma.hmsPharmacySettlement.findUniqueOrThrow({ where: { id: settlement } });
    const pharmacyCharge = await prisma.hmsPharmacyCharge.findUniqueOrThrow({ where: { id: charge } });
    const retried = await pharmacyBridgeService.handleSettlementRequest({ settlementNumber: parent.settlementNumber,
      pharmacyInvoiceNumber: pharmacyCharge.pharmacyInvoiceNumber, requestedAmount: 1000 });
    expect(retried.status).toBe('PARTIALLY_RELEASED'); expect(Number(retried.remainingAmount)).toBe(700);
    await pay(700, 'BANK');
  });
  it('does not let a reference belonging to another payment override an existing key', async () => {
    const key = randomUUID(); await pay(100, 'BANK', key, 'A'); await pay(100, 'BANK', randomUUID(), 'B');
    await expect(pay(100, 'BANK', key, 'B')).rejects.toThrow('different payment data');
    expect(await releases()).toHaveLength(2);
  });
  it('locks shared cash custody across concurrent different settlements', async () => {
    const otherCharge = await prisma.hmsPharmacyCharge.create({ data: { admissionRecordId: admission, pharmacyInvoiceNumber: randomUUID(), totalAmount: 1000, patientPaid: 1000 } });
    const second = await prisma.hmsPharmacySettlement.create({ data: { settlementNumber: randomUUID(), pharmacyChargeId: otherCharge.id,
      pharmacyInvoiceNumber: randomUUID(), requestedAmount: 1000, remainingAmount: 1000, status: 'REQUESTED' } });
    const result = await Promise.allSettled([pay(700, 'CASH'), release(second.id,
      { releasedAmount: 700, paymentMethod: 'CASH', idempotencyKey: randomUUID() }, actor, 'ADMIN')]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(Number((await balance()).summary.expectedPhysicalCash)).toBe(300);
  });
  it('excludes only explicitly reconciled historical vouchers and preserves their evidence', async () => {
    const old = await prisma.expense.create({ data: { expenseNumber: randomUUID(), expenseDate: new Date(), category: 'MEDICAL_SUPPLIES', amount: 300,
      paymentMethod: 'BANK', paidTo: 'Legacy payee', departmentId: department, createdById: actor, reference: 'old-payment' } });
    const record = { settlementId: settlement, amount: 300, paymentMethod: 'BANK' as const, paymentReference: 'old-payment',
      idempotencyKey: randomUUID(), releasedById: actor, legacyExpenseId: old.id, bridgeStatus: 'DELIVERED' };
    await expect(prisma.hmsPharmacySettlementRelease.create({ data: record })).rejects.toThrow();
    await prisma.hmsPharmacySettlementRelease.create({ data: { ...record, reconciliationEvidence: 'Isolated fixture: signed voucher and bank confirmation reviewed together' } });
    await prisma.hmsPharmacySettlement.update({ where: { id: settlement }, data: { releasedAmount: 300, remainingAmount: 700, status: 'PARTIALLY_RELEASED' } });
    const q = { preset: 'today' as const, departmentId: department };
    expect(Number((await reports.getDetailedExpenses(q)).summary.totalHospitalExpenses)).toBe(0);
    expect(Number((await reports.getSummary(q)).summary.hospitalExpenses)).toBe(0);
    const ledger = await reports.getIncomeExpenseLedger(q);
    expect(ledger.totals.cashMovement.pharmacySettlementOutflows).toBe(300);
    expect(ledger.items.filter(r => r.details?.legacyExpenseId === old.id)).toHaveLength(1);
    expect(await prisma.expense.findUnique({ where: { id: old.id } })).toEqual(old);
  });
  it('reconciles M01, M03, Summary and M04 with Pharmacy revenue and outflows isolated', async () => {
    const inv = await prisma.hospitalInvoice.create({ data: { invoiceNumber: randomUUID(), sourceType: 'WALK_IN', encounterType: 'OPD',
      departmentId: department, admissionRecordId: admission, createdById: actor,
      subtotal: 1700, total: 1700, patientShare: 1700, paidTotal: 1700, status: 'PAID',
      lines: { create: [1000, 700].map((n, i) => ({ billingSource: i ? 'PHARMACY' as const : 'HOSPITAL_SERVICE' as const,
        isCompleted: true, descriptionSnapshot: i ? 'Medicine' : 'Hospital service', quantity: 1, rateSnapshot: n,
        lineGross: n, lineNet: n, patientShare: n })) } } });
    await prisma.paymentReceipt.create({ data: { receiptNumber: randomUUID(), hospitalInvoiceId: inv.id, amount: 1700, method: 'CASH', collectedById: actor } });
    await pay(300, 'CASH'); await pay(400, 'BANK');
    const q = { preset: 'today' as const, departmentId: department };
    const m01 = await reports.getIncomeExpenseLedger(q), m03 = await reports.getDetailedExpenses(q), summary = await reports.getSummary(q);
    const m04 = await reports.getOperatingProfitStatement({ ...q, comparison: 'none' });
    expect(m01.totals.hospitalRevenue.netEarnedRevenue).toBe(1000); expect(m01.totals.profit.operatingProfit).toBe(1000);
    expect(m01.totals.cashMovement).toMatchObject({ pharmacySettlementOutflows: 700, actualPaidOperatingExpenses: 0, nonOperatingCashOutflows: 300, netTotalFundsMovement: 1000 });
    expect(Number(m03.summary.totalOperatingCosts)).toBe(0); expect(Number(summary.summary.operatingProfit)).toBe(1000);
    expect(m04.summary.revenue).toBe(1000); expect(m04.summary.operatingProfit).toBe(1000);
    await prisma.expense.create({ data: { expenseNumber: randomUUID(), expenseDate: new Date(), category: 'MEDICAL_SUPPLIES', amount: 125,
      paymentMethod: 'CASH', paidTo: 'Legitimate supplier', departmentId: department, createdById: actor } });
    expect(Number((await reports.getDetailedExpenses(q)).summary.totalHospitalExpenses)).toBe(125);
    expect(Number((await reports.getSummary(q)).summary.operatingProfit)).toBe(875);
    expect((await reports.getIncomeExpenseLedger(q)).totals.profit.operatingProfit).toBe(875);
    expect((await reports.getOperatingProfitStatement({ ...q, comparison: 'none' })).summary.operatingProfit).toBe(875);
  });
});
