import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { buildPaginationMeta, paginationSkipTake } from '@/shared/pagination';
import { computeSalaryAmounts, workingDaySet } from './payroll.calc';
import { salaryBalance } from './payroll.balance';
import type { PayrollRunFilters, ListPayrollRunsQuery, PaySalarySlipBody, ListSalarySlipsQuery } from './payroll.schemas';

interface EligibleRow {
  staffId: string;
  fullName: string;
  employeeId: string;
  salaryBasis: string;
  monthlyBaseAmount?: Decimal;
  monthlyScheduledDays: number;
  dailyRate: Decimal;
  scheduledPayableDays: number;
  attendanceEquivalentDays: number;
  periodBaseAmount: Decimal;
  earnedBase: Decimal;
  attendanceDeductions: Decimal;
  allowances: Decimal;
  grossAmount: Decimal;
  tax: Decimal;
  otherDeductions: Decimal;
  lateDeduction: Decimal;
  earlyExitDeduction: Decimal;
  lateMinutes: number;
  earlyExitMinutes: number;
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

/**
 * PDF §11 — attendance-based salary per staff for the period. Read-only; never
 * persists. The maths lives in payroll.calc `computeSalaryAmounts`.
 */
async function computeEligibility(filters: PayrollRunFilters): Promise<{ eligible: EligibleRow[]; skipped: SkippedRow[] }> {
  const staffWhere: Prisma.StaffWhereInput = { isActive: true };
  if (filters.category) staffWhere.category = filters.category;
  if (filters.staffId) staffWhere.id = filters.staffId;
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
  const existingSlips = await prisma.salarySlip.findMany({ where: {
    staffId: { in: staffIds }, periodStart: { lte: filters.periodEnd }, periodEnd: { gte: filters.periodStart },
  }, select: { staffId: true } });
  const alreadyGenerated = new Set(existingSlips.map(s => s.staffId));

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
    select: { staffId: true, status: true, attendanceDate: true, lateMinutes: true, earlyExitMinutes: true },
  });
  const attendanceByStaff = new Map<string, { status: string; attendanceDate: Date; lateMinutes: number; earlyExitMinutes: number }[]>();
  for (const a of attendance) {
    const list = attendanceByStaff.get(a.staffId) ?? [];
    list.push(a);
    attendanceByStaff.set(a.staffId, list);
  }

  const eligible: EligibleRow[] = [];
  const skipped: SkippedRow[] = [];

  for (const s of staff) {
    if (alreadyGenerated.has(s.id)) {
      skipped.push({ staffId: s.id, fullName: s.fullName, employeeId: s.employeeId, reason: 'Salary already generated for an overlapping period; use an adjustment to correct it.' });
      continue;
    }
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
    const amounts = computeSalaryAmounts(profile, working, filters.periodStart, filters.periodEnd, records);
    if (!amounts) {
      skipped.push({ staffId: s.id, fullName: s.fullName, employeeId: s.employeeId, reason: 'No scheduled working days in this period (all weekly OFF)' });
      continue;
    }

    eligible.push({
      staffId: s.id,
      fullName: s.fullName,
      employeeId: s.employeeId,
      salaryBasis: profile.salaryBasis,
      ...(profile.salaryBasis.startsWith('MONTHLY') ? { monthlyBaseAmount: profile.baseAmount } : {}),
      ...amounts,
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
      // Serialize generation per employee; concurrent or overlapping runs must
      // not create a second liability for the same attendance period.
      for (const row of [...eligible].sort((a, b) => a.staffId.localeCompare(b.staffId))) {
        await tx.$queryRaw`SELECT id FROM staff WHERE id = ${row.staffId} FOR UPDATE`;
      }
      const duplicate = await tx.salarySlip.findFirst({ where: {
        staffId: { in: eligible.map(r => r.staffId) }, periodStart: { lte: filters.periodEnd }, periodEnd: { gte: filters.periodStart },
      } });
      if (duplicate) throw new ConflictError('Salary was generated concurrently for this period. Refresh Preview.');
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
              // Late-In / Early-Out cutting — dynamically computed from this
              // staff member's own Salary Profile deductionRules + the
              // period's actual AttendanceRecord.lateMinutes/earlyExitMinutes.
              lateMinutes: row.lateMinutes,
              lateDeduction: row.lateDeduction.toNumber(),
              earlyExitMinutes: row.earlyExitMinutes,
              earlyExitDeduction: row.earlyExitDeduction.toNumber(),
              netAmount: row.netAmount.toNumber(),
            },
            calculationSnapshot: {
              salaryBasis: row.salaryBasis,
              ...(row.salaryBasis.startsWith('MONTHLY') ? { monthlyBaseAmount: row.monthlyBaseAmount?.toString() } : {}),
              salaryProfileId: row.salaryProfileId,
              // Audit trail (PDF §11): the exact day-count/rate basis used,
              // so historical payroll stays reproducible even if the salary
              // profile, schedule, or attendance is edited afterwards.
              monthlyScheduledDays: row.monthlyScheduledDays,
              dailyRate: row.dailyRate.toString(),
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
            correctionEntries: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundError('Payroll run not found');
    return { ...run, lines: run.lines.map(line => ({ ...line, balance: salaryBalance(line) })) };
  },

  /** Locks every generated line at once — never edited after this except via payment/adjustment. */
  async approve(id: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const approvedAt = new Date();
      const changed = await tx.payrollRun.updateMany({
        where: { id, status: 'GENERATED' },
        data: { status: 'APPROVED', approvedById: actorId, approvedAt },
      });
      if (!changed.count) throw new ConflictError('Only a generated payroll run can be approved.');
      await tx.salarySlip.updateMany({ where: { payrollRunId: id, status: 'GENERATED' }, data: { status: 'APPROVED', approvedById: actorId, approvedAt } });
      return tx.payrollRun.findUniqueOrThrow({ where: { id }, include: { lines: true } });
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
        include: { staff: { select: { id: true, fullName: true, employeeId: true } }, payments: true, correctionEntries: true },
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query),
      }),
      prisma.salarySlip.count({ where }),
    ]);
    return { rows: rows.map(row => ({ ...row, balance: salaryBalance(row) })), meta: buildPaginationMeta(query, totalItems) };
  },

  async paySlip(id: string, body: PaySalarySlipBody, actorId: string) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM salary_slips WHERE id = ${id} FOR UPDATE`;
      const slip = await tx.salarySlip.findUnique({ where: { id }, include: { payments: true, correctionEntries: true } });
      if (!slip) throw new NotFoundError('Salary slip not found');
      if (!['APPROVED', 'PARTIALLY_PAID'].includes(slip.status)) throw new ConflictError('Only an approved salary slip can be paid.');
      const balance = salaryBalance(slip);
      if (balance.remaining.lte(0) || new Decimal(body.amount).gt(balance.remaining)) throw new ValidationError(`Payment exceeds remaining salary ${balance.remaining.toFixed(2)}.`);
      await tx.salaryPayment.create({ data: { salarySlipId: id, ...body, paidById: actorId } });
      const updated = await tx.salarySlip.update({ where: { id }, data: {
        status: balance.paid.plus(body.amount).gte(balance.payable) ? 'PAID' : 'PARTIALLY_PAID',
      }, include: { payments: true, correctionEntries: true, staff: { select: { id: true, fullName: true, employeeId: true } } } });
      return { ...updated, balance: salaryBalance(updated) };
    });
  },

  async adjustSlip(id: string, body: { amount: number; reason: string }, actorId: string) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM salary_slips WHERE id = ${id} FOR UPDATE`;
      const slip = await tx.salarySlip.findUnique({ where: { id }, include: { payments: true, correctionEntries: true } });
      if (!slip) throw new NotFoundError('Salary slip not found');
      if (!slip.approvedAt) throw new ConflictError('Only approved salary can be corrected.');
      const balance = salaryBalance(slip);
      const payable = balance.payable.plus(body.amount);
      if (payable.lt(0)) throw new ValidationError('Correction cannot reduce payable below zero.');
      await tx.salaryAdjustment.create({ data: { salarySlipId: id, ...body, createdById: actorId } });
      const updated = await tx.salarySlip.update({ where: { id }, data: {
        status: balance.paid.gte(payable) ? 'PAID' : balance.paid.gt(0) ? 'PARTIALLY_PAID' : 'APPROVED',
      }, include: { payments: true, correctionEntries: true, staff: { select: { id: true, fullName: true, employeeId: true } } } });
      return { ...updated, balance: salaryBalance(updated) };
    });
  },
};
