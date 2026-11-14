import 'dotenv/config';
import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

// Use the real database inside a single rollback-only transaction. Services
// retain real Prisma delegates; nested service transactions share this boundary.
const holder = vi.hoisted(() => ({ tx: null as any }));
vi.mock('@/db/client', () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  if (key === '$transaction') return (operation: any) => typeof operation === 'function' ? operation(holder.tx) : Promise.all(operation);
  return holder.tx[key];
} }) }));
import payrollRoutes from '@/modules/payroll/payroll.routes';
import commissionRoutes from '@/modules/commission/commission.routes';
import reportsRoutes from '@/modules/reports/reports.routes';
import { errorHandler } from '@/middleware/errorHandler';
import { invoicesService } from '@/modules/frontdesk/invoices.service';
import { appointmentsService } from '@/modules/frontdesk/appointments.service';
import { commissionService } from '@/modules/commission/commission.service';
import { admissionService } from '@/modules/admission/admission.service';

describe.runIf(process.env.HMS_PAYROLL_DB_TEST === '1')('real database + HTTP payroll / commission / Super Admin reporting', () => {
  it('links completed services, runs, approvals, separate payments, corrections and report totals; rolls back all fixtures', async () => {
    const db = new PrismaClient();
    const marker = `VERIFY-${randomUUID()}`;
    const rollback = new Error('ROLLBACK_VERIFICATION');
    try {
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-commission-regression-fixtures'))`;
        holder.tx = tx;
        const actor = await tx.portalUser.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
        const now = new Date();
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 30));
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        const iso = (d: Date) => d.toISOString().slice(0, 10);
        const dept = await tx.department.create({ data: { code: marker, name: marker, departmentType: 'CLINICAL' } });
        const service = await tx.serviceRate.create({ data: { code: marker, name: 'Verification consultation', billingUnit: 'SERVICE', standardRate: 10000, departmentId: dept.id } });
        const doctor = await tx.staff.create({ data: { employeeId: marker, fullName: 'Commission verification fixture', category: 'Doctor', phone: '03001234567', joiningDate: from, departmentId: dept.id,
          staffDepartments: { create: { departmentId: dept.id } }, staffServices: { create: { serviceRateId: service.id } },
        } });
        await tx.staffSalaryProfile.create({ data: { staffId: doctor.id, salaryBasis: 'MONTHLY_COMMISSION', baseAmount: 60000, fixedAllowance: 2000, fixedDeduction: 1000, salaryTaxMethod: 'PERCENTAGE', salaryTaxValue: 5, effectiveFrom: from, createdById: actor.id } });
        const statuses = [...Array(26).fill('PRESENT'), 'HALF_DAY', 'PAID_LEAVE', 'ABSENT', 'ABSENT'];
        await tx.attendanceRecord.createMany({ data: statuses.map((status, i) => ({ staffId: doctor.id, attendanceDate: new Date(from.getTime() + i * 86400000), status, isApproved: true, approvedById: actor.id })) });

        const app = express(); app.use(express.json());
        app.use((req, _res, next) => { req.user = { sub: actor.id, role: 'SUPER_ADMIN', staffId: null, mustResetPassword: false }; next(); });
        app.use('/api/v1/payroll', payrollRoutes); app.use('/api/v1/commission', commissionRoutes); app.use('/api/v1/reports', reportsRoutes); app.use(errorHandler);
        const server = app.listen(0, '127.0.0.1');
        await new Promise<void>(resolve => server.once('listening', resolve));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
        const request = async (path: string, body?: unknown, status = 200) => {
          if (path.endsWith('/pay') && body) body = { ...(body as Record<string, unknown>), requestKey: randomUUID() };
          const r = await fetch(`${url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          const result = await r.json() as any;
          expect(r.status, JSON.stringify(result)).toBe(status); return result.data;
        };
        try {
          await request('/commission/rules', { staffId: doctor.id, serviceRateId: service.id, ruleType: 'PERCENTAGE', rate: 15, basis: 'NET', commissionTaxMethod: 'PERCENTAGE', commissionTaxValue: 10, effectiveFrom: iso(from) }, 201);
          const invoice = await tx.hospitalInvoice.create({ data: { invoiceNumber: marker, sourceType: 'WALK_IN', departmentId: dept.id, createdById: actor.id } });
          const line = await invoicesService.addServiceLine(invoice.id, { serviceRateId: service.id, quantity: 1, discountAmount: 1000, discountReason: 'Approved example discount', performedByStaffId: doctor.id }, actor.id, 'SUPER_ADMIN');
          expect(await tx.doctorCommissionAccrual.count({ where: { invoiceLineItemId: line.id } })).toBe(0);
          await invoicesService.collectPayment(invoice.id, { amount: 9000, paymentMethod: 'CASH' }, actor.id);
          const earned = await tx.doctorCommissionAccrual.findFirstOrThrow({ where: { invoiceLineItemId: line.id } });
          expect(earned.commissionAmount.toNumber()).toBe(1350);

          const filters = { periodType: 'MONTHLY', periodStart: iso(from), periodEnd: iso(monthEnd), staffId: doctor.id, departmentId: dept.id, serviceRateId: service.id };
          const preview = await request('/commission/preview', filters);
          expect(preview.totalAmount).toBe('1215'); expect(preview.lineCount).toBe(1);
          const run = await request('/commission/runs', filters, 201);
          expect(run.totalAmount).toBe(preview.totalAmount);
          expect(run.lines[0].balance).toEqual(preview.lines[0].balance);
          await request(`/commission/accruals/${earned.id}/pay`, { amount: 1, method: 'CASH' }, 409);
          await request('/commission/runs', filters, 409);
          await request(`/commission/runs/${run.id}/approve`, {});
          await request(`/commission/accruals/${earned.id}/pay`, { amount: 1300, method: 'CASH' }, 400);
          await request(`/commission/accruals/${earned.id}/pay`, { amount: 1000, method: 'CASH' }, 201);
          const paid = await request(`/commission/accruals/${earned.id}/pay`, { amount: 215, method: 'BANK' }, 201);
          expect(paid.status).toBe('PAID'); expect(paid.balance.remaining).toBe('0');
          await request(`/commission/accruals/${earned.id}/adjustments`, { amount: 85, reason: 'Approved commission correction' }, 201);
          await invoicesService.refundPayment(invoice.id, { amount: 900, refundMethod: 'CASH', reason: '10% partial service refund' }, actor.id);
          expect((await tx.doctorCommissionAccrual.findUniqueOrThrow({ where: { id: earned.id } })).commissionAmount.toNumber()).toBe(1350);

          const salaryFilters = { periodType: 'CUSTOM', periodStart: iso(from), periodEnd: iso(to), staffId: doctor.id };
          const salaryPreview = await request('/payroll/preview', salaryFilters);
          expect(salaryPreview.totalAmount).toBe('53150');
          const salaryRun = await request('/payroll/runs', salaryFilters, 201);
          const slip = salaryRun.lines[0];
          expect(slip.generatedAmount).toBe(salaryPreview.eligible[0].netAmount);
          await request(`/payroll/slips/${slip.id}/pay`, { amount: 1000, method: 'CASH' }, 409);
          await request(`/payroll/runs/${salaryRun.id}/approve`, {});
          await request(`/payroll/slips/${slip.id}/pay`, { amount: 1000, method: 'CASH' }, 201);
          await request(`/payroll/slips/${slip.id}/adjustments`, { amount: -150, reason: 'Approved salary correction' }, 201);
          expect((await request('/payroll/preview', salaryFilters)).eligible).toHaveLength(0);
          expect(await tx.salaryPayment.count({ where: { salarySlipId: slip.id } })).toBe(1);
          expect(await tx.commissionPayout.count({ where: { doctorCommissionAccrualId: earned.id } })).toBe(2);
          const report = await request(`/reports/management/staff-payroll-commission?period=${iso(from).slice(0, 7)}&staffId=${doctor.id}&departmentId=${dept.id}`);
          expect(report.rows[0]).toMatchObject({ attendanceDays: 27.5, payrollAmount: '53150', salaryPayable: '53000', salaryPaid: '1000', salaryRemaining: '52000', commissionAmount: '1350', commissionTax: '121.5', commissionPayable: '1178.5', commissionPaid: '1215', commissionOverpaid: '36.5', salarySlipIds: [slip.id], commissionRunIds: [run.id] });

          // The appointment-created service used to bypass commission entirely.
          const appointment = await tx.appointment.create({ data: { departmentId: dept.id, doctorStaffId: doctor.id, serviceRateId: service.id, slotAt: now, estimatedAmount: 10000, status: 'CONFIRMED', createdById: actor.id } });
          const checkedIn = await appointmentsService.checkInAppointment(appointment.id, { encounterType: 'OPD' }, actor.id);
          const appointmentLine = checkedIn.invoice.lines[0]!;
          expect(await tx.doctorCommissionAccrual.count({ where: { invoiceLineItemId: appointmentLine.id } })).toBe(0);

          const admission = await tx.admissionRecord.create({ data: { admissionNumber: `${marker}-ADM`, departmentId: dept.id, doctorStaffId: doctor.id, status: 'ACTIVE', createdById: actor.id } });
          const admissionLine = await admissionService.addAdmissionService(admission.id, { serviceRateId: service.id, quantity: 1 }, actor.id);
          expect(await tx.doctorCommissionAccrual.count({ where: { invoiceLineItemId: admissionLine.id } })).toBe(0);
          const selfArranged = await admissionService.addAdmissionService(admission.id, { serviceRateId: service.id, quantity: 1, arrangementMode: 'SELF' }, actor.id);
          expect(await tx.doctorCommissionAccrual.count({ where: { invoiceLineItemId: selfArranged.id } })).toBe(0);

          // §18: Daily salary and three fixed service commissions stay separate.
          const daily = await tx.staff.create({ data: { employeeId: `${marker}-DAY`, fullName: 'Daily commission fixture', category: 'Doctor', phone: '03001234567', joiningDate: from,
            staffServices: { create: { serviceRateId: service.id } },
          } });
          await tx.staffSalaryProfile.create({ data: { staffId: daily.id, salaryBasis: 'PER_DAY_COMMISSION', baseAmount: 3000, salaryTaxMethod: 'PERCENTAGE', salaryTaxValue: 5, effectiveFrom: from, createdById: actor.id } });
          await tx.attendanceRecord.create({ data: { staffId: daily.id, attendanceDate: new Date(iso(now)), status: 'PRESENT', isApproved: true, approvedById: actor.id } });
          await request('/commission/rules', { staffId: daily.id, serviceRateId: service.id, ruleType: 'FIXED_PER_SERVICE', rate: 500, basis: 'NET', effectiveFrom: iso(from) }, 201);
          const dailyInvoice = await tx.hospitalInvoice.create({ data: { invoiceNumber: `${marker}-DAY`, sourceType: 'WALK_IN', createdById: actor.id } });
          for (let i = 0; i < 3; i++) await invoicesService.addServiceLine(dailyInvoice.id, { serviceRateId: service.id, quantity: 1, performedByStaffId: daily.id }, actor.id, 'SUPER_ADMIN');
          await invoicesService.collectPayment(dailyInvoice.id, { amount: 30000, paymentMethod: 'CASH' }, actor.id);
          const dailyFilters = { periodType: 'DAILY', periodStart: iso(now), periodEnd: iso(now), staffId: daily.id };
          expect((await request('/payroll/preview', dailyFilters)).totalAmount).toBe('2850');
          const dailySalary = await request('/payroll/runs', dailyFilters, 201);
          expect(dailySalary.totalAmount).toBe('2850');
          expect((await request('/commission/preview', dailyFilters)).totalAmount).toBe('1500');
          const dailyCommission = await request('/commission/runs', dailyFilters, 201);
          expect(dailyCommission.totalAmount).toBe('1500');

          // Real refund API must reverse only 10% of all eligible service lines.
          await invoicesService.refundPayment(dailyInvoice.id, { amount: 3000, refundMethod: 'CASH', reason: 'Verification partial refund' }, actor.id);
          const dailyReport = await request(`/reports/management/staff-payroll-commission?period=${iso(from).slice(0, 7)}&staffId=${daily.id}`);
          expect(dailyReport.rows[0]).toMatchObject({ payrollAmount: '2850', commissionAmount: '1500', commissionReversed: '150', commissionPayable: '1350' });

          // Effective-dated changes affect future services, never posted snapshots.
          await request('/commission/rules', { staffId: daily.id, serviceRateId: service.id, ruleType: 'FIXED_PER_SERVICE', rate: 700, effectiveFrom: iso(new Date(monthEnd.getTime() + 86400000)) }, 201);
          expect((await request(`/commission/runs/${dailyCommission.id}`)).totalAmount).toBe('1500');
        } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { holder.tx = null; await db.$disconnect(); }
    const check = new PrismaClient();
    try { expect(await check.staff.count({ where: { employeeId: marker } })).toBe(0); }
    finally { await check.$disconnect(); }
  }, 70000);
});
