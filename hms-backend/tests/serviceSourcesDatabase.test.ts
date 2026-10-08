import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/client';
import { serviceSelectionWhere } from '../src/shared/serviceClassification';
import { doctorCharges } from '../src/shared/doctorCharges';
import { admissionService } from '../src/modules/admission/admission.service';
import { pharmacyBridgeService } from '../src/modules/pharmacy-bridge/pharmacy-bridge.service';
vi.mock('@/modules/notifications/notifications.service', () => ({ notificationsService: { createNotification: vi.fn() } }));

describe.skipIf(process.env.RUN_SERVICE_DB_TESTS !== '1')('service-source database acceptance (rolled back)', () => {
  it('filters actual rows and posts hospital, outsourced, doctor, room and pharmacy sources without fake services', async () => {
    const rollback = new Error('ROLLBACK_ACCEPTANCE_FIXTURES');
    const originalTransaction = prisma.$transaction.bind(prisma);
    try {
      await originalTransaction(async tx => {
        const key = randomUUID();
        const actor = await tx.portalUser.create({ data: { username: key, passwordHash: 'test-only-unused', role: 'SUPER_ADMIN' } });
        const internal = await tx.department.create({ data: { code: key, name: 'Test General Ward', departmentType: 'CLINICAL' } });
        const provider = await tx.outsourcedProvider.create({ data: { name: 'Test ABC Diagnostics', allowedPaymentMethods: [] } });
        const external = await tx.department.create({ data: { code: key + '-ext', name: 'Test Radiology', departmentType: 'DIAGNOSTIC', fulfillmentOwnership: 'OUTSOURCED', outsourcedProviderId: provider.id } });
        const dressing = await tx.serviceRate.create({ data: { code: key + '-dress', name: 'Dressing', departmentId: internal.id, billingUnit: 'Procedure', standardRate: 500 } });
        const ct = await tx.serviceRate.create({ data: { code: key + '-ct', name: 'CT Scan', departmentId: external.id, providerType: 'OUTSOURCED', billingSource: 'OUTSOURCED_SERVICE', billingUnit: 'Test', standardRate: 5000 } });
        const hidden = await tx.serviceRate.create({ data: { code: key + '-legacy', name: 'Legacy Medication', departmentId: internal.id, billingSource: 'PHARMACY', isSystemGenerated: true, selectable: false, billingUnit: 'Items', standardRate: 0 } });
        await tx.serviceRate.create({ data: { code: key + '-inactive', name: 'Inactive Dressing', departmentId: internal.id, isActive: false, billingUnit: 'Procedure', standardRate: 500 } });
        expect((await tx.serviceRate.findMany({ where: serviceSelectionWhere({ providerType: 'INTERNAL', departmentId: internal.id }) })).map(s => s.id)).toEqual([dressing.id]);
        expect((await tx.serviceRate.findMany({ where: serviceSelectionWhere({ providerType: 'OUTSOURCED', departmentId: external.id, outsourcedProviderId: provider.id }) })).map(s => s.id)).toEqual([ct.id]);
        expect(await tx.serviceRate.findMany({ where: serviceSelectionWhere({ providerType: 'INTERNAL', departmentId: external.id }) })).toEqual([]);
        expect(await tx.serviceRate.findMany({ where: serviceSelectionWhere({ providerType: 'OUTSOURCED', departmentId: external.id, outsourcedProviderId: randomUUID() }) })).toEqual([]);

        const doctor = await tx.staff.create({ data: { employeeId: key, fullName: 'Dr Acceptance', category: 'Doctor', phone: '000', joiningDate: new Date(), consultationFee: 2000, departmentId: internal.id } });
        const room = await tx.room.create({ data: { name: 'Test Room', dailyRoomRate: 5000 } });
        const bed = await tx.bed.create({ data: { bedNumber: key, roomId: room.id, status: 'OCCUPIED' } });
        const admission = await tx.admissionRecord.create({ data: { admissionNumber: key, departmentId: internal.id, status: 'ACTIVE', bedId: bed.id } });
        const invoice = await tx.hospitalInvoice.create({ data: { invoiceNumber: key, sourceType: 'ADMISSION', admissionRecordId: admission.id, departmentId: internal.id } });
        const countBefore = await tx.serviceRate.count();
        const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation((async (fn: any) => fn(tx)) as any);
        const scopedAdmissions = tx.admissionRecord.findMany.bind(tx.admissionRecord);
        const dayScope = vi.spyOn(tx.admissionRecord, 'findMany').mockImplementation(((args: any) => scopedAdmissions({ ...args, where: { ...args.where, id: admission.id } })) as any);
        try {
          await expect(admissionService.addAdmissionService(admission.id, { serviceRateId: hidden.id, quantity: 1 }, actor.id)).rejects.toThrow();
          await expect(admissionService.addAdmissionService(admission.id, { serviceRateId: ct.id, quantity: 1, providerType: 'INTERNAL', departmentId: internal.id }, actor.id)).rejects.toThrow();
          await admissionService.addAdmissionService(admission.id, { serviceRateId: dressing.id, quantity: 1, providerType: 'INTERNAL', departmentId: internal.id }, actor.id);
          await admissionService.addAdmissionService(admission.id, { serviceRateId: ct.id, quantity: 1, providerType: 'OUTSOURCED', departmentId: external.id, outsourcedProviderId: provider.id }, actor.id);
          await doctorCharges.post(admission.id, 'ADMISSION', { doctorStaffId: doctor.id, quantity: 1 }, actor.id);
          await admissionService.closeHospitalDay({ businessDate: '2099-12-30' }, actor.id);
          const callback = { externalAdmissionRef: admission.id, dispenseEventId: key, pharmacyInvoiceNumber: key, subtotal: 500, taxTotal: 0, discountTotal: 0, totalAmount: 500, lines: [{ medicineName: 'Panadol', quantity: 1, rate: 500, lineNet: 500 }] };
          await pharmacyBridgeService.handleDispensedCallback(callback);
          expect((await pharmacyBridgeService.handleDispensedCallback(callback)).alreadyProcessed).toBe(true);
          const lines = await tx.invoiceLineItem.findMany({ where: { hospitalInvoiceId: invoice.id } });
          expect(lines.map(l => l.billingSource).sort()).toEqual(['DOCTOR_CHARGE', 'HOSPITAL_SERVICE', 'OUTSOURCED_SERVICE', 'PHARMACY', 'ROOM_BED']);
          expect(lines.filter(l => ['DOCTOR_CHARGE', 'ROOM_BED', 'PHARMACY'].includes(l.billingSource)).every(l => l.serviceRateId === null)).toBe(true);
          expect(lines.find(l => l.billingSource === 'PHARMACY')?.descriptionSnapshot).toBe('Panadol');
          expect(Number((await tx.hospitalInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).total)).toBe(13000);
          expect(await tx.serviceRate.count()).toBe(countBefore);
          expect((await tx.serviceRate.findUniqueOrThrow({ where: { id: hidden.id } })).selectable).toBe(false);
        } finally { dayScope.mockRestore(); transactionSpy.mockRestore(); }
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await prisma.$disconnect(); }
  }, 65000);
});
