import { assertSelectableService } from '@/shared/serviceClassification';
import { hospitalClock, postingTimeMinutes } from '@/shared/hospitalClock';
import bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';
import { commissionService } from '@/modules/commission/commission.service';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { notificationsService } from '../notifications/notifications.service';
import { AuthenticationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors/AppError';
import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { assertMembershipEligible } from '@/shared/panelMembership';
import { patientPaymentStatus, patientResponsibility } from '@/shared/invoicePaymentStatus';
import { assertCaseAuthorization } from '@/shared/panelAuthorization';
import { pharmacyBridgeClient } from '@/shared/pharmacyBridgeClient';
import { syncRemoteMedicineToLocal } from '@/modules/pharmacy/pharmacy.service';
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
    performedByStaffId?: string | null;
    lineGross: Decimal | null;
    discountAmount: Decimal | null;
    lineNet: Decimal | null;
    patientShare: Decimal | null;
    panelReceivable: Decimal | null;
  }[],
  actorId: string,
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
  if (allLines.some(line => line.performedByStaffId)) {
    await commissionService.syncInvoiceCollections(tx, invoice.id, actorId);
  }
}

/**
 * Look up the optional legacy "Room / Bed Accommodation Charges"
 * ServiceRate for historical panel contracts only —
 * uses a stable service code for automatic accommodation charges.
 * Its own `standardRate` is never billed; each posted line snapshots the
 * admitted room's OWN configured daily rate instead (rates differ per
 * room/bed, one shared rate card wouldn't fit).
 */
async function findLegacyRoomCoverageService(tx: Prisma.TransactionClient, _fallbackDepartmentId: string, _actorId: string) {
  // Optional legacy reference for existing panel contracts only. Never create a master row.
  return tx.serviceRate.findFirst({ where: { code: 'ROOM-ACC' } });
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
  actorId: string,
  existingInvoice?: any,
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

  let invoice = existingInvoice ?? (await tx.hospitalInvoice.findFirst({
    where: { admissionRecordId: admissionId, sourceType: 'ADMISSION' },
    include: { lines: true },
  }));

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

  const serviceRate = await tx.serviceRate.findFirst({ where: { code: { in: ['WARD-PRICE', 'WARD-FIXED'] } } });
  const linesList = await tx.invoiceLineItem.findMany({ where: { hospitalInvoiceId: invoice.id } });
  const alreadyBilled = linesList.some((l: any) => l.billingSource === 'ROOM_BED' && l.descriptionSnapshot === 'Ward Price');
  if (alreadyBilled) {
    return null;
  }

  const panelPatient = invoice.panelPatientId ? await tx.panelPatient.findUnique({
    where: { id: invoice.panelPatientId }, include: { corporatePanel: { include: { discountRules: true } } },
  }) : null;
  const coverage = resolvePanelCoverage(wardFixedRate, panelPatient?.corporatePanel.discountRules, serviceRate?.id ?? 'ROOM_BED', new Date(), ward.departmentId, new Decimal(1), panelPatient);
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
      billingSource: 'ROOM_BED', descriptionSnapshot: 'Ward Price',
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

  await recalcInvoiceTotals(tx, invoice, [...linesList, createdLine], actorId);

  return createdLine;
}

/**
 * One-time fixed Department charge integration.
 * Posts a one-time fixed fee line item if the admission's department has a configured `fixedPrice > 0`.
 * If `fixedPrice` is 0 or null, strictly nothing is billed.
 */
async function postDepartmentFixedChargeIfApplicable(
  tx: Prisma.TransactionClient,
  admissionId: string,
  departmentId: string | null | undefined,
  actorId: string,
  existingInvoice?: any,
) {
  let deptId = departmentId;
  if (!deptId) {
    const admission = await tx.admissionRecord.findUnique({
      where: { id: admissionId },
      select: { departmentId: true },
    });
    deptId = admission?.departmentId ?? undefined;
  }

  if (!deptId || !tx.department?.findUnique) {
    return null;
  }

  const department = await tx.department.findUnique({
    where: { id: deptId },
  });

  if (!department?.fixedPrice || Number(department.fixedPrice) <= 0) {
    return null;
  }

  const deptFixedRate = new Decimal(department.fixedPrice);

  let invoice = existingInvoice ?? (await tx.hospitalInvoice.findFirst({
    where: { admissionRecordId: admissionId, sourceType: 'ADMISSION' },
    include: { lines: true },
  }));

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

  const serviceRate = await tx.serviceRate.findFirst({ where: { code: { in: ['DEPT-PRICE', 'DEPT-FIXED', 'DEPARTMENT-FEE'] } } }).catch(() => null);
  const linesList = await tx.invoiceLineItem.findMany({ where: { hospitalInvoiceId: invoice.id } });
  const descSnapshot = `Department Fee - ${department.name}`;
  const alreadyBilled = linesList.some((l: any) =>
    l.descriptionSnapshot === descSnapshot ||
    l.descriptionSnapshot === 'Department Fee' ||
    (l.descriptionSnapshot && l.descriptionSnapshot.startsWith('Department Fee - '))
  );
  if (alreadyBilled) {
    return null;
  }

  const panelPatient = invoice.panelPatientId ? await tx.panelPatient.findUnique({
    where: { id: invoice.panelPatientId }, include: { corporatePanel: { include: { discountRules: true } } },
  }) : null;
  const coverage = resolvePanelCoverage(
    deptFixedRate,
    panelPatient?.corporatePanel?.discountRules,
    serviceRate?.id ?? 'HOSPITAL_SERVICE',
    new Date(),
    department.id,
    new Decimal(1),
    panelPatient,
  );
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
      billingSource: 'HOSPITAL_SERVICE',
      descriptionSnapshot: descSnapshot,
      rateSnapshot: deptFixedRate,
      quantity: new Decimal(1),
      lineGross: deptFixedRate,
      discountAmount: coverage.discountAmount,
      discountReason: coverage.discountReason,
      lineNet: coverage.eligibleNet,
      patientShare: coverage.patientShare,
      panelReceivable: coverage.panelReceivable,
      coverageSnapshot: coverage.coverageSnapshot,
      isCompleted: true,
    },
  });

  await recalcInvoiceTotals(tx, invoice, [...linesList, createdLine], actorId);

  return createdLine;
}


