import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { buildPaginationMeta, paginationSkipTake } from '@/shared/pagination';
import { PAYABLE_EQUIVALENT } from '../attendance/attendance.service';
import type { PayrollRunFilters, ListPayrollRunsQuery, PaySalarySlipBody, ListSalarySlipsQuery } from './payroll.schemas';

interface EligibleRow {
  staffId: string;
  fullName: string;
  employeeId: string;
  salaryBasis: string;
  scheduledPayableDays: number;
  attendanceEquivalentDays: number;
  periodBaseAmount: Decimal;
  earnedBase: Decimal;
  attendanceDeductions: Decimal;
  allowances: Decimal;
  grossAmount: Decimal;
  tax: Decimal;
  otherDeductions: Decimal;
  netAmount: Decimal;
  taxMethod: string | null;
  taxValue: Decimal | null;
  salaryProfileId: string;
}

interface SkippedRow {
  staffId: string;
  fullName: string;
  employeeId: string;
  reason: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
};

/**
 * A staff member's working weekdays (PDF §8): their own Weekly Timing when set
 * (OFF days excluded), otherwise their Shift's weekly-off days, otherwise every day.
 */
function workingDaySet(schedule: { dayOfWeek: string; isWorking: boolean }[], shiftOffDays: string[]): Set<string> {
  if (schedule.length > 0) return new Set(schedule.filter((d) => d.isWorking).map((d) => d.dayOfWeek));
  const off = new Set(shiftOffDays);
  return new Set(WEEKDAY_NAMES.filter((d) => !off.has(d)));
}

/** Scheduled working days in [from, to] (UTC day timestamps, inclusive). */
function countWorkingDays(from: number, to: number, working: Set<string>): number {
  let n = 0;
  for (let t = from; t <= to; t += DAY_MS) {
    if (working.has(WEEKDAY_NAMES[new Date(t).getUTCDay()] as string)) n += 1;
  }
  return n;
}

/**
 * For each calendar month the period touches: scheduled days of the whole
 * month vs. scheduled days that fall inside the period. Monthly salaries are
 * earned per month (PDF §11 "Monthly Base / Scheduled Payable Days"), so a
 * 10-day custom run pays 10 days' worth — not a full month — and a run that
 * crosses a month boundary uses each month's own per-day rate.
 */
function monthSlices(periodStart: Date, periodEnd: Date, working: Set<string>) {
  const start = utcDay(periodStart);
  const end = utcDay(periodEnd);
  const slices = new Map<string, { monthDays: number; periodDays: number }>();
  for (let t = start; t <= end; ) {
    const d = new Date(t);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const sliceEnd = Math.min(monthEnd, end);
    slices.set(monthKey(t), {
      monthDays: countWorkingDays(monthStart, monthEnd, working),
      periodDays: countWorkingDays(t, sliceEnd, working),
    });
    t = monthEnd + DAY_MS;
  }
  return slices;
}

/**
 * PDF §11 — attendance-based salary per staff for the period. Read-only; never persists.
 *
 *   Attendance Equivalent = Present + Half×0.5 + Paid Leave
 *   Monthly: per-day = Monthly Base / scheduled days of that month; Daily: per-day = Daily Rate
 *   Earned Base = per-day × attendance equivalent days
 *   Gross = Earned Base + Allowance;  Tax% = Gross × %;  Net = Gross − Tax − Deduction
 *
 * Fixed allowance / deduction / fixed tax are monthly amounts for Monthly types
 * (prorated to the period's share of each month) and per-run amounts for Daily
 * types, matching the PDF's §12 monthly and §13 daily examples.
 */
