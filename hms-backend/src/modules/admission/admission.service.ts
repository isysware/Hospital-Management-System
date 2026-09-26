import bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { notificationsService } from '../notifications/notifications.service';
import { AuthenticationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors/AppError';
import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { assertMembershipEligible } from '@/shared/panelMembership';
import { patientPaymentStatus, patientResponsibility } from '@/shared/invoicePaymentStatus';
import { assertCaseAuthorization, caseAuthorizationIneligibilityReasons } from '@/shared/panelAuthorization';
import type {
  CreatePlannedAdmissionBody,
  UpdatePlannedAdmissionBody,
  CheckInAdmissionBody,
  RequestPaymentBody,
  TransferBedBody,
  AddAdmissionServiceBody,
  ChangeMedicationModeBody,
  CreatePharmacyRequestBody,
  GrantClearanceBody,
  ListAdmissionsQuery,
  ClinicalDischargeBody,
  AuthorizeHighCostMedicineBody,
  RejectHighCostMedicineBody,
  CloseHospitalDayBody,
} from './admission.schemas';

import {
  generateAdmissionNumber,
  generateInvoiceNumber,
  generateMedicineRequestNumber,
  generateMrNumber,
  generateReceiptNumber,
} from '@/shared/idGenerator';

/**
 * Recomputes and persists a HospitalInvoice's aggregate totals from its
 * current line items (v7.2 §2.2 — always scoped to ONE department invoice).
 * Shared by every action that appends a line item to an admission's
 * department invoice, so `addAdmissionService` and `closeHospitalDay` can
 * never drift on how a total/status is derived from its lines.
 */
async function recalcInvoiceTotals(
  tx: Prisma.TransactionClient,
  invoice: { id: string; paidTotal: Decimal; panelPatientId?: string | null },
  allLines: {
    lineGross: Decimal | null;
    discountAmount: Decimal | null;
    lineNet: Decimal | null;
    patientShare: Decimal | null;
    panelReceivable: Decimal | null;
  }[],
) {
  if (invoice.panelPatientId && allLines.some(line => !new Decimal(line.patientShare ?? 0).plus(line.panelReceivable ?? 0).equals(line.lineNet ?? 0))) {
    throw new ValidationError('Historical panel lines need payer reconciliation before adding charges');
  }
  const newSubtotal = allLines.reduce((acc, l) => acc.plus(l.lineGross ?? 0), new Decimal(0));
  const newDiscountTotal = allLines.reduce((acc, l) => acc.plus(l.discountAmount ?? 0), new Decimal(0));
  const newTotal = allLines.reduce((acc, l) => acc.plus(l.lineNet ?? 0), new Decimal(0));
  const newPatientShare = allLines.reduce((acc, l) => acc.plus(l.patientShare ?? 0), new Decimal(0));
  const newPanelReceivable = allLines.reduce((acc, l) => acc.plus(l.panelReceivable ?? 0), new Decimal(0));

  const newStatus = newTotal.equals(0)
    ? 'PAID'
    : patientPaymentStatus(
        { panelPatientId: invoice.panelPatientId, total: newTotal, patientShare: newPatientShare, panelReceivable: newPanelReceivable },
        invoice.paidTotal,
      );

  await tx.hospitalInvoice.update({
    where: { id: invoice.id },
    data: {
      subtotal: newSubtotal,
      discountTotal: newDiscountTotal,
      total: newTotal,
      patientShare: newPatientShare,
      panelReceivable: newPanelReceivable,
      status: newStatus,
    },
  });
}

/**
 * Find-or-create the single shared "Room / Bed Accommodation Charges"
 * ServiceRate that every automatic day-close charge posts against —
 * uses a stable service code for automatic accommodation charges.
 * Its own `standardRate` is never billed; each posted line snapshots the
 * admitted room's OWN configured daily rate instead (rates differ per
 * room/bed, one shared rate card wouldn't fit).
 */
async function getOrCreateRoomChargeServiceRate(tx: Prisma.TransactionClient, fallbackDepartmentId: string, actorId: string) {
  let serviceRate = await tx.serviceRate.findFirst({
    where: {
      OR: [{ code: 'ROOM-ACC' }, { name: { contains: 'Room / Bed Accommodation', mode: 'insensitive' } }],
    },
  });

  if (!serviceRate) {
    serviceRate = await tx.serviceRate.create({
      data: {
        code: 'ROOM-ACC',
        name: 'Room / Bed Accommodation Charges',
        category: 'Accommodation',
        departmentId: fallbackDepartmentId,
        standardRate: new Decimal(2000),
        billingUnit: 'PER_DAY',
        discountAllowed: false,
        isActive: true,
        isSystemGenerated: true,
        createdById: actorId,
      },
    });
  }

  return serviceRate;
}

/**
 * One-time fixed Ward charge integration.
 * Posts a one-time fixed fee line item if the occupied bed's ward has a configured `fixedPrice > 0`.
 * If `fixedPrice` is 0 or null, strictly nothing is billed.
 */
async function postWardFixedChargeIfApplicable(
  tx: Prisma.TransactionClient,
  admissionId: string,
  target: string | { bedId?: string | null; wardId?: string | null },
  actorId: string
) {
  const bedId = typeof target === 'string' ? target : target?.bedId;
  const wardId = typeof target === 'object' ? target?.wardId : undefined;

  let ward: { id: string; fixedPrice: Decimal | null; departmentId: string } | null = null;

  if (wardId) {
    ward = await tx.ward.findUnique({
      where: { id: wardId },
    });
  } else if (bedId) {
    const bed = await tx.bed.findUnique({
      where: { id: bedId },
      include: { room: { include: { ward: true } }, ward: true },
    });
    // Direct Ward -> Bed carries its own ward; Ward -> Room -> Bed resolves
    // via the room; a standalone Room -> Bed (no ward) has none of either.
    ward = bed?.ward ?? bed?.room?.ward ?? null;
  }

  if (!ward?.fixedPrice || Number(ward.fixedPrice) <= 0) {
    return null;
  }

  const wardFixedRate = new Decimal(ward.fixedPrice);

  let invoice = await tx.hospitalInvoice.findFirst({
    where: { admissionRecordId: admissionId, sourceType: 'ADMISSION' },
    include: { lines: true },
  });

  if (!invoice) {
    const admission = await tx.admissionRecord.findUnique({ where: { id: admissionId } });
    if (!admission) return null;
    invoice = await tx.hospitalInvoice.create({
      data: {
        invoiceNumber: await generateInvoiceNumber(tx),
        sourceType: 'ADMISSION',
        admissionRecordId: admission.id,
        departmentId: admission.departmentId,
        panelPatientId: admission.panelPatientId,
        selfPayEncounterId: admission.selfPayEncounterId,
        subtotal: new Decimal(0),
        discountTotal: new Decimal(0),
        total: new Decimal(0),
        paidTotal: new Decimal(0),
        patientShare: new Decimal(0),
        panelReceivable: new Decimal(0),
        status: 'UNPAID',
        createdById: actorId,
      },
      include: { lines: true },
    });
  }

  let serviceRate = await tx.serviceRate.findFirst({
    where: {
      OR: [
        { code: 'WARD-PRICE' },
        { code: 'WARD-FIXED' },
        { name: { contains: 'Ward Price', mode: 'insensitive' } },
        { name: { contains: 'Ward Fixed / Admission Fee', mode: 'insensitive' } },
        { name: { contains: 'Ward Fixed', mode: 'insensitive' } },
      ],
    },
  });

  if (!serviceRate) {
    serviceRate = await tx.serviceRate.create({
      data: {
        code: 'WARD-PRICE',
        name: 'Ward Price',
        category: 'Accommodation',
        departmentId: invoice.departmentId ?? ward.departmentId,
        standardRate: new Decimal(0),
        billingUnit: 'PER_ADMISSION',
        discountAllowed: false,
        isActive: true,
        isSystemGenerated: true,
        createdById: actorId,
      },
    });
  } else if (/fixed/i.test(serviceRate.name)) {
    serviceRate = await tx.serviceRate.update({
      where: { id: serviceRate.id },
      data: { name: 'Ward Price' },
    });
  }

  // Idempotency: verify this one-time fee has not already been posted on the admission's invoice
  const alreadyBilled = invoice.lines.some((l) => l.serviceRateId === serviceRate!.id);
  if (alreadyBilled) {
    return null;
  }

  const panelPatient = invoice.panelPatientId ? await tx.panelPatient.findUnique({
    where: { id: invoice.panelPatientId }, include: { corporatePanel: { include: { discountRules: true } } },
  }) : null;
  const coverage = resolvePanelCoverage(wardFixedRate, panelPatient?.corporatePanel.discountRules, serviceRate.id, new Date(), ward.departmentId, new Decimal(1), panelPatient);
  if (panelPatient) {
    const authFields = await tx.admissionRecord.findUnique({
      where: { id: admissionId },
      select: { authorizationNumber: true, authorizationValidUntil: true },
    });
    assertCaseAuthorization(panelPatient.corporatePanel.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, authFields ?? {});
  }
  const createdLine = await tx.invoiceLineItem.create({
    data: {
      hospitalInvoiceId: invoice.id,
      serviceRateId: serviceRate.id,
      rateSnapshot: wardFixedRate,
      quantity: new Decimal(1),
      lineGross: wardFixedRate,
      discountAmount: coverage.discountAmount,
      discountReason: coverage.discountReason,
      lineNet: coverage.eligibleNet,
      patientShare: coverage.patientShare,
      panelReceivable: coverage.panelReceivable,
      coverageSnapshot: coverage.coverageSnapshot,
      isCompleted: true,
    },
  });

  await recalcInvoiceTotals(tx, invoice, [...invoice.lines, createdLine]);

  return createdLine;
}

async function postInitialRoomChargeIfApplicable(tx: Prisma.TransactionClient, admissionId: string, bedId: string, actorId: string) {
  const bed = await tx.bed.findUnique({ where: { id: bedId }, include: { room: true } });
  const rate = bed?.room?.dailyRoomRate;
  if (!rate || rate.lessThanOrEqualTo(0)) return;
  // Intake and check-in share this guard; the first day is posted only once.
  if (await tx.admissionRoomChargeLog.findFirst({ where: { admissionRecordId: admissionId } })) return;
  const admission = await tx.admissionRecord.findUnique({
    where: { id: admissionId },
    include: { panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } } },
  });
  if (!admission) throw new NotFoundError('Admission record not found');
  const invoice = await tx.hospitalInvoice.findFirst({
    where: { admissionRecordId: admissionId, sourceType: 'ADMISSION' }, include: { lines: true },
  });
  if (!invoice) throw new NotFoundError('Admission invoice not found');
  const service = await getOrCreateRoomChargeServiceRate(tx, admission.departmentId, actorId);
  const coverage = resolvePanelCoverage(rate, admission.panelPatient?.corporatePanel?.discountRules, service.id, new Date(), admission.departmentId, new Decimal(1), admission.panelPatient);
  if (admission.panelPatient) {
    assertCaseAuthorization(admission.panelPatient.corporatePanel?.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, admission);
  }
  const line = await tx.invoiceLineItem.create({ data: {
    hospitalInvoiceId: invoice.id, serviceRateId: service.id, rateSnapshot: rate,
    quantity: new Decimal(1), lineGross: rate, discountAmount: coverage.discountAmount,
    discountReason: coverage.discountReason, lineNet: rate.minus(coverage.discountAmount),
    patientShare: coverage.patientShare, panelReceivable: coverage.panelReceivable, coverageSnapshot: coverage.coverageSnapshot, isCompleted: true,
  } });
  await tx.admissionRoomChargeLog.create({ data: {
    admissionRecordId: admissionId,
    businessDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
    invoiceLineItemId: line.id, ratePosted: rate,
  } });
  await recalcInvoiceTotals(tx, invoice, [...invoice.lines, line]);
}

