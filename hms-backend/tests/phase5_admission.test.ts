import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import bcrypt from 'bcryptjs';

// Mock prisma client
vi.mock('@/db/client', () => {
  const mockTx: any = {};
  const mockPrisma: any = {
    $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    admissionRecord: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    selfPayEncounter: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    bed: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    bedTransferHistory: {
      create: vi.fn(),
    },
    admissionPaymentRequest: {
      create: vi.fn(),
    },
    medicationModeHistory: {
      create: vi.fn(),
    },
    pharmacyClearance: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dualDischargeClearance: {
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    dischargeSummary: {
      create: vi.fn(),
    },
    staff: {
      findUnique: vi.fn(),
    },
    portalUser: {
      findUnique: vi.fn(),
    },
    highCostMedicinePolicy: {
      findFirst: vi.fn(),
    },
    medicineMaster: {
      findMany: vi.fn(),
    },
    highCostMedicineAuthorization: {
      create: vi.fn(),
      update: vi.fn(),
    },
    hospitalInvoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    invoiceLineItem: {
      create: vi.fn(),
    },
    serviceRate: {
      findUnique: vi.fn(),
    },
    paymentReceipt: {
      create: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    userCashBalance: {
      create: vi.fn(),
    },
  };

  Object.keys(mockPrisma).forEach((key) => {
    if (key !== '$transaction') {
      mockTx[key] = mockPrisma[key];
    }
  });

  return { prisma: mockPrisma };
});

import { prisma } from '@/db/client';
import { admissionService } from '@/modules/admission/admission.service';
import { admissionBillingService } from '@/modules/frontdesk/admissionBilling.service';

describe('Phase 5: Inpatient Admission, Bed Lifecycle & Dual Clearance Discharge Workflow', () => {
  const staffUserId = 'user-admission-staff-1';
  const doctorStaffId = 'staff-dr-specialist-1';
  const departmentId = 'dept-general-surgery';
  const bedId1 = 'bed-ward-a-01';
  const bedId2 = 'bed-ward-a-02';

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.bed.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.admissionRecord.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.selfPayEncounter.create as any).mockResolvedValue({
      id: 'self-pay-encounter-1',
      fullName: 'Kamran Akmal',
    });
  });

  describe('1. Planned Admission & Billing Hand-off (§4.7, D16 p.10)', () => {
    it('creates planned admission without occupying bed at booking time', async () => {
      (prisma.admissionRecord.create as any).mockResolvedValue({
        id: 'adm-001',
        admissionNumber: 'ADM-TEST-001',
        departmentId,
        doctorStaffId,
        bedId: bedId1,
        status: 'PLANNED',
        medicationMode: 'SELF',
        diagnosis: 'Acute Appendicitis',
      });
      (prisma.bed.findUnique as any).mockResolvedValue({
        id: bedId1,
        status: 'AVAILABLE',
        operationalStatus: 'ACTIVE',
        room: { ward: { departmentId } },
      });

      const result = await admissionService.createPlannedAdmission(
        {
          departmentId,
          doctorStaffId,
          preferredBedId: bedId1,
          diagnosis: 'Acute Appendicitis',
          medicationMode: 'SELF',
          newSelfPayPatient: {
            fullName: 'Kamran Akmal',
            phone: '03211234567',
          },
        },
        staffUserId,
      );

      expect(prisma.admissionRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PLANNED',
            medicationMode: 'SELF',
          }),
        }),
      );
      // Confirms bed status was NOT updated to OCCUPIED during planned booking
      expect(prisma.bed.update).not.toHaveBeenCalled();
      expect(result.admission.status).toBe('PLANNED');
      // No advanceAmount was passed, so no receipt should be created.
      expect(result.advanceReceipt).toBeNull();
      expect(prisma.paymentReceipt.create).not.toHaveBeenCalled();
    });

    it('creates a planned admission with no doctor assigned (doctor is optional at planning time)', async () => {
      (prisma.admissionRecord.create as any).mockResolvedValue({
        id: 'adm-003',
        admissionNumber: 'ADM-TEST-003',
        departmentId,
        doctorStaffId: null,
        status: 'PLANNED',
        medicationMode: 'SELF',
      });

      const result = await admissionService.createPlannedAdmission(
        {
          departmentId,
          medicationMode: 'SELF',
          newSelfPayPatient: { fullName: 'Kamran Akmal', phone: '03211234567' },
        } as any,
        staffUserId,
      );

      expect(prisma.admissionRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ doctorStaffId: null }),
        }),
      );
      expect(result.admission.doctorStaffId).toBeNull();
    });

    it('rejects a preferred bed that does not belong to the admitting department', async () => {
      (prisma.bed.findUnique as any).mockResolvedValue({
        id: bedId1,
        status: 'AVAILABLE',
        operationalStatus: 'ACTIVE',
        room: { ward: { departmentId: 'dept-cardiology' } },
      });

      await expect(
        admissionService.createPlannedAdmission(
          {
            departmentId,
            doctorStaffId,
            preferredBedId: bedId1,
            medicationMode: 'SELF',
            newSelfPayPatient: { fullName: 'Kamran Akmal', phone: '03211234567' },
          },
          staffUserId,
        ),
      ).rejects.toThrow('does not belong to the chosen admitting department');
      expect(prisma.admissionRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a preferred bed that is not currently available', async () => {
      (prisma.bed.findUnique as any).mockResolvedValue({
        id: bedId1,
        status: 'OCCUPIED',
        operationalStatus: 'ACTIVE',
        room: { ward: { departmentId } },
      });

      await expect(
        admissionService.createPlannedAdmission(
          {
            departmentId,
            doctorStaffId,
            preferredBedId: bedId1,
            medicationMode: 'SELF',
            newSelfPayPatient: { fullName: 'Kamran Akmal', phone: '03211234567' },
          },
          staffUserId,
        ),
      ).rejects.toThrow('Only AVAILABLE beds can be preferred');
      expect(prisma.admissionRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a preferred bed that does not exist', async () => {
      (prisma.bed.findUnique as any).mockResolvedValue(null);

      await expect(
        admissionService.createPlannedAdmission(
          {
            departmentId,
            doctorStaffId,
            preferredBedId: bedId1,
            medicationMode: 'SELF',
            newSelfPayPatient: { fullName: 'Kamran Akmal', phone: '03211234567' },
          },
          staffUserId,
        ),
      ).rejects.toThrow('Selected bed not found');
      expect(prisma.admissionRecord.create).not.toHaveBeenCalled();
    });

    it('posts a real advance receipt + cashier ledger entry when advanceAmount is collected at creation', async () => {
      (prisma.admissionRecord.create as any).mockResolvedValue({
        id: 'adm-002',
        admissionNumber: 'ADM-TEST-002',
        departmentId,
        doctorStaffId,
        status: 'PLANNED',
        medicationMode: 'SELF',
      });
      (prisma.paymentReceipt.create as any).mockResolvedValue({
        id: 'receipt-adv-1',
        receiptNumber: 'REC-TEST-001',
        amount: new Decimal(20000),
        method: 'CASH',
      });

      const result = await admissionService.createPlannedAdmission(
        {
          departmentId,
          doctorStaffId,
          medicationMode: 'SELF',
          advanceAmount: 20000,
          paymentMethod: 'CASH',
          notes: 'Patient requested a ground-floor ward.',
          newSelfPayPatient: {
            fullName: 'Kamran Akmal',
            phone: '03211234567',
          },
        } as any,
        staffUserId,
      );

      // Intake notes must actually be persisted on the AdmissionRecord, not silently dropped.
      expect(prisma.admissionRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: 'Patient requested a ground-floor ward.',
          }),
        }),
      );

      expect(prisma.paymentReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: expect.any(Decimal),
            method: 'CASH',
            admissionRecordId: 'adm-002',
            collectedById: staffUserId,
          }),
        }),
      );
      // Universal Cashier balance ledger (§4.9) must record the same collection.
      expect(prisma.userCashBalance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            portalUserId: staffUserId,
            direction: 'IN',
            category: 'COLLECTION',
            isPhysicalCash: true,
            paymentReceiptId: 'receipt-adv-1',
          }),
        }),
      );
      expect(result.advanceReceipt).not.toBeNull();
      expect(result.advanceReceipt?.receiptNumber).toBe('REC-TEST-001');
    });

    it('raises payment request to Billing queue without collecting cash in admission', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        admissionNumber: 'ADM-TEST-001',
      });

      (prisma.admissionPaymentRequest.create as any).mockResolvedValue({
        id: 'pay-req-001',
        admissionRecordId: 'adm-001',
        requestType: 'ADVANCE',
        requestedAmount: new Decimal(25000),
        status: 'PENDING',
      });

      const request = await admissionService.requestPayment(
        'adm-001',
        { requestType: 'ADVANCE', requestedAmount: 25000, notes: 'Admission initial deposit' },
        staffUserId,
      );

      expect(prisma.admissionPaymentRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionRecordId: 'adm-001',
            requestType: 'ADVANCE',
            requestedAmount: new Decimal(25000),
            status: 'PENDING',
            requestedById: staffUserId,
          }),
        }),
      );
      expect(request.status).toBe('PENDING');
    });
  });

  describe('2. Bed Lifecycle: Check-in, Transfer & Running Charges (§4.7, D16 p.11)', () => {
    it('checks in admission, marks bed OCCUPIED, and initializes 3 clearance streams', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'PLANNED',
        medicationMode: 'SELF',
        dischargeClearances: [],
      });

      (prisma.bed.findUnique as any).mockResolvedValue({
        id: bedId1,
        status: 'AVAILABLE',
        operationalStatus: 'ACTIVE',
      });

      (prisma.bed.update as any).mockResolvedValue({
        id: bedId1,
        status: 'OCCUPIED',
      });

      (prisma.admissionRecord.update as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        bedId: bedId1,
      });

      (prisma.hospitalInvoice.findFirst as any).mockResolvedValue(null);
      (prisma.hospitalInvoice.create as any).mockResolvedValue({
        id: 'inv-adm-001',
        sourceType: 'ADMISSION',
      });

      const updated = await admissionService.checkInAdmission(
        'adm-001',
        { bedId: bedId1 },
        staffUserId,
      );

      // Bed is marked OCCUPIED on check-in
      expect(prisma.bed.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: bedId1 },
          data: { status: 'OCCUPIED' },
        }),
      );

      // Admission status becomes ACTIVE
      expect(prisma.admissionRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adm-001' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            bedId: bedId1,
          }),
        }),
      );

      // 3 Clearance streams are initialized
      expect(prisma.dualDischargeClearance.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ clearanceType: 'CLINICAL', status: 'PENDING' }),
            expect.objectContaining({ clearanceType: 'HOSPITAL_BILLING', status: 'PENDING' }),
            expect.objectContaining({ clearanceType: 'PHARMACY', status: 'NOT_APPLICABLE' }), // SELF mode
          ]),
        }),
      );

      expect(updated.status).toBe('ACTIVE');
    });

    it('appends Check-In notes to any existing intake notes instead of overwriting them', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-003',
        status: 'PLANNED',
        medicationMode: 'SELF',
        dischargeClearances: [],
        notes: 'Intake: patient allergic to penicillin.',
      });
      (prisma.bed.findUnique as any).mockResolvedValue({ id: bedId1, status: 'AVAILABLE', operationalStatus: 'ACTIVE' });
      (prisma.bed.update as any).mockResolvedValue({ id: bedId1, status: 'OCCUPIED' });
      (prisma.admissionRecord.update as any).mockResolvedValue({ id: 'adm-003', status: 'ACTIVE' });
      (prisma.hospitalInvoice.findFirst as any).mockResolvedValue(null);
      (prisma.hospitalInvoice.create as any).mockResolvedValue({ id: 'inv-adm-003', sourceType: 'ADMISSION' });

      await admissionService.checkInAdmission(
        'adm-003',
        { bedId: bedId1, notes: 'Arrived via wheelchair.' },
        staffUserId,
      );

      expect(prisma.admissionRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: 'Intake: patient allergic to penicillin.\n[Check-In] Arrived via wheelchair.',
          }),
        }),
      );
    });

    it('transfers patient to new bed: frees old bed to AVAILABLE, occupies new bed, and logs transfer history', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        bedId: bedId1,
      });

      (prisma.bed.findUnique as any).mockResolvedValue({
        id: bedId2,
        status: 'AVAILABLE',
        operationalStatus: 'ACTIVE',
      });

      (prisma.bed.update as any)
        .mockResolvedValueOnce({ id: bedId1, status: 'AVAILABLE' }) // old bed freed
        .mockResolvedValueOnce({ id: bedId2, status: 'OCCUPIED' }); // new bed occupied

      (prisma.bedTransferHistory.create as any).mockResolvedValue({
        id: 'transfer-001',
        fromBedId: bedId1,
        toBedId: bedId2,
        reason: 'Shifted to private room',
      });

      (prisma.admissionRecord.update as any).mockResolvedValue({
        id: 'adm-001',
        bedId: bedId2,
      });

      const result = await admissionService.transferBed(
        'adm-001',
        { targetBedId: bedId2, reason: 'Shifted to private room' },
        staffUserId,
      );

      // Old bed freed
      expect(prisma.bed.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: bedId1 },
          data: { status: 'AVAILABLE' },
        }),
      );

      // New bed occupied only while it is still available
      expect(prisma.bed.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: bedId2, status: 'AVAILABLE', operationalStatus: 'ACTIVE' },
          data: { status: 'OCCUPIED' },
        }),
      );

      // Transfer history logged
      expect(prisma.bedTransferHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionRecordId: 'adm-001',
            fromBedId: bedId1,
            toBedId: bedId2,
            reason: 'Shifted to private room',
            transferredById: staffUserId,
          }),
        }),
      );

      expect(result.admission.bedId).toBe(bedId2);
    });

    it('appends billable hospital service to the admitting department\'s existing invoice (v7.2 §2.2)', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        doctorStaffId,
        hospitalInvoices: [
          {
            id: 'inv-adm-1',
            departmentId, // matches admission's own department
            subtotal: new Decimal(10000),
            total: new Decimal(10000),
            paidTotal: new Decimal(5000),
            patientShare: new Decimal(10000),
            panelReceivable: new Decimal(0),
            lines: [],
          },
        ],
        panelPatient: null,
      });

      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'srv-rate-ecg',
        standardRate: new Decimal(3000),
        isActive: true,
        departmentId, // same department as the existing invoice
      });

      (prisma.invoiceLineItem.create as any).mockResolvedValue({
        id: 'line-srv-1',
        lineGross: new Decimal(3000),
        discountAmount: new Decimal(0),
        lineNet: new Decimal(3000),
        patientShare: new Decimal(3000),
        panelReceivable: new Decimal(0),
      });

      const line = await admissionService.addAdmissionService(
        'adm-001',
        { serviceRateId: 'srv-rate-ecg', quantity: 1, notes: 'Daily doctor rounds' },
        staffUserId,
      );

      // Reuses the existing invoice — no new one created for the same department.
      expect(prisma.hospitalInvoice.create).not.toHaveBeenCalled();
      expect(prisma.invoiceLineItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hospitalInvoiceId: 'inv-adm-1',
            rateSnapshot: new Decimal(3000),
            lineGross: new Decimal(3000),
            lineNet: new Decimal(3000),
          }),
        }),
      );
      expect(line.lineNet).toEqual(new Decimal(3000));
    });

    it('records a SELF arranged service with PKR 0 charge (no hospital ledger debt)', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        doctorStaffId,
        hospitalInvoices: [
          {
            id: 'inv-adm-1',
            departmentId,
            subtotal: new Decimal(0),
            total: new Decimal(0),
            paidTotal: new Decimal(0),
            patientShare: new Decimal(0),
            panelReceivable: new Decimal(0),
            lines: [],
          },
        ],
        panelPatient: null,
      });

      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'srv-rate-outside-lab',
        standardRate: new Decimal(5000),
        isActive: true,
        departmentId,
      });

      (prisma.invoiceLineItem.create as any).mockResolvedValue({
        id: 'line-self-1',
        hospitalInvoiceId: 'inv-adm-1',
        serviceRateId: 'srv-rate-outside-lab',
        rateSnapshot: new Decimal(0),
        quantity: new Decimal(1),
        lineGross: new Decimal(0),
        discountAmount: new Decimal(0),
        discountReason: '[Self-Arranged]',
        lineNet: new Decimal(0),
        patientShare: new Decimal(0),
        panelReceivable: new Decimal(0),
      });

      const line = await admissionService.addAdmissionService(
        'adm-001',
        { serviceRateId: 'srv-rate-outside-lab', quantity: 1, arrangementMode: 'SELF' },
        staffUserId,
      );

      expect(prisma.invoiceLineItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hospitalInvoiceId: 'inv-adm-1',
            rateSnapshot: new Decimal(0),
            lineGross: new Decimal(0),
            lineNet: new Decimal(0),
            discountReason: '[Self-Arranged]',
          }),
        }),
      );
      expect(line.lineNet).toEqual(new Decimal(0));
    });

    it('adds services from any department to the existing admission invoice (1 invoice per admission)', async () => {
      const labDeptId = 'dept-laboratory';
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-002',
        status: 'ACTIVE',
        doctorStaffId,
        departmentId,
        hospitalInvoices: [
          {
            id: 'inv-hospital-services',
            departmentId,
            subtotal: new Decimal(5000),
            total: new Decimal(5000),
            paidTotal: new Decimal(0),
            patientShare: new Decimal(5000),
            panelReceivable: new Decimal(0),
            lines: [],
          },
        ],
        panelPatient: null,
      });

      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'srv-rate-cbc',
        standardRate: new Decimal(1500),
        isActive: true,
        departmentId: labDeptId, // Lab, NOT the admitting department
      });

      (prisma.invoiceLineItem.create as any).mockResolvedValue({
        id: 'line-cbc-1',
        lineGross: new Decimal(1500),
        discountAmount: new Decimal(0),
        lineNet: new Decimal(1500),
        patientShare: new Decimal(1500),
        panelReceivable: new Decimal(0),
      });

      await admissionService.addAdmissionService(
        'adm-002',
        { serviceRateId: 'srv-rate-cbc', quantity: 1 },
        staffUserId,
      );

      // Reuses the admission's single invoice — no new invoice is created
      expect(prisma.hospitalInvoice.create).not.toHaveBeenCalled();
      expect(prisma.invoiceLineItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hospitalInvoiceId: 'inv-hospital-services' }) }),
      );
    });

    it('splits Patient Share / Panel Receivable on an admission service line using the panel coverage rule (v7.2 §2.5)', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-003',
        status: 'ACTIVE',
        doctorStaffId,
        hospitalInvoices: [],
        panelPatient: {
          corporatePanel: {
            discountRules: [
              {
                serviceRateId: 'srv-rate-mri',
                discountPercent: new Decimal(0),
                coveragePercent: new Decimal(70),
                capAmount: null,
                effectiveFrom: new Date('2020-01-01'),
                effectiveTo: null,
              },
            ],
          },
        },
      });

      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'srv-rate-mri',
        standardRate: new Decimal(20000),
        isActive: true,
        departmentId: 'dept-radiology',
      });

      (prisma.hospitalInvoice.create as any).mockResolvedValue({
        id: 'inv-radiology',
        departmentId: 'dept-radiology',
        paidTotal: new Decimal(0),
        lines: [],
      });
      (prisma.invoiceLineItem.create as any).mockResolvedValue({
        id: 'line-mri-1',
        lineGross: new Decimal(20000),
        discountAmount: new Decimal(0),
        lineNet: new Decimal(20000),
        patientShare: new Decimal(6000),
        panelReceivable: new Decimal(14000),
      });

      await admissionService.addAdmissionService('adm-003', { serviceRateId: 'srv-rate-mri', quantity: 1 }, staffUserId);

      expect(prisma.invoiceLineItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lineNet: new Decimal(20000), // coverage split doesn't touch the billed total
            patientShare: new Decimal(6000), // 20,000 - 70% coverage (14,000)
            panelReceivable: new Decimal(14000),
          }),
        }),
      );
      expect(prisma.hospitalInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientShare: new Decimal(6000),
            panelReceivable: new Decimal(14000),
          }),
        }),
      );
    });
  });

  describe('3. Medication Mode & Pharmacy Integration (§4.7 Sub-flow C, D16 p.12)', () => {
    it('toggles mode to HOSPITAL_MANAGED with immutable reason and updates pharmacy clearance', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        medicationMode: 'SELF',
        dischargeClearances: [],
      });

      (prisma.medicationModeHistory.create as any).mockResolvedValue({
        id: 'mode-hist-1',
        previousMode: 'SELF',
        newMode: 'HOSPITAL_MANAGED',
        reason: 'Patient requested hospital medicines for surgery',
      });

      (prisma.admissionRecord.update as any).mockResolvedValue({
        id: 'adm-001',
        medicationMode: 'HOSPITAL_MANAGED',
      });

      const result = await admissionService.changeMedicationMode(
        'adm-001',
        { mode: 'HOSPITAL_MANAGED', reason: 'Patient requested hospital medicines for surgery' },
        staffUserId,
      );

      expect(prisma.medicationModeHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionRecordId: 'adm-001',
            previousMode: 'SELF',
            newMode: 'HOSPITAL_MANAGED',
            reason: 'Patient requested hospital medicines for surgery',
            changedById: staffUserId,
          }),
        }),
      );

      // Updates Pharmacy clearance stream to PENDING
      expect(prisma.dualDischargeClearance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { admissionRecordId: 'adm-001', clearanceType: 'PHARMACY' },
          data: { status: 'PENDING' },
        }),
      );

      expect(result.admission.medicationMode).toBe('HOSPITAL_MANAGED');
    });

    it('blocks pharmacy request when medication mode is SELF', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        medicationMode: 'SELF',
      });

      await expect(
        admissionService.createPharmacyRequest(
          'adm-001',
          {
            lines: [{ medicineId: 'med-001', requestedQuantity: 2 }],
          },
          staffUserId,
        ),
      ).rejects.toThrow(/permitted only when Medication Mode is HOSPITAL_MANAGED/);
    });

    it('creates pharmacy request when mode is HOSPITAL_MANAGED', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        medicationMode: 'HOSPITAL_MANAGED',
      });

      (prisma.pharmacyClearance.create as any).mockResolvedValue({
        id: 'pharm-req-001',
        status: 'REQUESTED',
      });

      const req = await admissionService.createPharmacyRequest(
        'adm-001',
        {
          lines: [{ medicineId: 'med-paracetamol', requestedQuantity: 5 }],
          notes: 'Post-op analgesics',
        },
        staffUserId,
      );

      // Request-level notes must actually be persisted, not silently dropped.
      expect(prisma.pharmacyClearance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: 'Post-op analgesics',
          }),
        }),
      );
      expect(req.status).toBe('REQUESTED');
    });
  });

  describe('4. Dual / 3-Key Discharge Gate (§4.7 Sub-flow D, D16 p.13)', () => {
    it('blocks discharge when clearances are still pending', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        dischargeClearances: [
          { clearanceType: 'CLINICAL', status: 'CLEARED' },
          { clearanceType: 'HOSPITAL_BILLING', status: 'PENDING' }, // Still unpaid
          { clearanceType: 'PHARMACY', status: 'PENDING' }, // Medicines not cleared
        ],
      });

      await expect(
        admissionService.dischargePatient('adm-001', staffUserId),
      ).rejects.toThrow(/The following clearances are still pending: \[HOSPITAL_BILLING, PHARMACY\]/);
    });

    it('blocks hospital billing clearance if patient has outstanding unpaid invoices', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        hospitalInvoices: [
          { total: new Decimal(20000), paidTotal: new Decimal(10000) }, // 10,000 outstanding
        ],
        dischargeClearances: [
          { id: 'dc-1', clearanceType: 'HOSPITAL_BILLING', status: 'PENDING' },
        ],
      });

      await expect(
        admissionService.grantClearance(
          'adm-001',
          { clearanceType: 'HOSPITAL_BILLING' },
          staffUserId,
        ),
      ).rejects.toThrow(/patient has unpaid hospital invoices/);
    });

    it('allows final discharge when all 3 clearances are cleared and automatically frees bed to AVAILABLE', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        bedId: bedId1,
        dischargeClearances: [
          { clearanceType: 'CLINICAL', status: 'CLEARED' },
          { clearanceType: 'HOSPITAL_BILLING', status: 'CLEARED' },
          { clearanceType: 'PHARMACY', status: 'CLEARED' },
        ],
      });

      (prisma.admissionRecord.update as any).mockResolvedValue({
        id: 'adm-001',
        status: 'DISCHARGED',
        dischargedAt: new Date(),
      });

      (prisma.bed.update as any).mockResolvedValue({
        id: bedId1,
        status: 'AVAILABLE',
      });

      const result = await admissionService.dischargePatient('adm-001', staffUserId);

      // Admission status set to DISCHARGED
      expect(prisma.admissionRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adm-001' },
          data: expect.objectContaining({ status: 'DISCHARGED' }),
        }),
      );

      // Bed is automatically freed to AVAILABLE
      expect(prisma.bed.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: bedId1 },
          data: { status: 'AVAILABLE' },
        }),
      );

      expect(result.admission.status).toBe('DISCHARGED');
    });
  });

  describe('6. Doctor Clinical Discharge Authorization (v7.2 §2.4)', () => {
    const doctorPasswordHash = bcrypt.hashSync('Correct-Doctor-Pass1', 4);

    it('accepts valid doctor credentials, creates the Discharge Summary, clears CLINICAL, and routes to DISCHARGE_PENDING', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-001',
        status: 'ACTIVE',
        dischargeClearances: [{ id: 'dc-clinical', clearanceType: 'CLINICAL', status: 'PENDING' }],
      });
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'doctor-1',
        fullName: 'Dr. Kamran Sheikh',
        isActive: true,
        departmentId: 'dept-1',
        department: { name: 'General Medicine' },
        clinicalAuthUsername: 'dr.kamran',
        clinicalAuthActive: true,
        clinicalAuthPasswordHash: doctorPasswordHash,
      });
      (prisma.dischargeSummary.create as any).mockImplementation((args: any) => ({ id: 'ds-1', ...args.data }));
      (prisma.dualDischargeClearance.update as any).mockResolvedValue({ id: 'dc-clinical', status: 'CLEARED' });
      (prisma.admissionRecord.update as any).mockResolvedValue({ id: 'adm-001', status: 'DISCHARGE_PENDING' });

      const result = await admissionService.clinicalDischarge(
        'adm-001',
        {
          doctorUsername: 'dr.kamran',
          doctorPassword: 'Correct-Doctor-Pass1',
          dischargeSummary: {
            finalDiagnosis: 'Resolved chest pain',
            treatmentSummary: 'Observation + medication',
            conditionAtDischarge: 'Stable',
            medicinesInstructions: 'Paracetamol as needed',
          },
        },
        staffUserId,
      );

      expect(prisma.dischargeSummary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ doctorStaffId: 'doctor-1', doctorNameSnapshot: 'Dr. Kamran Sheikh', initiatedById: staffUserId }),
        }),
      );
      expect(prisma.dualDischargeClearance.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'dc-clinical' }, data: expect.objectContaining({ status: 'CLEARED' }) }),
      );
      expect(prisma.admissionRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'adm-001' }, data: { status: 'DISCHARGE_PENDING' } }),
      );
      expect(result.admission.status).toBe('DISCHARGE_PENDING');
    });

    it('verify step returns the doctor identity only, and rejects a deactivated doctor', async () => {
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'doctor-1',
        employeeId: '1001',
        fullName: 'Dr. Kamran Sheikh',
        designation: 'Consultant',
        isActive: true,
        department: { name: 'General Medicine' },
        clinicalAuthActive: true,
        clinicalAuthPasswordHash: doctorPasswordHash,
      });
      await expect(admissionService.verifyDischargeDoctor('dr.kamran', 'Correct-Doctor-Pass1')).resolves.toEqual({
        staffId: 'doctor-1',
        employeeId: '1001',
        fullName: 'Dr. Kamran Sheikh',
        designation: 'Consultant',
        department: 'General Medicine',
      });

      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'doctor-1',
        isActive: false,
        clinicalAuthActive: true,
        clinicalAuthPasswordHash: doctorPasswordHash,
      });
      await expect(admissionService.verifyDischargeDoctor('dr.kamran', 'Correct-Doctor-Pass1')).rejects.toThrow('Invalid doctor credentials');
    });

    it('rejects a wrong doctor password', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-001', status: 'ACTIVE', dischargeClearances: [] });
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'doctor-1',
        clinicalAuthUsername: 'dr.kamran',
        clinicalAuthActive: true,
        clinicalAuthPasswordHash: doctorPasswordHash,
      });

      await expect(
        admissionService.clinicalDischarge(
          'adm-001',
          {
            doctorUsername: 'dr.kamran',
            doctorPassword: 'wrong-password',
            dischargeSummary: {
              finalDiagnosis: 'x',
              treatmentSummary: 'x',
              conditionAtDischarge: 'x',
              medicinesInstructions: 'x',
            },
          },
          staffUserId,
        ),
      ).rejects.toThrow(/Invalid doctor credentials/);
    });

    it('rejects an inactive clinical-auth credential', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-001', status: 'ACTIVE', dischargeClearances: [] });
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'doctor-1',
        clinicalAuthUsername: 'dr.kamran',
        clinicalAuthActive: false,
        clinicalAuthPasswordHash: doctorPasswordHash,
      });

      await expect(
        admissionService.clinicalDischarge(
          'adm-001',
          {
            doctorUsername: 'dr.kamran',
            doctorPassword: 'Correct-Doctor-Pass1',
            dischargeSummary: {
              finalDiagnosis: 'x',
              treatmentSummary: 'x',
              conditionAtDischarge: 'x',
              medicinesInstructions: 'x',
            },
          },
          staffUserId,
        ),
      ).rejects.toThrow(/Invalid doctor credentials/);
    });

    it('rejects granting the CLINICAL gate through the generic grantClearance path — doctor auth only', async () => {
      await expect(
        admissionService.grantClearance('adm-001', { clearanceType: 'CLINICAL' }, staffUserId),
      ).rejects.toThrow(/doctor credential authorization/);
    });
  });

  describe('7. High-Cost Medicine Authorization (v7.2 §2.6)', () => {
    const managementPasswordHash = bcrypt.hashSync('Admin-Pass-123', 4);

    it('leaves a below-threshold pharmacy request as plain REQUESTED (no regression)', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-001', medicationMode: 'HOSPITAL_MANAGED' });
      (prisma.highCostMedicinePolicy.findFirst as any).mockResolvedValue({
        enabled: true,
        thresholdAmount: new Decimal(10000),
        thresholdBasis: 'LINE_TOTAL',
      });
      (prisma.medicineMaster.findMany as any).mockResolvedValue([{ id: 'med-cheap', saleRate: new Decimal(50) }]);
      (prisma.pharmacyClearance.create as any).mockResolvedValue({ id: 'pharm-req-002', status: 'REQUESTED' });

      const req = await admissionService.createPharmacyRequest(
        'adm-001',
        { lines: [{ medicineId: 'med-cheap', requestedQuantity: 2 }] },
        staffUserId,
      );

      expect(prisma.pharmacyClearance.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REQUESTED' }) }));
      expect(prisma.highCostMedicineAuthorization.create).not.toHaveBeenCalled();
      expect(req.status).toBe('REQUESTED');
    });

    it('blocks an above-threshold pharmacy request at AUTHORIZATION_REQUIRED and records the authorization row', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-001', medicationMode: 'HOSPITAL_MANAGED' });
      (prisma.highCostMedicinePolicy.findFirst as any).mockResolvedValue({
        enabled: true,
        thresholdAmount: new Decimal(1000),
        thresholdBasis: 'LINE_TOTAL',
      });
      (prisma.medicineMaster.findMany as any).mockResolvedValue([{ id: 'med-expensive', saleRate: new Decimal(6000) }]);
      (prisma.pharmacyClearance.create as any).mockResolvedValue({ id: 'pharm-req-003', status: 'AUTHORIZATION_REQUIRED' });
      (prisma.highCostMedicineAuthorization.create as any).mockImplementation((args: any) => ({ id: 'hca-1', ...args.data }));

      const req = await admissionService.createPharmacyRequest(
        'adm-001',
        { lines: [{ medicineId: 'med-expensive', requestedQuantity: 2 }] }, // 12,000 line total vs 1,000 threshold (Worked Example 8 shape)
        staffUserId,
      );

      expect(prisma.pharmacyClearance.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AUTHORIZATION_REQUIRED' }) }));
      expect(prisma.highCostMedicineAuthorization.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pharmacyClearanceId: 'pharm-req-003', lineTotal: expect.any(Decimal), status: 'PENDING' }) }),
      );
      expect(req.status).toBe('AUTHORIZATION_REQUIRED');
      expect(req.highCostAuthorization).toBeTruthy();
    });

    it('authorizes on EITHER logic satisfied by attendant confirmation alone, and releases the clearance back to REQUESTED', async () => {
      (prisma.pharmacyClearance.findUnique as any).mockResolvedValue({
        id: 'pharm-req-003',
        admissionRecordId: 'adm-001',
        highCostAuthorization: { id: 'hca-1', status: 'PENDING' },
      });
      (prisma.highCostMedicinePolicy.findFirst as any).mockResolvedValue({
        attendantConfirmationRequired: true,
        managementApprovalRequired: true,
        combinedLogic: 'EITHER',
      });
      (prisma.highCostMedicineAuthorization.update as any).mockImplementation((args: any) => ({ id: 'hca-1', ...args.data }));

      const result = await admissionService.authorizeHighCostMedicine(
        'adm-001',
        'pharm-req-003',
        { attendantName: 'Ali Khan', attendantRelation: 'Son', attendantConfirmed: true },
        staffUserId,
      );

      expect(result.status).toBe('AUTHORIZED');
      expect(prisma.pharmacyClearance.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pharm-req-003' }, data: { status: 'REQUESTED' } }),
      );
    });

    it('rejects BOTH-logic authorization when only attendant confirmation was provided', async () => {
      (prisma.pharmacyClearance.findUnique as any).mockResolvedValue({
        id: 'pharm-req-004',
        admissionRecordId: 'adm-001',
        highCostAuthorization: { id: 'hca-2', status: 'PENDING' },
      });
      (prisma.highCostMedicinePolicy.findFirst as any).mockResolvedValue({
        attendantConfirmationRequired: true,
        managementApprovalRequired: true,
        combinedLogic: 'BOTH',
      });

      await expect(
        admissionService.authorizeHighCostMedicine(
          'adm-001',
          'pharm-req-004',
          { attendantName: 'Ali Khan', attendantRelation: 'Son', attendantConfirmed: true },
          staffUserId,
        ),
      ).rejects.toThrow(/still missing: management approval/);
    });

    it('rejects wrong management credentials rather than silently proceeding', async () => {
      (prisma.pharmacyClearance.findUnique as any).mockResolvedValue({
        id: 'pharm-req-005',
        admissionRecordId: 'adm-001',
        highCostAuthorization: { id: 'hca-3', status: 'PENDING' },
      });
      (prisma.highCostMedicinePolicy.findFirst as any).mockResolvedValue({
        attendantConfirmationRequired: false,
        managementApprovalRequired: true,
        combinedLogic: 'MANAGEMENT_ONLY',
      });
      (prisma.portalUser.findUnique as any).mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: managementPasswordHash,
      });

      await expect(
        admissionService.authorizeHighCostMedicine(
          'adm-001',
          'pharm-req-005',
          { managementUsername: 'admin', managementPassword: 'wrong-password' },
          staffUserId,
        ),
      ).rejects.toThrow(/Invalid management credentials/);
    });
  });

  describe('5. Admission Billing — Department Split Statement & Payment Allocation (v7.2 §2.2/§2.10/§2.11)', () => {
    it('builds a consolidated Interim Statement summing across every department invoice', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-stmt-1',
        admissionNumber: 'ADM-0001',
        status: 'ACTIVE',
        panelPatient: null,
        selfPayEncounter: { id: 'sp-1', fullName: 'Test Patient' },
        hospitalInvoices: [
          {
            id: 'inv-hs',
            subtotal: new Decimal(20000),
            discountTotal: new Decimal(0),
            total: new Decimal(20000),
            paidTotal: new Decimal(20000),
            patientShare: new Decimal(20000),
            panelReceivable: new Decimal(0),
          },
          {
            id: 'inv-lab',
            subtotal: new Decimal(20000),
            discountTotal: new Decimal(0),
            total: new Decimal(20000),
            paidTotal: new Decimal(0),
            patientShare: new Decimal(20000),
            panelReceivable: new Decimal(0),
          },
          {
            id: 'inv-pharm',
            subtotal: new Decimal(10000),
            discountTotal: new Decimal(0),
            total: new Decimal(10000),
            paidTotal: new Decimal(0),
            patientShare: new Decimal(10000),
            panelReceivable: new Decimal(0),
          },
        ],
      });

      const statement = await admissionBillingService.getStatement('adm-stmt-1');

      expect(statement.isNotFinalDischargeInvoice).toBe(true);
      expect(statement.departmentInvoices).toHaveLength(3);
      expect(statement.consolidated.total).toEqual(new Decimal(50000)); // matches the PDF's PKR 50,000 worked split
      expect(statement.consolidated.paidTotal).toEqual(new Decimal(20000));
      expect(statement.consolidated.outstanding).toEqual(new Decimal(30000));
    });

    it('auto-allocates one payment proportionally across outstanding department invoices', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-alloc-1' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-hs', invoiceNumber: 'INV-HS-1', total: new Decimal(25000), paidTotal: new Decimal(0) },
        { id: 'inv-lab', invoiceNumber: 'INV-LAB-1', total: new Decimal(12000), paidTotal: new Decimal(0) },
        { id: 'inv-pharm', invoiceNumber: 'INV-PHARM-1', total: new Decimal(18000), paidTotal: new Decimal(0) },
      ]);
      (prisma.paymentReceipt.create as any).mockImplementation((args: any) => ({ id: `rec-${args.data.hospitalInvoiceId}`, ...args.data }));

      const result = await admissionBillingService.collectPayment('adm-alloc-1', { amount: 20000, paymentMethod: 'CASH' }, staffUserId);

      const sum = result.allocations.reduce((s: Decimal, a: any) => s.plus(a.amount), new Decimal(0));
      expect(sum).toEqual(new Decimal(20000)); // always sums exactly to the collected amount
      expect(result.allocations).toHaveLength(3);
      // Proportional to outstanding (25k : 12k : 18k of 55k total)
      const hs = result.allocations.find((a: any) => a.invoiceId === 'inv-hs')!;
      expect(hs.amount.toNumber()).toBeCloseTo((20000 * 25000) / 55000, 1);
    });

    it('banks the shortfall as an unallocated advance credit when explicit allocations sum to less than the collected amount, and still rejects when they exceed it', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-alloc-2' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-hs', invoiceNumber: 'INV-HS-2', total: new Decimal(25000), paidTotal: new Decimal(15000) }, // 10,000 outstanding
        { id: 'inv-lab', invoiceNumber: 'INV-LAB-2', total: new Decimal(12000), paidTotal: new Decimal(7000) }, // 5,000 outstanding
        { id: 'inv-pharm', invoiceNumber: 'INV-PHARM-2', total: new Decimal(18000), paidTotal: new Decimal(13000) }, // 5,000 outstanding
      ]);

      // Explicit allocations summing to MORE than the collected amount is
      // still a hard rejection (typo-guard).
      await expect(
        admissionBillingService.collectPayment(
          'adm-alloc-2',
          {
            amount: 19000,
            paymentMethod: 'CASH',
            allocations: [
              { invoiceId: 'inv-hs', amount: 10000 },
              { invoiceId: 'inv-lab', amount: 5000 },
              { invoiceId: 'inv-pharm', amount: 5000 }, // sums to 20,000 > 19,000 collected
            ],
          },
          staffUserId,
        ),
      ).rejects.toThrow(/cannot exceed the collected amount/);

      (prisma.paymentReceipt.create as any).mockImplementation((args: any) => ({
        id: `rec-${args.data.hospitalInvoiceId ?? 'advance'}`,
        ...args.data,
      }));

      // Explicit allocations summing to LESS than the collected amount
      // (19,999 vs 20,000) now banks the 1 PKR shortfall as an unallocated
      // advance/deposit credit instead of rejecting the whole collection
      // (§7/§8 — "additional deposit" during the stay).
      const result = await admissionBillingService.collectPayment(
        'adm-alloc-2',
        {
          amount: 20000,
          paymentMethod: 'CASH',
          allocations: [
            { invoiceId: 'inv-hs', amount: 10000 },
            { invoiceId: 'inv-lab', amount: 5000 },
            { invoiceId: 'inv-pharm', amount: 4999 },
          ],
        },
        staffUserId,
      );
      expect(result.allocations).toHaveLength(4);
      const advance = result.allocations.find((a: any) => a.invoiceId === null)!;
      expect(advance.amount).toEqual(new Decimal(1));
    });

    it('rejects an explicit allocation that exceeds that invoice\'s own outstanding balance', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-alloc-3' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-hs', invoiceNumber: 'INV-HS-3', total: new Decimal(10000), paidTotal: new Decimal(8000) }, // 2,000 outstanding
      ]);

      await expect(
        admissionBillingService.collectPayment(
          'adm-alloc-3',
          { amount: 5000, paymentMethod: 'CASH', allocations: [{ invoiceId: 'inv-hs', amount: 5000 }] },
          staffUserId,
        ),
      ).rejects.toThrow(/exceeds its outstanding patient balance/);
    });

    it('caps patient collection at the panel invoice\'s own patientShare, never the full total (bug found via live testing 2026-09-23)', async () => {
      // Also satisfies reconcileAdmissionDischarge's own internal re-fetch
      // (same admissionRecord.findUnique mock, called a second time after
      // collectPayment posts the receipt) — status/hospitalInvoices/
      // dischargeClearances are what it reads.
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({
        id: 'adm-alloc-panel',
        status: 'ACTIVE',
        hospitalInvoices: [],
        dischargeClearances: [],
      });
      (prisma.paymentReceipt.aggregate as any).mockResolvedValue({ _sum: { amount: new Decimal(0) } });
      (prisma.dualDischargeClearance.findMany as any).mockResolvedValue([]);
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        {
          id: 'inv-panel',
          invoiceNumber: 'INV-PANEL-1',
          panelPatientId: 'pp-1',
          total: new Decimal(1000),
          patientShare: new Decimal(500),
          panelReceivable: new Decimal(500),
          paidTotal: new Decimal(0),
        },
      ]);

      // Explicit allocation: the panel's 500 must never be collectible as patient cash.
      await expect(
        admissionBillingService.collectPayment(
          'adm-alloc-panel',
          { amount: 1000, paymentMethod: 'CASH', allocations: [{ invoiceId: 'inv-panel', amount: 1000 }] },
          staffUserId,
        ),
      ).rejects.toThrow(/exceeds its outstanding patient balance \(500\)/);

      (prisma.paymentReceipt.create as any).mockImplementation((args: any) => ({
        id: `rec-${args.data.hospitalInvoiceId ?? 'advance'}`,
        ...args.data,
      }));

      // Auto-allocation (no explicit allocations): collecting the full 1000
      // must settle only the 500 patient share against the invoice and
      // bank the other 500 as unallocated credit — never as if the panel's
      // receivable had been paid by the patient.
      const result = await admissionBillingService.collectPayment(
        'adm-alloc-panel',
        { amount: 1000, paymentMethod: 'CASH' },
        staffUserId,
      );
      const invoiceAllocation = result.allocations.find((a: any) => a.invoiceId === 'inv-panel')!;
      const advanceAllocation = result.allocations.find((a: any) => a.invoiceId === null)!;
      expect(invoiceAllocation.amount).toEqual(new Decimal(500));
      expect(advanceAllocation.amount).toEqual(new Decimal(500));
    });

    it('settles outstanding invoices in full and banks the remainder as an unallocated advance credit when the auto-allocated amount exceeds total outstanding', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-alloc-4' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-hs', invoiceNumber: 'INV-HS-4', total: new Decimal(5000), paidTotal: new Decimal(4000) }, // 1,000 outstanding
      ]);
      (prisma.paymentReceipt.create as any).mockImplementation((args: any) => ({
        id: `rec-${args.data.hospitalInvoiceId ?? 'advance'}`,
        ...args.data,
      }));

      // Matches the spec's worked example (§8): guardian pays more than
      // what's currently outstanding — the outstanding invoice is settled
      // in full and the rest becomes Patient Credit, not a rejected payment.
      const result = await admissionBillingService.collectPayment('adm-alloc-4', { amount: 5000, paymentMethod: 'CASH' }, staffUserId);

      expect(result.allocations).toHaveLength(2);
      const invoiceAlloc = result.allocations.find((a: any) => a.invoiceId === 'inv-hs')!;
      expect(invoiceAlloc.amount).toEqual(new Decimal(1000));
      const advance = result.allocations.find((a: any) => a.invoiceId === null)!;
      expect(advance.amount).toEqual(new Decimal(4000));
    });

    it('collects a pure advance/deposit before any department invoice exists yet, instead of rejecting', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValue({ id: 'adm-alloc-5' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([]);
      (prisma.paymentReceipt.create as any).mockImplementation((args: any) => ({ id: 'rec-advance', ...args.data }));

      const result = await admissionBillingService.collectPayment('adm-alloc-5', { amount: 3000, paymentMethod: 'CASH' }, staffUserId);

      expect(result.allocations).toEqual([{ invoiceId: null, amount: new Decimal(3000) }]);
      expect(prisma.paymentReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ admissionRecordId: 'adm-alloc-5', hospitalInvoiceId: undefined }),
        }),
      );
    });
  });

  describe('8. Admission Patient Records / Running Ledger (v7.2)', () => {
    const baseAdmission = {
      id: 'adm-ledger-1',
      admissionNumber: 'ADM-26-0099',
      status: 'ACTIVE',
      panelPatientId: null,
      panelPatient: null,
      selfPayEncounter: { id: 'sp-9', fullName: 'Test Ledger Patient', phone: '0300' },
      bed: null,
      admittedAt: new Date('2026-09-01T10:00:00Z'),
      hospitalInvoices: [] as any[],
      finalBillNumber: null as string | null,
      finalBillGeneratedAt: null as Date | null,
    };

    it('generateFinalBill is idempotent — a second call returns the same number without minting a new one', async () => {
      (prisma.paymentReceipt.findMany as any).mockResolvedValue([]);
      (prisma.admissionRecord.update as any).mockResolvedValue({});
      (prisma.admissionRecord.findUnique as any)
        .mockResolvedValueOnce({ ...baseAdmission }) // tx check inside generateFinalBill, call 1
        .mockResolvedValueOnce({ ...baseAdmission }); // getLedger's own read, call 1

      const first = await admissionBillingService.generateFinalBill('adm-ledger-1', staffUserId);
      expect(first.finalBillNumber).toMatch(/^FBL-\d{2}-/);
      expect(prisma.admissionRecord.update).toHaveBeenCalledTimes(1);

      (prisma.admissionRecord.findUnique as any)
        .mockResolvedValueOnce({ ...baseAdmission, finalBillNumber: first.finalBillNumber, finalBillGeneratedAt: first.finalBillGeneratedAt }) // tx check, call 2
        .mockResolvedValueOnce({ ...baseAdmission, finalBillNumber: first.finalBillNumber }); // getLedger read, call 2

      const second = await admissionBillingService.generateFinalBill('adm-ledger-1', staffUserId);

      expect(second.finalBillNumber).toBe(first.finalBillNumber);
      // Still only ever called once — the number is never re-minted.
      expect(prisma.admissionRecord.update).toHaveBeenCalledTimes(1);
    });

    it('getLedger flattens invoice-line charges and payment receipts into one chronological, running-balance list', async () => {
      (prisma.admissionRecord.findUnique as any).mockResolvedValueOnce({
        ...baseAdmission,
        hospitalInvoices: [
          {
            id: 'inv-1',
            invoiceNumber: 'INV-26-0001',
            total: new Decimal(1500),
            patientShare: new Decimal(1500),
            panelReceivable: new Decimal(0),
            department: { id: 'dept-1', name: 'Laboratory' },
            lines: [
              {
                id: 'line-1',
                createdAt: new Date('2026-09-01T11:00:00Z'),
                serviceRate: { name: 'CBC' },
                performedBy: null,
                quantity: new Decimal(1),
                rateSnapshot: new Decimal(1500),
                lineNet: new Decimal(1500),
                discountReason: null,
              },
            ],
          },
        ],
      });
      (prisma.paymentReceipt.findMany as any).mockResolvedValue([
        {
          id: 'rec-1',
          receiptNumber: 'REC-26-0001',
          amount: new Decimal(5000),
          method: 'CASH',
          collectedAt: new Date('2026-09-01T09:00:00Z'), // before the charge — the admission advance
          hospitalInvoiceId: null,
          hospitalInvoice: null,
          collectedBy: { username: 'frontdesk1', displayName: null },
        },
      ]);

      const ledger = await admissionBillingService.getLedger('adm-ledger-1');

      expect(ledger.entries).toHaveLength(2);
      expect(ledger.entries[0].type).toBe('Admission Advance');
      expect(ledger.entries[0].credit).toEqual(new Decimal(5000));
      expect(ledger.entries[0].runningBalance).toEqual(new Decimal(-5000));
      expect(ledger.entries[1].type).toBe('CBC');
      expect(ledger.entries[1].debit).toEqual(new Decimal(1500));
      expect(ledger.entries[1].runningBalance).toEqual(new Decimal(-3500));
      expect(ledger.summary.totalCharges).toEqual(new Decimal(1500));
      expect(ledger.summary.totalPaid).toEqual(new Decimal(5000));
      expect(ledger.summary.availableCredit).toEqual(new Decimal(3500));
      expect(ledger.summary.outstandingBalance).toEqual(new Decimal(0));
    });

    it.each(['PLANNED', 'CONFIRMED'])('shows %s registrations before check-in without making them active', async (status) => {
      (prisma.admissionRecord.findMany as any).mockResolvedValue([
        { id: 'new-registration', admissionNumber: 'ADM-NEW', status, admittedAt: null,
          selfPayEncounter: { fullName: 'Registered Patient' }, hospitalInvoices: [], bed: null },
      ]);
      (prisma.paymentReceipt.findMany as any).mockResolvedValue([]);
      const rows = await admissionBillingService.listAdmissionRecords();
      expect(prisma.admissionRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { OR: [{ admittedAt: { not: null } }, { status: { in: ['PLANNED', 'CONFIRMED'] } }] },
      }));
      expect(rows[0]).toMatchObject({ id: 'new-registration', clinicalStatus: status, admittedAt: null });
      expect(prisma.admissionRecord.update).not.toHaveBeenCalled();
    });

    it('listAdmissionRecords consolidates charges and payments (including unallocated advance receipts) per admission', async () => {
      (prisma.admissionRecord.findMany as any).mockResolvedValue([
        {
          id: 'adm-list-1',
          admissionNumber: 'ADM-26-0050',
          panelPatientId: null,
          panelPatient: null,
          selfPayEncounter: { fullName: 'List Patient', phone: '0300' },
          bed: null,
          status: 'ACTIVE',
          admittedAt: new Date('2026-09-01'),
          hospitalInvoices: [{ id: 'inv-list-1', total: new Decimal(14000) }],
        },
      ]);
      (prisma.paymentReceipt.findMany as any).mockResolvedValue([
        { amount: new Decimal(20000), admissionRecordId: 'adm-list-1', hospitalInvoice: null },
      ]);

      const rows = await admissionBillingService.listAdmissionRecords();

      expect(rows).toHaveLength(1);
      expect(rows[0].currentCharges).toEqual(new Decimal(14000));
      expect(rows[0].totalPaid).toEqual(new Decimal(20000));
      expect(rows[0].outstanding).toEqual(new Decimal(0));
      // Matches the spec's worked example (§8): 20,000 advance vs 14,000 charges = 6,000 credit.
      expect(rows[0].availableCredit).toEqual(new Decimal(6000));
      expect(rows[0].billingStatus).toBe('PAID');
    });
  });
});
