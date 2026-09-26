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
    const data: Prisma.AttendanceRecordUpsertArgs['create'] = {
      staffId: body.staffId,
      attendanceDate: body.attendanceDate,
      status: body.status,
      actualIn: body.actualIn ?? null,
      actualOut: body.actualOut ?? null,
      workedMinutes,
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

    const result = await prisma.$transaction(
      toWrite.map((r) =>
        prisma.attendanceRecord.upsert({
          where: { staffId_attendanceDate: { staffId: r.staffId, attendanceDate: body.attendanceDate } },
          create: {
            staffId: r.staffId,
            attendanceDate: body.attendanceDate,
            status: r.status,
            actualIn: r.actualIn ?? null,
            actualOut: r.actualOut ?? null,
            workedMinutes: workedMinutesOf(r.actualIn, r.actualOut),
            notes: r.notes ?? null,
            source: 'MANUAL',
            markedById: actorId,
          },
          update: {
            status: r.status,
            actualIn: r.actualIn ?? null,
            actualOut: r.actualOut ?? null,
            workedMinutes: workedMinutesOf(r.actualIn, r.actualOut),
            notes: r.notes ?? null,
            markedById: actorId,
          },
        }),
      ),
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
      notes: record.notes,
    };
    const nextActualIn = body.actualIn ?? record.actualIn ?? undefined;
    const nextActualOut = body.actualOut ?? record.actualOut ?? undefined;
    const correctedValue = {
      status: body.status ?? record.status,
      actualIn: body.actualIn ?? record.actualIn,
      actualOut: body.actualOut ?? record.actualOut,
      workedMinutes: workedMinutesOf(nextActualIn, nextActualOut),
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
};
