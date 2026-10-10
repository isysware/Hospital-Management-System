import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError } from '@/shared/errors/AppError';
import { buildPaginationMeta, paginationSkipTake } from '@/shared/pagination';
import type {
  MarkAttendanceBody,
  BulkMarkAttendanceBody,
  RosterQuery,
  ListAttendanceQuery,
  SummaryQuery,
  CorrectAttendanceBody,
} from './attendance.schemas';

/** staff.md §11 — Attendance Status → payable-equivalent-day weight. */
export const PAYABLE_EQUIVALENT: Record<string, number> = {
  PRESENT: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
  PAID_LEAVE: 1,
  UNPAID_LEAVE: 0,
  MISSING_PUNCH: 0,
};

function workedMinutesOf(actualIn?: Date, actualOut?: Date): number {
  if (!actualIn || !actualOut) return 0;
  const diff = Math.round((actualOut.getTime() - actualIn.getTime()) / 60000);
  return diff > 0 ? diff : 0;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function minutesFromHHMM(hhmm: string): number {
  const parts = hhmm.split(':');
  return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
}

/** Minutes-since-midnight of a timestamp, read as UTC — the same convention
 * `payroll.calc.ts` (`utcDay`) already uses for every date-only field here. */
function minutesOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

interface ShiftWindow {
  startMinutes: number;
  endMinutes: number;
  graceMinutes: number;
  toleranceMinutes: number;
}

/**
 * The staff member's applicable shift start/end and Late-In grace / Early-Out
 * tolerance for one attendance day (staff.md §8/§11) — their own Weekly
 * Timing override when set, otherwise their assigned Shift's defaults (Shift
 * Management "Attendance Timing Defaults"). Never hardcoded: always read live
 * from `StaffWeeklySchedule`/`Shift`. Returns null when no window is
 * configured, the day is OFF, or the shift is overnight (end < start — out of
 * scope for this same-day minute comparison).
 */
async function resolveShiftWindow(staffId: string, attendanceDate: Date): Promise<ShiftWindow | null> {
  const dayOfWeek = WEEKDAY_NAMES[attendanceDate.getUTCDay()];
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: {
      assignedShift: { select: { startTime: true, endTime: true, defaultArrivalGraceMinutes: true, defaultEarlyExitToleranceMinutes: true } },
      weeklySchedule: { where: { dayOfWeek }, select: { startTime: true, endTime: true, useShiftDefault: true, isWorking: true } },
    },
  });
  if (!staff) return null;
  const day = staff.weeklySchedule[0];
  if (day && !day.isWorking) return null;

  const useShiftTiming = !day || day.useShiftDefault;
  const startTime = useShiftTiming ? staff.assignedShift?.startTime : day?.startTime ?? undefined;
  const endTime = useShiftTiming ? staff.assignedShift?.endTime : day?.endTime ?? undefined;
  if (!startTime || !endTime) return null;

  const startMinutes = minutesFromHHMM(startTime);
  const endMinutes = minutesFromHHMM(endTime);
  if (endMinutes <= startMinutes) return null;

  return {
    startMinutes,
    endMinutes,
    graceMinutes: staff.assignedShift?.defaultArrivalGraceMinutes ?? 0,
    toleranceMinutes: staff.assignedShift?.defaultEarlyExitToleranceMinutes ?? 0,
  };
}

/** Late-In / Early-Out minutes beyond the shift's own grace/tolerance — the input `computeSalaryAmounts` turns into an actual cut using each staff member's configured rate. */
function computeLateEarly(window: ShiftWindow | null, actualIn?: Date, actualOut?: Date): { lateMinutes: number; earlyExitMinutes: number } {
  if (!window) return { lateMinutes: 0, earlyExitMinutes: 0 };
  const lateMinutes = actualIn ? Math.max(0, minutesOfDay(actualIn) - window.startMinutes - window.graceMinutes) : 0;
  const earlyExitMinutes = actualOut ? Math.max(0, window.endMinutes - minutesOfDay(actualOut) - window.toleranceMinutes) : 0;
  return { lateMinutes, earlyExitMinutes };
}

const attendanceInclude = {
  staff: {
    select: {
      id: true,
      employeeId: true,
      fullName: true,
      category: true,
      designation: true,
      department: { select: { id: true, name: true } },
    },
  },
  approvedBy: { select: { id: true, username: true } },
  markedByUser: { select: { id: true, username: true } },
} satisfies Prisma.AttendanceRecordInclude;

async function findRecord(staffId: string, attendanceDate: Date) {
  return prisma.attendanceRecord.findUnique({ where: { staffId_attendanceDate: { staffId, attendanceDate } } });
}

