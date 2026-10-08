import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError } from './errors/AppError';
import { resolvePanelCoverage } from './panelCoverage';
import { assertCaseAuthorization } from './panelAuthorization';
import { patientPaymentStatus } from './invoicePaymentStatus';
import { generateInvoiceNumber } from './idGenerator';

export const doctorChargeSchema = z.object({ doctorStaffId: z.string().uuid(), quantity: z.coerce.number().int().positive().max(100).default(1) });
export const doctorFeeSchema = z.object({ consultationFee: z.coerce.number().nonnegative() });
export const doctorCharges = {
  list: () => prisma.staff.findMany({ where: { category: 'Doctor', isActive: true, employmentStatus: 'ACTIVE' }, select: { id: true, fullName: true, consultationFee: true, departmentId: true } }),
  async configure(id: string, fee: number) {
    const doctor = await prisma.staff.findUnique({ where: { id } });
    if (!doctor || doctor.category !== 'Doctor') throw new ValidationError('Select a doctor');
    return prisma.staff.update({ where: { id }, data: { consultationFee: new Decimal(fee) }, select: { id: true, fullName: true, consultationFee: true } });
  },
  async post(targetId: string, target: 'ADMISSION' | 'INVOICE', body: z.infer<typeof doctorChargeSchema>, actorId: string) {
    return prisma.$transaction(async tx => {
      const doctor = await tx.staff.findUnique({ where: { id: body.doctorStaffId } });
      if (!doctor?.isActive || doctor.employmentStatus !== 'ACTIVE' || doctor.category !== 'Doctor' || doctor.consultationFee == null) throw new ValidationError('Configure an active doctor consultation/visit fee first');
      let invoiceId = targetId;
      let admission: any = null;
      if (target === 'ADMISSION') {
        admission = await tx.admissionRecord.findUnique({ where: { id: targetId } });
        if (!admission || admission.status !== 'ACTIVE') throw new ValidationError('An active admission is required');
        let inv = await tx.hospitalInvoice.findFirst({ where: { admissionRecordId: targetId, sourceType: 'ADMISSION' } });
        if (!inv) inv = await tx.hospitalInvoice.create({ data: { invoiceNumber: await generateInvoiceNumber(tx), sourceType: 'ADMISSION', admissionRecordId: targetId, departmentId: admission.departmentId, panelPatientId: admission.panelPatientId, selfPayEncounterId: admission.selfPayEncounterId, createdById: actorId } });
        invoiceId = inv.id;
      }
      // Serialize additions with existing payment/charge transactions.
      await tx.$queryRaw`SELECT id FROM hospital_invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.hospitalInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true, panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } } } });
      if (!invoice || invoice.status === 'VOID') throw new NotFoundError('Active invoice not found');
      const quantity = new Decimal(body.quantity), gross = doctor.consultationFee.mul(quantity);
      const coverage = resolvePanelCoverage(gross, invoice.panelPatient?.corporatePanel.discountRules, 'DOCTOR_CHARGE', new Date(), doctor.departmentId, quantity, invoice.panelPatient);
      if (invoice.panelPatient) assertCaseAuthorization(invoice.panelPatient.corporatePanel.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, admission ?? invoice);
      const line = await tx.invoiceLineItem.create({ data: { hospitalInvoiceId: invoice.id, billingSource: 'DOCTOR_CHARGE', descriptionSnapshot: doctor.fullName + ' Visit', performedByStaffId: doctor.id, rateSnapshot: doctor.consultationFee, quantity, lineGross: gross, discountAmount: coverage.discountAmount, discountReason: coverage.discountReason, lineNet: coverage.eligibleNet, patientShare: coverage.patientShare, panelReceivable: coverage.panelReceivable, coverageSnapshot: coverage.coverageSnapshot, isCompleted: true } });
      const total = invoice.total.plus(line.lineNet), patientShare = invoice.patientShare.plus(line.patientShare), panelReceivable = invoice.panelReceivable.plus(line.panelReceivable);
      await tx.hospitalInvoice.update({ where: { id: invoice.id }, data: { subtotal: invoice.subtotal.plus(gross), discountTotal: invoice.discountTotal.plus(line.discountAmount), total, patientShare, panelReceivable, status: patientPaymentStatus({ ...invoice, total, patientShare, panelReceivable }, invoice.paidTotal) } });
      return line;
    });
  },
};
