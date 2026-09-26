import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { staffRepository } from './staff.repository';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { buildPaginationMeta } from '@/shared/pagination';
import { resolveActorLabel } from '@/shared/actorLabel';
import type {
  CreateStaffBody,
  UpdateStaffBody,
  ListStaffQuery,
  SetClinicalAuthBody,
  ResetClinicalAuthPasswordBody,
  CreateSalaryProfileBody,
  ReplaceWeeklyScheduleBody,
  CreateBankAccountBody,
  WeeklyScheduleInput,
  BankAccountInput,
  CommissionSetup,
} from './staff.schemas';
import { WEEK_DAYS, isCommissionBasis } from './staff.schemas';

const BCRYPT_ROUNDS = 12;

// `clinicalAuthPasswordHash` (v7.2 §2.4) never needs stripping here — it's
// globally omitted at the Prisma client level (`src/db/client.ts`), so it's
// structurally absent from every query result everywhere, not just this file.

/**
 * System-generated Employee ID (§16 Q-01 — exact format not specified by
 * the client; `EMP-<year>-<sequence>` is this phase's placeholder).
 * Generation + insert is retried on a unique-constraint race rather than
/**
 * System-generated purely numeric Employee ID (e.g. 1001, 1002, 1003...).
 * Automatically scans existing staff to find the highest numeric code and increments it sequentially.
 */
async function generateNumericEmployeeId(attempt: number = 0): Promise<string> {
  const { rows } = await staffRepository.findMany({ pageSize: 1000, page: 1 });
  let maxNum = 1000;
  for (const s of rows) {
    const num = parseInt(s.employeeId, 10);
    if (!Number.isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }
  return String(maxNum + 1 + attempt);
}

const MAX_EMPLOYEE_ID_RETRIES = 3;

/** staff.md §2/§4 — "Doctor service assignments must reference active real services." */
async function assertServicesActive(serviceIds: string[]): Promise<void> {
  const rows = await prisma.serviceRate.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, isActive: true, isDeleted: true },
  });
  const found = new Map(rows.map((r) => [r.id, r]));
  for (const id of serviceIds) {
    const svc = found.get(id);
    if (!svc || svc.isDeleted || !svc.isActive) {
      throw new ConflictError(`Service "${id}" is not an active service and cannot be assigned to a doctor.`);
    }
  }
}

type Tx = Prisma.TransactionClient;

/** Replaces the 7 weekday rows (one current schedule per staff member). */
async function writeWeeklySchedule(tx: Tx, staffId: string, days: WeeklyScheduleInput, effectiveFrom: Date, actorLabel: string) {
  await tx.staffWeeklySchedule.deleteMany({ where: { staffId } });
  await tx.staffWeeklySchedule.createMany({
    data: days.map((d) => ({
      staffId,
      dayOfWeek: d.dayOfWeek,
      isWorking: d.isWorking,
      useShiftDefault: d.isWorking ? d.useShiftDefault : true,
      startTime: d.isWorking && !d.useShiftDefault ? d.startTime ?? null : null,
      endTime: d.isWorking && !d.useShiftDefault ? d.endTime ?? null : null,
      breakMinutes: d.isWorking ? d.breakMinutes : 0,
      effectiveFrom,
      createdBy: actorLabel,
    })),
  });
}

/** Effective-dated: closes the currently open profile at the new effectiveFrom. */
async function writeSalaryProfile(tx: Tx, staffId: string, body: CreateSalaryProfileBody, actorId: string) {
  await tx.staffSalaryProfile.updateMany({
    where: { staffId, effectiveTo: null },
    data: { effectiveTo: body.effectiveFrom },
  });
  return tx.staffSalaryProfile.create({
    data: {
      staffId,
      salaryTemplateId: body.salaryTemplateId ?? undefined,
      salaryBasis: body.salaryBasis,
      baseAmount: body.baseAmount,
      payrollDivisor: body.payrollDivisor ?? 30,
      salaryTaxMethod: body.salaryTaxMethod ?? null,
      salaryTaxValue: body.salaryTaxMethod ? body.salaryTaxValue ?? 0 : null,
      salaryTaxEffectiveFrom: body.salaryTaxMethod ? body.effectiveFrom : null,
      fixedAllowance: body.fixedAllowance ?? 0,
      fixedDeduction: body.fixedDeduction ?? 0,
      paymentMethod: body.paymentMethod ?? null,
      effectiveFrom: body.effectiveFrom,
      createdById: actorId,
    },
    include: { salaryTemplate: true },
  });
}