export const attendanceService = {
  /** Daily marking grid — every active staff member for a date, with any existing mark for that day. */
  async getRoster(query: RosterQuery) {
    const where: Prisma.StaffWhereInput = { isActive: true };
    if (query.departmentId) {
      where.staffDepartments = { some: { departmentId: query.departmentId } };
    }
    if (query.category) where.category = query.category;

    const staff = await prisma.staff.findMany({
      where,
      select: { id: true, employeeId: true, fullName: true, category: true, designation: true, department: { select: { id: true, name: true } } },
      orderBy: { fullName: 'asc' },
    });

    const records = await prisma.attendanceRecord.findMany({
      where: { attendanceDate: query.date, staffId: { in: staff.map((s) => s.id) } },
      include: attendanceInclude,
    });
    const byStaffId = new Map(records.map((r) => [r.staffId, r]));

    return staff.map((s) => ({
      staff: s,
      attendance: byStaffId.get(s.id) ?? null,
    }));
  },

  /** Single upsert-by-day mark. Rejects once the day is approved — use `correct` instead (never a silent overwrite). */
  async mark(body: MarkAttendanceBody, actorId: string) {
    const staff = await prisma.staff.findUnique({ where: { id: body.staffId }, select: { id: true, isActive: true } });
    if (!staff) throw new NotFoundError('Staff record not found');

    const existing = await findRecord(body.staffId, body.attendanceDate);
    if (existing?.isApproved) {
      throw new ConflictError('This attendance day is already approved. Use the correction workflow to change it.');
    }

    const workedMinutes = workedMinutesOf(body.actualIn, body.actualOut);
    const window = await resolveShiftWindow(body.staffId, body.attendanceDate);
    const { lateMinutes, earlyExitMinutes } = computeLateEarly(window, body.actualIn, body.actualOut);
    const data: Prisma.AttendanceRecordUpsertArgs['create'] = {
      staffId: body.staffId,
      attendanceDate: body.attendanceDate,
      status: body.status,
      actualIn: body.actualIn ?? null,
      actualOut: body.actualOut ?? null,
      workedMinutes,
      lateMinutes,
      earlyExitMinutes,
      notes: body.notes ?? null,
      source: 'MANUAL',
      markedById: actorId,
    };

    return prisma.attendanceRecord.upsert({
      where: { staffId_attendanceDate: { staffId: body.staffId, attendanceDate: body.attendanceDate } },
      create: data,
      update: {
        status: body.status,
        actualIn: body.actualIn ?? null,
        actualOut: body.actualOut ?? null,
        workedMinutes,
        lateMinutes,
        earlyExitMinutes,
        notes: body.notes ?? null,
        markedById: actorId,
      },
      include: attendanceInclude,
    });
  },

  /** Marks/updates a whole day's roster in one transaction. Rows already approved are skipped, not overwritten. */
  async bulkMark(body: BulkMarkAttendanceBody, actorId: string) {
    const staffIds = body.records.map((r) => r.staffId);
    const staffRows = await prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true } });
    const validIds = new Set(staffRows.map((s) => s.id));

    const existing = await prisma.attendanceRecord.findMany({
      where: { attendanceDate: body.attendanceDate, staffId: { in: staffIds } },
    });
    const approvedIds = new Set(existing.filter((r) => r.isApproved).map((r) => r.staffId));

    const skipped: string[] = [];
    const toWrite = body.records.filter((r) => {
      if (!validIds.has(r.staffId)) {
        skipped.push(r.staffId);
        return false;
      }
      if (approvedIds.has(r.staffId)) {
        skipped.push(r.staffId);
        return false;
      }
      return true;
    });

    const windows = new Map(
      await Promise.all(toWrite.map(async (r) => [r.staffId, await resolveShiftWindow(r.staffId, body.attendanceDate)] as const)),
    );

    const result = await prisma.$transaction(
      toWrite.map((r) => {
        const { lateMinutes, earlyExitMinutes } = computeLateEarly(windows.get(r.staffId) ?? null, r.actualIn, r.actualOut);
        return prisma.attendanceRecord.upsert({
          where: { staffId_attendanceDate: { staffId: r.staffId, attendanceDate: body.attendanceDate } },
          create: {
            staffId: r.staffId,
            attendanceDate: body.attendanceDate,
            status: r.status,
            actualIn: r.actualIn ?? null,
            actualOut: r.actualOut ?? null,
            workedMinutes: workedMinutesOf(r.actualIn, r.actualOut),
            lateMinutes,
            earlyExitMinutes,
            notes: r.notes ?? null,
            source: 'MANUAL',
            markedById: actorId,
          },
          update: {
            status: r.status,
            actualIn: r.actualIn ?? null,
            actualOut: r.actualOut ?? null,
            workedMinutes: workedMinutesOf(r.actualIn, r.actualOut),
            lateMinutes,
            earlyExitMinutes,
            notes: r.notes ?? null,
            markedById: actorId,
          },
        });
      }),
    );

    return { marked: result.length, skipped };
  },

  async list(query: ListAttendanceQuery) {
    const where: Prisma.AttendanceRecordWhereInput = {};
    if (query.staffId) where.staffId = query.staffId;
    if (query.status) where.status = query.status;
    if (query.isApproved !== undefined) where.isApproved = query.isApproved;
    if (query.startDate || query.endDate) {
      where.attendanceDate = {};
      if (query.startDate) where.attendanceDate.gte = query.startDate;
      if (query.endDate) where.attendanceDate.lte = query.endDate;
    }
    if (query.departmentId) {
      where.staff = { staffDepartments: { some: { departmentId: query.departmentId } } };
    }

    const [rows, totalItems] = await prisma.$transaction([
      prisma.attendanceRecord.findMany({
        where,
        include: attendanceInclude,
        orderBy: [{ attendanceDate: 'desc' }, { createdAt: 'desc' }],
        ...paginationSkipTake(query),
      }),
      prisma.attendanceRecord.count({ where }),
    ]);
    return { rows, meta: buildPaginationMeta(query, totalItems) };
  },

  /** Payable-equivalent summary for a period (staff.md §11) — the exact input Payroll Run will consume. */
  async getSummary(query: SummaryQuery) {
    const where: Prisma.AttendanceRecordWhereInput = {
      attendanceDate: { gte: query.startDate, lte: query.endDate },
    };
    if (query.staffId) where.staffId = query.staffId;
    if (query.departmentId) where.staff = { staffDepartments: { some: { departmentId: query.departmentId } } };

    const records = await prisma.attendanceRecord.findMany({
      where,
      select: { staffId: true, staff: { select: { fullName: true, employeeId: true } }, status: true },
    });

    const byStaff = new Map<string, { staffId: string; fullName: string; employeeId: string; counts: Record<string, number>; payableEquivalentDays: number }>();
    for (const r of records) {
      let entry = byStaff.get(r.staffId);
      if (!entry) {
        entry = { staffId: r.staffId, fullName: r.staff.fullName, employeeId: r.staff.employeeId, counts: {}, payableEquivalentDays: 0 };
        byStaff.set(r.staffId, entry);
      }
      entry.counts[r.status] = (entry.counts[r.status] ?? 0) + 1;
      entry.payableEquivalentDays += PAYABLE_EQUIVALENT[r.status] ?? 0;
    }
    return Array.from(byStaff.values());
  },

  async approve(id: string, actorId: string) {
    const record = await prisma.attendanceRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Attendance record not found');
    if (record.isApproved) throw new ConflictError('This attendance record is already approved.');

    return prisma.attendanceRecord.update({
      where: { id },
      data: { isApproved: true, approvedById: actorId, approvedAt: new Date() },
      include: attendanceInclude,
    });
  },

  /** Post-approval correction — never a silent edit; always logs original → corrected + reason (D16 p.19/p.33). */
  async correct(id: string, body: CorrectAttendanceBody, actorId: string) {
    const record = await prisma.attendanceRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Attendance record not found');
    if (!record.isApproved) {
      throw new ConflictError('Only approved attendance can be corrected — edit it directly with /mark before approval.');
    }

    const originalValue = {
      status: record.status,
      actualIn: record.actualIn,
      actualOut: record.actualOut,
      workedMinutes: record.workedMinutes,
      lateMinutes: record.lateMinutes,
      earlyExitMinutes: record.earlyExitMinutes,
      notes: record.notes,
    };
    const nextActualIn = body.actualIn ?? record.actualIn ?? undefined;
    const nextActualOut = body.actualOut ?? record.actualOut ?? undefined;
    const window = await resolveShiftWindow(record.staffId, record.attendanceDate);
    const { lateMinutes, earlyExitMinutes } = computeLateEarly(window, nextActualIn, nextActualOut);
    const correctedValue = {
      status: body.status ?? record.status,
      actualIn: body.actualIn ?? record.actualIn,
      actualOut: body.actualOut ?? record.actualOut,
      workedMinutes: workedMinutesOf(nextActualIn, nextActualOut),
      lateMinutes,
      earlyExitMinutes,
      notes: body.notes ?? record.notes,
    };

    return prisma.$transaction(async (tx) => {
      await tx.attendanceCorrectionLog.create({
        data: {
          attendanceRecordId: id,
          originalValue,
          correctedValue,
          reason: body.reason,
          changedById: actorId,
        },
      });
      return tx.attendanceRecord.update({
        where: { id },
        data: correctedValue,
        include: attendanceInclude,
      });
    });
  },

  async getById(id: string) {
    const record = await prisma.attendanceRecord.findUnique({
      where: { id },
      include: { ...attendanceInclude, corrections: { orderBy: { changedAt: 'desc' } } },
    });
    if (!record) throw new NotFoundError('Attendance record not found');
    return record;
  },

  async deleteRecord(id: string) {
    const record = await prisma.attendanceRecord.findUnique({
      where: { id },
      include: { corrections: true },
    });
    if (!record) throw new NotFoundError('Attendance record not found');
    if (record.isApproved) {
      throw new ConflictError('Cannot delete an approved attendance record. Use correction workflow instead.');
    }
    if (record.corrections && record.corrections.length > 0) {
      await prisma.attendanceCorrectionLog.deleteMany({ where: { attendanceRecordId: id } });
    }
    await prisma.attendanceRecord.delete({ where: { id } });
    return { success: true };
  },
};
