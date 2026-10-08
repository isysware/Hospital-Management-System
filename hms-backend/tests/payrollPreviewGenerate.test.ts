import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal } from '@prisma/client/runtime/library';

vi.mock('@/db/client', () => {
  const mockTx: any = {
    $queryRaw: vi.fn(),
    payrollRun: { create: vi.fn(), findUniqueOrThrow: vi.fn() },
    salarySlip: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
  };
  const mockPrisma: any = {
    $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    staff: { findMany: vi.fn() },
    staffSalaryProfile: { findMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
    salarySlip: { findMany: vi.fn().mockResolvedValue([]) },
    __tx: mockTx,
  };
  return { prisma: mockPrisma };
});

import { prisma } from '@/db/client';
import { payrollService } from '@/modules/payroll/payroll.service';
import payrollRoutes from '@/modules/payroll/payroll.routes';

const db = prisma as any;
const tx = db.__tx;
const d = (n: number) => new Decimal(n);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Real HTTP route, authorization, schema coercion, controller, eligibility and
// calculation. Only the database and authenticated session are fixtures.
let server: Server;
let url: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'actor-1', role: 'SUPER_ADMIN', staffId: null, mustResetPassword: false };
    next();
  });
  app.use('/api/v1/payroll', payrollRoutes);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/payroll`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function post(path: string, body: unknown, status: number) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.status).toBe(status);
  return (await response.json() as any).data;
}

/** Monthly staff whose weekly OFF days are `off`; the first `absent` scheduled days of the period are ABSENT. */
function staffCase(id: string, off: string[], absent: number, from: string, to: string) {
  const attendance: { staffId: string; status: string; attendanceDate: Date }[] = [];
  let scheduled = 0;
  for (let t = date(from).getTime(); t <= date(to).getTime(); t += 86_400_000) {
    const day = new Date(t);
    if (off.includes(WEEKDAYS[day.getUTCDay()] as string)) continue;
    attendance.push({ staffId: id, status: scheduled < absent ? 'ABSENT' : 'PRESENT', attendanceDate: day });
    scheduled += 1;
  }
  return {
    staff: { id, fullName: `Staff ${id}`, employeeId: `EMP-${id}`, assignedShift: { defaultWeeklyOffDays: off }, weeklySchedule: [] },
    profile: {
      id: `profile-${id}`, staffId: id, salaryBasis: 'MONTHLY', baseAmount: d(30000),
      fixedAllowance: d(3000), fixedDeduction: d(600), salaryTaxMethod: 'PERCENTAGE', salaryTaxValue: d(10),
      effectiveFrom: date('2026-01-01'), effectiveTo: null,
    },
    attendance,
  };
}

function load(cases: ReturnType<typeof staffCase>[]) {
  db.staff.findMany.mockResolvedValue(cases.map((c) => c.staff));
  db.staffSalaryProfile.findMany.mockResolvedValue(cases.map((c) => c.profile));
  db.attendanceRecord.findMany.mockResolvedValue(cases.flatMap((c) => c.attendance));
}

describe('payroll — Preview and Generate produce identical MONTHLY figures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.payrollRun.create.mockResolvedValue({ id: 'run-1' });
    tx.payrollRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1' });
  });

  it.each([
    ['2026-08-31', '2026-09-27', 24],
    ['2026-09-01', '2026-09-30', 26],
    ['2026-08-31', '2026-09-30', 27],
  ])('HTTP Preview and Generate: full 28,000 monthly base from %s to %s', async (from, to, scheduled) => {
    const fixture = staffCase('monthly', ['Sunday'], scheduled - 2, from, to);
    fixture.profile.baseAmount = d(28000);
    fixture.profile.fixedAllowance = d(3000);
    fixture.profile.fixedDeduction = d(600);
    fixture.profile.salaryTaxMethod = 'FIXED';
    fixture.profile.salaryTaxValue = d(300);
    load([fixture]);
    // Return what Generate actually persisted, including database money precision.
    tx.payrollRun.findUniqueOrThrow.mockImplementation(async () => ({
      ...tx.payrollRun.create.mock.calls[0][0].data,
      lines: tx.salarySlip.create.mock.calls.map(([{ data }]: any) => ({
        ...data, baseAmount: data.baseAmount.toFixed(2),
        attendanceDeductions: data.attendanceDeductions.toFixed(2),
        generatedAmount: data.generatedAmount.toFixed(2),
      })),
    }));
    const payload = { periodType: 'MONTHLY', periodStart: from, periodEnd: to };
    const preview = await post('/preview', payload, 200);
    expect(tx.salarySlip.create).not.toHaveBeenCalled();
    const row = preview.eligible[0];
    // August and September 2026 (Sunday OFF) each have 26 scheduled days in
    // their own complete calendar month — the real Monthly Scheduled Days
    // divisor, keyed off periodStart's month, regardless of how many of
    // those days the selected period itself spans.
    const monthlyScheduledDays = 26;
    const dailyRate = 28000 / monthlyScheduledDays;
    expect(row.scheduledPayableDays).toBe(scheduled);
    expect(row.attendanceEquivalentDays).toBe(2);
    expect(row.monthlyBaseAmount).toBe('28000');
    expect(row.monthlyScheduledDays).toBe(monthlyScheduledDays);
    expect(Number(row.dailyRate)).toBeCloseTo(dailyRate, 2);
    expect(Number(row.periodBaseAmount)).toBeCloseTo(dailyRate * scheduled, 2);
    expect(Number(row.attendanceDeductions)).toBeCloseTo((scheduled - 2) * dailyRate, 2);
    expect(Number(row.earnedBase)).toBeCloseTo(2 * dailyRate, 2);
    expect(Number(row.allowances)).toBe(3000);
    expect(Number(row.otherDeductions)).toBe(600);
    expect(Number(row.tax)).toBe(300);
    expect(db.attendanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({where: expect.objectContaining({
      isApproved: true, attendanceDate: { gte: date(from), lte: date(to) },
    })}));
    const generated = await post('/runs', payload, 201);
    const slip = generated.lines[0];
    for (const key of ['periodBaseAmount', 'earnedBase', 'attendanceDeductions', 'allowances', 'grossAmount', 'tax', 'otherDeductions', 'netAmount']) {
      expect(slip.componentBreakdown[key]).toBe(Number(row[key]));
    }
    expect(slip.baseAmount).toBe(d(Number(row.periodBaseAmount)).toFixed(2));
    expect(slip.generatedAmount).toBe(d(Number(row.netAmount)).toFixed(2));
    expect(Number(slip.baseAmount)).toBe(Number(row.periodBaseAmount));
    expect(Number(slip.attendanceDeductions)).toBe(Number(row.attendanceDeductions));
    expect(Number(slip.generatedAmount)).toBe(Number(row.netAmount));
    expect(slip.calculationSnapshot.monthlyBaseAmount).toBe(row.monthlyBaseAmount);
    expect(slip.calculationSnapshot.monthlyScheduledDays).toBe(row.monthlyScheduledDays);
    expect(slip.calculationSnapshot.dailyRate).toBe(row.dailyRate);
    expect(generated.totalAmount).toBe(preview.totalAmount);
  });

  it('HTTP Preview prorates Period Base to the period\'s own scheduled days for cross-month dates — never the full 30,000', async () => {
    const fixture = staffCase('monthly', ['Sunday'], 22, '2026-08-31', '2026-09-27');
    load([fixture]);
    const preview = await post('/preview', { periodType: 'MONTHLY', periodStart: '2026-08-31', periodEnd: '2026-09-27' }, 200);
    const row = preview.eligible[0];
    // periodStart (Aug 31) falls in August 2026, which has 26 scheduled
    // days (Sunday OFF) — the Monthly Scheduled Days divisor for this run.
    const dailyRate = 30000 / 26;
    expect(row.monthlyScheduledDays).toBe(26);
    expect(row.scheduledPayableDays).toBe(24);
    expect(row.attendanceEquivalentDays).toBe(2);
    expect(Number(row.dailyRate)).toBeCloseTo(dailyRate, 2);
    expect(Number(row.periodBaseAmount)).toBeCloseTo(dailyRate * 24, 2);
    expect(Number(row.attendanceDeductions)).toBeCloseTo(dailyRate * 22, 2);
    expect(Number(row.earnedBase)).toBeCloseTo(dailyRate * 2, 2);
  });

  // 24 / 28 scheduled in February, 30 / 31 scheduled in a no-OFF 30/31-day month.
  const periods: [string, string, string, [string[], number][]][] = [
    ['February 2026', '2026-02-01', '2026-02-28', [[['Sunday'], 24], [[], 28]]],
    ['February 2028', '2028-02-01', '2028-02-29', [[[], 29], [['Sunday'], 25]]],
    ['September 2026', '2026-09-01', '2026-09-30', [[[], 30], [['Sunday'], 26]]],
    ['October 2026', '2026-10-01', '2026-10-31', [[[], 31]]],
  ];

  for (const [label, from, to, schedules] of periods) {
    it(`${label}: every slip written by Generate equals its Preview row`, async () => {
      const cases = schedules.flatMap(([off], i) => [staffCase(`${i}a`, off, 0, from, to), staffCase(`${i}b`, off, 2, from, to)]);
      load(cases);
      const filters = { periodType: 'MONTHLY' as const, periodStart: date(from), periodEnd: date(to) };

      const preview = await payrollService.preview(filters);
      await payrollService.generate(filters, 'actor-1');

      expect(preview.eligible.map((r) => r.scheduledPayableDays)).toEqual(schedules.flatMap(([, n]) => [n, n]));
      expect(tx.salarySlip.create).toHaveBeenCalledTimes(preview.eligible.length);
      expect(tx.payrollRun.create.mock.calls[0][0].data.totalAmount.toString()).toBe(preview.totalAmount.toString());

      preview.eligible.forEach((row, i) => {
        const slip = tx.salarySlip.create.mock.calls[i][0].data;
        expect(slip.staffId).toBe(row.staffId);
        expect(slip.baseAmount.toString()).toBe(row.periodBaseAmount.toString());
        expect(slip.attendanceDeductions.toString()).toBe(row.attendanceDeductions.toString());
        expect(slip.allowances.toString()).toBe(row.allowances.toString());
        expect(slip.otherDeductions.toString()).toBe(row.otherDeductions.toString());
        expect(slip.generatedAmount.toString()).toBe(row.netAmount.toString());
        expect(slip.componentBreakdown).toEqual({
          periodBaseAmount: row.periodBaseAmount.toNumber(),
          earnedBase: row.earnedBase.toNumber(),
          attendanceDeductions: row.attendanceDeductions.toNumber(),
          allowances: row.allowances.toNumber(),
          grossAmount: row.grossAmount.toNumber(),
          tax: row.tax.toNumber(),
          otherDeductions: row.otherDeductions.toNumber(),
          lateMinutes: row.lateMinutes,
          lateDeduction: row.lateDeduction.toNumber(),
          earlyExitMinutes: row.earlyExitMinutes,
          earlyExitDeduction: row.earlyExitDeduction.toNumber(),
          netAmount: row.netAmount.toNumber(),
        });

        // Full-month period: Monthly Scheduled Days == this period's own
        // scheduled days, so Daily Rate = Base/scheduled — full attendance
        // always nets the full base; 2 absent deduct 2 × that real daily rate.
        const fullAttendance = row.attendanceEquivalentDays === row.scheduledPayableDays;
        const dailyRate = 30000 / row.scheduledPayableDays;
        const earned = fullAttendance ? 30000 : 30000 - 2 * dailyRate;
        const net = earned + 3000 - (earned + 3000) * 0.1 - 600;
        expect(row.earnedBase.toNumber()).toBeCloseTo(earned, 2);
        expect(row.netAmount.toNumber()).toBeCloseTo(net, 2);
      });
    });
  }
});

describe('payroll — MONTHLY_COMMISSION uses the exact same fixed 30-day basis as MONTHLY (real Preview/Generate HTTP path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.payrollRun.create.mockResolvedValue({ id: 'run-1' });
    tx.payrollRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1' });
  });

  it('PKR 30,000 base, 26 scheduled, 1 present/25 absent — Daily Rate 1,153.85, Deduction ≈28,846.15, Earned ≈1,153.85; Doctor commission stays a separate ledger (untouched here)', async () => {
    const fixture = staffCase('doc-commission', ['Sunday'], 25, '2026-09-01', '2026-09-30');
    fixture.profile.salaryBasis = 'MONTHLY_COMMISSION';
    fixture.profile.fixedAllowance = d(0);
    fixture.profile.fixedDeduction = d(0);
    fixture.profile.salaryTaxMethod = null;
    fixture.profile.salaryTaxValue = null;
    load([fixture]);
    tx.payrollRun.findUniqueOrThrow.mockImplementation(async () => ({
      ...tx.payrollRun.create.mock.calls[0][0].data,
      lines: tx.salarySlip.create.mock.calls.map(([{ data }]: any) => ({
        ...data, baseAmount: data.baseAmount.toFixed(2),
        attendanceDeductions: data.attendanceDeductions.toFixed(2),
        generatedAmount: data.generatedAmount.toFixed(2),
      })),
    }));
    const payload = { periodType: 'MONTHLY', periodStart: '2026-09-01', periodEnd: '2026-09-30' };

    const preview = await post('/preview', payload, 200);
    const row = preview.eligible[0];
    const dailyRate = 30000 / 26;
    expect(row.monthlyScheduledDays).toBe(26);
    expect(row.scheduledPayableDays).toBe(26);
    expect(row.attendanceEquivalentDays).toBe(1);
    expect(Number(row.dailyRate)).toBeCloseTo(dailyRate, 2);
    expect(Number(row.periodBaseAmount)).toBe(30000);
    expect(Number(row.attendanceDeductions)).toBeCloseTo(25 * dailyRate, 2);
    expect(Number(row.earnedBase)).toBeCloseTo(30000 - 25 * dailyRate, 2);
    expect(Number(row.netAmount)).toBeCloseTo(30000 - 25 * dailyRate, 2);

    const generated = await post('/runs', payload, 201);
    const slip = generated.lines[0];
    expect(Number(slip.baseAmount)).toBe(Number(row.periodBaseAmount));
    expect(Number(slip.attendanceDeductions)).toBe(Number(row.attendanceDeductions));
    expect(Number(slip.generatedAmount)).toBe(Number(row.netAmount));
    expect(generated.totalAmount).toBe(preview.totalAmount);
  });

  it('MONTHLY and MONTHLY_COMMISSION Preview rows are identical for the same attendance', async () => {
    const monthly = staffCase('m', ['Sunday'], 3, '2026-09-01', '2026-09-30');
    const commission = staffCase('mc', ['Sunday'], 3, '2026-09-01', '2026-09-30');
    commission.profile.salaryBasis = 'MONTHLY_COMMISSION';
    load([monthly, commission]);
    const preview = await post('/preview', { periodType: 'MONTHLY', periodStart: '2026-09-01', periodEnd: '2026-09-30' }, 200);
    const [m, mc] = preview.eligible;
    expect(mc.periodBaseAmount).toBe(m.periodBaseAmount);
    expect(mc.attendanceDeductions).toBe(m.attendanceDeductions);
    expect(mc.earnedBase).toBe(m.earnedBase);
    expect(mc.netAmount).toBe(m.netAmount);
  });
});
