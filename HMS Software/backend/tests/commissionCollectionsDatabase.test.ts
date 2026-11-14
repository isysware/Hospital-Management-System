import 'dotenv/config';
import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';

// Services use real Prisma delegates in one rollback-only database transaction.
const holder = vi.hoisted(() => ({ tx: null as any }));
vi.mock('@/db/client', () => ({ prisma: new Proxy({}, { get: (_, key) => key === '$transaction'
  ? (fn: any) => typeof fn === 'function' ? fn(holder.tx) : Promise.all(fn) : holder.tx[key] }) }));
import { commissionService, commissionInclude } from '@/modules/commission/commission.service';
import { commissionRunService } from '@/modules/commission/commissionRun.service';
import { commissionBalance } from '@/modules/commission/commission.calc';
import { staffFinanceSummary } from '@/modules/reports/staffFinanceSummary';
import { invoicesService } from '@/modules/frontdesk/invoices.service';
import { managementReportsService } from '@/modules/reports/managementReports.service';

describe.runIf(process.env.HMS_COMMISSION_DB_TEST === '1')('collection commission / real PostgreSQL', () => {
  it('reconciles partial/full/cross-month receipts, multiple doctors, refunds, paid recovery and duplicate callbacks', async () => {
    const db = new PrismaClient(), marker = `COLL-${randomUUID()}`, rollback = new Error('ROLLBACK');
    try {
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-commission-regression-fixtures'))`;
        holder.tx = tx;
        const actor = await tx.portalUser.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
        const jan = new Date('2026-01-01'), feb = new Date('2026-02-01');
        const dept = await tx.department.create({ data: { code: marker, name: marker, departmentType: 'CLINICAL' } });
        const dept2 = await tx.department.create({ data: { code: `${marker}-2`, name: `${marker}-2`, departmentType: 'CLINICAL' } });
        const service = await tx.serviceRate.create({ data: { code: marker, name: marker, standardRate: 1000, billingUnit: 'SERVICE', departmentId: dept.id } });
        const service2 = await tx.serviceRate.create({ data: { code: `${marker}-2`, name: marker, standardRate: 1000, billingUnit: 'SERVICE', departmentId: dept2.id } });
        const makeDoctor = async (suffix: string, serviceId: string, fixed = false) => {
          const doctor = await tx.staff.create({ data: { employeeId: marker + suffix, fullName: marker, category: 'Doctor', phone: '03001234567', joiningDate: jan,
            staffServices: { create: { serviceRateId: serviceId } } } });
          await tx.staffSalaryProfile.create({ data: { staffId: doctor.id, salaryBasis: 'MONTHLY_COMMISSION', baseAmount: 0, effectiveFrom: jan } });
          await tx.doctorCommissionRule.create({ data: { staffId: doctor.id, serviceRateId: serviceId, ruleType: fixed ? 'FIXED_PER_SERVICE' : 'PERCENTAGE', rate: fixed ? 300 : 20, basis: 'NET', effectiveFrom: jan } });
          return doctor;
        };
        const doctor = await makeDoctor('', service.id), doctor2 = await makeDoctor('-2', service2.id, true);
        let seq = 0;
        const makeInvoice = async (mixed = false) => tx.hospitalInvoice.create({ data: {
          invoiceNumber: `${marker}-${++seq}`, sourceType: 'WALK_IN', departmentId: dept.id, createdById: actor.id, createdAt: jan,
          total: mixed ? 2000 : 1000, subtotal: mixed ? 2000 : 1000, patientShare: mixed ? 2000 : 1000,
          lines: { create: [ { serviceRateId: service.id, performedByStaffId: doctor.id, rateSnapshot: 1000, lineGross: 1000, lineNet: 1000, patientShare: 1000, isCompleted: true, createdAt: jan },
            ...(mixed ? [{ serviceRateId: service2.id, performedByStaffId: doctor2.id, rateSnapshot: 1000, lineGross: 1000, lineNet: 1000, patientShare: 1000, isCompleted: true, createdAt: jan }] : []) ] },
        }, include: { lines: true } });
        const post = async (invoiceId: string, amount: number, at: Date) => {
          const receipt = await tx.paymentReceipt.create({ data: { receiptNumber: `${marker}-R${++seq}`, hospitalInvoiceId: invoiceId, amount, collectedAt: at, collectedById: actor.id, method: 'CASH', isReversed: amount < 0 } });
          await tx.hospitalInvoice.update({ where: { id: invoiceId }, data: { paidTotal: { increment: amount } } });
          await commissionService.syncInvoiceCollections(tx, invoiceId, actor.id);
          return receipt;
        };
        const balances = async (invoiceId: string) => (await tx.doctorCommissionAccrual.findMany({ where: { invoiceLineItem: { hospitalInvoiceId: invoiceId } }, include: commissionInclude })).map(r => ({ ...r, balance: commissionBalance(r) }));
        const total = (rows: Awaited<ReturnType<typeof balances>>, key: 'payable' | 'overpaid' = 'payable') => rows.reduce((s, r) => s + r.balance[key].toNumber(), 0);
        const invoice = await makeInvoice();
        await commissionService.syncInvoiceCollections(tx, invoice.id, actor.id);
        expect(await balances(invoice.id)).toHaveLength(0); // fully unpaid
        await post(invoice.id, 500, new Date('2026-01-10'));
        expect(total(await balances(invoice.id))).toBe(100);
        const janFilters = { periodType: 'MONTHLY' as const, periodStart: jan, periodEnd: new Date('2026-01-31'), staffId: doctor.id, departmentId: dept.id };
        const preview = await commissionRunService.preview(janFilters);
        expect(preview.totalAmount.toNumber()).toBe(100);
        const run = await commissionRunService.generate(janFilters, actor.id);
        expect(run.totalAmount.toNumber()).toBe(100);
        await commissionRunService.approve(run.id, actor.id);
        const original = (await balances(invoice.id))[0]!;
        await commissionService.payAccrual(original.id, { amount: 100, method: 'BANK', requestKey: randomUUID() }, actor.id);
        await post(invoice.id, 500, new Date('2026-02-10'));
        expect(total(await balances(invoice.id))).toBe(200);
        expect((await commissionRunService.preview({ ...janFilters, periodStart: feb, periodEnd: new Date('2026-02-28') })).totalAmount.toNumber()).toBe(100);
        const beforeReplay = await tx.commissionCollectionEvent.count();
        await commissionService.syncInvoiceCollections(tx, invoice.id, actor.id);
        expect(await tx.commissionCollectionEvent.count()).toBe(beforeReplay);
        expect(await balances(invoice.id)).toHaveLength(2);
        expect((await staffFinanceSummary(jan, new Date('2026-01-31T23:59:59Z'), dept.id)).commissionGenerated.toNumber()).toBe(100);
        expect((await staffFinanceSummary(feb, new Date('2026-02-28T23:59:59Z'), dept.id)).commissionGenerated.toNumber()).toBe(100);
        await post(invoice.id, -750, new Date('2026-03-10'));
        expect(total(await balances(invoice.id))).toBe(50);
        expect(total(await balances(invoice.id), 'overpaid')).toBe(50);
        const retained = await tx.doctorCommissionAccrual.findUniqueOrThrow({ where: { id: original.id }, include: { payouts: true } });
        expect(retained.commissionAmount.toNumber()).toBe(100);
        expect(retained.status).toBe('PAID'); expect(retained.payouts).toHaveLength(1);
        expect((await staffFinanceSummary(new Date('2026-03-01'), new Date('2026-03-31T23:59:59Z'), dept.id)).commissionGenerated.toNumber()).toBe(-150);
        const march = await managementReportsService.getStaffPayrollCommission({ period: '2026-03', staffId: doctor.id, departmentId: dept.id });
        expect(march.rows[0]?.commissionPayable.toNumber()).toBe(-150);
        expect(march.rows[0]?.commissionRemaining.toNumber()).toBe(50); // payout was posted after March

        const mixed = await makeInvoice(true);
        await post(mixed.id, 1000, new Date('2026-04-10'));
        const mixedRows = await balances(mixed.id);
        expect(mixedRows.find(r => r.staffId === doctor.id)?.commissionAmount.toNumber()).toBe(100);
        expect(mixedRows.find(r => r.staffId === doctor2.id)?.commissionAmount.toNumber()).toBe(150);
        // Department attribution comes from the service, not staff membership.
        expect((await commissionRunService.preview({ ...janFilters, periodStart: new Date('2026-04-01'), periodEnd: new Date('2026-04-30'), staffId: doctor2.id, departmentId: dept2.id })).totalAmount.toNumber()).toBe(150);
        await post(mixed.id, 1000, new Date('2026-05-10'));
        expect(total(await balances(mixed.id))).toBe(500);

        // Exercise the real receipt + refund service hooks, not just the synchronizer.
        const today = await makeInvoice();
        await invoicesService.collectPayment(today.id, { amount: 500, paymentMethod: 'CASH' }, actor.id);
        expect(total(await balances(today.id))).toBe(100);
        const refundKey = randomUUID();
        await invoicesService.refundPayment(today.id, { amount: 250, refundMethod: 'CASH', reason: 'Collection verification', requestKey: refundKey }, actor.id);
        await invoicesService.refundPayment(today.id, { amount: 250, refundMethod: 'CASH', reason: 'Collection verification', requestKey: refundKey }, actor.id);
        expect(total(await balances(today.id))).toBe(50);

        // Legacy approved/paid source records stay immutable; only linked recovery.
        const legacy = await makeInvoice();
        const legacyRow = await tx.doctorCommissionAccrual.create({ data: { staffId: doctor.id, invoiceLineItemId: legacy.lines[0]!.id,
          periodType: 'DAILY', periodStart: jan, periodEnd: jan, status: 'PAID', approvedAt: jan, approvedById: actor.id, commissionAmount: 200,
          ruleSnapshot: { ruleType: 'PERCENTAGE', basis: 'NET', rate: 20, lineNet: 1000, commissionTaxAmount: 0 },
          payouts: { create: { amount: 200, method: 'BANK', paidById: actor.id } },
        } });
        await post(legacy.id, 500, new Date('2026-06-10'));
        expect(total(await balances(legacy.id))).toBe(100);
        expect(total(await balances(legacy.id), 'overpaid')).toBe(100);
        expect((await tx.doctorCommissionAccrual.findUniqueOrThrow({ where: { id: legacyRow.id } })).commissionAmount.toNumber()).toBe(200);
        // Eligibility is resolved at completed-service posting; no salary-only,
        // unassigned, uncompleted, void or pharmacy line may acquire commission.
        for (const scenario of ['uncompleted', 'void', 'no-doctor', 'pharmacy', 'room', 'salary-only', 'unassigned', 'no-rule']) {
          const excluded = await makeInvoice();
          if (scenario === 'uncompleted') await tx.invoiceLineItem.update({ where: { id: excluded.lines[0]!.id }, data: { isCompleted: false } });
          if (scenario === 'void') await tx.hospitalInvoice.update({ where: { id: excluded.id }, data: { status: 'VOID' } });
          if (scenario === 'no-doctor') await tx.invoiceLineItem.update({ where: { id: excluded.lines[0]!.id }, data: { performedByStaffId: null } });
          if (scenario === 'pharmacy' || scenario === 'room') await tx.invoiceLineItem.update({ where: { id: excluded.lines[0]!.id }, data: { billingSource: scenario === 'pharmacy' ? 'PHARMACY' : 'ROOM_BED' } });
          if (scenario === 'salary-only') await tx.staffSalaryProfile.updateMany({ where: { staffId: doctor.id }, data: { salaryBasis: 'MONTHLY' } });
          if (scenario === 'unassigned') await tx.staffService.updateMany({ where: { staffId: doctor.id }, data: { isActive: false } });
          if (scenario === 'no-rule') await tx.doctorCommissionRule.updateMany({ where: { staffId: doctor.id }, data: { effectiveTo: jan } });
          await post(excluded.id, 1000, new Date('2026-07-10'));
          expect(await balances(excluded.id), scenario).toHaveLength(0);
          await tx.staffSalaryProfile.updateMany({ where: { staffId: doctor.id }, data: { salaryBasis: 'MONTHLY_COMMISSION' } });
          await tx.staffService.updateMany({ where: { staffId: doctor.id }, data: { isActive: true } });
          await tx.doctorCommissionRule.updateMany({ where: { staffId: doctor.id }, data: { effectiveTo: null } });
        }
        // Panel clearance is receivable, not a receipt. Patient and panel
        // collections use their respective line weights without cross-allocation.
        const panelInvoice = await makeInvoice(true);
        const company = await tx.corporatePanel.create({ data: { organizationName: marker } });
        await tx.invoiceLineItem.update({ where: { id: panelInvoice.lines[1]!.id }, data: { patientShare: 0, panelReceivable: 1000 } });
        await commissionService.syncInvoiceCollections(tx, panelInvoice.id, actor.id);
        expect(await balances(panelInvoice.id)).toHaveLength(0);
        await post(panelInvoice.id, 1000, new Date('2026-08-10'));
        expect((await balances(panelInvoice.id)).filter(r => r.staffId === doctor2.id)).toHaveLength(0);
        await tx.panelRemittance.create({ data: { remittanceNumber: `${marker}-PANEL`, corporatePanelId: company.id, amount: 500,
          method: 'BANK', receivedAt: new Date('2026-09-10'), receivedById: actor.id,
          allocations: { create: { hospitalInvoiceId: panelInvoice.id, allocatedAmount: 500 } } } });
        await commissionService.syncInvoiceCollections(tx, panelInvoice.id, actor.id);
        expect((await balances(panelInvoice.id)).find(r => r.staffId === doctor2.id)?.commissionAmount.toNumber()).toBe(150);

        // Default contract fallback and historical snapshots remain authoritative.
        await tx.doctorCommissionRule.updateMany({ where: { staffId: doctor.id }, data: { serviceRateId: null } });
        const late = await makeInvoice();
        await commissionService.syncInvoiceCollections(tx, late.id, actor.id);
        await tx.doctorCommissionRule.updateMany({ where: { staffId: doctor.id }, data: { rate: 90 } });
        await post(late.id, 500, new Date('2026-10-10'));
        expect(total(await balances(late.id))).toBe(100);
        await post(late.id, 500, new Date('2026-11-10'));
        expect(total(await balances(late.id))).toBe(200);
        // A discount correction changes the collected fraction, never the receipt.
        const repriced = await makeInvoice();
        await tx.doctorCommissionRule.updateMany({ where: { staffId: doctor.id }, data: { rate: 20 } });
        await post(repriced.id, 500, new Date('2026-11-11'));
        await tx.invoiceLineItem.update({ where: { id: repriced.lines[0]!.id }, data: { lineNet: 800, discountAmount: 200 } });
        await commissionService.repriceCommission(tx, repriced.lines[0]!.id, new Decimal(1000), new Decimal(800), actor.id, 'Approved discount');
        expect(total(await balances(repriced.id))).toBe(100);
        await post(repriced.id, 300, new Date('2026-11-12'));
        expect(total(await balances(repriced.id))).toBe(160);
        await tx.invoiceLineItem.update({ where: { id: repriced.lines[0]!.id }, data: { isCompleted: false } });
        await commissionService.syncInvoiceCollections(tx, repriced.id, actor.id);
        expect(total(await balances(repriced.id))).toBe(0);
        await tx.invoiceLineItem.update({ where: { id: repriced.lines[0]!.id }, data: { isCompleted: true } });
        await commissionService.syncInvoiceCollections(tx, repriced.id, actor.id);
        expect(total(await balances(repriced.id))).toBe(160); // returning to an earlier state is not mistaken for a callback replay
        await expect(post(repriced.id, 1, new Date('2026-11-01'))).rejects.toThrow('backdated collection');
        const expanded = await makeInvoice();
        await post(expanded.id, 500, new Date('2026-11-12'));
        await invoicesService.addServiceLine(expanded.id, { serviceRateId: service2.id, quantity: 1, performedByStaffId: doctor2.id }, actor.id, 'SUPER_ADMIN');
        const expandedRows = await balances(expanded.id);
        expect(expandedRows.filter(row => row.staffId === doctor.id).reduce((sum, row) => sum + row.balance.payable.toNumber(), 0)).toBe(50);
        expect(expandedRows.find(row => row.staffId === doctor2.id)?.balance.payable.toNumber()).toBe(75);
        expect(await tx.salarySlip.count({ where: { staffId: { in: [doctor.id, doctor2.id] } } })).toBe(0);
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { holder.tx = null; await db.$disconnect(); }
    const check = new PrismaClient();
    try { expect(await check.department.count({ where: { code: marker } })).toBe(0); }
    finally { await check.$disconnect(); }
  }, 70000);
});
