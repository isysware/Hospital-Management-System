import { Decimal } from '@prisma/client/runtime/library';
import { lockMainFund } from '@/shared/mainFundLock';
import { departmentCollectionLedger } from '@/shared/departmentCollections';
import { isCoreEncounterService, serviceSelectionWhere, validateServiceMaster, type ServiceFilters } from '@/shared/serviceClassification';
import { resolveDateRange } from '@/modules/reports/dashboard.service';
import { Prisma } from '@prisma/client';
import { financialDepartmentSelect, hospitalServiceDepartment } from '@/shared/hospitalRevenueRecognition';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { actorSelect, resolveActorLabel, formatActorFromRelation, type ActorRelation } from '@/shared/actorLabel';
import type {
  UpdateHospitalProfileBody,
  CreateDepartmentBody,
  UpdateDepartmentBody,
  CreateServiceRateBody,
  BulkCreateServiceRatesBody,
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
  BulkServiceDiscountBody,
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
    findMany: (args?: { select?: { code: boolean } }) => Promise<Array<{ code: string }>>;
    findFirst: (args: { where: { code: string } }) => Promise<unknown>;
  };
  const existingRows = await table.findMany({ select: { code: true } }).catch(() => []);
  const prefixUpper = prefix.trim().toUpperCase();
  const regex = new RegExp(`^${prefixUpper}[-_]?(\\d+)$`, 'i');

  let maxNum = 0;
  for (const row of existingRows) {
    if (!row.code) continue;
    const match = row.code.match(regex);
    if (match?.[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const padLength = model === 'serviceRate' ? 3 : 4;
  let seq = maxNum + 1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `${prefixUpper}-${String(seq).padStart(padLength, '0')}`;
    const taken = existingRows.some((r) => r.code?.toUpperCase() === candidate);
    if (!taken) {
      const dbMatch = await table.findFirst({ where: { code: candidate } });
      if (!dbMatch) return candidate;
    }
    seq += 1;
  }
  return `${prefixUpper}-${Date.now().toString(36).toUpperCase()}`;
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
  'ipdDailyRoomBedPostingTime',
  'emergencyEnabled',
  'emergencyMode',
  'dateFormat',
  'timeFormat',
  'workingHours',
  'discountApprovalRequired',
  'discountMaxPercentThreshold',
  'discountMaxAmountThreshold',
  'discountOverallAllowed',
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
    discountApprovalRequired: extended.discountApprovalRequired !== false,
    discountMaxPercentThreshold: typeof extended.discountMaxPercentThreshold === 'number' ? extended.discountMaxPercentThreshold : 15,
    discountMaxAmountThreshold: typeof extended.discountMaxAmountThreshold === 'number' ? extended.discountMaxAmountThreshold : 1500,
    discountOverallAllowed: extended.discountOverallAllowed !== false,
    ipdDailyRoomBedPostingTime: extended.ipdDailyRoomBedPostingTime ?? '11:00 AM',
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

  async getHospitalPublicProfile() {
    const existing = await prisma.hospitalProfile.findFirst();
    if (!existing) {
      return {
        name: 'CH Sharif and Saeed Hospital',
        shortName: 'CSS Hospital',
        logo: null,
        primaryPhone: '',
        address: '',
      };
    }
    const extended = (existing.extendedProfile as Record<string, unknown>) ?? {};
    const address = existing.address || [extended.addressLine1, extended.city, extended.province].filter(Boolean).join(', ') || '';
    const phone = existing.contactPhone || (extended.primaryPhone as string) || '';
    return {
      name: existing.name || (extended.name as string) || 'CH Sharif and Saeed Hospital',
      shortName: (extended.shortName as string) || 'CSS Hospital',
      logo: existing.logoUrl ?? null,
      primaryPhone: phone,
      address: address,
    };
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
    const logoVal = (body as any).logo !== undefined ? (body as any).logo : body.logoUrl;
    if (logoVal !== undefined) data.logoUrl = logoVal;
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

    const doctorCountMap = new Map<string, number>();
    const staffCountMap = new Map<string, number>();
    const countedStaffPerDept = new Map<string, Set<string>>();

    for (const id of departmentIds) {
      doctorCountMap.set(id, 0);
      staffCountMap.set(id, 0);
      countedStaffPerDept.set(id, new Set());
    }

    if (departmentIds.length > 0) {
      // 1. Count from cross-department assignments (StaffDepartment)
      const staffDeptLinks = await prisma.staffDepartment.findMany({
        where: {
          departmentId: { in: departmentIds },
          staff: { isActive: true },
        },
        select: {
          departmentId: true,
          staff: { select: { id: true, category: true } },
        },
      });

      for (const link of staffDeptLinks) {
        const set = countedStaffPerDept.get(link.departmentId);
        if (set && !set.has(link.staff.id)) {
          set.add(link.staff.id);
          staffCountMap.set(link.departmentId, (staffCountMap.get(link.departmentId) ?? 0) + 1);
          if (link.staff.category === 'Doctor') {
            doctorCountMap.set(link.departmentId, (doctorCountMap.get(link.departmentId) ?? 0) + 1);
          }
        }
      }

      // 2. Fallback to primary departmentId if staff has no StaffDepartment row
      const primaryStaff = await prisma.staff.findMany({
        where: {
          departmentId: { in: departmentIds },
          isActive: true,
        },
        select: { id: true, departmentId: true, category: true },
      });

      for (const s of primaryStaff) {
        if (s.departmentId) {
          const set = countedStaffPerDept.get(s.departmentId);
          if (set && !set.has(s.id)) {
            set.add(s.id);
            staffCountMap.set(s.departmentId, (staffCountMap.get(s.departmentId) ?? 0) + 1);
            if (s.category === 'Doctor') {
              doctorCountMap.set(s.departmentId, (doctorCountMap.get(s.departmentId) ?? 0) + 1);
            }
          }
        }
      }
    }

    return rows.map((row) => ({
      ...row,
      headName: row.headStaff?.fullName || 'Not Assigned',
      doctorCount: doctorCountMap.get(row.id) ?? 0,
      staffCount: staffCountMap.get(row.id) ?? row._count.staff,
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
    if ((existing as any).isDefaultPharmacy && (body.isActive === false || body.pharmacyRelated === false || (body.departmentType && body.departmentType !== 'PHARMACY') || (body.fulfillmentOwnership && body.fulfillmentOwnership !== 'INTERNAL') || body.outsourcedProviderId)) throw new ValidationError('Default Pharmacy must remain active, internal and classified as Pharmacy');
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
    const existing = await this.assertExists('department', id);
    if ((existing as any).isDefaultPharmacy || (existing as any).departmentType === 'PHARMACY' || (existing as any).code === 'DEP-0004' || (existing as any).name?.toLowerCase() === 'pharmacy') {
      throw new ValidationError('Default Pharmacy department cannot be deactivated');
    }
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
    if (dept.isDefaultPharmacy || dept.departmentType === 'PHARMACY' || dept.code === 'DEP-0004' || dept.name?.toLowerCase() === 'pharmacy') {
      throw new ValidationError('Default Pharmacy department cannot be deleted');
    }

    const [staffCount, wardCount, apptCount, admCount, rateCount] = await Promise.all([
      prisma.staff.count({ where: { departmentId: id } }),
      prisma.ward.count({ where: { departmentId: id } }),
      prisma.appointment.count({ where: { departmentId: id } }),
      prisma.admissionRecord.count({ where: { departmentId: id } }),
      prisma.serviceRate.count({ where: { departmentId: id } }),
    ]);

    const hasLinkedRecords = staffCount > 0 || wardCount > 0 || apptCount > 0 || admCount > 0 || rateCount > 0;

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

    if (hasLinkedRecords && !fallbackDept) {
      const blockers: string[] = [
        staffCount > 0 ? `${staffCount} staff member${staffCount > 1 ? 's' : ''}` : '',
        wardCount > 0 ? `${wardCount} ward${wardCount > 1 ? 's' : ''}` : '',
        apptCount > 0 ? `${apptCount} admission/clinical record${apptCount > 1 ? 's' : ''}` : '',
        rateCount > 0 ? `${rateCount} service rate${rateCount > 1 ? 's' : ''}` : '',
      ].filter(Boolean);

      throw new ValidationError(
        `Cannot delete "${dept.name}" because it is the only department in the hospital and has active records (${blockers.join(', ')}). Please create another department first to preserve staff and clinical records.`
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (fallbackDept) {
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
        }

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
      if (error instanceof ValidationError) {
        throw error;
      }
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
    department: { select: { id: true, name: true, code: true, outsourcedProviderId: true, fulfillmentOwnership: true } },
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

  async getNextServiceCode(): Promise<string> {
    return generateUniqueCode('serviceRate', 'SRV');
  },

  async listServiceRates(filters: ServiceFilters | { activeOnly?: string; providerType?: 'INTERNAL' | 'OUTSOURCED'; departmentId?: string; outsourcedProviderId?: string; status?: 'ACTIVE' | 'INACTIVE' } = {}) {
    const rows = await prisma.serviceRate.findMany({ where: serviceSelectionWhere({ ...filters, activeOnly: filters.activeOnly === true || filters.activeOnly === 'true' }), include: this.serviceRateInclude, orderBy: { name: 'asc' } });
    return this.decorateServiceRates(rows as any);
  },

  async createServiceRate(body: CreateServiceRateBody, createdById: string) {
    if (body.isDefaultEncounterService) throw new ValidationError('OPD, OBS and ER defaults already exist; edit the existing entry');
    const classification = await validateServiceMaster(prisma, body);
    const code = normalizeCode(body.code) ?? (await generateUniqueCode('serviceRate', 'SRV')); 
    try {
      const created = await prisma.serviceRate.create({
        data: {
          ...body,
          code,
          createdById,
          ...classification,
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

  async bulkCreateServiceRates(body: BulkCreateServiceRatesBody, createdById: string) {
    const results = [];
    for (const item of body.services) {
      const created = await this.createServiceRate(item, createdById);
      results.push(created);
    }
    return { count: results.length, services: results };
  },

  async updateServiceRate(id: string, body: UpdateServiceRateBody, updatedById: string) {
    const existing = await this.assertExists('serviceRate', id);
    if ((existing as any).isDeleted) {
      throw new NotFoundError('Service rate not found or already deleted.');
    }
    if (isCoreEncounterService(existing)) {
      if (body.departmentId || (body.providerType && body.providerType !== 'INTERNAL') || body.isActive === false || body.isDefaultEncounterService === false || (body.encounterType && body.encounterType !== (existing as any).encounterType) || (body.code && body.code !== (existing as any).code) || (body.serviceStream && body.serviceStream !== 'HOSPITAL')) throw new ValidationError('Default encounter services must remain active, internal and without a department');
      const { standardRate, description, billingUnit, panelEligible, discountAllowed, manualRateOverrideAllowed, name } = body;
      const data: Prisma.ServiceRateUncheckedUpdateInput = {
        standardRate,
        description,
        billingUnit,
        panelEligible,
        discountAllowed,
        manualRateOverrideAllowed,
        updatedById,
      };
      if (name && typeof name === 'string' && name.trim()) {
        data.name = name.trim();
      }
      const updated = await prisma.serviceRate.update({ where: { id }, data, include: this.serviceRateInclude });
      return this.decorateServiceRates([updated as any])[0];
    }
    if (body.isDefaultEncounterService) throw new ValidationError('Edit the existing OPD, OBS or ER default');
    if ((existing as any).isSystemGenerated) throw new ValidationError('Legacy billing records cannot be edited as Services');
    const classification = await validateServiceMaster(prisma, { ...existing, ...body });
    const data: Prisma.ServiceRateUncheckedUpdateInput = { ...body, ...classification, code: normalizeCode(body.code), updatedById };
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
    const existing = await this.assertExists('serviceRate', id);
    if (isCoreEncounterService(existing)) throw new ValidationError('Default encounter services can only be edited');
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
        `Core encounter service "${service.name}" (${encType}) cannot be deleted from the hospital master catalog. Only editing is allowed.`
      );
    }

    // Archive only: retain all invoice, appointment, panel and commission dependencies.
    await prisma.serviceRate.update({ where: { id }, data: { isActive: false, isDeleted: true, selectable: false, deletedAt: new Date() } });
  },

  async updateBulkDiscount(body: BulkServiceDiscountBody, updatedById: string) {
    const where: Prisma.ServiceRateWhereInput = { isDeleted: false };
    if (body.scope === 'DEPARTMENT') {
      if (!body.departmentId) throw new ValidationError('Department is required for DEPARTMENT scope');
      where.departmentId = body.departmentId;
    } else if (body.scope === 'SERVICE') {
      if (!body.serviceRateIds || !body.serviceRateIds.length) {
        throw new ValidationError('At least one service is required for SERVICE scope');
      }
      where.id = { in: body.serviceRateIds };
    }

    const result = await prisma.serviceRate.updateMany({
      where,
      data: {
        discountAllowed: body.discountAllowed,
        updatedById,
      },
    });

    return { count: result.count, discountAllowed: body.discountAllowed };
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

      // Automatically create a corresponding Department with fulfillmentOwnership = 'OUTSOURCED'
      const deptCode = await generateUniqueCode('department', 'DEP');
      await prisma.department.create({
        data: {
          code: deptCode,
          name: body.name,
          description: body.paymentTermsNotes || `Outsourced department: ${body.name}`,
          departmentType: 'DIAGNOSTIC',
          fulfillmentOwnership: 'OUTSOURCED',
          outsourcedProviderId: created.id,
          isActive: body.isActive ?? true,
          createdById,
        },
      }).catch((e) => {
        console.error('Failed to auto-create department for outsourced provider:', e);
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

      if (body.name || body.isActive !== undefined) {
        await prisma.department.updateMany({
          where: { outsourcedProviderId: id },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            updatedById,
          },
        }).catch(() => {});
      }

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

  async deleteOutsourcedProvider(id: string) {
    const provider = await this.assertExists('outsourcedProvider', id);

    // 1. Check if there are settlements
    const settlementCount = await prisma.providerSettlement.count({
      where: { outsourcedProviderId: id },
    });
    if (settlementCount > 0) {
      throw new ValidationError(
        `Cannot delete outsourced department "${(provider as any).name}" because it has ${settlementCount} recorded provider settlement(s). Please deactivate it instead to preserve financial audit history.`
      );
    }

    // 2. Find linked departments
    const linkedDepts = await prisma.department.findMany({
      where: { outsourcedProviderId: id },
      select: { id: true, name: true },
    });

    // 3. Check if there are invoices or line items linked
    for (const d of linkedDepts) {
      const invCount = await prisma.hospitalInvoice.count({
        where: { departmentId: d.id },
      });
      const lineCount = await prisma.invoiceLineItem.count({
        where: { serviceRate: { departmentId: d.id } },
      });
      if (invCount > 0 || lineCount > 0) {
        throw new ValidationError(
          `Cannot delete outsourced department "${(provider as any).name}" because department "${d.name}" has ${invCount} invoice(s) and ${lineCount} billed service(s). Please deactivate it instead to preserve financial records.`
        );
      }
    }

    // 4. Safely delete within transaction
    await prisma.$transaction(async (tx) => {
      const deptIds = linkedDepts.map((d) => d.id);
      if (deptIds.length > 0) {
        await tx.serviceRate.deleteMany({
          where: { departmentId: { in: deptIds } },
        });
        await tx.department.deleteMany({
          where: { id: { in: deptIds } },
        });
      }

      await tx.outsourcedProvider.delete({
        where: { id },
      });
    });

    return { success: true, message: `Outsourced department "${(provider as any).name}" deleted successfully.` };
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

  /** Eligibility is calculated from receipts inside the same serializable transaction. */
  async createProviderSettlement(body: CreateProviderSettlementBody, settledById: string) {
    if (!body.departmentId) throw new ValidationError('Select a department for this settlement.');
    const { requestKey, ...voucherBody } = body;
    if (!requestKey) throw new ValidationError('A settlement request key is required.');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await prisma.$transaction(async (tx) => {
          const existing = await tx.providerSettlement.findUnique({
            where: { id: requestKey }, include: this.providerSettlementInclude,
          });
          if (existing) {
            const fields = ['outsourcedProviderId', 'departmentId', 'paymentMethod', 'paymentReference',
              'periodLabel', 'representativeName', 'representativeDesignation', 'remarks'] as const;
            if (existing.settledById !== settledById || !existing.settlementAmount.eq(body.settlementAmount) ||
                fields.some(key => (existing[key] ?? '') !== (body[key] ?? ''))) {
              throw new ConflictError('This request key already belongs to a different settlement.');
            }
            return existing;
          }
          if (body.paymentMethod === 'CASH') await lockMainFund(tx);
          const department = await tx.department.findUnique({
            where: { id: body.departmentId }, include: { outsourcedProvider: true },
          });
          if (!department || department.fulfillmentOwnership !== 'OUTSOURCED' ||
              department.outsourcedProviderId !== body.outsourcedProviderId || !department.outsourcedProvider?.isActive) {
            throw new ValidationError('Select the active outsourced provider linked to this department.');
          }
          const methods = department.outsourcedProvider.allowedPaymentMethods;
          if (methods.length && !methods.includes(body.paymentMethod)) {
            throw new ValidationError('This payment method is not allowed by the provider.');
          }
          const ambiguous = await tx.providerSettlement.count({ where: { OR: [
            { outsourcedProviderId: body.outsourcedProviderId, departmentId: null },
            { departmentId: body.departmentId, outsourcedProviderId: { not: body.outsourcedProviderId } },
          ] } });
          if (ambiguous) throw new ValidationError('Existing vouchers are unassigned or belong to a different provider. Reconcile these vouchers before making another payment.');
          const ledger = await departmentCollectionLedger(tx, new Date(), body.departmentId);
          const eligible = ledger.filter(r => r.departmentId === body.departmentId)
            .reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
          const prior = await tx.providerSettlement.aggregate({
            where: { departmentId: body.departmentId }, _sum: { settlementAmount: true },
          });
          const settled = prior._sum.settlementAmount ?? new Decimal(0);
          const remaining = eligible.minus(settled);
          const amount = new Decimal(body.settlementAmount);
          if (!amount.gt(0) || amount.decimalPlaces() > 2 || amount.gt(remaining)) {
            throw new ValidationError('Settlement exceeds available payable (' + Decimal.max(remaining, 0).toFixed(2) + ') or is not a valid amount in cents.');
          }
          if (body.paymentMethod === 'CASH') {
            const rows = await tx.mainCashFundEntry.findMany({ select: { direction: true, amount: true } });
            const available = rows.reduce((sum, r) => r.direction === 'IN' ? sum.plus(r.amount) : sum.minus(r.amount), new Decimal(0));
            if (available.lt(amount)) {
              throw new ValidationError(`Insufficient Main Fund cash (${available.toFixed(2)} available). Deposit or accept cash handovers before paying the provider.`);
            }
          }
          const voucher = await tx.providerSettlement.create({
            data: {
              ...voucherBody, id: requestKey, departmentId: department.id,
              eligibleRealizedAmount: eligible, alreadySettledAmount: settled,
              settlementAmount: amount, status: amount.eq(remaining) ? 'FULL' : 'PARTIAL',
              settledById,
            },
            include: this.providerSettlementInclude,
          });
          if (body.paymentMethod === 'CASH') {
            await tx.mainCashFundEntry.create({
              data: {
                // Same UUID gives a stable, unique link without a destructive schema migration.
                id: voucher.id, direction: 'OUT', amount, type: 'WITHDRAWAL',
                note: `Provider settlement ${voucher.id} — ${department.name}`,
                performedById: settledById,
              },
            });
          }
          return voucher;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { ...created, settledByLabel: formatActorFromRelation(created.settledByUser as ActorRelation | null) };
      } catch (error) {
        if (['P2034', 'P2002'].includes((error as { code?: string }).code ?? '') && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictError('Settlement changed concurrently. Please refresh and retry.');
  },

  async getDepartmentPayablesSummary(query: {
    preset?: string;
    fromDate?: string;
    toDate?: string;
    type?: string;
  }) {
    const preset = query.preset || 'this_month';
    const { start, end, label } = preset === 'all' ? { start: new Date(0), end: new Date(), label: 'All Time' } : resolveDateRange({
      preset: preset as any,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });

    const departments = await prisma.department.findMany({
      where: {
        ...(query.type === 'OUTSOURCED'
          ? { fulfillmentOwnership: 'OUTSOURCED' }
          : query.type === 'INTERNAL'
            ? { fulfillmentOwnership: 'INTERNAL' }
            : {}),
      },
      include: {
        outsourcedProvider: {
          select: {
            id: true,
            name: true,
            code: true,
            allowedPaymentMethods: true,
            settlementCycle: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ fulfillmentOwnership: 'desc' }, { name: 'asc' }],
    });

    const invoiceLines = await prisma.invoiceLineItem.findMany({
      where: {
        billingSource: { not: 'PHARMACY' },
        hospitalInvoice: {
          status: { not: 'VOID' },
          createdAt: { gte: start, lte: end },
        },
      },
      select: {
        id: true,
        billingSource: true,
        lineGross: true,
        discountAmount: true,
        lineNet: true,
        serviceRateId: true,
        serviceRate: {
          select: {
            departmentId: true,
            providerType: true,
            department: { select: financialDepartmentSelect },
          },
        },
        hospitalInvoice: {
          select: {
            id: true,
            departmentId: true,
            department: { select: financialDepartmentSelect },
            appointment: { select: { department: { select: financialDepartmentSelect } } },
            admissionRecord: { select: { department: { select: financialDepartmentSelect } } },
            total: true,
            paidTotal: true,
          },
        },
      },
    });

    const ledger = await departmentCollectionLedger(prisma, end);
    const settlements = await prisma.providerSettlement.findMany({
      where: { settledAt: { lte: end } },
      select: {
        id: true,
        departmentId: true,
        outsourcedProviderId: true,
        settlementAmount: true,
        settledAt: true,
      },
    });

    const summaryRows = departments.map((d) => {
      const matchingLines = invoiceLines.filter(l => hospitalServiceDepartment(l, l.hospitalInvoice)?.id === d.id);

      const invoicesSet = new Set<string>();
      let periodGross = 0;
      let periodDiscount = 0;
      let periodBilled = 0;
      let periodRealized = 0;

      for (const l of matchingLines) {
        invoicesSet.add(l.hospitalInvoice.id);
        const gross = Number(l.lineGross);
        const disc = Number(l.discountAmount);
        const net = Number(l.lineNet);
        periodGross += gross;
        periodDiscount += disc;
        periodBilled += net;

      }
      const collections = ledger.filter(r => r.departmentId === d.id);
      const sum = (values: Decimal[]) => values.reduce((a, b) => a.plus(b), new Decimal(0)).toNumber();
      periodRealized = sum(collections.filter(r => r.collectedAt >= start).map(r => r.amount));
      const cumulativeRealized = sum(collections.map(r => r.amount));
      const deptSettlements = settlements.filter(s => s.departmentId === d.id);
      const alreadySettled = sum(deptSettlements.map(s => s.settlementAmount));
      const periodSettled = sum(deptSettlements.filter(s => s.settledAt >= start).map(s => s.settlementAmount));
      const isOutsourced = d.fulfillmentOwnership === 'OUTSOURCED';
      const closingBalance = isOutsourced ? new Decimal(cumulativeRealized).minus(alreadySettled).toNumber() : 0;
      const openingBalance = isOutsourced ? new Decimal(closingBalance).minus(periodRealized).plus(periodSettled).toNumber() : 0;
      const remainingPayable = Math.max(0, closingBalance);
      const requiresSettlementReconciliation = settlements.some(s =>
        (s.outsourcedProviderId === d.outsourcedProviderId && !s.departmentId) ||
        (s.departmentId === d.id && s.outsourcedProviderId !== d.outsourcedProviderId));

      return {
        departmentId: d.id,
        departmentName: d.name,
        departmentCode: d.code,
        fulfillmentOwnership: d.fulfillmentOwnership,
        outsourcedProvider: d.outsourcedProvider,
        invoicesCount: invoicesSet.size,
        servicesCount: matchingLines.length,
        periodGross: Math.round(periodGross * 100) / 100,
        periodDiscount: Math.round(periodDiscount * 100) / 100,
        periodBilled: Math.round(periodBilled * 100) / 100,
        periodRealized: Math.round(periodRealized * 100) / 100,
        cumulativeRealized,
        periodSettled,
        openingBalance,
        closingBalance,
        requiresSettlementReconciliation,
        alreadySettled: Math.round(alreadySettled * 100) / 100,
        remainingPayable: Math.round(remainingPayable * 100) / 100,
      };
    });

    const totalBilled = summaryRows.reduce((sum, r) => sum + r.periodBilled, 0);
    const totalRealized = summaryRows.reduce((sum, r) => sum + r.periodRealized, 0);
    const totalSettled = summaryRows.reduce((sum, r) => sum + r.periodSettled, 0);
    const totalRemaining = summaryRows.reduce((sum, r) => sum + r.remainingPayable, 0);

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      kpis: {
        totalBilled: Math.round(totalBilled * 100) / 100,
        totalRealized: Math.round(totalRealized * 100) / 100,
        totalSettled: Math.round(totalSettled * 100) / 100,
        totalRemaining: Math.round(totalRemaining * 100) / 100,
      },
      departments: summaryRows,
    };
  },
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