async function computeEligibility(filters: PayrollRunFilters): Promise<{ eligible: EligibleRow[]; skipped: SkippedRow[] }> {
  const staffWhere: Prisma.StaffWhereInput = { isActive: true };
  if (filters.category) staffWhere.category = filters.category;
  if (filters.departmentId) staffWhere.staffDepartments = { some: { departmentId: filters.departmentId } };

  const staff = await prisma.staff.findMany({
    where: staffWhere,
    select: {
      id: true,
      fullName: true,
      employeeId: true,
      assignedShift: { select: { defaultWeeklyOffDays: true } },
      weeklySchedule: { select: { dayOfWeek: true, isWorking: true } },
    },
  });
  if (staff.length === 0) return { eligible: [], skipped: [] };

  const staffIds = staff.map((s) => s.id);

  // Current salary profile as of the period: effectiveFrom <= periodEnd, still open or overlapping the period.
  const profiles = await prisma.staffSalaryProfile.findMany({
    where: {
      staffId: { in: staffIds },
      effectiveFrom: { lte: filters.periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: filters.periodStart } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  const profileByStaff = new Map<string, (typeof profiles)[number]>();
  for (const p of profiles) {
    if (!profileByStaff.has(p.staffId)) profileByStaff.set(p.staffId, p);
  }

  const attendance = await prisma.attendanceRecord.findMany({
    where: {
      staffId: { in: staffIds },
      attendanceDate: { gte: filters.periodStart, lte: filters.periodEnd },
      isApproved: true,
    },
    select: { staffId: true, status: true, attendanceDate: true },
  });
  const attendanceByStaff = new Map<string, { status: string; attendanceDate: Date }[]>();
  for (const a of attendance) {
    const list = attendanceByStaff.get(a.staffId) ?? [];
    list.push(a);
    attendanceByStaff.set(a.staffId, list);
  }

  const eligible: EligibleRow[] = [];
  const skipped: SkippedRow[] = [];
  const zero = new Decimal(0);

  for (const s of staff) {
    const profile = profileByStaff.get(s.id);
    if (!profile) {
      skipped.push({ staffId: s.id, fullName: s.fullName, employeeId: s.employeeId, reason: 'No Salary Profile configured for this period' });
      continue;
    }
    const records = attendanceByStaff.get(s.id) ?? [];
    if (records.length === 0) {
      skipped.push({ staffId: s.id, fullName: s.fullName, employeeId: s.employeeId, reason: 'No approved attendance in this period' });
      continue;
    }

    const working = workingDaySet(s.weeklySchedule, s.assignedShift?.defaultWeeklyOffDays ?? []);
    const slices = monthSlices(filters.periodStart, filters.periodEnd, working);
    const scheduledPayableDays = [...slices.values()].reduce((n, m) => n + m.periodDays, 0);
    if (scheduledPayableDays === 0) {
      skipped.push({ staffId: s.id, fullName: s.fullName, employeeId: s.employeeId, reason: 'No scheduled working days in this period (all weekly OFF)' });
      continue;
    }

    const isMonthly = profile.salaryBasis.startsWith('MONTHLY');
    const base = profile.baseAmount;

    // Attendance equivalent days, grouped by month so each month uses its own per-day rate.
    const equivByMonth = new Map<string, number>();
    let attendanceEquivalentDays = 0;
    for (const r of records) {
      const eq = PAYABLE_EQUIVALENT[r.status] ?? 0;
      attendanceEquivalentDays += eq;
      const key = monthKey(utcDay(r.attendanceDate));
      equivByMonth.set(key, (equivByMonth.get(key) ?? 0) + eq);
    }

    let periodBaseAmount = zero;
    let earnedBase = zero;
    // Share of a monthly amount that belongs to this period (1 for a full month).
    let monthFraction = zero;
    if (isMonthly) {
      for (const [key, m] of slices) {
        if (m.monthDays === 0) continue;
        const perDay = base.div(m.monthDays);
        periodBaseAmount = periodBaseAmount.plus(perDay.mul(m.periodDays));
        earnedBase = earnedBase.plus(perDay.mul(equivByMonth.get(key) ?? 0));
        monthFraction = monthFraction.plus(new Decimal(m.periodDays).div(m.monthDays));
      }
    } else {
      periodBaseAmount = base.mul(scheduledPayableDays);
      earnedBase = base.mul(attendanceEquivalentDays);
    }
    const attendanceDeductions = Decimal.max(periodBaseAmount.minus(earnedBase), zero);

    const scale = (amount: Decimal) => (isMonthly ? amount.mul(monthFraction) : amount);
    const allowances = scale(profile.fixedAllowance);
    const otherDeductions = scale(profile.fixedDeduction);
    const grossAmount = earnedBase.plus(allowances);

    let tax = zero;
    if (profile.salaryTaxMethod === 'PERCENTAGE' && profile.salaryTaxValue) {
      tax = grossAmount.mul(profile.salaryTaxValue).div(100);
    } else if (profile.salaryTaxMethod === 'FIXED' && profile.salaryTaxValue) {
      tax = scale(profile.salaryTaxValue);
    }
    const netAmount = Decimal.max(grossAmount.minus(tax).minus(otherDeductions), zero);

    eligible.push({
      staffId: s.id,
      fullName: s.fullName,
      employeeId: s.employeeId,
      salaryBasis: profile.salaryBasis,
      scheduledPayableDays,
      attendanceEquivalentDays,
      periodBaseAmount,
      earnedBase,
      attendanceDeductions,
      allowances,
      grossAmount,
      tax,
      otherDeductions,
      netAmount,
      taxMethod: profile.salaryTaxMethod,
      taxValue: profile.salaryTaxValue,
      salaryProfileId: profile.id,
    });
  }

  return { eligible, skipped };
}

export const payrollService = {
  /** Read-only preview — exactly what a Generate would produce, without writing anything. */
  async preview(filters: PayrollRunFilters) {
    const { eligible, skipped } = await computeEligibility(filters);
    const totalAmount = eligible.reduce((sum, r) => sum.plus(r.netAmount), new Decimal(0));
    return { eligible, skipped, totalAmount, staffCount: eligible.length };
  },

  async generate(filters: PayrollRunFilters, actorId: string) {
    const { eligible, skipped } = await computeEligibility(filters);
    if (eligible.length === 0) {
      throw new ConflictError('No staff have both a Salary Profile and approved attendance for this period — nothing to generate.');
    }
    const totalAmount = eligible.reduce((sum, r) => sum.plus(r.netAmount), new Decimal(0));

    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          periodType: filters.periodType,
          periodStart: filters.periodStart,
          periodEnd: filters.periodEnd,
          departmentId: filters.departmentId,
          category: filters.category,
          status: 'GENERATED',
          staffCount: eligible.length,
          totalAmount,
          skippedStaff: skipped as unknown as Prisma.InputJsonValue,
          generatedById: actorId,
        },
      });

      for (const row of eligible) {
        await tx.salarySlip.create({
          data: {
            staffId: row.staffId,
            payrollRunId: run.id,
            periodType: filters.periodType,
            periodStart: filters.periodStart,
            periodEnd: filters.periodEnd,
            baseAmount: row.periodBaseAmount,
            allowances: row.allowances,
            attendanceDeductions: row.attendanceDeductions,
            otherDeductions: row.otherDeductions,
            adjustments: 0,
            generatedAmount: row.netAmount,
            componentBreakdown: {
              periodBaseAmount: row.periodBaseAmount.toNumber(),
              earnedBase: row.earnedBase.toNumber(),
              attendanceDeductions: row.attendanceDeductions.toNumber(),
              allowances: row.allowances.toNumber(),
              grossAmount: row.grossAmount.toNumber(),
              tax: row.tax.toNumber(),
              otherDeductions: row.otherDeductions.toNumber(),
              netAmount: row.netAmount.toNumber(),
            },
            calculationSnapshot: {
              salaryBasis: row.salaryBasis,
              salaryProfileId: row.salaryProfileId,
              scheduledPayableDays: row.scheduledPayableDays,
              attendanceEquivalentDays: row.attendanceEquivalentDays,
              taxMethod: row.taxMethod,
              taxValue: row.taxValue?.toNumber() ?? null,
              generatedAt: new Date().toISOString(),
            },
            status: 'GENERATED',
          },
        });
      }

      return tx.payrollRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { lines: { include: { staff: { select: { id: true, fullName: true, employeeId: true } } } }, department: true },
      });
    });
  },

  async list(query: ListPayrollRunsQuery) {
    const where: Prisma.PayrollRunWhereInput = {};
    if (query.status) where.status = query.status;
    const [rows, totalItems] = await prisma.$transaction([
      prisma.payrollRun.findMany({
        where,
        include: { department: { select: { id: true, name: true } }, generatedByUser: { select: { id: true, username: true } } },
        orderBy: { generatedAt: 'desc' },
        ...paginationSkipTake(query),
      }),
      prisma.payrollRun.count({ where }),
    ]);
    return { rows, meta: buildPaginationMeta(query, totalItems) };
  },

  async getById(id: string) {
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        generatedByUser: { select: { id: true, username: true } },
        approvedByUser: { select: { id: true, username: true } },
        lines: {
          include: {
            staff: { select: { id: true, fullName: true, employeeId: true, category: true } },
            payments: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundError('Payroll run not found');
    return run;
  },

  /** Locks every generated line at once — never edited after this except via payment/adjustment. */
  async approve(id: string, actorId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run not found');
    if (run.status === 'APPROVED') throw new ConflictError('This payroll run is already approved.');

    return prisma.$transaction(async (tx) => {
      await tx.salarySlip.updateMany({ where: { payrollRunId: id }, data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() } });
      return tx.payrollRun.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
        include: { lines: true },
      });
    });
  },

  async listSlips(query: ListSalarySlipsQuery) {
    const where: Prisma.SalarySlipWhereInput = {};
    if (query.staffId) where.staffId = query.staffId;
    if (query.status) where.status = query.status as Prisma.EnumSalaryStatusFilter['equals'];
    if (query.payrollRunId) where.payrollRunId = query.payrollRunId;

    const [rows, totalItems] = await prisma.$transaction([
      prisma.salarySlip.findMany({
        where,
        include: { staff: { select: { id: true, fullName: true, employeeId: true } }, payments: true },
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query),
      }),
      prisma.salarySlip.count({ where }),
    ]);
    return { rows, meta: buildPaginationMeta(query, totalItems) };
  },

  /** Only an APPROVED (or already PARTIALLY_PAID) slip can be paid — never a DRAFT/unapproved one. */
  async paySlip(id: string, body: PaySalarySlipBody, actorId: string) {
    const slip = await prisma.salarySlip.findUnique({ where: { id }, include: { payments: true } });
    if (!slip) throw new NotFoundError('Salary slip not found');
    if (slip.status !== 'APPROVED' && slip.status !== 'PARTIALLY_PAID') {
      throw new ConflictError('Only an approved salary slip can be paid.');
    }
    const alreadyPaid = slip.payments.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
    const remaining = slip.generatedAmount.minus(alreadyPaid);
    if (remaining.lte(0)) throw new ConflictError('This salary slip is already fully paid.');
    if (new Decimal(body.amount).gt(remaining)) {
      throw new ValidationError(`Payment amount exceeds the remaining balance of ${remaining.toFixed(2)}.`);
    }

    return prisma.$transaction(async (tx) => {
      await tx.salaryPayment.create({
        data: {
          salarySlipId: id,
          amount: body.amount,
          method: body.method,
          reference: body.reference,
          paidById: actorId,
        },
      });
      const newPaidTotal = alreadyPaid.plus(body.amount);
      const newStatus = newPaidTotal.gte(slip.generatedAmount) ? 'PAID' : 'PARTIALLY_PAID';
      return tx.salarySlip.update({
        where: { id },
        data: { status: newStatus },
        include: { payments: true, staff: { select: { id: true, fullName: true, employeeId: true } } },
      });
    });
  },
};
