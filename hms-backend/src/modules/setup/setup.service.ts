import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { actorSelect, resolveActorLabel, formatActorFromRelation, type ActorRelation } from '@/shared/actorLabel';
import type {
  UpdateHospitalProfileBody,
  CreateDepartmentBody,
  UpdateDepartmentBody,
  CreateServiceRateBody,
  UpdateServiceRateBody,
  CreateWardBody,
  UpdateWardBody,
  CreateRoomBody,
  UpdateRoomBody,
  CreateBedBody,
  UpdateBedBody,
  CreateCorporatePanelBody,
  UpdateCorporatePanelBody,
  ReplaceDiscountRulesBody,
  CreateShiftBody,
  UpdateShiftBody,
  CreateOutsourcedProviderBody,
  UpdateOutsourcedProviderBody,
  UpdateHighCostMedicinePolicyBody,
  CreateProviderSettlementBody,
  ListProviderSettlementsQuery,
  CreateFloorBody,
  UpdateFloorBody,
} from './setup.schemas';

/**
 * §4.2 Hospital Setup & Master Data. Kept as a single service file for this
 * phase (routes → controller → service, no separate repository layer) —
 * each sub-resource here is a thin CRUD wrapper around one Prisma model.
 */

type CodeModel = 'department' | 'serviceRate' | 'ward' | 'room' | 'bed' | 'corporatePanel' | 'shift' | 'outsourcedProvider';

/**
 * Trims/uppercases a manually entered code. Returns `undefined` for blank
 * input so callers can tell "not provided" apart from "provided" — on
 * create that means "generate one", on update it means "leave untouched"
 * (Prisma skips `undefined` fields in an update payload).
 */