/**
 * PDF §7/§14 — replaces the staff member's commission setup: every open rule is
 * closed at the new effectiveFrom (history kept) and the new service-wise rules start.
 */
async function writeCommissionRules(tx: Tx, staffId: string, setup: CommissionSetup, actorId: string) {
  await tx.doctorCommissionRule.updateMany({
    where: { staffId, effectiveTo: null },
    data: { effectiveTo: setup.effectiveFrom },
  });
  for (const rule of setup.rules) {
    await tx.doctorCommissionRule.create({
      data: {
        staffId,
        serviceRateId: rule.serviceRateId,
        ruleType: rule.ruleType,
        rate: rule.rate,
        basis: rule.basis,
        effectiveFrom: setup.effectiveFrom,
        commissionTaxMethod: setup.commissionTaxMethod ?? null,
        commissionTaxValue: setup.commissionTaxMethod ? setup.commissionTaxValue ?? 0 : null,
        createdById: actorId,
      },
    });
  }
}

/** Effective-dated: a new account closes the previous current one (PDF §4 "Effective From"). */
async function writeBankAccount(tx: Tx, staffId: string, body: BankAccountInput, actorLabel: string) {
  await tx.staffBankAccount.updateMany({
    where: { staffId, effectiveTo: null },
    data: { effectiveTo: body.effectiveFrom, isActive: false },
  });
  const isBank = body.paymentMethod === 'BANK';
  return tx.staffBankAccount.create({
    data: {
      staffId,
      paymentMethod: body.paymentMethod,
      bankName: isBank ? body.bankName ?? null : null,
      branchName: isBank ? body.branchName ?? null : null,
      accountTitle: isBank ? body.accountTitle ?? null : null,
      accountNumber: isBank ? body.accountNumber ?? null : null,
      iban: isBank ? body.iban ?? null : null,
      walletAccount: body.paymentMethod === 'ONLINE' ? body.walletAccount ?? null : null,
      preferredForSalary: body.preferredForSalary,
      preferredForCommission: body.preferredForCommission,
      effectiveFrom: body.effectiveFrom,
      createdBy: actorLabel,
    },
  });
}