async function postInitialRoomChargeIfApplicable(tx: Prisma.TransactionClient, admissionId: string, bedId: string, actorId: string, now = new Date(), allowAssignedIntake = false) {
  const businessDate = new Date(hospitalClock(now).date + 'T00:00:00.000Z');
  await tx.$queryRaw`SELECT id FROM admission_records WHERE id = ${admissionId} FOR UPDATE`;
  const bed = await tx.bed.findUnique({ where: { id: bedId }, include: { room: true } });
  const rate = bed?.room?.dailyRoomRate;
  if (!rate || rate.lessThanOrEqualTo(0)) return;
  // Check-in, transfers, manual retries and cron share the same calendar-day guard.
  if (await tx.admissionRoomChargeLog.findFirst({ where: { admissionRecordId: admissionId, businessDate } })) return;
  const admission = await tx.admissionRecord.findUnique({
    where: { id: admissionId },
    include: { panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } } },
  });
  if (!admission) throw new NotFoundError('Admission record not found');
  const eligibleStatus = admission.status === 'ACTIVE' || admission.status === 'DISCHARGE_PENDING' || (allowAssignedIntake && admission.status === 'PLANNED');
  if (!eligibleStatus || admission.bedId !== bedId || admission.dischargedAt) return;
  const invoice = await tx.hospitalInvoice.findFirst({
    where: { admissionRecordId: admissionId, sourceType: 'ADMISSION' }, include: { lines: true },
  });
  if (!invoice) throw new NotFoundError('Admission invoice not found');
  await tx.$queryRaw`SELECT id FROM hospital_invoices WHERE id = ${invoice.id} FOR UPDATE`;
  const freshInvoice = await tx.hospitalInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } });
  const assignment = await tx.bedTransferHistory.findFirst({ where: { admissionRecordId: admissionId, toBedId: bedId }, orderBy: { transferredAt: 'desc' } });
  const service = await findLegacyRoomCoverageService(tx, admission.departmentId, actorId);
  const coverage = resolvePanelCoverage(rate, admission.panelPatient?.corporatePanel?.discountRules, service?.id ?? 'ROOM_BED', new Date(), admission.departmentId, new Decimal(1), admission.panelPatient);
  if (admission.panelPatient) {
    assertCaseAuthorization(admission.panelPatient.corporatePanel?.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, admission);
  }
  const line = await tx.invoiceLineItem.create({
    data: {
      hospitalInvoiceId: invoice.id, billingSource: 'ROOM_BED', descriptionSnapshot: `Room/Bed - ${bed?.room?.name ?? 'Room'} / Bed ${bed?.bedNumber ?? bedId} (${hospitalClock(now).date})`, rateSnapshot: rate,
      quantity: new Decimal(1), lineGross: rate, discountAmount: coverage.discountAmount,
      discountReason: coverage.discountReason, lineNet: rate.minus(coverage.discountAmount),
      patientShare: coverage.patientShare, panelReceivable: coverage.panelReceivable, coverageSnapshot: coverage.coverageSnapshot, isCompleted: true,
    }
  });
  await tx.admissionRoomChargeLog.create({
    data: {
      admissionRecordId: admissionId,
      businessDate,
      bedAssignmentId: assignment?.id ?? `${admissionId}:initial:${bedId}`,
      roomId: bed?.room?.id, bedId, postedBy: actorId,
      roomNameSnapshot: bed?.room?.name, bedNumberSnapshot: bed?.bedNumber,
      invoiceLineItemId: line.id, ratePosted: rate,
    }
  });
  await recalcInvoiceTotals(tx, freshInvoice, [...freshInvoice.lines, line], actorId);
  return line;
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

      if (body.doctorStaffId) {
        const doc = await tx.staff.findUnique({ where: { id: body.doctorStaffId } });
        if (!doc || !doc.isActive) throw new ValidationError('Selected doctor not found or inactive');
        if (doc.category !== 'Doctor') throw new ValidationError('Selected staff is not a Doctor');
      }

      if (body.rmoStaffId) {
        const rmo = await tx.staff.findUnique({ where: { id: body.rmoStaffId } });
        if (!rmo || !rmo.isActive) throw new ValidationError('Selected RMO not found or inactive');
        if (rmo.category !== 'RMO') throw new ValidationError('Selected staff is not an RMO');
      }

      const admissionNumber = await generateAdmissionNumber(tx);

      const admission = await tx.admissionRecord.create({
        data: {
          admissionNumber,
          panelPatientId: body.panelPatientId,
          selfPayEncounterId,
          departmentId,
          doctorStaffId: body.doctorStaffId ?? null,
          rmoStaffId: body.rmoStaffId ?? null,
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
          rmo: true,
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
          doctorStaffId: admission.doctorStaffId,
          rmoStaffId: admission.rmoStaffId,
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
        include: { lines: true },
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
          actorId,
          invoice,
        );
      }

      // Check if department has fixed pricing configured
      await postDepartmentFixedChargeIfApplicable(
        tx,
        admission.id,
        admission.departmentId,
        actorId,
        invoice,
      );

      // Front-desk intake already occupies the selected bed and issues the invoice.
      // Post its first day now; check-in and cron share the same date guard.
      if (body.preferredBedId) {
        await postInitialRoomChargeIfApplicable(tx, admission.id, body.preferredBedId, actorId, new Date(), true);
      }
      return { admission, advanceReceipt, invoice };
    }, { maxWait: 15000, timeout: 30000 });

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
    if (query.status === 'ACTIVE') {
      where.status = { in: ['ACTIVE', 'DISCHARGE_PENDING'] };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.doctorStaffId) where.doctorStaffId = query.doctorStaffId;
    if (query.rmoStaffId) where.rmoStaffId = query.rmoStaffId;

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
        rmo: { select: { id: true, fullName: true, designation: true } },
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
        rmo: true,
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

    if (body.doctorStaffId) {
      const doc = await prisma.staff.findUnique({ where: { id: body.doctorStaffId } });
      if (!doc || !doc.isActive) throw new ValidationError('Selected doctor not found or inactive');
      if (doc.category !== 'Doctor') throw new ValidationError('Selected staff is not a Doctor');
    }

    if (body.rmoStaffId) {
      const rmo = await prisma.staff.findUnique({ where: { id: body.rmoStaffId } });
      if (!rmo || !rmo.isActive) throw new ValidationError('Selected RMO not found or inactive');
      if (rmo.category !== 'RMO') throw new ValidationError('Selected staff is not an RMO');
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
        rmo: true,
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

    // If requestType is FINAL (discharge clearance), ensure admission status routes to DISCHARGE_PENDING
    if (body.requestType === 'FINAL' && admission.status === 'ACTIVE') {
      await prisma.admissionRecord.update({
        where: { id: admission.id },
        data: { status: 'DISCHARGE_PENDING' },
      });
    }

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

      const isDischargeReq = body.requestType === 'FINAL';
      const title = isDischargeReq ? `Discharge Clearance Needed: ${patientName}` : `Payment Requested: ${patientName}`;
      const message = isDischargeReq
        ? `Discharge billing clearance requested for ${patientName}${mrNumber} (${admission.admissionNumber}). Outstanding balance: Rs. ${amountStr}. Please collect clearance payment at Front Desk.`
        : `Payment request of Rs. ${amountStr} raised for ${patientName}${mrNumber} (${admission.admissionNumber}) by ${actorDisplayName} (User ID: ${actor?.username || actorId}).`;
      const actionUrl = `/front-desk/admission_patient_records?admissionId=${admission.id}`;

      await notificationsService.createNotification({
        title,
        message,
        type: 'urgent',
        module: 'BILLING',
        targetPortal: 'front-desk',
        actionUrl,
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
        await tx.bedTransferHistory.create({
          data: {
            admissionRecordId: admission.id, fromBedId: admission.bedId, toBedId: bed.id,
            reason: body.transferReason.trim(), transferredById: actorId,
          }
        });
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
      await postDepartmentFixedChargeIfApplicable(tx, admission.id, admission.departmentId, actorId);
      await postInitialRoomChargeIfApplicable(tx, admission.id, bed.id, actorId);

      // Initialize Dual Discharge Clearances (Clinical + Hospital Billing)
      if (admission.dischargeClearances.length === 0) {
        await tx.dualDischargeClearance.createMany({
          data: [
            { admissionRecordId: admission.id, clearanceType: 'CLINICAL', status: 'PENDING' },
            { admissionRecordId: admission.id, clearanceType: 'HOSPITAL_BILLING', status: 'PENDING' },
          ],
        });
      }

      return updatedAdmission;
    }, { maxWait: 15000, timeout: 30000 });
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
        where: { id: admission.id, status: { in: ['ACTIVE', 'DISCHARGE_PENDING'] }, bedId: admission.bedId },
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

      // A transfer triggers an immediate charge only for the first billable assignment.
      // Otherwise the next daily charge remains gated by the configured posting time.
      if (targetBed.room?.dailyRoomRate?.greaterThan(0) &&
        !await tx.admissionRoomChargeLog.findFirst({ where: { admissionRecordId: admission.id } })) {
        await postInitialRoomChargeIfApplicable(tx, admission.id, targetBed.id, actorId);
      }
      return {
        admission: updatedAdmission,
        transferLog,
      };
    }, { maxWait: 15000, timeout: 30000 });
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
      if (admission.status !== 'ACTIVE' && admission.status !== 'DISCHARGE_PENDING') {
        throw new ValidationError('Cannot add hospital charges to an inactive or discharged admission');
      }

      const serviceRate = await tx.serviceRate.findUnique({ include: { department: { include: { outsourcedProvider: true } } }, where: { id: body.serviceRateId } });
      assertSelectableService(serviceRate, body);
      if (!serviceRate) throw new NotFoundError('Service not found');

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
      const arrangementMode = body.arrangementMode ?? (serviceRate.providerType === 'OUTSOURCED' ? admission.outsourcedFulfillmentMode : 'HOSPITAL_MANAGED');
      const isSelf = arrangementMode === 'SELF';
      const performedByStaffId = body.performedByStaffId ?? admission.doctorStaffId ?? null;

      // Check if this service is already on the invoice so we increment quantity instead of adding a duplicate row
      const existingLine = invoice.lines.find((l) => {
        if (l.billingSource === 'ROOM_BED') return false;
        if (l.serviceRateId !== serviceRate.id) return false;
        const lineIsSelf =
          l.discountReason?.includes('Self-Arranged') ||
          l.discountReason?.includes('Self Arranged') ||
          (new Decimal(l.lineGross).isZero() && new Decimal(l.rateSnapshot).isZero());
        if (lineIsSelf !== isSelf) return false;
        if (performedByStaffId && l.performedByStaffId && l.performedByStaffId !== performedByStaffId) {
          return false;
        }
        return true;
      });

      const effectiveQty = existingLine ? new Decimal(existingLine.quantity).plus(qty) : qty;

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
        discountReason = existingLine?.discountReason || (body.notes ? `[Self-Arranged] ${body.notes}` : '[Self-Arranged]');
        lineNet = new Decimal(0);
        patientShare = new Decimal(0);
        panelReceivable = new Decimal(0);
      } else {
        lineGross = rate.mul(effectiveQty);
        // v7.2 §2.5 — Patient Share vs Panel Receivable, same resolution
        // `appointments.service.ts` uses (Panel Service rule → else NOT_COVERED).
        const coverage = resolvePanelCoverage(lineGross, admission.panelPatient?.corporatePanel?.discountRules, serviceRate.id, new Date(), serviceRate.departmentId ?? admission.departmentId, effectiveQty, admission.panelPatient);
        if (admission.panelPatient) {
          assertCaseAuthorization(admission.panelPatient.corporatePanel?.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, admission);
        }
        discountAmount = coverage.discountAmount;
        discountReason = coverage.discountReason ?? body.notes ?? existingLine?.discountReason ?? null;
        lineNet = lineGross.minus(discountAmount);
        patientShare = coverage.patientShare;
        panelReceivable = coverage.panelReceivable;
        coverageSnapshot = coverage.coverageSnapshot;
      }

      let activeLine: any;
      if (existingLine) {
        activeLine = await tx.invoiceLineItem.update({
          where: { id: existingLine.id },
          data: {
            rateSnapshot: isSelf ? new Decimal(0) : rate,
            quantity: effectiveQty,
            lineGross,
            discountAmount,
            discountReason,
            lineNet,
            patientShare,
            panelReceivable,
            coverageSnapshot,
            performedByStaffId: existingLine.performedByStaffId ?? performedByStaffId,
            isCompleted: true,
          },
          include: { serviceRate: true, performedBy: true },
        });

        const otherLines = invoice.lines.filter((l) => l.id !== existingLine.id);
        await recalcInvoiceTotals(tx, invoice, [...otherLines, activeLine], actorId);
      } else {
        activeLine = await tx.invoiceLineItem.create({
          data: {
            hospitalInvoiceId: invoice.id,
            serviceRateId: serviceRate.id,
            billingSource: serviceRate.billingSource, descriptionSnapshot: serviceRate.name,
            rateSnapshot: isSelf ? new Decimal(0) : rate,
            quantity: qty,
            lineGross,
            discountAmount,
            discountReason,
            lineNet,
            patientShare,
            panelReceivable, coverageSnapshot,
            performedByStaffId,
            isCompleted: true,
          },
          include: { serviceRate: true, performedBy: true },
        });

        await recalcInvoiceTotals(tx, invoice, [...invoice.lines, activeLine], actorId);
      }

      // If a billable service charge was added, revert any existing HOSPITAL_BILLING clearance to PENDING
      if (!isSelf && lineNet.greaterThan(0) && tx.dualDischargeClearance?.findFirst) {
        try {
          const billingClearance = await tx.dualDischargeClearance.findFirst({
            where: { admissionRecordId: admission.id, clearanceType: 'HOSPITAL_BILLING' },
          });
          if (billingClearance && billingClearance.status === 'CLEARED') {
            await tx.dualDischargeClearance.update({
              where: { id: billingClearance.id },
              data: { status: 'PENDING', clearedById: null, clearedAt: null },
            });
          }
        } catch {}
      }

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
          actionUrl: '/front-desk/admission_patient_records',
          referenceId: admission.id,
          createdById: actorId,
        });
      } catch (notifErr) {
        console.error('Failed to notify bill update:', notifErr);
      }

      return activeLine;
    }, { maxWait: 15000, timeout: 30000 });
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
   * Helper: Dispatches an authorized or pending pharmacy clearance request to the Standalone Pharmacy API.
   */
  async dispatchToPharmacyBridge(
    clearanceId: string,
    highCostMeta?: { isHighCost?: boolean; isApproved?: boolean; highCostStatus?: string },
  ) {
    try {
      const clearance = (await prisma.pharmacyClearance.findUnique({
        where: { id: clearanceId },
        include: {
          admissionRecord: {
            include: {
              panelPatient: { select: { fullName: true } },
              selfPayEncounter: { select: { fullName: true } },
            },
          },
          lines: { include: { medicine: true } },
          requestedBy: { select: { username: true, displayName: true } },
          highCostAuthorization: true,
        },
      })) as any;

      if (!clearance) return;
      const patientName =
        clearance.admissionRecord?.panelPatient?.fullName ||
        clearance.admissionRecord?.selfPayEncounter?.fullName ||
        'Patient';

      const isHighCost = highCostMeta?.isHighCost ?? Boolean(clearance.highCostAuthorization);
      const isApproved =
        highCostMeta?.isApproved ??
        (clearance.status !== 'AUTHORIZATION_REQUIRED' &&
          (!clearance.highCostAuthorization || clearance.highCostAuthorization?.status === 'AUTHORIZED'));
      const highCostStatus =
        highCostMeta?.highCostStatus ??
        (clearance.highCostAuthorization?.status || (isHighCost ? 'PENDING_APPROVAL' : 'NOT_REQUIRED'));

      await pharmacyBridgeClient.dispatchMedicineRequest({
        externalAdmissionRef: clearance.admissionRecord.admissionNumber,
        externalRequestRef: clearance.medicineRequestNumber,
        patientNameSnapshot: patientName,
        urgency: isHighCost && !isApproved ? 'HIGH_COST_PENDING' : 'ROUTINE',
        requestedByExternal: clearance.requestedBy?.displayName || clearance.requestedBy?.username || 'Doctor',
        isHighCost,
        isApproved,
        highCostStatus,
        lines: (clearance.lines || []).map((l: any) => ({
          medicineId: l.medicineId,
          requestedQuantity: Number(l.requestedQuantity),
          notes: l.notes ? `[HMS_LINE:${l.id}] ${l.notes}` : `[HMS_LINE:${l.id}]`,
        })),
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[dispatchToPharmacyBridge] Outbound dispatch warning (queued in HMS for sync):', err?.message || err);
      // Keep request marked for sync retry
      await prisma.pharmacyClearance
        .update({
          where: { id: clearanceId },
          data: {
            notes: 'QUEUED_FOR_PHARMACY_SYNC',
          },
        })
        .catch(() => null);
    }
  },

  /**
   * Create medicine request for Standalone Pharmacy queue (§4.7, §8.8)
   * Permitted ONLY when medicationMode is HOSPITAL_MANAGED.
   */
  async createPharmacyRequest(admissionId: string, body: CreatePharmacyRequestBody, actorId: string) {
    // 1. Validate admission exists and is HOSPITAL_MANAGED before doing external sync or opening transaction
    const admissionCheck = await prisma.admissionRecord.findUnique({
      where: { id: admissionId },
    });
    if (!admissionCheck) throw new NotFoundError('Admission record not found');
    if (admissionCheck.medicationMode !== 'HOSPITAL_MANAGED') {
      throw new ValidationError(
        'Pharmacy requests are permitted only when Medication Mode is HOSPITAL_MANAGED. Current mode is SELF.',
      );
    }

    // 2. Pre-verify and sync all requested medicines into local MedicineMaster
    for (const line of body.lines) {
      let localMed = await prisma.medicineMaster.findUnique({ where: { id: line.medicineId } });
      if (!localMed) {
        // Fetch from Standalone Pharmacy bridge and sync
        const remoteMeds = await pharmacyBridgeClient.getMedicines().catch(() => null);
        const remoteMed = Array.isArray(remoteMeds) ? remoteMeds.find((rm: any) => rm.id === line.medicineId) : null;
        if (remoteMed) {
          await syncRemoteMedicineToLocal(remoteMed);
          localMed = await prisma.medicineMaster.findUnique({ where: { id: line.medicineId } });
        }
      }
      if (!localMed) {
        throw new ValidationError(`Medicine with ID ${line.medicineId} not found in Pharmacy catalog.`);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
      });

      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.medicationMode !== 'HOSPITAL_MANAGED') {
        throw new ValidationError(
          'Pharmacy requests are permitted only when Medication Mode is HOSPITAL_MANAGED. Current mode is SELF.',
        );
      }

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

      // Reuse the admission's primary pharmacy clearance if one already exists (§Consolidated Inpatient Requisitions)
      const existingClearance = await tx.pharmacyClearance.findFirst({
        where: { admissionRecordId: admission.id },
        orderBy: { requestedAt: 'asc' },
        include: { lines: true },
      });

      let clearance: any;
      if (existingClearance) {
        for (const l of body.lines) {
          const packagingNote =
            l.unit && l.conversionToBase && l.conversionToBase > 1
              ? `${l.saleUnitQuantity || Math.round(l.requestedQuantity / l.conversionToBase)} ${l.unit} (${l.requestedQuantity} base units)`
              : l.unit
                ? `${l.requestedQuantity} ${l.unit}`
                : null;
          const finalNotes = packagingNote
            ? l.notes && l.notes !== packagingNote
              ? `${packagingNote} — ${l.notes}`
              : packagingNote
            : l.notes;

          await tx.pharmacyClearanceLine.create({
            data: {
              pharmacyClearanceId: existingClearance.id,
              medicineId: l.medicineId,
              requestedQuantity: new Decimal(l.requestedQuantity),
              notes: finalNotes,
            },
          });
        }

        clearance = await tx.pharmacyClearance.update({
          where: { id: existingClearance.id },
          data: {
            status: triggeringLineAmount ? 'AUTHORIZATION_REQUIRED' : 'REQUESTED',
            requestedById: actorId,
            requestedAt: new Date(),
            notes: body.notes
              ? (existingClearance.notes ? `${existingClearance.notes} | ${body.notes}` : body.notes)
              : existingClearance.notes,
          },
          include: {
            lines: { include: { medicine: true } },
            highCostAuthorization: true,
          },
        });
      } else {
        const medicineRequestNumber = await generateMedicineRequestNumber(tx);
        const idempotencyKey = `MED-IDEMP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        clearance = await tx.pharmacyClearance.create({
          data: {
            admissionRecordId: admission.id,
            medicineRequestNumber,
            idempotencyKey,
            status: triggeringLineAmount ? 'AUTHORIZATION_REQUIRED' : 'REQUESTED',
            requestedById: actorId,
            notes: body.notes,
            lines: {
              create: body.lines.map((l) => {
                const packagingNote =
                  l.unit && l.conversionToBase && l.conversionToBase > 1
                    ? `${l.saleUnitQuantity || Math.round(l.requestedQuantity / l.conversionToBase)} ${l.unit} (${l.requestedQuantity} base units)`
                    : l.unit
                      ? `${l.requestedQuantity} ${l.unit}`
                      : null;
                const finalNotes = packagingNote
                  ? l.notes && l.notes !== packagingNote
                    ? `${packagingNote} — ${l.notes}`
                    : packagingNote
                  : l.notes;

                return {
                  medicineId: l.medicineId,
                  requestedQuantity: new Decimal(l.requestedQuantity),
                  notes: finalNotes,
                };
              }),
            },
          },
          include: {
            lines: { include: { medicine: true } },
            highCostAuthorization: true,
          },
        });
      }

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

      // Only set PHARMACY discharge clearance to PENDING if unpaid dispensed medications exist
      const isBlocked = await pharmacyDischargeBlocked(tx, admission.id);
      if (isBlocked) {
        await tx.dualDischargeClearance.updateMany({
          where: { admissionRecordId: admission.id, clearanceType: 'PHARMACY' },
          data: { status: 'PENDING' },
        });
      }

      return { ...clearance, highCostAuthorization };
    }, { maxWait: 15000, timeout: 30000 });

    if (result.status === 'REQUESTED' || result.status === 'AUTHORIZATION_REQUIRED') {
      await this.dispatchToPharmacyBridge(result.id).catch((err: any) => {
        // eslint-disable-next-line no-console
        console.error('[createPharmacyRequest] Bridge dispatch error:', err?.message || err);
      });
    }

    return result;
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
    const result = await prisma.$transaction(async (tx) => {
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

      if (!managementSatisfied && actorId) {
        const currentActor = await tx.portalUser.findUnique({ where: { id: actorId } });
        if (currentActor && ['ADMIN', 'SUPER_ADMIN'].includes(currentActor.role)) {
          updateData.managementApprovedById = currentActor.id;
          updateData.managementReason = body.managementReason || 'Approved via Admin Panel';
          updateData.managementApprovedAt = new Date();
          managementSatisfied = true;
        }
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

    this.dispatchToPharmacyBridge(clearanceId).catch(() => null);

    // Notify Pharmacy Bridge of approval to unblock dispensing automatically
    pharmacyBridgeClient.notifyHighCostApproval({
      externalRequestRef: clearanceId,
      isApproved: true,
      approvedBy: result.managementApprovedById ? 'HMS Management' : 'Attendant Confirmed',
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[authorizeHighCostMedicine] Failed to notify pharmacy bridge:', err?.message || err);
    });

    return result;
  },

  /** Explicit decline — no credential requirement, matches "Rejected/Pending request cannot be dispensed" as the safe default. */
  async rejectHighCostMedicine(admissionId: string, clearanceId: string, body: RejectHighCostMedicineBody) {
    const result = await prisma.$transaction(async (tx) => {
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

    // Notify Pharmacy Bridge of rejection to block dispensing permanently
    pharmacyBridgeClient.notifyHighCostApproval({
      externalRequestRef: clearanceId,
      isApproved: false,
      rejectionReason: body.reason,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[rejectHighCostMedicine] Failed to notify pharmacy bridge:', err?.message || err);
    });

    return result;
  },

  /**
   * List all high-cost medicine authorizations that are pending management/guardian approval.
   */
  async listPendingHighCostAuthorizations() {
    return prisma.highCostMedicineAuthorization.findMany({
      where: { status: 'PENDING' },
      include: {
        pharmacyClearance: {
          include: {
            admissionRecord: {
              include: {
                panelPatient: {
                  include: {
                    corporatePanel: true,
                  },
                },
                selfPayEncounter: true,
                bed: {
                  include: {
                    room: {
                      include: {
                        ward: true,
                      },
                    },
                  },
                },
                doctor: {
                  select: { id: true, fullName: true, designation: true, category: true },
                },
              },
            },
            lines: {
              include: {
                medicine: true,
              },
            },
            requestedBy: {
              select: { id: true, displayName: true, username: true, role: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
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
        include: {
          hospitalInvoices: true,
          dischargeClearances: true,
          panelPatient: true,
          selfPayEncounter: true,
        },
      });

      if (!admission) throw new NotFoundError('Admission record not found');

      // If granting HOSPITAL_BILLING clearance, check that the admission has
      // zero outstanding balance ACROSS ALL its department invoices,
      // combined — never per invoice in isolation.
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
        const outstanding = totalCharges.minus(totalPaid);

        if (outstanding.greaterThan(0)) {
          // Patient has outstanding balance.
          // Route clearance request to Front Desk with high-priority notification & PENDING payment request.
          const formattedAmount = Number(outstanding).toLocaleString('en-PK', { maximumFractionDigits: 0 });

          if (prisma.admissionPaymentRequest) {
            try {
              const existingPendingReq = await prisma.admissionPaymentRequest.findFirst({
                where: {
                  admissionRecordId: admission.id,
                  status: { in: ['PENDING', 'PARTIALLY_FULFILLED'] },
                },
              });

              if (existingPendingReq) {
                await prisma.admissionPaymentRequest.update({
                  where: { id: existingPendingReq.id },
                  data: {
                    requestedAmount: outstanding,
                    requestType: 'FINAL',
                    notes: `Discharge billing clearance requested. Outstanding balance: Rs. ${formattedAmount}.`,
                  },
                });
              } else {
                await prisma.admissionPaymentRequest.create({
                  data: {
                    admissionRecordId: admission.id,
                    requestType: 'FINAL',
                    requestedAmount: outstanding,
                    notes: `Discharge billing clearance requested. Outstanding balance: Rs. ${formattedAmount}.`,
                    status: 'PENDING',
                    requestedById: actorId,
                  },
                });
              }
            } catch (pReqErr) {
              console.error('Failed to create/update admissionPaymentRequest:', pReqErr);
            }
          }



          const existingBillingClearance = admission.dischargeClearances.find(
            (c) => c.clearanceType === 'HOSPITAL_BILLING',
          );
          if (existingBillingClearance) {
            await tx.dualDischargeClearance.update({
              where: { id: existingBillingClearance.id },
              data: { status: 'PENDING', clearedById: null, clearedAt: null },
            });
          } else {
            await tx.dualDischargeClearance.create({
              data: {
                admissionRecordId: admission.id,
                clearanceType: 'HOSPITAL_BILLING',
                status: 'PENDING',
              },
            });
          }

          const patientName = admission.panelPatient?.fullName || admission.selfPayEncounter?.fullName || 'Patient';
          const mrNum = admission.panelPatient?.mrNumber ? ` [MR: ${admission.panelPatient.mrNumber}]` : '';

          try {
            await notificationsService.createNotification({
              title: `Discharge Clearance Needed: ${patientName}`,
              message: `Discharge billing clearance requested for ${patientName}${mrNum} (${admission.admissionNumber}). Outstanding balance: Rs. ${formattedAmount}. Please clear payment at Front Desk.`,
              type: 'urgent',
              module: 'BILLING',
              targetPortal: 'front-desk',
              actionUrl: `/front-desk/admission_patient_records?admissionId=${admission.id}`,
              referenceId: admission.id,
              createdById: actorId,
            });
          } catch (notifErr) {
            console.error('Failed to notify Front Desk of discharge clearance request:', notifErr);
          }

          throw new ValidationError(
            `Cannot grant Hospital Billing clearance: patient has an outstanding balance across their hospital invoices (Rs. ${formattedAmount}). Clearance request and notification have been sent to Front Desk.`,
          );
        }
      }

      if (body.clearanceType === 'PHARMACY' && await pharmacyDischargeBlocked(tx, admissionId)) {
        throw new ValidationError('Cannot grant Pharmacy clearance: patient has unpaid dispensed medications that must be cleared at Front Desk');
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
    }, { maxWait: 15000, timeout: 30000 });
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
        hospitalInvoices: { where: { sourceType: 'ADMISSION', status: { not: 'VOID' } } },
        dischargeClearances: true,
      },
    });
    if (!admission || admission.status === 'DISCHARGED' || admission.status === 'CANCELLED') {
      return { isDischarged: admission?.status === 'DISCHARGED', isDischargePending: false, admission };
    }

    // 1. Evaluate billing balance across this admission (patient responsibility only)
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
    } else {
      if (billingClearance && billingClearance.status === 'CLEARED') {
        billingClearance = await tx.dualDischargeClearance.update({
          where: { id: billingClearance.id },
          data: {
            status: 'PENDING',
            clearedById: null,
            clearedAt: null,
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

    // Only dispensed, unpaid medications block discharge.
    const isPharmacyBlocked = await pharmacyDischargeBlocked(tx, admission.id);

    // Clinical authorization strictly requires doctor authorization and a recorded discharge summary form
    const hasDischargeSummary = tx.dischargeSummary?.findFirst
      ? await tx.dischargeSummary.findFirst({
          where: { admissionRecordId: admission.id },
        })
      : true;
    const clinicalOk = clinicalGate?.status === 'CLEARED' && !!hasDischargeSummary;
    const billingOk = isBillingSettled && billingGate?.status === 'CLEARED' && !isPharmacyBlocked;

    // If clinical is cleared but billing is not settled (including unpaid pharmacy dues), ensure status is DISCHARGE_PENDING
    if (clinicalOk && !billingOk && admission.status === 'ACTIVE') {
      const updated = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: { status: 'DISCHARGE_PENDING' },
      });
      return { isDischarged: false, isDischargePending: true, admission: updated };
    }

    // If both Clinical and Hospital Billing gates are satisfied: Finalize Discharge!
    if (clinicalOk && billingOk) {
      const updated = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: {
          status: 'DISCHARGED',
          dischargedAt: admission.dischargedAt ?? new Date(),
        },
      });

      // Auto-cancel any lingering unfulfilled/undispensed pharmacy requests for this admission
      if (typeof tx.pharmacyClearance?.updateMany === 'function') {
        await tx.pharmacyClearance.updateMany({
          where: {
            admissionRecordId: admission.id,
            status: { in: ['REQUESTED', 'ACCEPTED', 'DISPENSING', 'INTEGRATION_ERROR', 'AUTHORIZATION_REQUIRED'] },
          },
          data: {
            status: 'REJECTED',
            notes: 'Auto-cancelled upon patient discharge — unfulfilled',
          },
        });
      }

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
        include: {
          dischargeClearances: true,
          panelPatient: true,
          selfPayEncounter: true,
          hospitalInvoices: { where: { sourceType: 'ADMISSION', status: { not: 'VOID' } } },
        },
      });
      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status !== 'ACTIVE' && admission.status !== 'DISCHARGE_PENDING') {
        throw new ValidationError('Clinical discharge is only permitted for an active admission');
      }



      const doctor = await findDoctorByDischargeCredential(tx, body.doctorUsername, body.doctorPassword);

      const summary = await tx.dischargeSummary.create({
        data: {
          admissionRecordId: admission.id,
          finalDiagnosis: body.dischargeSummary.finalDiagnosis,
          associatedDiagnosisA: body.dischargeSummary.associatedDiagnosisA ?? null,
          associatedDiagnosisB: body.dischargeSummary.associatedDiagnosisB ?? null,
          history: body.dischargeSummary.history ?? null,
          examination: body.dischargeSummary.examination ?? null,
          investigations: body.dischargeSummary.investigations ?? null,
          treatmentSummary: body.dischargeSummary.treatmentSummary || '',
          prescriptionOnDischarge: body.dischargeSummary.prescriptionOnDischarge ?? body.dischargeSummary.medicinesInstructions ?? null,
          medicinesInstructions: body.dischargeSummary.medicinesInstructions || body.dischargeSummary.prescriptionOnDischarge || '',
          conditionAtDischarge: body.dischargeSummary.conditionAtDischarge || 'Stable & Ambulatory',
          followUpAdvice: body.dischargeSummary.followUpAdvice ?? null,
          followUpDoctorStaffId: body.dischargeSummary.followUpDoctorStaffId ?? null,
          followUpDate: body.dischargeSummary.followUpDate ?? null,
          additionalNotes: body.dischargeSummary.additionalNotes ?? null,
          nicu: body.dischargeSummary.nicu ?? null,
          weightOnAdmission: body.dischargeSummary.weightOnAdmission ?? (admission.weightKg ? String(admission.weightKg) : null),
          weightOnDischarge: body.dischargeSummary.weightOnDischarge ?? null,
          finalOutcome: body.dischargeSummary.finalOutcome || 'Discharge',
          dischargeDate: body.dischargeSummary.dischargeDate ?? new Date(),
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
    }, { maxWait: 15000, timeout: 30000 });

    try {
      const patName = result.admission?.panelPatient?.fullName || result.admission?.selfPayEncounter?.fullName || 'Patient';
      await notificationsService.createNotification({
        title: `Discharge Clearance Needed: ${patName}`,
        message: `Doctor authorized clinical discharge for #${result.admission.admissionNumber}. Ready for final billing & payment clearance at Front Desk.`,
        type: 'DISCHARGE_REQUEST',
        module: 'BILLING',
        targetPortal: 'front-desk',
        actionUrl: '/front-desk/billing_pending_discharges',
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

    const rawClearances = await prisma.dualDischargeClearance.findMany({
      where: { admissionRecordId: admissionId },
      include: { clearedBy: { select: { id: true, username: true } } },
    });

    // Consolidate pharmacy gate into hospital billing: only CLINICAL and HOSPITAL_BILLING are exposed
    const clearances = rawClearances.filter((c) => c.clearanceType !== 'PHARMACY');
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

      if (!reconcile.admission) throw new NotFoundError('Admission record not found');

      const admission = reconcile.admission;
      const totalCharges = (admission.hospitalInvoices || []).reduce((sum: Decimal, inv: any) => sum.plus(patientResponsibility(inv)), new Decimal(0));
      const invoiceIds = (admission.hospitalInvoices || []).map((inv: any) => inv.id);
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
      const outstanding = totalCharges.minus(totalPaid);

      const isPharmacyBlocked = await pharmacyDischargeBlocked(tx, admission.id);
      if (outstanding.greaterThan(0) || isPharmacyBlocked) {
        const formattedAmount = Number(outstanding).toLocaleString('en-PK', { maximumFractionDigits: 0 });
        const patientName = admission.panelPatient?.fullName || admission.selfPayEncounter?.fullName || 'Patient';
        const mrNum = admission.panelPatient?.mrNumber ? ` [MR: ${admission.panelPatient.mrNumber}]` : '';

        const reason = isPharmacyBlocked && outstanding.lessThanOrEqualTo(0)
          ? 'Final discharge blocked: patient has unpaid dispensed medications from pharmacy. Please collect payment at Front Desk.'
          : `Final discharge blocked: patient has an outstanding balance across hospital invoices (Rs. ${formattedAmount}). Clearance request and notification have been sent to Front Desk.`;

        setTimeout(async () => {
          try {
            await notificationsService.createNotification({
              title: `Discharge Clearance Needed: ${patientName}`,
              message: `Discharge attempted for ${patientName}${mrNum} (${admission.admissionNumber}) but ${reason} Please collect payment at Front Desk so discharge can proceed.`,
              type: 'urgent',
              module: 'BILLING',
              targetPortal: 'front-desk',
              actionUrl: '/front-desk/billing_pending_discharges',
              referenceId: admission.id,
              createdById: _actorId,
            });
          } catch (e) {
            console.error('Failed to notify Front Desk on blocked discharge:', e);
          }
        }, 0);

        throw new ValidationError(reason);
      }

      // 2. Strict Doctor / RMO Clinical Authorization & Summary check:
      // Front Desk payment settlement alone must NEVER discharge a patient without doctor authorization.
      const allClearances = await tx.dualDischargeClearance.findMany({
        where: { admissionRecordId: admission.id },
      });
      const clinicalGate = allClearances.find((c: any) => c.clearanceType === 'CLINICAL');
      const dischargeSummary = await tx.dischargeSummary.findFirst({
        where: { admissionRecordId: admission.id },
      });
      const clinicalOk = clinicalGate?.status === 'CLEARED' && !!dischargeSummary;

      if (!clinicalOk) {
        throw new ValidationError(
          'Cannot discharge patient: Doctor / RMO Clinical Discharge Authorization is required. The attending doctor must complete the discharge authorization and summary form in the admission portal first.',
        );
      }

      // Both Doctor Authorization & Billing Settlement are satisfied: clear billing gate, discharge patient, and free bed
      await tx.dualDischargeClearance.updateMany({
        where: { admissionRecordId: admission.id, clearanceType: 'HOSPITAL_BILLING', status: 'PENDING' },
        data: { status: 'CLEARED', clearedById: _actorId, clearedAt: new Date() },
      });

      const updated = await tx.admissionRecord.update({
        where: { id: admission.id },
        data: {
          status: 'DISCHARGED',
          dischargedAt: new Date(),
        },
      });

      if (admission.bedId) {
        await tx.bed.update({
          where: { id: admission.bedId },
          data: { status: 'AVAILABLE' },
        });
      }

      return {
        admission: updated,
        message: 'Patient discharged successfully. Bed freed to AVAILABLE.',
      };
    }, { maxWait: 15000, timeout: 30000 });

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
   * Revert a DISCHARGE_PENDING admission back to ACTIVE inpatient stay.
   */
  async resumeActiveStay(admissionId: string, _actorId: string) {
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({
        where: { id: admissionId },
      });
      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.status === 'DISCHARGED' || admission.status === 'CANCELLED') {
        throw new ValidationError('Cannot resume an already discharged or cancelled admission');
      }

      const updated = await tx.admissionRecord.update({
        where: { id: admissionId },
        data: { status: 'ACTIVE' },
      });

      // Cancel any pending FINAL payment requests
      await tx.admissionPaymentRequest.updateMany({
        where: { admissionRecordId: admissionId, requestType: 'FINAL', status: 'PENDING' },
        data: { status: 'CANCELLED', notes: 'Discharge request cancelled; resumed active inpatient care.' },
      });

      // Reset billing clearance to PENDING if exists
      await tx.dualDischargeClearance.updateMany({
        where: { admissionRecordId: admissionId, clearanceType: 'HOSPITAL_BILLING' },
        data: { status: 'PENDING', clearedById: null, clearedAt: null },
      });

      return { admission: updated, message: 'Admission resumed to ACTIVE status.' };
    });
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
        rmo: true,
        dischargeSummary: {
          include: {
            doctor: { select: { id: true, fullName: true, designation: true, pmdcNumber: true } },
          },
        },
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
          fatherGuardianName: admission.panelPatient.guardianName ?? null,
          age: admission.panelPatient.dob ? Math.max(0, new Date().getFullYear() - new Date(admission.panelPatient.dob).getFullYear()) : null,
          gender: admission.panelPatient.gender ?? null,
          address: admission.panelPatient.address ?? null,
          phone: admission.panelPatient.phone ?? null,
          mrNumber: admission.panelPatient.mrNumber,
          panel: admission.panelPatient.corporatePanel.organizationName,
          cnic: admission.panelPatient.cnicOrPassport ?? null,
        }

        : {
          type: 'SELF_PAY',
          name: admission.selfPayEncounter?.fullName ?? 'Inpatient',
          fatherGuardianName: admission.selfPayEncounter?.guardianName ?? null,
          age: admission.selfPayEncounter?.dob ? Math.max(0, new Date().getFullYear() - new Date(admission.selfPayEncounter.dob).getFullYear()) : null,
          gender: admission.selfPayEncounter?.gender ?? null,
          address: admission.selfPayEncounter?.address ?? null,
          phone: admission.selfPayEncounter?.phone ?? null,
          cnic: admission.selfPayEncounter?.cnicOrPassport ?? null,
        },
      doctor: admission.doctor?.fullName ?? null,
      rmo: admission.rmo?.fullName ?? null,
      department: admission.department.name,
      diagnosis: admission.diagnosis,
      weightKg: admission.weightKg != null ? Number(admission.weightKg) : null,
      dischargeSummary: admission.dischargeSummary ?? null,
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


  // Manual recovery and cron share the same daily posting engine.
  async closeHospitalDay(body: CloseHospitalDayBody, actorId: string, now = new Date()) {
    const clock = hospitalClock(now);
    if (body.businessDate && body.businessDate !== clock.date) {
      throw new ValidationError('Only today in Asia/Karachi can be posted; historical tariffs must not be guessed.');
    }
    const profile = await prisma.hospitalProfile.findFirst();
    const config = (profile?.extendedProfile ?? {}) as Record<string, unknown>;
    if (clock.minutes < postingTimeMinutes(config.ipdDailyRoomBedPostingTime ?? '11:00 AM')) {
      throw new ValidationError('IPD daily posting time has not passed in Asia/Karachi');
    }
    const businessDate = new Date(clock.date + 'T00:00:00.000Z');
    const admissions = await prisma.admissionRecord.findMany({ where: { status: { in: ['ACTIVE', 'DISCHARGE_PENDING'] }, bedId: { not: null }, roomChargeLogs: { none: { businessDate } }, bed: { room: { dailyRoomRate: { gt: 0 } } } }, select: { id: true }, orderBy: { id: 'asc' } });
    const failures: string[] = [];
    const deadline = Date.now() + 240_000;
    for (const candidate of admissions) {
      if (Date.now() >= deadline) throw new ConflictError('Daily billing will continue on the next scheduled run; committed charges are preserved.');
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM admission_records WHERE id = ${candidate.id} FOR UPDATE`;
          const current = await tx.admissionRecord.findUnique({ where: { id: candidate.id } });
          if (!current || !['ACTIVE', 'DISCHARGE_PENDING'].includes(current.status) || !current.bedId || current.dischargedAt) return;
          const line = await postInitialRoomChargeIfApplicable(tx, current.id, current.bedId, actorId, now);
          if (!line) return;
          await tx.hospitalDayClose.upsert({
            where: { businessDate },
            create: { businessDate, admissionsCharged: 1, totalAmountPosted: line.lineNet ?? 0, closedById: actorId },
            update: { admissionsCharged: { increment: 1 }, totalAmountPosted: { increment: line.lineNet ?? 0 } },
          });
        }, { maxWait: 5000, timeout: 15000 });
      } catch (error) {
        failures.push(candidate.id);
        console.error('IPD daily charge failed', candidate.id, error);
      }
    }
    if (failures.length) throw new ConflictError(`Daily billing incomplete for ${failures.length} admission(s); retry is safe.`);
    return await prisma.hospitalDayClose.findUnique({ where: { businessDate } }) ?? { businessDate, admissionsCharged: 0, totalAmountPosted: new Decimal(0) };
  },

  async runScheduledRoomCharges(now = new Date()) {
    const profile = await prisma.hospitalProfile.findFirst();
    const config = (profile?.extendedProfile ?? {}) as Record<string, unknown>;
    if (hospitalClock(now).minutes < postingTimeMinutes(config.ipdDailyRoomBedPostingTime ?? '11:00 AM')) return { skipped: 'Before posting time' };
    const actorId = process.env.IPD_BILLING_SYSTEM_ACTOR_ID;
    if (!actorId) throw new ValidationError('IPD_BILLING_SYSTEM_ACTOR_ID must identify a dedicated system portal user');
    return this.closeHospitalDay({}, actorId, now);
  },

  async getDayCloseHistory(limit: number) {
    return prisma.hospitalDayClose.findMany({
      orderBy: { businessDate: 'desc' },
      take: limit,
      include: { closedBy: { select: { username: true, staff: { select: { fullName: true } } } } },
    });
  },
};
import { pharmacyDischargeBlocked } from '@/shared/pharmacyDischargeGate';