function normalizeCode(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

/**
 * Auto-generates a unique, human-readable code (e.g. "DEP-0007") for every
 * master-data "Add" form — code is always accepted from the user but never
 * required; this is the fallback when they leave it blank.
 */
async function generateUniqueCode(model: CodeModel, prefix: string): Promise<string> {
  const table = prisma[model] as unknown as {
    count: () => Promise<number>;
    findFirst: (args: { where: { code: string } }) => Promise<unknown>;
  };
  let seq = (await table.count()) + 1;
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = `${prefix}-${String(seq).padStart(4, '0')}`;
    if (!(await table.findFirst({ where: { code: candidate } }))) return candidate;
    seq += 1;
  }
  // Practically unreachable — guarantees termination if the sequential range is somehow exhausted.
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
// Fields that live in the `billingLegalMetadata` JSON blob (tax/legal/invoice identity).
const BILLING_LEGAL_KEYS = [
  'registrationNumber',
  'licenseNumber',
  'accreditationBody',
  'accreditationNumber',
  'legalBusinessName',
  'taxNumber',
  'salesTaxNumber',
  'billingAddress',
  'invoicePhone',
  'invoiceEmail',
  'invoicePrefix',
  'receiptPrefix',
] as const;

// Everything else the Hospital Overview screen shows that isn't a
// first-class column and isn't billing/legal — grouped identity, contact,
// address, and operational-hours fields.
const EXTENDED_PROFILE_KEYS = [
  'shortName',
  'hospitalType',
  'status',
  'alternatePhone',
  'emergencyPhone',
  'secondaryEmail',
  'website',
  'addressLine1',
  'addressLine2',
  'city',
  'province',
  'postalCode',
  'country',
  'weekStartDay',
  'workingMode',
  'opdOpenTime',
  'opdCloseTime',
  'dayCloseTime',
  'emergencyEnabled',
  'emergencyMode',
  'dateFormat',
  'timeFormat',
  'workingHours',
] as const;

function pickKeys<T extends Record<string, unknown>>(source: T, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

/** Reassembles the flat frontend `HospitalProfile` shape from columns + JSON blobs. */
function toClientProfile(row: Awaited<ReturnType<typeof prisma.hospitalProfile.findFirst>>) {
  if (!row) return null;
  const billing = (row.billingLegalMetadata as Record<string, unknown>) ?? {};
  const extended = (row.extendedProfile as Record<string, unknown>) ?? {};
  return {
    id: row.id,
    name: row.name ?? '',
    logo: row.logoUrl ?? null,
    primaryPhone: row.contactPhone ?? '',
    primaryEmail: row.contactEmail ?? '',
    currency: row.currencyCode,
    timezone: row.timezone,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? '',
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? '',
    ...billing,
    ...extended,
  };
}

export const setupService = {
  // ── Hospital Profile (singleton) ────────────────────────────────────
  async getHospitalProfile() {
    const existing = await prisma.hospitalProfile.findFirst();
    // Unconfigured fields render "Not configured" client-side rather than
    // being fabricated here — an empty singleton is a valid response.
    const row = existing ?? (await prisma.hospitalProfile.create({ data: {} }));
    return toClientProfile(row);
  },

  async getHospitalSummary() {
    const [
      departments,
      doctors,
      staffUsers,
      inpatientWards,
      hospitalRooms,
      totalBeds,
      activePanels,
    ] = await prisma.$transaction([
      prisma.department.count({ where: { isActive: true } }),
      prisma.staff.count({
        where: {
          category: { equals: 'Doctor', mode: 'insensitive' },
          isActive: true,
        },
      }),
      prisma.staff.count({ where: { isActive: true } }),
      prisma.ward.count({ where: { isActive: true } }),
      prisma.room.count({ where: { isActive: true } }),
      prisma.bed.count(),
      prisma.corporatePanel.count({ where: { isActive: true } }),
    ]);

    return {
      departments,
      doctors,
      staffUsers,
      inpatientWards,
      hospitalRooms,
      totalBeds,
      activePanels,
    };
  },

  async updateHospitalProfile(body: UpdateHospitalProfileBody, updatedByPortalUserId: string) {
    const existing = await prisma.hospitalProfile.findFirst();
    const row = existing ?? (await prisma.hospitalProfile.create({ data: {} }));

    const billingPatch = pickKeys(body as Record<string, unknown>, BILLING_LEGAL_KEYS);
    const extendedPatch = pickKeys(body as Record<string, unknown>, EXTENDED_PROFILE_KEYS);
    const updatedBy = await resolveActorLabel(updatedByPortalUserId);

    const data: Prisma.HospitalProfileUpdateInput = { updatedBy };
    if (!row.createdBy) data.createdBy = updatedBy;
    if (body.name !== undefined) data.name = body.name;
    if (body.primaryPhone !== undefined) data.contactPhone = body.primaryPhone;
    if (body.primaryEmail !== undefined) data.contactEmail = body.primaryEmail;
    if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;
    if (body.currency !== undefined) data.currencyCode = body.currency;
    if (body.timezone !== undefined) data.timezone = body.timezone;
    if (body.printHeaderConfig !== undefined) data.printHeaderConfig = body.printHeaderConfig as Prisma.InputJsonValue;
    if (body.printFooterConfig !== undefined) data.printFooterConfig = body.printFooterConfig as Prisma.InputJsonValue;
    if (Object.keys(billingPatch).length > 0) {
      data.billingLegalMetadata = { ...(row.billingLegalMetadata as object), ...billingPatch } as Prisma.InputJsonValue;
    }
    if (Object.keys(extendedPatch).length > 0) {
      data.extendedProfile = { ...(row.extendedProfile as object), ...extendedPatch } as Prisma.InputJsonValue;
    }

    const updated = await prisma.hospitalProfile.update({ where: { id: row.id }, data });
    return toClientProfile(updated);
  },

  // ── Departments ──────────────────────────────────────────────────────
  departmentInclude: {
    headStaff: { select: { id: true, fullName: true } },
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
    _count: { select: { staff: true, wards: true, serviceRates: true } },
  } satisfies Prisma.DepartmentInclude,

  /** Attaches computed doctorCount/staffCount/serviceCount/wardCount + resolved actor labels. */
  async decorateDepartments(
    rows: Array<
      Record<string, unknown> & {
        id: string;
        headStaff: { id: string; fullName: string } | null;
        createdByUser: ActorRelation | null;
        updatedByUser: ActorRelation | null;
        _count: { staff: number; wards: number; serviceRates: number };
      }
    >,
  ) {
    const departmentIds = rows.map((r) => r.id);
    const doctorCounts =
      departmentIds.length === 0
        ? []
        : await prisma.staff.groupBy({
            by: ['departmentId'],
            where: { departmentId: { in: departmentIds }, category: 'Doctor', isActive: true },
            _count: { _all: true },
          });
    const doctorCountMap = new Map(doctorCounts.map((d) => [d.departmentId, d._count._all]));

    return rows.map((row) => ({
      ...row,
      headName: row.headStaff?.fullName || 'Not Assigned',
      doctorCount: doctorCountMap.get(row.id) ?? 0,
      staffCount: row._count.staff,
      serviceCount: row._count.serviceRates,
      wardCount: row._count.wards,
      createdByLabel: formatActorFromRelation(row.createdByUser),
      updatedByLabel: formatActorFromRelation(row.updatedByUser),
    }));
  },

  async listDepartments(activeOnly = false) {
    const rows = await prisma.department.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      include: this.departmentInclude,
      orderBy: { name: 'asc' },
    });
    return this.decorateDepartments(rows as any);
  },

  async createDepartment(body: CreateDepartmentBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('department', 'DEP'));
    // v7.2 §2.1 — an Outsourced department must be linked to a provider.
    if (body.fulfillmentOwnership === 'OUTSOURCED' && !body.outsourcedProviderId) {
      throw new ValidationError('An Outsourced department must be linked to an Outsourced Provider.');
    }
    const location = body.location || body.floor || undefined;
    const floor = body.floor || (body.location ? body.location : undefined);
    const fixedPrice = body.fixedPrice != null ? new Prisma.Decimal(body.fixedPrice) : null;
    try {
      const created = await prisma.department.create({
        data: {
          ...body,
          code,
          createdById,
          location,
          floor,
          fixedPrice,
        },
        include: this.departmentInclude,
      });
      return (await this.decorateDepartments([created as any]))[0];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Department code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateDepartment(id: string, body: UpdateDepartmentBody, updatedById: string) {
    const existing = await this.assertExists('department', id);
    const nextOwnership = body.fulfillmentOwnership ?? (existing as { fulfillmentOwnership: string }).fulfillmentOwnership;
    const nextProviderId =
      body.outsourcedProviderId !== undefined
        ? body.outsourcedProviderId
        : (existing as { outsourcedProviderId: string | null }).outsourcedProviderId;
    if (nextOwnership === 'OUTSOURCED' && !nextProviderId) {
      throw new ValidationError('An Outsourced department must be linked to an Outsourced Provider.');
    }
    const data: Prisma.DepartmentUncheckedUpdateInput = { ...body, code: normalizeCode(body.code), updatedById };
    if (body.fixedPrice !== undefined) {
      data.fixedPrice = body.fixedPrice != null ? new Prisma.Decimal(body.fixedPrice) : null;
    }
    if (body.floor !== undefined) {
      data.floor = body.floor;
      if (!body.location) {
        data.location = body.floor;
      }
    }
    if (body.isActive !== undefined && body.isActive !== (existing as { isActive: boolean }).isActive) {
      data.statusChangedAt = new Date();
      data.statusChangedBy = await resolveActorLabel(updatedById);
    }
    try {
      const updated = await prisma.department.update({ where: { id }, data, include: this.departmentInclude });
      return (await this.decorateDepartments([updated as any]))[0];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Department code "${body.code}" already exists.`);
      }
      throw error;
    }
  },

  async deactivateDepartment(id: string, updatedById: string) {
    await this.assertExists('department', id);
    const updated = await prisma.department.update({
      where: { id },
      data: {
        isActive: false,
        updatedById,
        statusChangedAt: new Date(),
        statusChangedBy: await resolveActorLabel(updatedById),
      },
      include: this.departmentInclude,
    });
    return (await this.decorateDepartments([updated as any]))[0];
  },

  async deleteDepartment(id: string) {
    const dept = (await this.assertExists('department', id)) as any;

    // Find a fallback active department to safely preserve and reassign staff/doctors (Doctors/staff are NEVER deleted)
    let fallbackDept = await prisma.department.findFirst({
      where: { id: { not: id }, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!fallbackDept) {
      fallbackDept = await prisma.department.findFirst({
        where: { id: { not: id } },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!fallbackDept) {
      fallbackDept = await prisma.department.create({
        data: {
          name: 'General OPD',
          code: 'GEN-OPD',
          departmentType: 'CLINICAL',
          supportsOpd: true,
          isActive: true,
        },
      });
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Reassign all staff and doctors to the fallback department (DO NOT DELETE STAFF/DOCTORS)
        await tx.staff.updateMany({
          where: { departmentId: id },
          data: { departmentId: fallbackDept.id },
        });

        // 2. Reassign any wards to fallback department
        await tx.ward.updateMany({
          where: { departmentId: id },
          data: { departmentId: fallbackDept.id },
        });

        // 3. Reassign any appointments to fallback department
        await tx.appointment.updateMany({
          where: { departmentId: id },
          data: { departmentId: fallbackDept.id },
        });

        // 4. Reassign any admissions to fallback department
        await tx.admissionRecord.updateMany({
          where: { departmentId: id },
          data: { departmentId: fallbackDept.id },
        });

        // 5. Reassign service rates to fallback department
        await tx.serviceRate.updateMany({
          where: { departmentId: id },
          data: { departmentId: fallbackDept.id },
        });

        // 6. Unlink hospital invoices
        await tx.hospitalInvoice.updateMany({
          where: { departmentId: id },
          data: { departmentId: null },
        });

        // 7. Unlink provider settlements
        await tx.providerSettlement.updateMany({
          where: { departmentId: id },
          data: { departmentId: null },
        });

        // 8. Clean up requisitions
        const reqs = await tx.departmentRequisition.findMany({
          where: { departmentId: id },
          select: { id: true },
        });
        if (reqs.length > 0) {
          const reqIds = reqs.map((r) => r.id);
          await tx.departmentRequisitionLine.deleteMany({
            where: { departmentRequisitionId: { in: reqIds } },
          });
          await tx.departmentRequisition.deleteMany({
            where: { id: { in: reqIds } },
          });
        }

        // 9. Clean up department-specific history & assignments
        await tx.staffEmploymentHistory.deleteMany({
          where: { departmentId: id },
        });

        await tx.staffDepartment.deleteMany({
          where: { departmentId: id },
        });

        await tx.shift.deleteMany({
          where: { departmentId: id },
        });

        // 10. Clear headStaff link on this department before deletion
        await tx.department.update({
          where: { id },
          data: { headStaffId: null },
        });

        // 11. Delete the department itself
        await tx.department.delete({ where: { id } });
      });
    } catch (error: any) {
      this.rethrowFkError(
        error,
        `Department "${dept.name}" could not be deleted due to active database constraints.`
      );
    }
  },

  // ── Hospital Floors ──────────────────────────────────────────────────
  async listFloors() {
    return prisma.hospitalFloor.findMany({
      orderBy: [{ floorNumber: 'asc' }, { name: 'asc' }],
    });
  },

  async createFloor(body: CreateFloorBody) {
    const existing = await prisma.hospitalFloor.findFirst({
      where: {
        name: { equals: body.name.trim(), mode: 'insensitive' },
      },
    });
    if (existing) {
      throw new ConflictError(`Floor "${body.name}" already exists.`);
    }

    return prisma.hospitalFloor.create({
      data: {
        floorNumber: body.floorNumber,
        name: body.name.trim(),
        building: body.building?.trim() || 'Main Building',
        description: body.description?.trim() || null,
        isActive: body.isActive ?? true,
      },
    });
  },

  async updateFloor(id: string, body: UpdateFloorBody) {
    const floor = await prisma.hospitalFloor.findUnique({ where: { id } });
    if (!floor) throw new NotFoundError('Hospital floor not found');

    if (body.name && body.name.trim().toLowerCase() !== floor.name.toLowerCase()) {
      const existing = await prisma.hospitalFloor.findFirst({
        where: {
          id: { not: id },
          name: { equals: body.name.trim(), mode: 'insensitive' },
        },
      });
      if (existing) {
        throw new ConflictError(`Floor name "${body.name}" is already in use.`);
      }
    }

    return prisma.hospitalFloor.update({
      where: { id },
      data: {
        ...body,
        name: body.name ? body.name.trim() : undefined,
        building: body.building !== undefined ? (body.building ? body.building.trim() : null) : undefined,
        description: body.description !== undefined ? (body.description ? body.description.trim() : null) : undefined,
      },
    });
  },

  async deleteFloor(id: string) {
    const floor = await prisma.hospitalFloor.findUnique({ where: { id } });
    if (!floor) throw new NotFoundError('Hospital floor not found');

    // Check if any departments currently use this floor
    const deptCount = await prisma.department.count({
      where: { floor: floor.name },
    });
    if (deptCount > 0) {
      throw new ValidationError(
        `Cannot delete "${floor.name}": It is assigned to ${deptCount} department(s). Reassign them first.`
      );
    }

    await prisma.hospitalFloor.delete({ where: { id } });
  },

  // ── Service Rates ────────────────────────────────────────────────────
  serviceRateInclude: {
    department: { select: { id: true, name: true, code: true } },
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
    _count: { select: { invoiceLines: true, panelDiscountRules: true } },
  } satisfies Prisma.ServiceRateInclude,

  decorateServiceRates(
    rows: Array<
      Record<string, unknown> & {
        createdByUser: ActorRelation | null;
        updatedByUser: ActorRelation | null;
        _count: { invoiceLines: number; panelDiscountRules: number };
      }
    >,
  ) {
    return rows.map((row) => {
      const category = (row.category as string) || '';
      const fallbackStream =
        category.toLowerCase().includes('lab') ||
        category.toLowerCase().includes('diagnostic') ||
        category.toLowerCase().includes('radiology')
          ? 'LAB'
          : 'HOSPITAL';
      const serviceStream = (row.serviceStream as string) || fallbackStream;

      return {
        ...row,
        serviceStream,
        linkedInvoiceCount: row._count.invoiceLines,
        linkedPanelRuleCount: row._count.panelDiscountRules,
        createdByLabel: formatActorFromRelation(row.createdByUser),
        updatedByLabel: formatActorFromRelation(row.updatedByUser),
      };
    });
  },

  async listServiceRates(activeOnly = false) {
    const rows = await prisma.serviceRate.findMany({
      where: {
        isDeleted: false,
        // Internal accommodation-billing rows (Ward/Room charges) are never
        // human-selectable — they don't belong in Services & Rates, the
        // Doctor "Assigned Services" picker, or any other service picker.
        isSystemGenerated: false,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: this.serviceRateInclude,
      orderBy: { name: 'asc' },
    });
    return this.decorateServiceRates(rows as any);
  },

  async createServiceRate(body: CreateServiceRateBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('serviceRate', 'SRV'));
    if (body.isDefaultEncounterService && body.encounterType && body.encounterType !== 'NONE') {
      await prisma.serviceRate.updateMany({
        where: { encounterType: body.encounterType },
        data: { isDefaultEncounterService: false },
      });
    }
    try {
      const created = await prisma.serviceRate.create({
        data: {
          ...body,
          code,
          createdById,
          serviceStream: body.serviceStream ?? 'HOSPITAL',
        },
        include: this.serviceRateInclude,
      });
      return this.decorateServiceRates([created as any])[0];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Service code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateServiceRate(id: string, body: UpdateServiceRateBody, updatedById: string) {
    const existing = await this.assertExists('serviceRate', id);
    if ((existing as any).isDeleted) {
      throw new NotFoundError('Service rate not found or already deleted.');
    }
    if (body.isDefaultEncounterService && (body.encounterType ?? (existing as any).encounterType) && (body.encounterType ?? (existing as any).encounterType) !== 'NONE') {
      const encType = body.encounterType ?? (existing as any).encounterType;
      await prisma.serviceRate.updateMany({
        where: { encounterType: encType, id: { not: id } },
        data: { isDefaultEncounterService: false },
      });
    }
    const data: Prisma.ServiceRateUncheckedUpdateInput = { ...body, code: normalizeCode(body.code), updatedById };
    if (body.isActive !== undefined && body.isActive !== (existing as { isActive: boolean }).isActive) {
      data.statusChangedAt = new Date();
      data.statusChangedBy = await resolveActorLabel(updatedById);
    }
    try {
      // NOTE: changing standardRate here never rewrites rate_snapshot on
      // already-posted invoice lines (D15 §15) — those are frozen at billing time.
      const updated = await prisma.serviceRate.update({ where: { id }, data, include: this.serviceRateInclude });
      return this.decorateServiceRates([updated as any])[0];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Service code "${body.code}" already exists.`);
      }
      throw error;
    }
  },

  async deactivateServiceRate(id: string, updatedById: string) {
    await this.assertExists('serviceRate', id);
    const updated = await prisma.serviceRate.update({
      where: { id },
      data: { isActive: false, updatedById, statusChangedAt: new Date(), statusChangedBy: await resolveActorLabel(updatedById) },
      include: this.serviceRateInclude,
    });
    return this.decorateServiceRates([updated as any])[0];
  },

  async deleteServiceRate(id: string) {
    const service = (await this.assertExists('serviceRate', id)) as any;

    if (service.isDeleted) {
      throw new NotFoundError('Service rate not found or already deleted.');
    }

    const encType = (service.encounterType || '').toUpperCase();
    const isCoreEncounter = Boolean(
      service.isDefaultEncounterService &&
      ['OPD', 'OBSERVATION', 'EMERGENCY'].includes(encType)
    );

    if (isCoreEncounter) {
      throw new ValidationError(
        `Core encounter service "${service.name}" (${encType}) cannot be deleted from the hospital master catalog. You can deactivate it instead.`
      );
    }

    const invoiceLineCount = await prisma.invoiceLineItem.count({
      where: { serviceRateId: id },
    });

    await prisma.$transaction(async (tx) => {
      // 1. Delete associated panel discount rules
      await tx.panelDiscountRule.deleteMany({
        where: { serviceRateId: id },
      });

      // 2. Delete associated doctor commission rules
      await tx.doctorCommissionRule.deleteMany({
        where: { serviceRateId: id },
      });

      // 3. Reassign linked appointments to another active, non-deleted service
      const linkedAppointments = await tx.appointment.count({
        where: { serviceRateId: id },
      });
      if (linkedAppointments > 0) {
        const fallbackService = await tx.serviceRate.findFirst({
          where: { id: { not: id }, isDeleted: false, isActive: true },
          orderBy: { isDefaultEncounterService: 'desc', createdAt: 'asc' },
        });
        if (fallbackService) {
          await tx.appointment.updateMany({
            where: { serviceRateId: id },
            data: { serviceRateId: fallbackService.id },
          });
        }
      }

      // 4. Safe deletion:
      // If the service has no posted invoice lines, physically delete it from the database.
      // If it has posted invoice lines, archive it (isDeleted: true, isActive: false, renamed code)
      // so past patient invoices, financial records, receipts, and day-close reports remain 100% intact.
      if (invoiceLineCount === 0) {
        await tx.serviceRate.delete({ where: { id } });
      } else {
        const uniqueDelSuffix = Date.now().toString(36).toUpperCase();
        await tx.serviceRate.update({
          where: { id },
          data: {
            code: `${service.code}-DEL-${uniqueDelSuffix}`,
            isActive: false,
            isDeleted: true,
            deletedAt: new Date(),
            statusChangedAt: new Date(),
            statusChangedBy: 'System (Deleted by Admin)',
          },
        });
      }
    });
  },

  // ── Wards / Rooms / Beds — flexible hierarchy, §4.2 ──────────────────
  // Three supported structures: Ward -> Bed (direct), Ward -> Room -> Bed,
  // and standalone Room -> Bed (no Ward). `ward.beds` below is filtered to
  // roomId: null so a ward's direct beds are never double-counted with the
  // beds already nested under its rooms.
  roomWithBedsInclude: {
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
    beds: { include: { createdByUser: actorSelect, updatedByUser: actorSelect } },
  } satisfies Prisma.RoomInclude,

  wardHierarchyInclude: {
    department: { select: { id: true, name: true, code: true } },
    headStaff: { select: { id: true, fullName: true, designation: true } },
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
    rooms: {
      include: {
        createdByUser: actorSelect,
        updatedByUser: actorSelect,
        beds: { include: { createdByUser: actorSelect, updatedByUser: actorSelect } },
      },
    },
    beds: {
      where: { roomId: null },
      include: { createdByUser: actorSelect, updatedByUser: actorSelect },
    },
  } satisfies Prisma.WardInclude,

  /** Resolves the current occupant (if any) for a set of beds from the Admission module — never stored on Bed itself. */
  async currentOccupantsByBedId(bedIds: string[]) {
    type Occupant = {
      admissionId: string;
      patientName: string;
      patientMrNumber?: string;
      admittedAt?: Date | null;
      doctorName?: string;
    };
    if (bedIds.length === 0) return new Map<string, Occupant>();
    const activeAdmissions = await prisma.admissionRecord.findMany({
      where: { bedId: { in: bedIds }, status: 'ACTIVE' },
      select: {
        id: true,
        bedId: true,
        admittedAt: true,
        // Self-pay encounters are per-visit and have no permanent MRN by
        // design (panel.md §4.6/§17) — patientMrNumber stays undefined for
        // those, which is correct, not a gap.
        panelPatient: { select: { fullName: true, mrNumber: true } },
        selfPayEncounter: { select: { fullName: true } },
        doctor: { select: { fullName: true } },
      },
    });
    const map = new Map<string, Occupant>();
    for (const admission of activeAdmissions) {
      if (!admission.bedId) continue;
      map.set(admission.bedId, {
        admissionId: admission.id,
        patientName: admission.panelPatient?.fullName || admission.selfPayEncounter?.fullName || 'Unknown Patient',
        patientMrNumber: admission.panelPatient?.mrNumber,
        admittedAt: admission.admittedAt,
        doctorName: admission.doctor?.fullName,
      });
    }
    return map;
  },

  decorateBedRow(bed: any, occupants: Map<string, { admissionId: string; patientName: string; patientMrNumber?: string; admittedAt?: Date | null; doctorName?: string }>) {
    const occupant = occupants.get(bed.id);
    return {
      ...bed,
      currentPatientId: occupant?.admissionId,
      currentPatientName: occupant?.patientName,
      currentPatientMrn: occupant?.patientMrNumber,
      admissionDate: occupant?.admittedAt,
      admittingDoctorName: occupant?.doctorName,
      admissionId: occupant?.admissionId,
      createdByLabel: formatActorFromRelation(bed.createdByUser),
      updatedByLabel: formatActorFromRelation(bed.updatedByUser),
    };
  },

  decorateRoomRow(room: any, occupants: Map<string, { admissionId: string; patientName: string }>) {
    const beds = room.beds.map((bed: any) => this.decorateBedRow(bed, occupants));
    return {
      ...room,
      beds,
      bedsConfigured: beds.length,
      availableBeds: beds.filter((b: any) => b.status === 'AVAILABLE').length,
      createdByLabel: formatActorFromRelation(room.createdByUser),
      updatedByLabel: formatActorFromRelation(room.updatedByUser),
    };
  },

  /**
   * Returns the full hierarchy across all three supported structures:
   * Ward -> Bed (direct), Ward -> Room -> Bed, and standalone Room -> Bed
   * (no Ward). `wards[].beds` holds each ward's direct beds; `standaloneRooms`
   * holds rooms with no parent ward (each with its own `beds`).
   */
  async listWardHierarchy() {
    const [wards, standaloneRooms] = await Promise.all([
      prisma.ward.findMany({ include: this.wardHierarchyInclude, orderBy: { name: 'asc' } }),
      prisma.room.findMany({
        where: { wardId: null },
        include: this.roomWithBedsInclude,
        orderBy: { name: 'asc' },
      }),
    ]);

    const allBedIds = [
      ...wards.flatMap((w: any) => [
        ...w.rooms.flatMap((r: any) => r.beds.map((b: any) => b.id)),
        ...w.beds.map((b: any) => b.id),
      ]),
      ...standaloneRooms.flatMap((r: any) => r.beds.map((b: any) => b.id)),
    ];
    const occupants = await this.currentOccupantsByBedId(allBedIds);

    const wardResults = wards.map((ward: any) => {
      const rooms = ward.rooms.map((room: any) => this.decorateRoomRow(room, occupants));
      const directBeds = ward.beds.map((bed: any) => this.decorateBedRow(bed, occupants));
      const allBeds = [...rooms.flatMap((r: any) => r.beds), ...directBeds];
      return {
        ...ward,
        headStaffId: ward.headStaffId ?? null,
        headStaffName: ward.headStaff?.fullName ?? null,
        fixedPrice: ward.fixedPrice != null ? Number(ward.fixedPrice) : null,
        rooms,
        beds: directBeds,
        roomCount: rooms.length,
        bedCount: allBeds.length,
        availableBeds: allBeds.filter((b: any) => b.status === 'AVAILABLE').length,
        createdByLabel: formatActorFromRelation(ward.createdByUser),
        updatedByLabel: formatActorFromRelation(ward.updatedByUser),
      };
    });

    const standaloneRoomResults = standaloneRooms.map((room: any) => this.decorateRoomRow(room, occupants));

    return { wards: wardResults, standaloneRooms: standaloneRoomResults };
  },

  async createWard(body: CreateWardBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('ward', 'WRD'));
    let departmentId = body.departmentId;
    if (!departmentId) {
      const defaultDept = await prisma.department.findFirst({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
      if (!defaultDept) {
        throw new ValidationError('No active department found to associate with ward.');
      }
      departmentId = defaultDept.id;
    }
    const fixedPrice = body.fixedPrice != null ? new Prisma.Decimal(body.fixedPrice) : null;
    const headStaffId = body.headStaffId || null;
    try {
      return await prisma.ward.create({
        data: {
          ...body,
          departmentId,
          code,
          headStaffId,
          fixedPrice,
          createdById,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Ward code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateWard(id: string, body: UpdateWardBody, updatedById: string) {
    const existing = await this.assertExists('ward', id);
    const data: Prisma.WardUncheckedUpdateInput = {
      ...body,
      code: normalizeCode(body.code),
      headStaffId: body.headStaffId !== undefined ? body.headStaffId || null : undefined,
      fixedPrice: body.fixedPrice !== undefined ? (body.fixedPrice != null ? new Prisma.Decimal(body.fixedPrice) : null) : undefined,
      updatedById,
    };
    if (body.isActive !== undefined && body.isActive !== (existing as { isActive: boolean }).isActive) {
      data.statusChangedAt = new Date();
      data.statusChangedBy = await resolveActorLabel(updatedById);
    }
    return prisma.ward.update({ where: { id }, data });
  },

  async createRoom(body: CreateRoomBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('room', 'RM'));
    try {
      return await prisma.room.create({ data: { ...body, code, createdById } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Room code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateRoom(id: string, body: UpdateRoomBody, updatedById: string) {
    const existing = await this.assertExists('room', id);
    const data: Prisma.RoomUncheckedUpdateInput = { ...body, code: normalizeCode(body.code), updatedById };
    if (body.isActive !== undefined && body.isActive !== (existing as { isActive: boolean }).isActive) {
      data.statusChangedAt = new Date();
      data.statusChangedBy = await resolveActorLabel(updatedById);
    }
    return prisma.room.update({ where: { id }, data });
  },

  async createBed(body: CreateBedBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('bed', 'BED'));
    const roomId = body.roomId || null;
    let wardId = body.wardId || null;

    // A Room's ward is authoritative when a room is given — the bed's ward
    // is always denormalized to match it (never a conflicting manual pick),
    // including null when the room itself is standalone (no ward).
    if (roomId) {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { wardId: true } });
      if (!room) throw new NotFoundError('Room not found');
      wardId = room.wardId;
    }

    if (!roomId && wardId && await prisma.room.count({ where: { wardId } }) > 0) {
      throw new ValidationError('This ward has rooms. Select a room before adding a bed.');
    }

    try {
      return await prisma.bed.create({ data: { ...body, code, roomId, wardId, dailyRate: 0, createdById } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Bed "${body.bedNumber}" already exists in this room, or the bed code is taken.`);
      }
      throw error;
    }
  },

  async updateBed(id: string, body: UpdateBedBody, updatedById: string) {
    const existing = await this.assertExists('bed', id);
    const data: Prisma.BedUncheckedUpdateInput = { ...body, dailyRate: 0, code: normalizeCode(body.code), updatedById };
    if (
      body.operationalStatus !== undefined &&
      body.operationalStatus !== (existing as { operationalStatus: string }).operationalStatus
    ) {
      data.statusChangedAt = new Date();
      data.statusChangedBy = await resolveActorLabel(updatedById);
    }
    return prisma.bed.update({ where: { id }, data });
  },

  rethrowFkError(error: unknown, fallbackMessage: string): never {
    const msg = String((error as any)?.message || '');
    const code = String((error as any)?.code || '');
    const isFkError =
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
      code === 'P2003' ||
      code === '23001' ||
      code === '23503' ||
      msg.includes('foreign key constraint') ||
      msg.includes('violates RESTRICT');

    if (isFkError) {
      throw new ConflictError(fallbackMessage);
    }
    throw error;
  },

  async deleteBed(id: string) {
    const bed = await prisma.bed.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            admissions: true,
            bedTransfersFrom: true,
            bedTransfersTo: true,
          },
        },
      },
    });
    if (!bed) throw new NotFoundError('Bed not found');

    if (bed.status === 'OCCUPIED') {
      throw new ConflictError(`Bed "${bed.bedNumber}" is currently occupied and cannot be deleted.`);
    }
    const historyCount = bed._count.admissions + bed._count.bedTransfersFrom + bed._count.bedTransfersTo;
    if (historyCount > 0) {
      throw new ConflictError(
        `Bed "${bed.bedNumber}" has recorded patient admission or transfer history (${historyCount} records) and cannot be deleted. Decommission it instead.`,
      );
    }

    try {
      await prisma.bed.delete({ where: { id } });
    } catch (error: any) {
      this.rethrowFkError(error, `Bed "${bed.bedNumber}" has linked hospital activity and cannot be deleted. Decommission it instead.`);
    }
  },

  async deleteRoom(id: string) {
    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        beds: {
          include: {
            _count: {
              select: {
                admissions: true,
                bedTransfersFrom: true,
                bedTransfersTo: true,
              },
            },
          },
        },
      },
    });
    if (!room) throw new NotFoundError('Room not found');

    for (const bed of room.beds) {
      if (bed.status === 'OCCUPIED') {
        throw new ConflictError(
          `Cannot delete room "${room.name}": Bed "${bed.bedNumber}" is currently occupied.`,
        );
      }
      const historyCount = bed._count.admissions + bed._count.bedTransfersFrom + bed._count.bedTransfersTo;
      if (historyCount > 0) {
        throw new ConflictError(
          `Cannot delete room "${room.name}": Bed "${bed.bedNumber}" has recorded patient admission history. Deactivate the room instead.`,
        );
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.bed.deleteMany({ where: { roomId: id } });
        await tx.room.delete({ where: { id } });
      });
    } catch (error: any) {
      this.rethrowFkError(error, `Room "${room.name}" has linked hospital records and cannot be deleted. Deactivate it instead.`);
    }
  },

  async deleteWard(id: string) {
    const bedCountSelect = {
      _count: { select: { admissions: true, bedTransfersFrom: true, bedTransfersTo: true } },
    } satisfies Prisma.BedInclude;

    const ward = await prisma.ward.findUnique({
      where: { id },
      include: {
        rooms: { include: { beds: { include: bedCountSelect } } },
        // Direct Ward -> Bed assignments (no Room) must also be checked/removed.
        beds: { where: { roomId: null }, include: bedCountSelect },
      },
    });
    if (!ward) throw new NotFoundError('Ward not found');

    const allBeds = [...ward.rooms.flatMap((r) => r.beds), ...ward.beds];
    for (const bed of allBeds) {
      if (bed.status === 'OCCUPIED') {
        throw new ConflictError(
          `Cannot delete ward "${ward.name}": Bed "${bed.bedNumber}" is currently occupied.`,
        );
      }
      const historyCount = bed._count.admissions + bed._count.bedTransfersFrom + bed._count.bedTransfersTo;
      if (historyCount > 0) {
        throw new ConflictError(
          `Cannot delete ward "${ward.name}": Bed "${bed.bedNumber}" has recorded patient admission history. Deactivate the ward instead.`,
        );
      }
    }

    const roomIds = ward.rooms.map((r) => r.id);
    try {
      await prisma.$transaction(async (tx) => {
        if (roomIds.length > 0) {
          await tx.bed.deleteMany({ where: { roomId: { in: roomIds } } });
          await tx.room.deleteMany({ where: { id: { in: roomIds } } });
        }
        // Direct ward beds (no room) — deleted separately from room-scoped beds above.
        await tx.bed.deleteMany({ where: { wardId: id, roomId: null } });
        await tx.ward.delete({ where: { id } });
      });
    } catch (error: any) {
      this.rethrowFkError(error, `Ward "${ward.name}" has linked hospital records and cannot be deleted. Deactivate it instead.`);
    }
  },

  // ── Corporate Panels ─────────────────────────────────────────────────
  corporatePanelInclude: {
    discountRules: { where: { archivedAt: null }, orderBy: { createdAt: 'asc' as const } },
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
    _count: { select: { panelPatients: { where: { isActive: true, status: 'ACTIVE' } } } },
  } satisfies Prisma.CorporatePanelInclude,

  decorateCorporatePanel(
    row: Record<string, unknown> & {
      createdByUser: ActorRelation | null;
      updatedByUser: ActorRelation | null;
      _count: { panelPatients: number };
    },
  ) {
    return {
      ...row,
      activePatientsCount: row._count.panelPatients,
      createdByLabel: formatActorFromRelation(row.createdByUser),
      updatedByLabel: formatActorFromRelation(row.updatedByUser),
    };
  },

  async listCorporatePanels(activeOnly = false) {
    const rows = await prisma.corporatePanel.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      include: this.corporatePanelInclude,
      orderBy: { organizationName: 'asc' },
    });
    return rows.map((r) => this.decorateCorporatePanel(r as any));
  },

  async listPanelCategories() {
    return prisma.panelCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  },

  async validatePanelCategory(category: string | undefined) {
    if (!category || !await prisma.panelCategory.findFirst({ where: { name: category, isActive: true } })) {
      throw new ValidationError('Select an active configured panel category');
    }
  },

  async createCorporatePanel(body: CreateCorporatePanelBody, createdById: string) {
    await this.validatePanelCategory(body.category);
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('corporatePanel', 'PNL'));
    try {
      const created = await prisma.corporatePanel.create({ data: { ...body, code, createdById }, include: this.corporatePanelInclude });
      return this.decorateCorporatePanel(created as any);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Corporate panel code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateCorporatePanel(id: string, body: UpdateCorporatePanelBody, updatedById: string) {
    if (body.category !== undefined) await this.validatePanelCategory(body.category);
    await this.assertExists('corporatePanel', id);
    try {
      const updated = await prisma.corporatePanel.update({
        where: { id },
        data: { ...body, code: normalizeCode(body.code), updatedById },
        include: this.corporatePanelInclude,
      });
      return this.decorateCorporatePanel(updated as any);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Corporate panel code "${body.code}" already exists.`);
      }
      throw error;
    }
  },

  async listPanelRuleHistory(corporatePanelId: string) {
    await this.assertExists('corporatePanel', corporatePanelId);
    const rules = await prisma.panelDiscountRule.findMany({
      where: { corporatePanelId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 500,
      include: { serviceRate: { select: { name: true } }, department: { select: { name: true } } },
    });
    const actors = await prisma.portalUser.findMany({
      where: { id: { in: [...new Set(rules.flatMap(r => r.createdById ? [r.createdById] : []))] } },
      select: { id: true, displayName: true, username: true },
    });
    const names = new Map(actors.map(a => [a.id, a.displayName ?? a.username]));
    return rules.map(r => ({ ...r, createdByLabel: r.createdById ? names.get(r.createdById) ?? 'Unavailable' : 'Legacy record' }));
  },

  async replaceDiscountRules(corporatePanelId: string, body: ReplaceDiscountRulesBody, actorId: string) {
    await this.assertExists('corporatePanel', corporatePanelId);
    return prisma.$transaction(async (tx) => {
      // Serialize full rule-set replacements for this company; preserve every old version.
      await tx.$queryRaw`SELECT id FROM corporate_panels WHERE id = ${corporatePanelId} FOR UPDATE`;
      for (const rule of body.rules) {
        if (rule.serviceRateId) {
          const service = await tx.serviceRate.findFirst({ where: { id: rule.serviceRateId, ...(rule.isActive ? { isActive: true, isDeleted: false } : {}) } });
          if (!service) throw new ValidationError('Select an active service for every service rule');
          if (rule.contractRate != null && new Prisma.Decimal(rule.contractRate).greaterThan(service.standardRate)) {
            throw new ValidationError('Contract tariff cannot exceed the standard service rate');
          }
        }
        if (rule.departmentId && !await tx.department.findFirst({ where: { id: rule.departmentId, ...(rule.isActive ? { isActive: true } : {}) } })) {
          throw new ValidationError('Select an active department for every department rule');
        }
      }
      await tx.panelDiscountRule.updateMany({ where: { corporatePanelId, archivedAt: null }, data: { archivedAt: new Date() } });
      if (body.rules.length) await tx.panelDiscountRule.createMany({
        data: body.rules.map(rule => ({ ...rule, corporatePanelId, createdById: actorId,
          coverageType: rule.coverageType ?? (rule.coveragePercent != null ? 'PERCENTAGE' : 'LEGACY_DISCOUNT') })),
      });
      return tx.panelDiscountRule.findMany({ where: { corporatePanelId, archivedAt: null }, orderBy: { createdAt: 'asc' } });
    });
  },

  async deleteCorporatePanel(id: string) {
    const existing = await this.assertExists('corporatePanel', id);
    if (await prisma.panelDiscountRule.count({ where: { corporatePanelId: id } })) {
      throw new ConflictError('This panel has contract history. Deactivate it to preserve its records.');
    }
    const linkedPatientsCount = await prisma.panelPatient.count({
      where: { corporatePanelId: id },
    });
    if (linkedPatientsCount > 0) {
      throw new ConflictError(
        `Cannot delete "${(existing as any).organizationName}" because it is linked to ${linkedPatientsCount} registered patient(s). Deactivate the panel instead.`
      );
    }
    return prisma.$transaction(async (tx) => {
      await tx.panelDiscountRule.deleteMany({ where: { corporatePanelId: id } });
      return tx.corporatePanel.delete({ where: { id } });
    });
  },

  // ── Shifts (Shift Master, Super Admin "Shift Management") ───────────
  shiftInclude: {
    department: { select: { id: true, name: true, code: true } },
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
  } satisfies Prisma.ShiftInclude,

  decorateShift(row: Record<string, unknown> & { createdByUser: ActorRelation | null; updatedByUser: ActorRelation | null }) {
    return {
      ...row,
      createdByLabel: formatActorFromRelation(row.createdByUser),
      updatedByLabel: formatActorFromRelation(row.updatedByUser),
    };
  },

  async listShifts(filters: { departmentId?: string; shiftType?: string; isActive?: boolean; search?: string } = {}) {
    const where: Prisma.ShiftWhereInput = {};
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.shiftType) where.shiftType = filters.shiftType as Prisma.EnumShiftTypeFilter['equals'];
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.shift.findMany({ where, include: this.shiftInclude, orderBy: { name: 'asc' } });
    return rows.map((r) => this.decorateShift(r as any));
  },

  async createShift(body: CreateShiftBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('shift', 'SHF'));
    try {
      const created = await prisma.shift.create({ data: { ...body, code, createdById }, include: this.shiftInclude });
      return this.decorateShift(created as any);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Shift code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateShift(id: string, body: UpdateShiftBody, updatedById: string) {
    const existing = await this.assertExists('shift', id);
    const data: Prisma.ShiftUncheckedUpdateInput = { ...body, code: normalizeCode(body.code), updatedById };
    if (body.isActive !== undefined && body.isActive !== (existing as { isActive: boolean }).isActive) {
      data.statusChangedAt = new Date();
      data.statusChangedBy = await resolveActorLabel(updatedById);
    }
    try {
      const updated = await prisma.shift.update({ where: { id }, data, include: this.shiftInclude });
      return this.decorateShift(updated as any);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Shift code "${body.code}" already exists.`);
      }
      throw error;
    }
  },

  async deactivateShift(id: string, updatedById: string) {
    await this.assertExists('shift', id);
    const updated = await prisma.shift.update({
      where: { id },
      data: { isActive: false, updatedById, statusChangedAt: new Date(), statusChangedBy: await resolveActorLabel(updatedById) },
      include: this.shiftInclude,
    });
    return this.decorateShift(updated as any);
  },

  // ── Outsourced Providers (HMS_V7.2_NEW_REQUIREMENTS.md §2.1) ─────────
  outsourcedProviderInclude: {
    createdByUser: actorSelect,
    updatedByUser: actorSelect,
    _count: { select: { departments: true, settlements: true } },
  } satisfies Prisma.OutsourcedProviderInclude,

  decorateOutsourcedProviders(
    rows: Array<
      Record<string, unknown> & {
        createdByUser: ActorRelation | null;
        updatedByUser: ActorRelation | null;
        _count: { departments: number; settlements: number };
      }
    >,
  ) {
    return rows.map((row) => ({
      ...row,
      linkedDepartmentCount: row._count.departments,
      settlementCount: row._count.settlements,
      createdByLabel: formatActorFromRelation(row.createdByUser),
      updatedByLabel: formatActorFromRelation(row.updatedByUser),
    }));
  },

  async listOutsourcedProviders(activeOnly = false) {
    const rows = await prisma.outsourcedProvider.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      include: this.outsourcedProviderInclude,
      orderBy: { name: 'asc' },
    });
    return this.decorateOutsourcedProviders(rows as any);
  },

  async createOutsourcedProvider(body: CreateOutsourcedProviderBody, createdById: string) {
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('outsourcedProvider', 'PRV'));
    try {
      const created = await prisma.outsourcedProvider.create({
        data: { ...body, code, createdById },
        include: this.outsourcedProviderInclude,
      });
      return this.decorateOutsourcedProviders([created as any])[0];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Outsourced provider code "${code}" already exists.`);
      }
      throw error;
    }
  },

  async updateOutsourcedProvider(id: string, body: UpdateOutsourcedProviderBody, updatedById: string) {
    await this.assertExists('outsourcedProvider', id);
    const data: Prisma.OutsourcedProviderUncheckedUpdateInput = { ...body, code: normalizeCode(body.code), updatedById };
    try {
      const updated = await prisma.outsourcedProvider.update({ where: { id }, data, include: this.outsourcedProviderInclude });
      return this.decorateOutsourcedProviders([updated as any])[0];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(`Outsourced provider code "${body.code}" already exists.`);
      }
      throw error;
    }
  },

  async deactivateOutsourcedProvider(id: string, updatedById: string) {
    await this.assertExists('outsourcedProvider', id);
    const updated = await prisma.outsourcedProvider.update({
      where: { id },
      data: { isActive: false, updatedById },
      include: this.outsourcedProviderInclude,
    });
    return this.decorateOutsourcedProviders([updated as any])[0];
  },

  // ── High-Cost Medicine Policy (HMS_V7.2_NEW_REQUIREMENTS.md §2.6) ────
  // Singleton, same get-or-create pattern as Hospital Profile.
  async getHighCostMedicinePolicy() {
    const existing = await prisma.highCostMedicinePolicy.findFirst();
    return existing ?? prisma.highCostMedicinePolicy.create({ data: {} });
  },

  async updateHighCostMedicinePolicy(body: UpdateHighCostMedicinePolicyBody, updatedById: string) {
    const existing = await this.getHighCostMedicinePolicy();
    return prisma.highCostMedicinePolicy.update({
      where: { id: existing.id },
      data: { ...body, updatedById },
    });
  },

  // ── Provider Settlements (HMS_V7.2_NEW_REQUIREMENTS.md §2.8) ─────────
  providerSettlementInclude: {
    outsourcedProvider: { select: { id: true, name: true, code: true } },
    department: { select: { id: true, name: true, code: true } },
    settledByUser: actorSelect,
  } satisfies Prisma.ProviderSettlementInclude,

  async listProviderSettlements(query: ListProviderSettlementsQuery) {
    const rows = await prisma.providerSettlement.findMany({
      where: {
        outsourcedProviderId: query.outsourcedProviderId,
        departmentId: query.departmentId,
      },
      include: this.providerSettlementInclude,
      orderBy: { settledAt: 'desc' },
    });
    return rows.map((row) => ({ ...row, settledByLabel: formatActorFromRelation(row.settledByUser as ActorRelation | null) }));
  },

  /**
   * Records a settlement voucher against an Outsourced Provider (§2.8).
   * `eligibleRealizedAmount` is entered by the settling user for now — see
   * the schema-file comment on `createProviderSettlementSchema` for why
   * (Front Desk's department sub-invoice split, §2.2, is future work).
   * `alreadySettledAmount` is always computed server-side from prior
   * settlements for this exact (provider, department) pair, never trusted
   * from the client, and settlement can never exceed what remains eligible.
   */
  async createProviderSettlement(body: CreateProviderSettlementBody, settledById: string) {
    await this.assertExists('outsourcedProvider', body.outsourcedProviderId);
    if (body.departmentId) await this.assertExists('department', body.departmentId);

    const priorSettlements = await prisma.providerSettlement.aggregate({
      where: { outsourcedProviderId: body.outsourcedProviderId, departmentId: body.departmentId ?? null },
      _sum: { settlementAmount: true },
    });
    const alreadySettledAmount = Number(priorSettlements._sum.settlementAmount ?? 0);
    const remainingEligible = body.eligibleRealizedAmount - alreadySettledAmount;

    if (body.settlementAmount > remainingEligible + 0.01) {
      throw new ValidationError(
        `Settlement amount (${body.settlementAmount}) exceeds the remaining eligible realized payable (${remainingEligible.toFixed(2)}). Already settled: ${alreadySettledAmount.toFixed(2)} of ${body.eligibleRealizedAmount}.`,
      );
    }

    const computedStatus = alreadySettledAmount + body.settlementAmount >= body.eligibleRealizedAmount - 0.01 ? 'FULL' : 'PARTIAL';

    const created = await prisma.providerSettlement.create({
      data: {
        outsourcedProviderId: body.outsourcedProviderId,
        departmentId: body.departmentId,
        periodLabel: body.periodLabel,
        eligibleRealizedAmount: body.eligibleRealizedAmount,
        alreadySettledAmount,
        settlementAmount: body.settlementAmount,
        status: computedStatus,
        paymentMethod: body.paymentMethod,
        paymentReference: body.paymentReference,
        representativeName: body.representativeName,
        representativeDesignation: body.representativeDesignation,
        remarks: body.remarks,
        settledById,
      },
      include: this.providerSettlementInclude,
    });
    return { ...created, settledByLabel: formatActorFromRelation(created.settledByUser as ActorRelation | null) };
  },

  // ── shared existence guard ───────────────────────────────────────────
  async assertExists(
    model: 'department' | 'serviceRate' | 'ward' | 'room' | 'bed' | 'corporatePanel' | 'shift' | 'outsourcedProvider',
    id: string,
  ) {
    const record = await (prisma[model] as unknown as { findUnique: (args: { where: { id: string } }) => Promise<unknown> })
      .findUnique({ where: { id } });
    if (!record) throw new NotFoundError(`${model} not found`);
    return record;
  },
};