/**
 * v7.2 §2.4 — resolves the doctor from their own discharge credential.
 * `db/client.ts`'s global `omit` hides `clinicalAuthPasswordHash` from every
 * Staff query by design; this is the one legitimate server-side read that
 * needs it, so it is un-omitted for this query only. Same generic error for
 * unknown user / wrong password / inactive credential.
 */
async function findDoctorByDischargeCredential(db: Prisma.TransactionClient | typeof prisma, username: string, password: string) {
  const doctor = await db.staff.findUnique({
    where: { clinicalAuthUsername: username.trim() },
    include: { department: true },
    omit: { clinicalAuthPasswordHash: false },
  });
  if (!doctor || !doctor.isActive || !doctor.clinicalAuthActive || !doctor.clinicalAuthPasswordHash) {
    throw new AuthenticationError('Invalid doctor credentials');
  }
  const passwordOk = await bcrypt.compare(password, doctor.clinicalAuthPasswordHash);
  if (!passwordOk) throw new AuthenticationError('Invalid doctor credentials');
  return doctor;
}

export const admissionService = {
  /**
   * Discharge popup step 1 — confirms the credential and returns only who the
   * doctor is, so the Admission user sees the authorizing doctor's name before
   * the Discharge Summary is written. Nothing is changed.
   */
  async verifyDischargeDoctor(username: string, password: string) {
    const doctor = await findDoctorByDischargeCredential(prisma, username, password);
    return {
      staffId: doctor.id,
      employeeId: doctor.employeeId,
      fullName: doctor.fullName,
      designation: doctor.designation,
      department: doctor.department?.name ?? null,
    };
  },

  /**
   * Create Planned Inpatient Admission (§4.7 Sub-flow A, D16 p.10)
   * Note: Tentative bed preference is recorded, but bed becomes OCCUPIED
   * only upon check-in / arrival, never during planned booking.
   */
  async createPlannedAdmission(body: CreatePlannedAdmissionBody, actorId: string) {
    const result = await prisma.$transaction(async (tx) => {
      let selfPayEncounterId = body.selfPayEncounterId;

      if (!body.panelPatientId && !selfPayEncounterId && body.newSelfPayPatient) {
        const createdSelfPay = await tx.selfPayEncounter.create({
          data: {
            mrNumber: await generateMrNumber(tx),
            fullName: body.newSelfPayPatient.fullName,
            guardianName: body.newSelfPayPatient.guardianName,
            gender: body.newSelfPayPatient.gender,
            dob: body.newSelfPayPatient.dob,
            cnicOrPassport: body.newSelfPayPatient.cnicOrPassport,
            phone: body.newSelfPayPatient.phone,
            address: body.newSelfPayPatient.address,
            createdById: actorId,
          },
        });
        selfPayEncounterId = createdSelfPay.id;
      }

      if (body.panelPatientId) {
        const panelPatient = await tx.panelPatient.findUnique({
          where: { id: body.panelPatientId },
          include: { corporatePanel: true },
        });
        if (!panelPatient || !panelPatient.isActive) {
          throw new NotFoundError('Panel patient not found or inactive');
        }
        if (panelPatient.corporatePanel && !panelPatient.corporatePanel.isActive) {
          throw new ValidationError('Corporate panel is inactive');
        }
        assertMembershipEligible(panelPatient);
        assertCaseAuthorization(panelPatient.corporatePanel?.authorizationRequired, false, {
          authorizationNumber: body.authorizationNumber,
          authorizationValidUntil: body.authorizationValidUntil,
        });
      }

      let departmentId = body.departmentId;

      if (body.preferredBedId) {
        const bed = await tx.bed.findUnique({
          where: { id: body.preferredBedId },
          include: { room: { include: { ward: true } }, ward: true },
        });
        if (!bed) throw new NotFoundError('Selected bed not found');
      if (bed.operationalStatus !== 'ACTIVE' || bed.room?.isActive === false || bed.ward?.isActive === false || bed.room?.ward?.isActive === false) {
        throw new ValidationError('Selected bed, room and ward must be active and in service.');
      }
        if (bed.status !== 'AVAILABLE') {
          throw new ValidationError(`Selected bed is currently ${bed.status}. Only AVAILABLE beds can be assigned.`);
        }
        if (bed.operationalStatus !== 'ACTIVE') {
          throw new ValidationError(`Selected bed is ${bed.operationalStatus} and cannot be assigned.`);
        }
        // Auto-align department with the bed's ward, when one is resolvable
        // (direct Ward -> Bed, or via the bed's Room -> Ward). A standalone
        // Room -> Bed with no ward keeps whatever departmentId was supplied.
        const resolvedWardDeptId = bed.ward?.departmentId ?? bed.room?.ward?.departmentId;
        if (!departmentId && resolvedWardDeptId) {
          departmentId = resolvedWardDeptId;
        }

        // Mark bed as OCCUPIED so it cannot be double-assigned to another patient
        await tx.bed.update({
          where: { id: bed.id },
          data: { status: 'OCCUPIED' },
        });
      }

      if (!departmentId) {
        const defaultDept = await tx.department.findFirst({
          where: { isActive: true },
          orderBy: { name: 'asc' },
        });
        if (!defaultDept) {
          throw new ValidationError('No active department found for admission.');
        }
        departmentId = defaultDept.id;
      }

      const admissionNumber = await generateAdmissionNumber(tx);

      const admission = await tx.admissionRecord.create({
        data: {
          admissionNumber,
          panelPatientId: body.panelPatientId,
          selfPayEncounterId,
          departmentId,
          doctorStaffId: body.doctorStaffId ?? null,
          bedId: body.preferredBedId ?? null,
          status: 'PLANNED',
          medicationMode: body.medicationMode ?? 'HOSPITAL_MANAGED',
          outsourcedFulfillmentMode: body.outsourcedFulfillmentMode ?? 'HOSPITAL_MANAGED',
          diagnosis: body.diagnosis,
          weightKg: body.weightKg != null ? new Decimal(body.weightKg) : null,
          expectedAt: body.expectedAt,
          estimatedAmount: body.estimatedAmount !== undefined ? new Decimal(body.estimatedAmount) : null,
          notes: body.notes,
          authorizationNumber: body.panelPatientId ? body.authorizationNumber || null : null,
          authorizationLimit: body.panelPatientId && body.authorizationLimit != null ? new Decimal(body.authorizationLimit) : null,
          authorizationValidUntil: body.panelPatientId ? body.authorizationValidUntil || null : null,
          createdById: actorId,
        },
        include: {
          panelPatient: true,
          selfPayEncounter: true,
          department: true,
          doctor: true,
          bed: { include: { room: { include: { ward: true } }, ward: true } },
        },
      });

      // Generate admission invoice immediately at creation (Front Desk entry time)
      const invoiceNumber = await generateInvoiceNumber(tx);
      const advDecimal = body.advanceAmount && body.advanceAmount > 0
        ? new Decimal(body.advanceAmount)
        : new Decimal(0);

      const isPaid = advDecimal.gt(0);

      const invoice = await tx.hospitalInvoice.create({
        data: {
          invoiceNumber,
          sourceType: 'ADMISSION',
          admissionRecordId: admission.id,
          departmentId: admission.departmentId,
          panelPatientId: admission.panelPatientId,
          selfPayEncounterId: admission.selfPayEncounterId,
          subtotal: new Decimal(0),
          discountTotal: new Decimal(0),
          total: new Decimal(0),
          paidTotal: advDecimal,
          patientShare: new Decimal(0),
          panelReceivable: new Decimal(0),
          status: 'PAID',
          createdById: actorId,
        },
      });

      let advanceReceipt = null;
      if (isPaid) {
        // Advance is a payment/credit only; it never creates a service charge.
        const receiptNumber = await generateReceiptNumber(tx);

        advanceReceipt = await tx.paymentReceipt.create({
          data: {
            receiptNumber,
            amount: advDecimal,
            method: body.paymentMethod ?? 'CASH',
            reference: body.paymentReference ?? `Advance for admission ${admission.admissionNumber}`,
            admissionRecordId: admission.id,
            hospitalInvoiceId: invoice.id,
            collectedById: actorId,
          },
        });

        // Universal Cashier balance ledger update (§4.9, §8.12)
        await tx.userCashBalance.create({
          data: {
            portalUserId: actorId,
            moduleScope: 'BILLING',
            direction: 'IN',
            amount: advDecimal,
            category: 'COLLECTION',
            isPhysicalCash: (body.paymentMethod ?? 'CASH') === 'CASH',
            paymentReceiptId: advanceReceipt.id,
          },
        });
      }

      // Check if ward (either direct wardId or from preferred bed) has fixed pricing configured
      if (body.wardId || body.preferredBedId) {
        await postWardFixedChargeIfApplicable(
          tx,
          admission.id,
          { bedId: body.preferredBedId, wardId: body.wardId },
          actorId
        );
      }

      if (body.preferredBedId) {
        await postInitialRoomChargeIfApplicable(tx, admission.id, body.preferredBedId, actorId);
      }
      return { admission, advanceReceipt, invoice };
    });

    try {
      const patientName = result.admission.panelPatient?.fullName || result.admission.selfPayEncounter?.fullName || 'Patient';
      const bedInfo = result.admission.bed?.bedNumber ? ` (Bed: ${result.admission.bed.bedNumber})` : '';
      const isPlanned = result.admission.status === 'PLANNED';
      await notificationsService.createNotification({
        title: isPlanned ? `New Planned Admission: ${patientName}` : `New Patient Admitted: ${patientName}`,
        message: `Patient ${patientName} (${result.admission.admissionNumber}) ${isPlanned ? 'scheduled as Planned Admission' : 'admitted'}${bedInfo}.`,
        type: 'success',
        module: 'ADMISSION',
        targetPortal: 'admission',
        actionUrl: '/admission/planned_admissions',
        referenceId: result.admission.id,
        createdById: actorId,
      });
    } catch (notifErr) {
      console.error('Failed to dispatch admission notification:', notifErr);
    }

    return result;
  },

  async listAdmissions(query: ListAdmissionsQuery) {
    const where: Prisma.AdmissionRecordWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.doctorStaffId) where.doctorStaffId = query.doctorStaffId;

    if (query.search) {
      where.OR = [
        { admissionNumber: { contains: query.search, mode: 'insensitive' } },
        { panelPatient: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { panelPatient: { mrNumber: { contains: query.search, mode: 'insensitive' } } },
        { selfPayEncounter: { fullName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return prisma.admissionRecord.findMany({
      where,
      include: {
        panelPatient: { select: { id: true, fullName: true, mrNumber: true } },
        selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
        department: { select: { id: true, name: true } },
        doctor: { select: { id: true, fullName: true, designation: true } },
        bed: {
          select: {
            id: true,
            bedNumber: true,
            status: true,
            ward: { select: { id: true, name: true } },
            room: { select: { id: true, name: true, ward: { select: { id: true, name: true } } } },
          },
        },
        dischargeClearances: true,
        paymentRequests: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(query.status === 'DISCHARGED' ? {} : { take: 100 }),
    });
  },

  async getAdmission(id: string) {
    const admission = await prisma.admissionRecord.findUnique({
      where: { id },
      include: {
        panelPatient: { include: { corporatePanel: true } },
        selfPayEncounter: true,
        department: true,
        doctor: true,
        bed: { include: { room: { include: { ward: true } }, ward: true } },
        bedTransfers: {
          include: {
            fromBed: { include: { room: { include: { ward: true } }, ward: true } },
            toBed: { include: { room: { include: { ward: true } }, ward: true } },
            transferredBy: { select: { id: true, username: true } },
          },
          orderBy: { transferredAt: 'desc' },
        },
        medicationModeHistory: {
          include: { changedBy: { select: { id: true, username: true } } },
          orderBy: { changedAt: 'desc' },
        },
        paymentRequests: {
          include: { requestedBy: { select: { id: true, username: true } } },
          orderBy: { requestedAt: 'desc' },
        },
        pharmacyClearances: {
          include: {
            lines: { include: { medicine: true } },
            requestedBy: { select: { id: true, username: true } },
            highCostAuthorization: true,
          },
        },
        dischargeClearances: {
          include: { clearedBy: { select: { id: true, username: true } } },
        },
        dischargeSummary: true,
        hospitalInvoices: {
          include: {
            department: true,
            lines: { include: { serviceRate: true, performedBy: true } },
            paymentReceipts: true,
          },
        },
      },
    });

    if (!admission) throw new NotFoundError('Admission record not found');

    // Unallocated advance/deposit receipts (`hospitalInvoiceId: null`) sit
    // outside every invoice's own `paidTotal` — surfaced here so the
    // Admission Portal's Services & Charges tab can net it against the raw
    // per-invoice `total - paidTotal` instead of showing an outstanding
    // balance that ignores money already collected (same fix as
    // `admissionBilling.service.ts`'s `getStatement`).
    const unallocated = await prisma.paymentReceipt.aggregate({
      where: { admissionRecordId: id, hospitalInvoiceId: null, isReversed: false },
      _sum: { amount: true },
    });

    return { ...admission, unallocatedAdvanceTotal: unallocated._sum.amount ?? new Decimal(0) };
  },

  async updatePlannedAdmission(id: string, body: UpdatePlannedAdmissionBody) {
    const existing = await prisma.admissionRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Admission record not found');
    if (existing.status !== 'PLANNED') {
      throw new ValidationError(`Cannot update admission in ${existing.status} status`);
    }

    return prisma.admissionRecord.update({
      where: { id },
      data: {
        ...body,
        estimatedAmount: body.estimatedAmount !== undefined ? new Decimal(body.estimatedAmount) : undefined,
        authorizationLimit: body.authorizationLimit !== undefined ? new Decimal(body.authorizationLimit) : undefined,
      },
      include: {
        doctor: true,
        department: true,
      },
    });
  },

  /**
   * Raise payment request to Front Desk / Billing queue (§4.7, D04 p.2).
   * Admission portal NEVER receives cash.
   */
  async requestPayment(admissionId: string, body: RequestPaymentBody, actorId: string) {
    const admission = await prisma.admissionRecord.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError('Admission record not found');

    const createdRequest = await prisma.admissionPaymentRequest.create({
      data: {
        admissionRecordId: admission.id,
        requestType: body.requestType,
        requestedAmount: new Decimal(body.requestedAmount),
        notes: body.notes,
        status: 'PENDING',
        requestedById: actorId,
      },
      include: {
        admissionRecord: { select: { id: true, admissionNumber: true } },
      },
    });

    try {
      const [actor, fullAdmission] = await Promise.all([
        prisma.portalUser.findUnique({
          where: { id: actorId },
          select: { id: true, username: true, staff: { select: { fullName: true } } },
        }),
        prisma.admissionRecord.findUnique({
          where: { id: admissionId },
          include: { panelPatient: true, selfPayEncounter: true },
        }),
      ]);
      const actorDisplayName = actor?.staff?.fullName || actor?.username || 'Staff';
      const patientName = fullAdmission?.panelPatient?.fullName || fullAdmission?.selfPayEncounter?.fullName || 'Patient';
      const mrNumber = fullAdmission?.panelPatient?.mrNumber ? ` [MR: ${fullAdmission.panelPatient.mrNumber}]` : '';
      const amountStr = Number(body.requestedAmount).toLocaleString('en-PK', { maximumFractionDigits: 0 });

      await notificationsService.createNotification({
        title: `Payment Requested: ${patientName}`,
        message: `Payment request of Rs. ${amountStr} raised for ${patientName}${mrNumber} (${admission.admissionNumber}) by ${actorDisplayName} (User ID: ${actor?.username || actorId}).`,
        type: 'urgent',
        module: 'BILLING',
        targetPortal: 'front-desk',
        actionUrl: '/billing/inpatient',
        referenceId: admission.id,
        createdById: actorId,
      });
    } catch (notifErr) {
      console.error('Failed to notify payment request:', notifErr);
    }

    return createdRequest;
  },

  /**
   * Admission Check-In / Assign Bed (§4.7 Sub-flow B, §8.8)
   * Transitions Bed status from AVAILABLE to OCCUPIED.
   * Initializes running HospitalInvoice and 3-Key Discharge Clearances.
   */
  async checkInAdmission(admissionId: string, body: CheckInAdmissionBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
        include: { dischargeClearances: true },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status === 'ACTIVE') throw new ValidationError('Patient is already admitted and active');
      if (admission.status === 'DISCHARGED') throw new ValidationError('Cannot check-in a discharged admission');

      // Verify target bed is available
      const bed = await tx.bed.findUnique({ where: { id: body.bedId }, include: { room: { include: { ward: true } }, ward: true } });
      if (!bed) throw new NotFoundError('Selected bed not found');
      if (bed.status !== 'AVAILABLE' && bed.id !== admission.bedId) {
        throw new ValidationError(`Selected bed is currently ${bed.status}. Only AVAILABLE beds can be assigned.`);
      }

      if (bed.id !== admission.bedId) {
        const claimed = await tx.bed.updateMany({
          where: { id: bed.id, status: 'AVAILABLE', operationalStatus: 'ACTIVE' },
          data: { status: 'OCCUPIED' },
        });
        if (claimed.count !== 1) throw new ConflictError('Selected bed is no longer available.');
      }
      // If switching to a different bed from previously assigned bed, free the old bed
      if (admission.bedId && admission.bedId !== bed.id) {
        if (!body.transferReason?.trim()) throw new ValidationError('Transfer reason is required when changing the assigned bed.');
        await tx.bedTransferHistory.create({ data: {
          admissionRecordId: admission.id, fromBedId: admission.bedId, toBedId: bed.id,
          reason: body.transferReason.trim(), transferredById: actorId,
        } });
        await tx.bed.update({
          where: { id: admission.bedId },
          data: { status: 'AVAILABLE' },
        });
      }

      // Ensure target bed is marked OCCUPIED
      await tx.bed.update({
        where: { id: bed.id },
        data: { status: 'OCCUPIED' },
      });

      // Update admission status to ACTIVE. Check-in notes are appended to
      // (never overwrite) any intake notes captured at creation — both
      // moments' notes stay on the record.
      const combinedNotes = body.notes
        ? admission.notes
          ? `${admission.notes}\n[Check-In] ${body.notes}`
          : `[Check-In] ${body.notes}`
        : admission.notes;

      const updatedAdmission = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: {
          bedId: bed.id,
          status: 'ACTIVE',
          admittedAt: new Date(),
          notes: combinedNotes,
        },
        include: {
          bed: { include: { room: { include: { ward: true } }, ward: true } },
          doctor: true,
          department: true,
        },
      });

      // Initialize the admitting department's own "Hospital Services" invoice
      // if one does not exist yet (v7.2 §2.2 — one department invoice per
      // department that bills this admission; other departments' invoices
      // are created on-demand in `addAdmissionService` as their services
      // are actually posted).
      const existingInvoice = await tx.hospitalInvoice.findFirst({
        where: { admissionRecordId: admission.id, sourceType: 'ADMISSION' },
      });

      if (!existingInvoice) {
        const invoiceNumber = await generateInvoiceNumber(tx);
        await tx.hospitalInvoice.create({
          data: {
            invoiceNumber,
            sourceType: 'ADMISSION',
            admissionRecordId: admission.id,
            departmentId: admission.departmentId,
            panelPatientId: admission.panelPatientId,
            selfPayEncounterId: admission.selfPayEncounterId,
            subtotal: new Decimal(0),
            discountTotal: new Decimal(0),
            total: new Decimal(0),
            paidTotal: new Decimal(0),
            patientShare: new Decimal(0),
            panelReceivable: new Decimal(0),
            status: 'UNPAID',
            createdById: actorId,
          },
        });
      }

      // If assigned bed's ward has fixed pricing, post one-time fixed charge line
      await postWardFixedChargeIfApplicable(tx, admission.id, bed.id, actorId);
      await postInitialRoomChargeIfApplicable(tx, admission.id, bed.id, actorId);

      // Initialize 3-Key Discharge Clearances (D16 p.13)
      if (admission.dischargeClearances.length === 0) {
        const pharmacyStatus = admission.medicationMode === 'HOSPITAL_MANAGED' ? 'PENDING' : 'NOT_APPLICABLE';

        await tx.dualDischargeClearance.createMany({
          data: [
            { admissionRecordId: admission.id, clearanceType: 'CLINICAL', status: 'PENDING' },
            { admissionRecordId: admission.id, clearanceType: 'HOSPITAL_BILLING', status: 'PENDING' },
            { admissionRecordId: admission.id, clearanceType: 'PHARMACY', status: pharmacyStatus },
          ],
        });
      }

      return updatedAdmission;
    });
  },

  /**
   * Bed Transfer (§4.7, D16 p.11)
   * Frees previous bed to AVAILABLE, marks target bed OCCUPIED,
   * and records immutable BedTransferHistory audit row.
   */
  async transferBed(admissionId: string, body: TransferBedBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status !== 'ACTIVE') {
        throw new ValidationError('Bed transfer is only permitted for ACTIVE admissions');
      }
      if (!admission.bedId) {
        throw new ValidationError('Patient currently has no assigned bed to transfer from');
      }
      if (admission.bedId === body.targetBedId) {
        throw new ValidationError('Target bed is identical to current assigned bed');
      }

      const targetBed = await tx.bed.findUnique({ where: { id: body.targetBedId }, include: { room: { include: { ward: true } }, ward: true } });
      if (!targetBed) throw new NotFoundError('Target bed not found');
      if (targetBed.operationalStatus !== 'ACTIVE' || targetBed.room?.isActive === false || targetBed.ward?.isActive === false || targetBed.room?.ward?.isActive === false) {
        throw new ValidationError('Target bed, room and ward must be active and in service.');
      }
      if (targetBed.status !== 'AVAILABLE') {
        throw new ValidationError(`Target bed is ${targetBed.status}. Only AVAILABLE beds can receive a transfer.`);
      }

      // Compare-and-set the assignment and target bed inside the same transaction.
      // Concurrent transfers must not occupy two beds for one admission or share a bed.
      const assignment = await tx.admissionRecord.updateMany({
        where: { id: admission.id, status: 'ACTIVE', bedId: admission.bedId },
        data: { bedId: targetBed.id },
      });
      if (assignment.count !== 1) throw new ConflictError('Admission location changed. Reload and try again.');
      const claimed = await tx.bed.updateMany({
        where: { id: targetBed.id, status: 'AVAILABLE', operationalStatus: 'ACTIVE' },
        data: { status: 'OCCUPIED' },
      });
      if (claimed.count !== 1) throw new ConflictError('Target bed is no longer available. Select another bed.');
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: 'AVAILABLE' } });

      // Log immutable BedTransferHistory
      const transferLog = await tx.bedTransferHistory.create({
        data: {
          admissionRecordId: admission.id,
          fromBedId: admission.bedId,
          toBedId: targetBed.id,
          reason: body.reason,
          transferredById: actorId,
        },
      });

      // Update admission record bedId
      const updatedAdmission = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: { bedId: targetBed.id },
        include: {
          bed: { include: { room: { include: { ward: true } }, ward: true } },
        },
      });

      return {
        admission: updatedAdmission,
        transferLog,
      };
    });
  },

  /**
   * Append running hospital service or procedure charge (§4.7, D16 p.11)
   */
  async addAdmissionService(admissionId: string, body: AddAdmissionServiceBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
        include: {
          hospitalInvoices: { where: { sourceType: 'ADMISSION' }, include: { lines: true } },
          panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } },
          selfPayEncounter: true,
        },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status !== 'ACTIVE') {
        throw new ValidationError('Cannot add hospital charges to a non-active admission');
      }

      const serviceRate = await tx.serviceRate.findUnique({ where: { id: body.serviceRateId } });
      if (!serviceRate || !serviceRate.isActive) {
        throw new NotFoundError('Service rate not found or inactive');
      }

      // 1 Admission = 1 Single Master Invoice!
      // All services, investigations, procedures, and room charges added for this admission
      // MUST be added to this admission's single invoice (never a separate invoice per department).
      let invoice = admission.hospitalInvoices[0];
      if (!invoice) {
        invoice = await tx.hospitalInvoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(tx),
            sourceType: 'ADMISSION',
            admissionRecordId: admission.id,
            departmentId: admission.departmentId,
            panelPatientId: admission.panelPatientId,
            selfPayEncounterId: admission.selfPayEncounterId,
            subtotal: new Decimal(0),
            discountTotal: new Decimal(0),
            total: new Decimal(0),
            paidTotal: new Decimal(0),
            patientShare: new Decimal(0),
            panelReceivable: new Decimal(0),
            status: 'UNPAID',
            createdById: actorId,
          },
          include: { lines: true, department: true },
        });
      }

      const rate = serviceRate.standardRate;
      const qty = new Decimal(body.quantity);
      const arrangementMode = body.arrangementMode ?? (serviceRate.serviceStream === 'LAB' ? admission.outsourcedFulfillmentMode : 'HOSPITAL_MANAGED');
      const isSelf = arrangementMode === 'SELF';

      let lineGross: Decimal;
      let discountAmount: Decimal;
      let discountReason: string | null;
      let lineNet: Decimal;
      let patientShare: Decimal;
      let panelReceivable: Decimal;
      let coverageSnapshot: Prisma.InputJsonValue | undefined;

      if (isSelf) {
        // Self-arranged by patient outside: Record for clinical tracking, but Rs 0 charge (no ledger debt)
        lineGross = new Decimal(0);
        discountAmount = new Decimal(0);
        discountReason = body.notes ? `[Self-Arranged] ${body.notes}` : '[Self-Arranged]';
        lineNet = new Decimal(0);
        patientShare = new Decimal(0);
        panelReceivable = new Decimal(0);
      } else {
        lineGross = rate.mul(qty);
        // v7.2 §2.5 — Patient Share vs Panel Receivable, same resolution
        // `appointments.service.ts` uses (Panel Service rule → else NOT_COVERED).
        const coverage = resolvePanelCoverage(lineGross, admission.panelPatient?.corporatePanel?.discountRules, serviceRate.id, new Date(), serviceRate.departmentId ?? admission.departmentId, qty, admission.panelPatient);
        if (admission.panelPatient) {
          assertCaseAuthorization(admission.panelPatient.corporatePanel?.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, admission);
        }
        discountAmount = coverage.discountAmount;
        discountReason = coverage.discountReason ?? body.notes ?? null;
        lineNet = lineGross.minus(discountAmount);
        patientShare = coverage.patientShare;
        panelReceivable = coverage.panelReceivable;
        coverageSnapshot = coverage.coverageSnapshot;
      }

      const createdLine = await tx.invoiceLineItem.create({
        data: {
          hospitalInvoiceId: invoice.id,
          serviceRateId: serviceRate.id,
          rateSnapshot: isSelf ? new Decimal(0) : rate,
          quantity: qty,
          lineGross,
          discountAmount,
          discountReason,
          lineNet,
          patientShare,
          panelReceivable, coverageSnapshot,
          performedByStaffId: body.performedByStaffId ?? admission.doctorStaffId,
          isCompleted: true,
        },
        include: { serviceRate: true, performedBy: true },
      });

      // Recalculate this department invoice's totals (never another
      // department's — each stays independently owned per §2.2).
      await recalcInvoiceTotals(tx, invoice, [...invoice.lines, createdLine]);

      // Notify Front Desk that bill has increased
      try {
        const actor = await tx.portalUser.findUnique({
          where: { id: actorId },
          select: { id: true, username: true, staff: { select: { fullName: true } } },
        });
        const actorDisplayName = actor?.staff?.fullName || actor?.username || 'Staff';
        const patientName = admission.panelPatient?.fullName || admission.selfPayEncounter?.fullName || 'Patient';
        const mrNumber = admission.panelPatient?.mrNumber ? ` [MR: ${admission.panelPatient.mrNumber}]` : '';
        const amountStr = Number(lineNet).toLocaleString('en-PK', { maximumFractionDigits: 0 });
        const serviceName = serviceRate.name || 'Clinical Service';

        await notificationsService.createNotification({
          title: `Admission Bill Updated: ${patientName}`,
          message: `Bill updated: Rs. ${amountStr} added for ${serviceName} on ${patientName}${mrNumber} (${admission.admissionNumber}) by ${actorDisplayName} (User ID: ${actor?.username || actorId}).`,
          type: 'info',
          module: 'BILLING',
          targetPortal: 'front-desk',
          actionUrl: '/billing/inpatient',
          referenceId: admission.id,
          createdById: actorId,
        });
      } catch (notifErr) {
        console.error('Failed to notify bill update:', notifErr);
      }

      return createdLine;
    });
  },

  /**
   * Toggle Medication Fulfillment Mode (SELF vs HOSPITAL_MANAGED) — §4.7 Sub-flow C, D16 p.12
   * Requires mandatory reason. Writes immutable MedicationModeHistory audit entry.
   */
  async changeMedicationMode(admissionId: string, body: ChangeMedicationModeBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
        include: { dischargeClearances: true },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status === 'DISCHARGED') {
        throw new ValidationError('Cannot change medication mode of a discharged patient');
      }

      // Record immutable audit history
      const historyEntry = await tx.medicationModeHistory.create({
        data: {
          admissionRecordId: admission.id,
          previousMode: admission.medicationMode,
          newMode: body.mode,
          reason: body.reason,
          changedById: actorId,
        },
      });

      // Update current mode on admission record
      const updated = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: { medicationMode: body.mode },
      });

      // Adjust Pharmacy Clearance requirement based on mode
      const newPharmacyStatus = body.mode === 'HOSPITAL_MANAGED' ? 'PENDING' : 'NOT_APPLICABLE';
      await tx.dualDischargeClearance.updateMany({
        where: {
          admissionRecordId: admission.id,
          clearanceType: 'PHARMACY',
        },
        data: { status: newPharmacyStatus },
      });

      return { admission: updated, historyEntry };
    });
  },

  /**
   * Create medicine request for Standalone Pharmacy queue (§4.7, §8.8)
   * Permitted ONLY when medicationMode is HOSPITAL_MANAGED.
   */
  async createPharmacyRequest(admissionId: string, body: CreatePharmacyRequestBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.medicationMode !== 'HOSPITAL_MANAGED') {
        throw new ValidationError(
          'Pharmacy requests are permitted only when Medication Mode is HOSPITAL_MANAGED. Current mode is SELF.',
        );
      }

      const medicineRequestNumber = await generateMedicineRequestNumber(tx);
      const idempotencyKey = `MED-IDEMP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // v7.2 §2.6 High-Cost Medicine gate — Medicine Line Amount = Quantity
      // × Current Approved Rate; if the configured policy is enabled and any
      // line exceeds its threshold, the whole request is blocked at
      // AUTHORIZATION_REQUIRED instead of proceeding straight to REQUESTED.
      // No policy row / disabled policy → completely unchanged behavior.
      const policy = await tx.highCostMedicinePolicy.findFirst();
      let triggeringLineAmount: Decimal | null = null;
      if (policy?.enabled) {
        const medicines = await tx.medicineMaster.findMany({
          where: { id: { in: body.lines.map((l) => l.medicineId) } },
        });
        const rateById = new Map(medicines.map((m) => [m.id, m.saleRate ?? new Decimal(0)]));
        for (const line of body.lines) {
          const rate = rateById.get(line.medicineId) ?? new Decimal(0);
          const lineAmount = policy.thresholdBasis === 'PER_UNIT' ? rate : rate.mul(line.requestedQuantity);
          if (lineAmount.greaterThan(policy.thresholdAmount)) {
            triggeringLineAmount = lineAmount;
            break;
          }
        }
      }

      const clearance = await tx.pharmacyClearance.create({
        data: {
          admissionRecordId: admission.id,
          medicineRequestNumber,
          idempotencyKey,
          status: triggeringLineAmount ? 'AUTHORIZATION_REQUIRED' : 'REQUESTED',
          requestedById: actorId,
          notes: body.notes,
          lines: {
            create: body.lines.map((l) => ({
              medicineId: l.medicineId,
              requestedQuantity: new Decimal(l.requestedQuantity),
              notes: l.notes,
            })),
          },
        },
        include: {
          lines: { include: { medicine: true } },
          highCostAuthorization: true,
        },
      });

      let highCostAuthorization = null;
      if (triggeringLineAmount && policy) {
        highCostAuthorization = await tx.highCostMedicineAuthorization.create({
          data: {
            pharmacyClearanceId: clearance.id,
            lineTotal: triggeringLineAmount,
            thresholdAmount: policy.thresholdAmount,
            status: 'PENDING',
          },
        });
      }

      // Ensure PHARMACY discharge clearance is set to PENDING
      await tx.dualDischargeClearance.updateMany({
        where: { admissionRecordId: admission.id, clearanceType: 'PHARMACY' },
        data: { status: 'PENDING' },
      });

      return { ...clearance, highCostAuthorization };
    });
  },

  /**
   * High-Cost Medicine Authorization (HMS_V7.2_NEW_REQUIREMENTS.md §2.6) —
   * captures whichever of attendant confirmation / management credential
   * approval the policy requires, evaluates `combinedLogic`, and releases
   * the pharmacy request back to `REQUESTED` only once satisfied. Never a
   * free-typed approver name — management approval validates a real
   * `PortalUser` (ADMIN/SUPER_ADMIN) credential.
   */
  async authorizeHighCostMedicine(
    admissionId: string,
    clearanceId: string,
    body: AuthorizeHighCostMedicineBody,
    actorId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const clearance = await tx.pharmacyClearance.findUnique({
        where: { id: clearanceId },
        include: { highCostAuthorization: true },
      });
      if (!clearance || clearance.admissionRecordId !== admissionId) {
        throw new NotFoundError('Pharmacy request not found for this admission');
      }
      if (!clearance.highCostAuthorization) {
        throw new ValidationError('This pharmacy request has no high-cost authorization pending');
      }
      if (clearance.highCostAuthorization.status !== 'PENDING') {
        throw new ValidationError(`This high-cost authorization is already ${clearance.highCostAuthorization.status}`);
      }

      const policy = await tx.highCostMedicinePolicy.findFirst();
      if (!policy) throw new NotFoundError('High-cost medicine policy not configured');

      const updateData: Record<string, any> = {
        panelAuthorizationRef: body.panelAuthorizationRef,
      };

      let attendantSatisfied = !policy.attendantConfirmationRequired;
      if (policy.attendantConfirmationRequired && body.attendantConfirmed) {
        if (!body.attendantName || !body.attendantRelation) {
          throw new ValidationError('Attendant name and relationship are required to confirm this request');
        }
        updateData.attendantName = body.attendantName;
        updateData.attendantRelation = body.attendantRelation;
        updateData.attendantContact = body.attendantContact;
        updateData.attendantConfirmed = true;
        updateData.attendantConfirmedById = actorId;
        updateData.attendantConfirmedAt = new Date();
        attendantSatisfied = true;
      }

      let managementSatisfied = !policy.managementApprovalRequired;
      if (policy.managementApprovalRequired && body.managementUsername && body.managementPassword) {
        const manager = await tx.portalUser.findUnique({ where: { username: body.managementUsername } });
        if (!manager || manager.status !== 'ACTIVE' || !['ADMIN', 'SUPER_ADMIN'].includes(manager.role)) {
          throw new AuthenticationError('Invalid management credentials');
        }
        const passwordOk = await bcrypt.compare(body.managementPassword, manager.passwordHash);
        if (!passwordOk) throw new AuthenticationError('Invalid management credentials');

        updateData.managementApprovedById = manager.id;
        updateData.managementReason = body.managementReason;
        updateData.managementApprovedAt = new Date();
        managementSatisfied = true;
      }

      const combinedSatisfied =
        policy.combinedLogic === 'ATTENDANT_ONLY'
          ? attendantSatisfied
          : policy.combinedLogic === 'MANAGEMENT_ONLY'
            ? managementSatisfied
            : policy.combinedLogic === 'EITHER'
              ? attendantSatisfied || managementSatisfied
              : attendantSatisfied && managementSatisfied; // BOTH

      if (!combinedSatisfied) {
        const missing = [
          policy.attendantConfirmationRequired && !attendantSatisfied ? 'attendant confirmation' : null,
          policy.managementApprovalRequired && !managementSatisfied ? 'management approval' : null,
        ].filter(Boolean);
        throw new ValidationError(`Authorization incomplete — still missing: ${missing.join(', ') || 'required approval'}`);
      }

      updateData.status = 'AUTHORIZED';
      const updated = await tx.highCostMedicineAuthorization.update({
        where: { id: clearance.highCostAuthorization.id },
        data: updateData,
      });

      await tx.pharmacyClearance.update({ where: { id: clearance.id }, data: { status: 'REQUESTED' } });

      return updated;
    });
  },

  /** Explicit decline — no credential requirement, matches "Rejected/Pending request cannot be dispensed" as the safe default. */
  async rejectHighCostMedicine(admissionId: string, clearanceId: string, body: RejectHighCostMedicineBody) {
    return prisma.$transaction(async (tx) => {
      const clearance = await tx.pharmacyClearance.findUnique({
        where: { id: clearanceId },
        include: { highCostAuthorization: true },
      });
      if (!clearance || clearance.admissionRecordId !== admissionId) {
        throw new NotFoundError('Pharmacy request not found for this admission');
      }
      if (!clearance.highCostAuthorization) {
        throw new ValidationError('This pharmacy request has no high-cost authorization pending');
      }

      const updated = await tx.highCostMedicineAuthorization.update({
        where: { id: clearance.highCostAuthorization.id },
        data: { status: 'REJECTED', managementReason: body.reason },
      });
      await tx.pharmacyClearance.update({ where: { id: clearance.id }, data: { status: 'REJECTED' } });

      return updated;
    });
  },

  /**
   * Grant Clearance stream (§4.7 Sub-flow D, D16 p.13)
   * Streams: CLINICAL, HOSPITAL_BILLING, PHARMACY
   */
  async grantClearance(admissionId: string, body: GrantClearanceBody, actorId: string) {
    // v7.2 §2.4 — Clinical discharge is doctor-credential-only; an Admission
    // user may never self-clear this gate. Use `clinicalDischarge` instead.
    if (body.clearanceType === 'CLINICAL') {
      throw new ValidationError(
        'Clinical discharge requires doctor credential authorization — use the Doctor Discharge Authorization action instead.',
      );
    }

    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
        include: { hospitalInvoices: true, dischargeClearances: true },
      });

      if (!admission) throw new NotFoundError('Admission record not found');

      // If granting HOSPITAL_BILLING clearance, check that the admission has
      // zero outstanding balance ACROSS ALL its department invoices,
      // combined — never per invoice in isolation. A per-invoice check
      // (`inv.total - inv.paidTotal`) ignores unallocated advance/deposit
      // receipts (`hospitalInvoiceId: null` — the admission-creation
      // deposit, or any "additional deposit" collected under §2.11's
      // overpayment case), which would otherwise wrongly block discharge
      // for a patient whose advance already fully covers their balance.
      if (body.clearanceType === 'HOSPITAL_BILLING') {
        const totalCharges = admission.hospitalInvoices.reduce((sum, inv) => sum.plus(inv.total), new Decimal(0));
        const receipts = await tx.paymentReceipt.aggregate({
          where: {
            isReversed: false,
            OR: [
              { admissionRecordId: admission.id },
              { hospitalInvoiceId: { in: admission.hospitalInvoices.map((inv) => inv.id) } },
            ],
          },
          _sum: { amount: true },
        });
        const totalPaid = receipts._sum.amount ?? new Decimal(0);
        if (totalCharges.minus(totalPaid).greaterThan(0)) {
          throw new ValidationError(
            'Cannot grant Hospital Billing clearance: patient has an outstanding balance across their hospital invoices.',
          );
        }
      }

      // Upsert clearance status to CLEARED
      const existing = admission.dischargeClearances.find(
        (c) => c.clearanceType === body.clearanceType,
      );

      let cleared;
      if (existing) {
        cleared = await tx.dualDischargeClearance.update({
          where: { id: existing.id },
          data: {
            status: 'CLEARED',
            clearedById: actorId,
            clearedAt: new Date(),
          },
        });
      } else {
        cleared = await tx.dualDischargeClearance.create({
          data: {
            admissionRecordId: admission.id,
            clearanceType: body.clearanceType,
            status: 'CLEARED',
            clearedById: actorId,
            clearedAt: new Date(),
          },
        });
      }

      await this.reconcileAdmissionDischarge(tx, admission.id, actorId);
      return cleared;
    });
  },

  /**
   * Reconcile / evaluate discharge readiness (§4.7, §8.8, v7.2 §2.4)
   * 1. Checks total charges vs total receipts across this admission. If <= 0, auto-clears HOSPITAL_BILLING.
   * 2. Checks all 3 gates (CLINICAL, HOSPITAL_BILLING, PHARMACY).
   * 3. If all gates are CLEARED or NOT_APPLICABLE, and admission is ACTIVE or DISCHARGE_PENDING:
   *    - Updates admissionRecord.status to 'DISCHARGED', sets dischargedAt = new Date()
   *    - Automatically frees bed to 'AVAILABLE'.
   */
  async reconcileAdmissionDischarge(tx: any, admissionId: string, actorId?: string | null) {
    const admission = await tx.admissionRecord.findUnique({
      where: { id: admissionId },
      include: {
        hospitalInvoices: { where: { sourceType: 'ADMISSION' } },
        dischargeClearances: true,
      },
    });
    if (!admission || admission.status === 'DISCHARGED' || admission.status === 'CANCELLED') {
      return { isDischarged: admission?.status === 'DISCHARGED', isDischargePending: false, admission };
    }

    // 1. Evaluate billing balance across this admission
    // Only the PATIENT's responsibility gates billing clearance — an open panel
    // receivable is the company's debt, realized later through remittances,
    // and never blocks the patient's exit (panel.md §5.3: patient exit is not
    // company settlement).
    const totalCharges = admission.hospitalInvoices.reduce((sum: Decimal, inv: any) => sum.plus(patientResponsibility(inv)), new Decimal(0));
    const invoiceIds = admission.hospitalInvoices.map((inv: any) => inv.id);
    const receipts = await tx.paymentReceipt.aggregate({
      where: {
        isReversed: false,
        OR: [
          { admissionRecordId: admission.id },
          ...(invoiceIds.length > 0 ? [{ hospitalInvoiceId: { in: invoiceIds } }] : []),
        ],
      },
      _sum: { amount: true },
    });
    const totalPaid = receipts._sum.amount ?? new Decimal(0);
    const isBillingSettled = totalCharges.minus(totalPaid).lessThanOrEqualTo(0);

    let billingClearance = admission.dischargeClearances.find((c: any) => c.clearanceType === 'HOSPITAL_BILLING');
    if (isBillingSettled) {
      if (billingClearance && billingClearance.status !== 'CLEARED') {
        billingClearance = await tx.dualDischargeClearance.update({
          where: { id: billingClearance.id },
          data: {
            status: 'CLEARED',
            clearedById: actorId ?? billingClearance.clearedById,
            clearedAt: billingClearance.clearedAt ?? new Date(),
          },
        });
      } else if (!billingClearance) {
        billingClearance = await tx.dualDischargeClearance.create({
          data: {
            admissionRecordId: admission.id,
            clearanceType: 'HOSPITAL_BILLING',
            status: 'CLEARED',
            clearedById: actorId ?? undefined,
            clearedAt: new Date(),
          },
        });
      }
    }

    // Re-fetch clearances to check complete status
    const allClearances = await tx.dualDischargeClearance.findMany({
      where: { admissionRecordId: admission.id },
    });

    const clinicalGate = allClearances.find((c: any) => c.clearanceType === 'CLINICAL');
    const billingGate = allClearances.find((c: any) => c.clearanceType === 'HOSPITAL_BILLING');
    const pharmacyGate = allClearances.find((c: any) => c.clearanceType === 'PHARMACY');

    const clinicalOk = clinicalGate?.status === 'CLEARED';
    const billingOk = billingGate?.status === 'CLEARED' || isBillingSettled;
    const pharmacyOk = !pharmacyGate || pharmacyGate.status === 'CLEARED' || pharmacyGate.status === 'NOT_APPLICABLE';

    // If clinical is cleared but billing is not settled, ensure status is DISCHARGE_PENDING
    if (clinicalOk && !billingOk && admission.status === 'ACTIVE') {
      const updated = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: { status: 'DISCHARGE_PENDING' },
      });
      return { isDischarged: false, isDischargePending: true, admission: updated };
    }

    // If all 3 gates are satisfied: Finalize Discharge!
    if (clinicalOk && billingOk && pharmacyOk) {
      const updated = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: {
          status: 'DISCHARGED',
          dischargedAt: admission.dischargedAt ?? new Date(),
        },
      });

      if (admission.bedId) {
        await tx.bed.update({
          where: { id: admission.bedId },
          data: { status: 'AVAILABLE' },
        });
      }

      return { isDischarged: true, isDischargePending: false, admission: updated };
    }

    return { isDischarged: false, isDischargePending: admission.status === 'DISCHARGE_PENDING', admission };
  },

  /**
   * Doctor Clinical Discharge Authorization (HMS_V7.2_NEW_REQUIREMENTS.md
   * §2.4) — the only way the CLINICAL clearance gate can be cleared. Verifies
   * the doctor's own clinical-authorization credential (separate from
   * `PortalUser` login — a doctor can be Staff-Record-Only and still hold
   * this), captures the Discharge Summary, clears the CLINICAL gate the same
   * way `grantClearance` would (so `getClearances`/`dischargePatient` need no
   * changes), and immediately routes the case to Front Desk by setting
   * status to `DISCHARGE_PENDING` ("Clinically Discharged - Billing
   * Pending", PDF 23 §12's status chain) — HOSPITAL_BILLING/PHARMACY
   * clearance and final discharge are unaffected, still gated as before.
   */
  async clinicalDischarge(admissionId: string, body: ClinicalDischargeBody, actorId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
        include: { dischargeClearances: true, panelPatient: true, selfPayEncounter: true },
      });
      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status !== 'ACTIVE') {
        throw new ValidationError('Clinical discharge is only permitted for an ACTIVE admission');
      }

      const doctor = await findDoctorByDischargeCredential(tx, body.doctorUsername, body.doctorPassword);

      const summary = await tx.dischargeSummary.create({
        data: {
          admissionRecordId: admission.id,
          finalDiagnosis: body.dischargeSummary.finalDiagnosis,
          treatmentSummary: body.dischargeSummary.treatmentSummary,
          conditionAtDischarge: body.dischargeSummary.conditionAtDischarge,
          medicinesInstructions: body.dischargeSummary.medicinesInstructions,
          followUpAdvice: body.dischargeSummary.followUpAdvice,
          followUpDoctorStaffId: body.dischargeSummary.followUpDoctorStaffId,
          followUpDate: body.dischargeSummary.followUpDate,
          additionalNotes: body.dischargeSummary.additionalNotes,
          doctorStaffId: doctor.id,
          doctorNameSnapshot: doctor.fullName,
          doctorDepartmentSnapshot: doctor.department?.name ?? 'Unassigned',
          initiatedById: actorId,
        },
      });

      const existingClinical = admission.dischargeClearances.find((c) => c.clearanceType === 'CLINICAL');
      if (existingClinical) {
        await tx.dualDischargeClearance.update({
          where: { id: existingClinical.id },
          data: { status: 'CLEARED', clearedById: actorId, clearedAt: new Date() },
        });
      } else {
        await tx.dualDischargeClearance.create({
          data: { admissionRecordId: admission.id, clearanceType: 'CLINICAL', status: 'CLEARED', clearedById: actorId, clearedAt: new Date() },
        });
      }

      // Reconcile discharge status: if billing is already paid & pharmacy cleared, finalize immediately; otherwise set DISCHARGE_PENDING
      const reconcile = await this.reconcileAdmissionDischarge(tx, admission.id, actorId);
      const finalAdmission = reconcile.isDischarged
        ? reconcile.admission
        : await tx.admissionRecord.update({
            where: { id: admission.id },
            data: { status: 'DISCHARGE_PENDING' },
            include: { panelPatient: true, selfPayEncounter: true },
          });

      return { admission: finalAdmission, dischargeSummary: summary };
    });

    try {
      const patName = result.admission?.panelPatient?.fullName || result.admission?.selfPayEncounter?.fullName || 'Patient';
      await notificationsService.createNotification({
        title: `Discharge Clearance Needed: ${patName}`,
        message: `Doctor authorized clinical discharge for #${result.admission.admissionNumber}. Ready for final billing & payment clearance at Front Desk.`,
        type: 'DISCHARGE_REQUEST',
        module: 'BILLING',
        targetPortal: 'front-desk',
        actionUrl: `/front-desk?tab=billing_pending_discharges&admissionId=${result.admission.id}`,
        referenceId: result.admission.id,
        createdById: actorId,
      });
    } catch (notifErr) {
      console.error('Failed to dispatch clinical discharge notification:', notifErr);
    }

    return result;
  },

  /**
   * Get 3-Key Discharge Clearances status (§4.7, §8.8)
   */
  async getClearances(admissionId: string) {
    // Reconcile billing clearance if patient has 0 balance
    const admission = await prisma.admissionRecord.findUnique({
      where: { id: admissionId },
      include: {
        hospitalInvoices: { where: { sourceType: 'ADMISSION' } },
        dischargeClearances: true,
      },
    });

    if (admission) {
      const totalCharges = admission.hospitalInvoices.reduce((sum, inv) => sum.plus(inv.total), new Decimal(0));
      const invoiceIds = admission.hospitalInvoices.map((inv) => inv.id);
      const receipts = await prisma.paymentReceipt.aggregate({
        where: {
          isReversed: false,
          OR: [
            { admissionRecordId: admission.id },
            ...(invoiceIds.length > 0 ? [{ hospitalInvoiceId: { in: invoiceIds } }] : []),
          ],
        },
        _sum: { amount: true },
      });
      const totalPaid = receipts._sum.amount ?? new Decimal(0);
      if (totalCharges.minus(totalPaid).lessThanOrEqualTo(0)) {
        const billingGate = admission.dischargeClearances.find((c) => c.clearanceType === 'HOSPITAL_BILLING');
        if (billingGate && billingGate.status !== 'CLEARED') {
          await prisma.dualDischargeClearance.update({
            where: { id: billingGate.id },
            data: { status: 'CLEARED', clearedAt: new Date() },
          });
        }
      }
    }

    const clearances = await prisma.dualDischargeClearance.findMany({
      where: { admissionRecordId: admissionId },
      include: { clearedBy: { select: { id: true, username: true } } },
    });

    const pending = clearances.filter((c) => c.status === 'PENDING').map((c) => c.clearanceType);
    const isDischargeReady = pending.length === 0 && clearances.length > 0;

    return {
      admissionId,
      isDischargeReady,
      pendingClearances: pending,
      clearances,
    };
  },

  /**
   * Attempt Final Discharge — Strict Dual / 3-Key Discharge Gate (§4.7 Sub-flow D, D16 p.13)
   * Formula: Clinical Ready + Hospital Billing Clearance + Pharmacy Clearance = Final Discharge.
   * If any clearance is PENDING, discharge is blocked by the API.
   * On success: marks admission DISCHARGED and automatically frees Bed to AVAILABLE.
   */
  async dischargePatient(admissionId: string, _actorId: string) {
    const result = await prisma.$transaction(async (tx) => {
      // First attempt to reconcile: auto-clears billing if balance is 0, auto-discharges if ready
      const reconcile = await this.reconcileAdmissionDischarge(tx, admissionId, _actorId);
      if (reconcile.isDischarged) {
        return {
          admission: reconcile.admission,
          message: 'Patient discharged successfully. Bed freed to AVAILABLE.',
        };
      }

      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
        include: { dischargeClearances: true, panelPatient: true, selfPayEncounter: true },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status === 'DISCHARGED') {
        throw new ValidationError('Patient is already discharged');
      }

      const clearances = admission.dischargeClearances;
      const pendingClearances = clearances.filter((c) => c.status === 'PENDING').map((c) => c.clearanceType);

      if (pendingClearances.length > 0) {
        throw new ValidationError(
          `Final discharge blocked: The following clearances are still pending: [${pendingClearances.join(', ')}]. All 3 clearance gates must be approved before discharge.`,
        );
      }

      // Set AdmissionRecord to DISCHARGED
      const discharged = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: {
          status: 'DISCHARGED',
          dischargedAt: new Date(),
        },
        include: { panelPatient: true, selfPayEncounter: true },
      });

      // Automatically free assigned Bed to AVAILABLE
      if (admission.bedId) {
        await tx.bed.update({
          where: { id: admission.bedId },
          data: { status: 'AVAILABLE' },
        });
      }

      return {
        admission: discharged,
        message: 'Patient discharged successfully. Bed freed to AVAILABLE.',
      };
    });

    try {
      const patName = result.admission?.panelPatient?.fullName || result.admission?.selfPayEncounter?.fullName || 'Patient';
      await notificationsService.createNotification({
        title: `Discharge Finalized: ${patName}`,
        message: `Discharge and clearance completed for #${result.admission?.admissionNumber || admissionId}. Bed freed to AVAILABLE.`,
        type: 'DISCHARGE_COMPLETED',
        module: 'ADMISSION',
        targetPortal: 'admission',
        actionUrl: '/admission/discharged_patients',
        referenceId: admissionId,
        createdById: _actorId,
      });
    } catch (notifErr) {
      console.error('Failed to dispatch final discharge notification:', notifErr);
    }

    return result;
  },

  /**
   * Consolidated Discharge Summary (§8.8, D16 p.13)
   * Shows hospital charges, payments, medication history, and clearance sign-offs.
   */
  async getDischargeSummary(admissionId: string) {
    const admission = await prisma.admissionRecord.findUnique({
      where: { id: admissionId },
      include: {
        panelPatient: { include: { corporatePanel: true } },
        selfPayEncounter: true,
        department: true,
        doctor: true,
        bed: { include: { room: { include: { ward: true } }, ward: true } },
        bedTransfers: {
          include: {
            fromBed: true,
            toBed: true,
            transferredBy: { select: { username: true } },
          },
        },
        medicationModeHistory: true,
        hospitalInvoices: {
          include: {
            lines: { include: { serviceRate: true, performedBy: true } },
            paymentReceipts: true,
          },
        },
        dischargeClearances: {
          include: { clearedBy: { select: { username: true } } },
        },
      },
    });

    if (!admission) throw new NotFoundError('Admission record not found');

    const totalHospitalBill = admission.hospitalInvoices.reduce(
      (sum, inv) => sum.plus(inv.total),
      new Decimal(0),
    );
    const totalHospitalPaid = admission.hospitalInvoices.reduce(
      (sum, inv) => sum.plus(inv.paidTotal),
      new Decimal(0),
    );
    const hospitalOutstanding = totalHospitalBill.minus(totalHospitalPaid);

    return {
      admissionNumber: admission.admissionNumber,
      status: admission.status,
      admittedAt: admission.admittedAt,
      dischargedAt: admission.dischargedAt,
      patient: admission.panelPatient
        ? {
            type: 'PANEL',
            name: admission.panelPatient.fullName,
            mrNumber: admission.panelPatient.mrNumber,
            panel: admission.panelPatient.corporatePanel.organizationName,
          }
        : {
            type: 'SELF_PAY',
            name: admission.selfPayEncounter?.fullName ?? 'Inpatient',
            phone: admission.selfPayEncounter?.phone,
          },
      doctor: admission.doctor?.fullName ?? null,
      department: admission.department.name,
      diagnosis: admission.diagnosis,
      weightKg: admission.weightKg != null ? Number(admission.weightKg) : null,
      bedSummary: {
        currentBed: admission.bed?.bedNumber ?? null,
        room: admission.bed?.room?.name ?? null,
        ward: admission.bed?.ward?.name ?? admission.bed?.room?.ward?.name ?? null,
        transfersCount: admission.bedTransfers.length,
      },
      hospitalFinancialSummary: {
        totalHospitalBill,
        totalHospitalPaid,
        hospitalOutstanding,
      },
      clearances: admission.dischargeClearances.map((c) => ({
        type: c.clearanceType,
        status: c.status,
        clearedBy: c.clearedBy?.username ?? null,
        clearedAt: c.clearedAt,
      })),
    };
  },

  /**
   * Super Admin "Close Day" action (Hospital Overview) — posts one
   * room/bed accommodation charge line for every currently ACTIVE,
   * bed-assigned admission, so the daily room rate keeps re-billing for
   * as long as the patient stays admitted instead of only charging once
   * at check-in. Nothing here is hardcoded: the rate comes from the
   * occupied Room's own configured daily rate, and idempotency is
   * enforced purely in the database —
   *   - `HospitalDayClose.businessDate` is unique, so the same date can
   *     never be closed twice;
   *   - `AdmissionRoomChargeLog`'s (admission, businessDate) unique
   *     constraint means even a retried/partial run never double-bills
   *     one admission for one day.
   */
  async closeHospitalDay(body: CloseHospitalDayBody, actorId: string) {
    const businessDate = new Date(`${body.businessDate ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

    return prisma.$transaction(async (tx) => {
      const alreadyClosed = await tx.hospitalDayClose.findUnique({ where: { businessDate } });
      if (alreadyClosed) {
        throw new ConflictError(`Hospital day ${businessDate.toISOString().slice(0, 10)} has already been closed.`);
      }

      const activeAdmissions = await tx.admissionRecord.findMany({
        where: { status: 'ACTIVE', bedId: { not: null } },
        include: {
          bed: { include: { room: true } },
          panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } },
          hospitalInvoices: { where: { sourceType: 'ADMISSION' }, include: { lines: true } },
        },
      });

      let admissionsCharged = 0;
      let totalAmountPosted = new Decimal(0);

      for (const admission of activeAdmissions) {
        const dailyRate = admission.bed?.room?.dailyRoomRate ?? null;
        if (!dailyRate || dailyRate.lessThanOrEqualTo(0)) continue; // no configured rate — nothing to bill
        // Missing/expired case authorization skips only THIS admission's
        // daily room charge for today, never the whole hospital day-close
        // batch (this loop runs one shared transaction across every active
        // admission) — the charge posts once the reference is renewed, same
        // as the zero-rate skip above. Rule-level requirement is checked
        // per-service below with the real coverage.matchedRule, not here.
        if (
          admission.panelPatient &&
          caseAuthorizationIneligibilityReasons(!!admission.panelPatient.corporatePanel?.authorizationRequired, admission).length > 0
        ) {
          continue;
        }

        // Belt-and-braces idempotency check — the unique constraint on
        // AdmissionRoomChargeLog is the real guarantee against double-billing,
        // but a Postgres unique-violation here would abort the rest of this
        // transaction (Prisma interactive transactions share one DB
        // transaction), so we check first rather than catch-and-continue.
        const existingLog = await tx.admissionRoomChargeLog.findUnique({
          where: { admissionRecordId_businessDate: { admissionRecordId: admission.id, businessDate } },
        });
        if (existingLog) continue;

        const serviceRate = await getOrCreateRoomChargeServiceRate(tx, admission.departmentId, actorId);

        let invoice = admission.hospitalInvoices[0];
        if (!invoice) {
          invoice = await tx.hospitalInvoice.create({
            data: {
              invoiceNumber: await generateInvoiceNumber(tx),
              sourceType: 'ADMISSION',
              admissionRecordId: admission.id,
              departmentId: admission.departmentId,
              panelPatientId: admission.panelPatientId,
              selfPayEncounterId: admission.selfPayEncounterId,
              subtotal: new Decimal(0),
              discountTotal: new Decimal(0),
              total: new Decimal(0),
              paidTotal: new Decimal(0),
              patientShare: new Decimal(0),
              panelReceivable: new Decimal(0),
              status: 'UNPAID',
              createdById: actorId,
            },
            include: { lines: true },
          });
        }

        const coverage = resolvePanelCoverage(dailyRate, admission.panelPatient?.corporatePanel?.discountRules, serviceRate.id, new Date(), admission.departmentId, new Decimal(1), admission.panelPatient);
        if (
          admission.panelPatient &&
          caseAuthorizationIneligibilityReasons(!!coverage.matchedRule?.preauthorizationRequired, admission).length > 0
        ) {
          continue; // rule specifically requires authorization — skip only this admission's charge for today, not the batch
        }
        const lineNet = dailyRate.minus(coverage.discountAmount);

        const createdLine = await tx.invoiceLineItem.create({
          data: {
            hospitalInvoiceId: invoice.id,
            serviceRateId: serviceRate.id,
            rateSnapshot: dailyRate,
            quantity: new Decimal(1),
            lineGross: dailyRate,
            discountAmount: coverage.discountAmount,
            discountReason: coverage.discountReason,
            lineNet,
            patientShare: coverage.patientShare,
            panelReceivable: coverage.panelReceivable,
            coverageSnapshot: coverage.coverageSnapshot,
            isCompleted: true,
          },
        });

        await tx.admissionRoomChargeLog.create({
          data: {
            admissionRecordId: admission.id,
            businessDate,
            invoiceLineItemId: createdLine.id,
            ratePosted: dailyRate,
          },
        });

        await recalcInvoiceTotals(tx, invoice, [...invoice.lines, createdLine]);

        admissionsCharged += 1;
        totalAmountPosted = totalAmountPosted.plus(lineNet);
      }

      return tx.hospitalDayClose.create({
        data: {
          businessDate,
          admissionsCharged,
          totalAmountPosted,
          closedById: actorId,
        },
      });
    });
  },

  async getDayCloseHistory(limit: number) {
    return prisma.hospitalDayClose.findMany({
      orderBy: { businessDate: 'desc' },
      take: limit,
      include: { closedBy: { select: { username: true, staff: { select: { fullName: true } } } } },
    });
  },
};
