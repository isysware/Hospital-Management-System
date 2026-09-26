import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import type { ListStaffQuery } from './staff.schemas';

const staffWithPortalInclude = {
  department: { select: { id: true, name: true, code: true } },
  assignedShift: { select: { id: true, name: true, code: true, startTime: true, endTime: true, defaultWeeklyOffDays: true } },
  staffDepartments: {
    select: {
      id: true,
      departmentId: true,
      isPrimary: true,
      department: { select: { id: true, name: true, code: true } },
    },
  },
  staffServices: {
    where: { isActive: true },
    select: {
      id: true,
      serviceRateId: true,
      // encounterType (OPD/OBSERVATION/EMERGENCY/NONE) drives this doctor's
      // real OPD/Observation/Emergency eligibility — staff.md §4/§7: a
      // doctor's consulting-list eligibility comes from the services they
      // were actually assigned, not a separate manual checkbox.
      serviceRate: { select: { id: true, name: true, code: true, encounterType: true } },
    },
  },
  portalUser: {
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      mustResetPassword: true,
      lastLoginAt: true,
      passwordResetAt: true,
      passwordResetBy: true,
    },
  },
} satisfies Prisma.StaffInclude;

function buildWhere(query: ListStaffQuery): Prisma.StaffWhereInput {
  const where: Prisma.StaffWhereInput = {};
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.category) where.category = query.category;
  if (query.employmentStatus) where.employmentStatus = query.employmentStatus;
  if (query.search) {
    where.OR = [
      { fullName: { contains: query.search, mode: 'insensitive' } },
      { employeeId: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

export const staffRepository = {
  count() {
    return prisma.staff.count();
  },

  async findMany(query: ListStaffQuery) {
    const where = buildWhere(query);
    const [rows, totalItems] = await prisma.$transaction([
      prisma.staff.findMany({
        where,
        include: staffWithPortalInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.staff.count({ where }),
    ]);
    return { rows, totalItems };
  },

  findById(id: string) {
    return prisma.staff.findUnique({ where: { id } });
  },

  create(data: Prisma.StaffCreateInput) {
    return prisma.staff.create({ data, include: staffWithPortalInclude });
  },

  update(id: string, data: Prisma.StaffUpdateInput) {
    return prisma.staff.update({ where: { id }, data, include: staffWithPortalInclude });
  },

  deactivate(id: string) {
    return prisma.staff.update({
      where: { id },
      data: { isActive: false, employmentStatus: 'INACTIVE' },
      include: staffWithPortalInclude,
    });
  },

  /**
   * Staff 360° profile (§4.1) — a single aggregate read across every tab
   * the client screen needs: Overview, Employment/Shift history, recent
   * Attendance, current Salary configuration, and Commission rules.
   */
  findFullProfile(id: string) {
    return prisma.staff.findUnique({
      where: { id },
      include: {
        department: true,
        assignedShift: { select: { id: true, name: true, code: true, startTime: true, endTime: true, defaultWeeklyOffDays: true } },
        staffDepartments: {
          select: {
            id: true,
            departmentId: true,
            isPrimary: true,
            department: { select: { id: true, name: true, code: true } },
          },
        },
        staffServices: {
          where: { isActive: true },
          select: {
            id: true,
            serviceRateId: true,
            serviceRate: { select: { id: true, name: true, code: true, encounterType: true } },
          },
        },
        portalUser: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
            isCashHandling: true,
            mustResetPassword: true,
            lastLoginAt: true,
          },
        },
        employmentHistory: {
          orderBy: { effectiveFrom: 'desc' },
          take: 20,
        },
        attendanceRecords: {
          orderBy: { attendanceDate: 'desc' },
          take: 30,
        },
        salaryProfiles: {
          orderBy: { effectiveFrom: 'desc' },
          take: 5,
          include: { salaryTemplate: true },
        },
        commissionRules: {
          orderBy: { effectiveFrom: 'desc' },
          include: { serviceRate: { select: { id: true, code: true, name: true } } },
        },
        weeklySchedule: true,
        bankAccounts: { orderBy: { effectiveFrom: 'desc' }, take: 5 },
      },
    });
  },

  async delete(id: string) {
    return prisma.$transaction(async (tx) => {
      const portal = await tx.portalUser.findUnique({ where: { staffId: id } });
      if (portal) {
        await tx.refreshToken.deleteMany({ where: { portalUserId: portal.id } });
        await tx.portalUser.delete({ where: { id: portal.id } });
      }
      await tx.department.updateMany({
        where: { headStaffId: id },
        data: { headStaffId: null },
      });
      await tx.staffEmploymentHistory.deleteMany({ where: { staffId: id } });
      await tx.staffSalaryProfile.deleteMany({ where: { staffId: id } });
      return tx.staff.delete({ where: { id } });
    });
  },
};