export const staffService = {
  async list(query: ListStaffQuery) {
    const { rows, totalItems } = await staffRepository.findMany(query);
    return { rows, meta: buildPaginationMeta(query, totalItems) };
  },

  async getById(id: string) {
    const staff = await staffRepository.findById(id);
    if (!staff) throw new NotFoundError('Staff record not found');
    return staff;
  },

  async create(body: CreateStaffBody, createdById: string) {
    if (body.cnic) {
      const existing = await prisma.staff.findUnique({ where: { cnic: body.cnic } });
      if (existing) throw new ConflictError(`CNIC "${body.cnic}" is already registered to another staff member.`);
    }
    if (body.category === 'Doctor' && body.serviceIds && body.serviceIds.length > 0) {
      await assertServicesActive(body.serviceIds);
    }
    // Checked up front so a clash reports clearly instead of looking like an employeeId retry.
    let clinicalAuthData: Pick<Prisma.StaffCreateInput, 'clinicalAuthUsername' | 'clinicalAuthPasswordHash' | 'clinicalAuthActive' | 'clinicalAuthUpdatedAt' | 'clinicalAuthUpdatedByUser'> = {};
    if (body.clinicalAuth) {
      const taken = await prisma.staff.findUnique({ where: { clinicalAuthUsername: body.clinicalAuth.username }, select: { id: true } });
      if (taken) throw new ConflictError(`Discharge username "${body.clinicalAuth.username}" is already used by another doctor.`);
      clinicalAuthData = {
        clinicalAuthUsername: body.clinicalAuth.username,
        clinicalAuthPasswordHash: await bcrypt.hash(body.clinicalAuth.password, BCRYPT_ROUNDS),
        clinicalAuthActive: true,
        clinicalAuthUpdatedAt: new Date(),
        clinicalAuthUpdatedByUser: { connect: { id: createdById } },
      };
    }

    const actorLabel = await resolveActorLabel(createdById);
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_EMPLOYEE_ID_RETRIES; attempt += 1) {
      const employeeId = await generateNumericEmployeeId(attempt);
      try {
        const deptIds = body.departmentIds ?? [];
        const primaryDeptId = deptIds[0];

        const data: Prisma.StaffCreateInput = {
          employeeId,
          fullName: body.fullName,
          fatherGuardianName: body.fatherGuardianName,
          cnic: body.cnic,
          dateOfBirth: body.dateOfBirth,
          category: body.category,
          ...(primaryDeptId ? { department: { connect: { id: primaryDeptId } } } : {}),
          designation: body.designation,
          phone: body.phone,
          alternatePhone: body.alternatePhone,
          email: body.email,
          joiningDate: body.joiningDate ?? new Date(),
          notes: body.notes,
          ...(body.assignedShiftId ? { assignedShift: { connect: { id: body.assignedShiftId } } } : {}),
          doctorSponsoredDiscountTrackingEnabled: body.doctorSponsoredDiscountTrackingEnabled ?? false,
          availableForOpd: body.availableForOpd ?? false,
          availableForObservation: body.availableForObservation ?? false,
          availableForEmergency: body.availableForEmergency ?? false,
          ...clinicalAuthData,
          createdBy: actorLabel,
          updatedBy: actorLabel,
          ...(deptIds.length > 0
            ? {
                staffDepartments: {
                  create: deptIds.map((deptId) => ({
                    departmentId: deptId,
                    isPrimary: deptId === primaryDeptId,
                    assignedBy: actorLabel,
                  })),
                },
              }
            : {}),
          ...(body.serviceIds && body.serviceIds.length > 0
            ? {
                staffServices: {
                  create: body.serviceIds.map((serviceRateId) => ({ serviceRateId, assignedBy: actorLabel })),
                },
              }
            : {}),
        };
        // Staff row + wizard steps 6–9 in one transaction: if any step fails
        // (e.g. a bad commission service), no half-created staff member remains.
        const created = await prisma.$transaction(async (tx) => {
          const staff = await tx.staff.create({ data, select: { id: true } });
          const effectiveFrom = body.joiningDate ?? new Date();
          if (body.weeklySchedule) await writeWeeklySchedule(tx, staff.id, body.weeklySchedule, effectiveFrom, actorLabel);
          if (body.salaryProfile) await writeSalaryProfile(tx, staff.id, body.salaryProfile, createdById);
          if (body.commission) await writeCommissionRules(tx, staff.id, body.commission, createdById);
          if (body.bankAccount) await writeBankAccount(tx, staff.id, body.bankAccount, actorLabel);
          return staff;
        });
        return (await staffRepository.findById(created.id))!;
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          lastError = error;
          continue; // employeeId collision — retry with the next sequence value
        }
        throw error;
      }
    }
    throw lastError;
  },

  async update(id: string, body: UpdateStaffBody, updatedById: string) {
    const existing = await this.getById(id);

    if (body.cnic && body.cnic !== existing.cnic) {
      const dup = await prisma.staff.findUnique({ where: { cnic: body.cnic } });
      if (dup && dup.id !== id) throw new ConflictError(`CNIC "${body.cnic}" is already registered to another staff member.`);
    }

    const nextCategory = body.category ?? existing.category;
    if (nextCategory === 'Doctor' && body.serviceIds && body.serviceIds.length > 0) {
      await assertServicesActive(body.serviceIds);
    }
    const leavingDoctorCategory = existing.category === 'Doctor' && body.category !== undefined && body.category !== 'Doctor';

    const actorLabel = await resolveActorLabel(updatedById);
    const data: Prisma.StaffUpdateInput = { ...body, updatedBy: actorLabel };
    delete (data as Record<string, unknown>).departmentIds;
    delete (data as Record<string, unknown>).serviceIds;
    delete (data as Record<string, unknown>).assignedShiftId;
    if (body.departmentIds && body.departmentIds.length > 0) {
      data.department = { connect: { id: body.departmentIds[0] } };
    }
    if (body.assignedShiftId !== undefined) {
      data.assignedShift = body.assignedShiftId ? { connect: { id: body.assignedShiftId } } : { disconnect: true };
    }

    // Plain field update, no department/service junction work needed — skip the transaction.
    const needsJunctionSync = body.departmentIds !== undefined || body.serviceIds !== undefined || leavingDoctorCategory;
    if (!needsJunctionSync) {
      return staffRepository.update(id, data);
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.staff.update({
        where: { id },
        data,
        include: {
          department: true,
          staffDepartments: { select: { id: true, departmentId: true, isPrimary: true, department: { select: { id: true, name: true, code: true } } } },
          staffServices: { where: { isActive: true }, select: { id: true, serviceRateId: true, serviceRate: { select: { id: true, name: true, code: true } } } },
          portalUser: { select: { id: true, username: true, email: true, role: true, status: true, mustResetPassword: true, lastLoginAt: true, passwordResetBy: true, passwordResetAt: true } },
        },
      });

      // Replace department junction rows only when the caller explicitly sent a new list.
      if (body.departmentIds !== undefined) {
        await tx.staffDepartment.deleteMany({ where: { staffId: id } });
        if (body.departmentIds.length > 0) {
          await tx.staffDepartment.createMany({
            data: body.departmentIds.map((deptId) => ({
              staffId: id,
              departmentId: deptId,
              isPrimary: deptId === body.departmentIds![0],
              assignedBy: actorLabel,
            })),
          });
        }
      }

      // Doctor ↔ Service assignments: soft-deactivate rather than delete, so
      // commission history on `DoctorCommissionRule` for the same service stays intact.
      if (leavingDoctorCategory) {
        await tx.staffService.updateMany({ where: { staffId: id, isActive: true }, data: { isActive: false } });
      } else if (body.serviceIds !== undefined) {
        const targetIds = new Set(body.serviceIds);
        const current = await tx.staffService.findMany({ where: { staffId: id } });
        const currentById = new Map(current.map((c) => [c.serviceRateId, c]));

        for (const row of current) {
          if (row.isActive && !targetIds.has(row.serviceRateId)) {
            await tx.staffService.update({ where: { id: row.id }, data: { isActive: false } });
          }
        }
        for (const serviceRateId of targetIds) {
          const row = currentById.get(serviceRateId);
          if (!row) {
            await tx.staffService.create({ data: { staffId: id, serviceRateId, assignedBy: actorLabel } });
          } else if (!row.isActive) {
            await tx.staffService.update({ where: { id: row.id }, data: { isActive: true, assignedBy: actorLabel } });
          }
        }
      }

      return updated;
    });
  },

  async deactivate(id: string, updatedById: string) {
    const existing = await staffRepository.findFullProfile(id);
    if (!existing) throw new NotFoundError('Staff record not found');
    const actorLabel = await resolveActorLabel(updatedById);
    return prisma.$transaction(async (tx) => {
      if (existing.portalUser) {
        await tx.portalUser.update({
          where: { id: existing.portalUser.id },
          data: { status: 'SUSPENDED', updatedBy: actorLabel },
        });
        await tx.refreshToken.updateMany({
          where: { portalUserId: existing.portalUser.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return tx.staff.update({
        where: { id },
        data: { isActive: false, employmentStatus: 'INACTIVE', updatedBy: actorLabel },
      });
    });
  },

  async delete(id: string) {
    const staff = await staffRepository.findById(id);
    if (!staff) throw new NotFoundError('Staff record not found');

    try {
      await staffRepository.delete(id);
    } catch (error: any) {
      const msg = String(error?.message || '');
      const code = String(error?.code || '');
      const isFkError =
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
        code === 'P2003' ||
        code === '23001' ||
        code === '23503' ||
        msg.includes('foreign key constraint') ||
        msg.includes('violates RESTRICT');

      if (isFkError) {
        throw new ConflictError(
          'This staff member has recorded hospital activity (appointments, patient admissions, billing, or salary history) and cannot be deleted. Deactivate them instead.',
        );
      }
      throw error;
    }
  },

  async getFullProfile(id: string) {
    const profile = await staffRepository.findFullProfile(id);
    if (!profile) throw new NotFoundError('Staff record not found');

    const currentSalaryProfile =
      profile.salaryProfiles.find((p) => p.effectiveTo === null) ?? profile.salaryProfiles[0] ?? null;

    return {
      overview: {
        id: profile.id,
        employeeId: profile.employeeId,
        fullName: profile.fullName,
        category: profile.category,
        designation: profile.designation,
        department: profile.department,
        assignedShift: profile.assignedShift,
        phone: profile.phone,
        email: profile.email,
        joiningDate: profile.joiningDate,
        employmentStatus: profile.employmentStatus,
        isActive: profile.isActive,
        notes: profile.notes,
      },
      // v7.2 Doctor Clinical Discharge Authorization status (§2.4) — never
      // the hash itself, just whether/when a credential is configured.
      clinicalAuthorization: {
        username: profile.clinicalAuthUsername,
        active: profile.clinicalAuthActive,
        configured: !!profile.clinicalAuthUsername,
        updatedAt: profile.clinicalAuthUpdatedAt,
      },
      portalAccess: profile.portalUser ?? null, // null = "No Portal Access", a valid state (D16 p.4)
      departments: profile.staffDepartments,
      assignedServices: profile.staffServices,
      employmentHistory: profile.employmentHistory,
      recentAttendance: profile.attendanceRecords,
      salary: {
        current: currentSalaryProfile,
        history: profile.salaryProfiles,
      },
      commissionRules: profile.commissionRules,
      weeklySchedule: [...profile.weeklySchedule].sort(
        (a, b) => WEEK_DAYS.indexOf(a.dayOfWeek as (typeof WEEK_DAYS)[number]) - WEEK_DAYS.indexOf(b.dayOfWeek as (typeof WEEK_DAYS)[number]),
      ),
      bankAccount: {
        current: profile.bankAccounts.find((b) => b.effectiveTo === null && b.isActive) ?? null,
        history: profile.bankAccounts,
      },
    };
  },

  // ── v7.2 Doctor Clinical Discharge Authorization (§2.4) ─────────────────
  // Deliberately separate from `PortalUser` login — a doctor can be "Staff
  // Record Only" (no portal account) and still hold discharge authorization.
  // Consumed later by the Admission Portal's discharge re-authentication
  // popup (not built in this phase — see HMS_V7.2_NEW_REQUIREMENTS.md §3.4).

  /** Create or replace a doctor's clinical discharge credential (also (re)activates it). */
  async setClinicalAuth(id: string, body: SetClinicalAuthBody, actorId: string) {
    await this.getById(id);
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    try {
      const updated = await prisma.staff.update({
        where: { id },
        data: {
          clinicalAuthUsername: body.username,
          clinicalAuthPasswordHash: passwordHash,
          clinicalAuthActive: true,
          clinicalAuthUpdatedAt: new Date(),
          clinicalAuthUpdatedById: actorId,
        },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Clinical authorization username "${body.username}" is already in use by another doctor.`);
      }
      throw error;
    }
  },

  /** Rotates the password on an existing clinical discharge credential without changing the username. */
  async resetClinicalAuthPassword(id: string, body: ResetClinicalAuthPasswordBody, actorId: string) {
    const staff = await this.getById(id);
    if (!staff.clinicalAuthUsername) {
      throw new ConflictError('This staff member has no clinical discharge authorization credential configured yet.');
    }
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const updated = await prisma.staff.update({
      where: { id },
      data: {
        clinicalAuthPasswordHash: passwordHash,
        clinicalAuthUpdatedAt: new Date(),
        clinicalAuthUpdatedById: actorId,
      },
    });
    return updated;
  },

  async setClinicalAuthActive(id: string, active: boolean, actorId: string) {
    const staff = await this.getById(id);
    if (!staff.clinicalAuthUsername) {
      throw new ConflictError('This staff member has no clinical discharge authorization credential configured yet.');
    }
    const updated = await prisma.staff.update({
      where: { id },
      data: { clinicalAuthActive: active, clinicalAuthUpdatedAt: new Date(), clinicalAuthUpdatedById: actorId },
    });
    return updated;
  },

  // ── Salary Profile (HMS_V7.2_NEW_REQUIREMENTS.md §2.7) ─────────────────
  // Creating a new profile closes out whichever row was previously current
  // (effectiveTo = null) at this staff member's new effectiveFrom, so
  // `salaryProfiles.find(p => p.effectiveTo === null)` (used by
  // getFullProfile above) always resolves to exactly one current row.
  async createSalaryProfile(staffId: string, body: CreateSalaryProfileBody, actorId: string) {
    await this.getById(staffId);
    return prisma.$transaction((tx) => writeSalaryProfile(tx, staffId, body, actorId));
  },

  /** Edit-mode counterpart of wizard step 6. */
  async replaceWeeklySchedule(staffId: string, body: ReplaceWeeklyScheduleBody, actorId: string) {
    await this.getById(staffId);
    const actorLabel = await resolveActorLabel(actorId);
    await prisma.$transaction((tx) => writeWeeklySchedule(tx, staffId, body.days, body.effectiveFrom, actorLabel));
    return prisma.staffWeeklySchedule.findMany({ where: { staffId } });
  },

  /** Edit-mode counterpart of wizard step 8 — only for "+ Commission" salary types, only on assigned services. */
  async replaceCommissionSetup(staffId: string, body: CommissionSetup, actorId: string) {
    await this.getById(staffId);
    const [profile, services] = await Promise.all([
      prisma.staffSalaryProfile.findFirst({ where: { staffId, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, select: { salaryBasis: true } }),
      prisma.staffService.findMany({ where: { staffId, isActive: true }, select: { serviceRateId: true } }),
    ]);
    if (!profile || !isCommissionBasis(profile.salaryBasis)) {
      throw new ValidationError('Commission can only be set for Monthly + Commission or Daily + Commission salary types.');
    }
    const assigned = new Set(services.map((s) => s.serviceRateId));
    const foreign = body.rules.find((r) => r.serviceRateId && !assigned.has(r.serviceRateId));
    if (foreign) throw new ValidationError('Commission can only be set on a service assigned to this staff member.');
    await prisma.$transaction((tx) => writeCommissionRules(tx, staffId, body, actorId));
    return prisma.doctorCommissionRule.findMany({ where: { staffId, effectiveTo: null }, include: { serviceRate: { select: { id: true, name: true, code: true } } } });
  },

  /** Edit-mode counterpart of wizard step 9. */
  async createBankAccount(staffId: string, body: CreateBankAccountBody, actorId: string) {
    await this.getById(staffId);
    const actorLabel = await resolveActorLabel(actorId);
    return prisma.$transaction((tx) => writeBankAccount(tx, staffId, body, actorLabel));
  },
};
