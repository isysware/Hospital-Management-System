import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError } from '@/shared/errors/AppError';
import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { assertMembershipEligible } from '@/shared/panelMembership';
import { patientPaymentStatus } from '@/shared/invoicePaymentStatus';
import type {
  BookAppointmentBody,
  ListAppointmentsQuery,
  UpdateAppointmentBody,
  CancelAppointmentBody,
  CollectAdvanceBody,
  CheckInAppointmentBody,
} from './appointments.schemas';

import { generateInvoiceNumber, generateReceiptNumber, generateMrNumber } from '@/shared/idGenerator';

export const appointmentsService = {
  async bookAppointment(body: BookAppointmentBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      let selfPayEncounterId = body.selfPayEncounterId;

      // If new self-pay patient payload is passed, create the temporary encounter identity
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

      // Validate ServiceRate
      const serviceRate = await tx.serviceRate.findUnique({
        where: { id: body.serviceRateId },
      });
      if (!serviceRate || !serviceRate.isActive) {
        throw new NotFoundError('Selected service rate not found or inactive');
      }

      if (
        serviceRate.departmentId &&
        serviceRate.departmentId !== body.departmentId &&
        !serviceRate.isDefaultEncounterService
      ) {
        throw new ValidationError('Selected service does not belong to the chosen department');
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
        assertMembershipEligible(panelPatient, body.slotAt);
      }

      const estimatedAmount = body.estimatedAmount !== undefined
        ? new Decimal(body.estimatedAmount)
        : serviceRate.standardRate;

      // Create appointment
      const appointment = await tx.appointment.create({
        data: {
          panelPatientId: body.panelPatientId,
          selfPayEncounterId,
          departmentId: body.departmentId,
          doctorStaffId: body.doctorStaffId,
          serviceRateId: body.serviceRateId,
          slotAt: body.slotAt,
          estimatedAmount,
          status: 'CONFIRMED',
          notes: body.notes,
          createdById: actorId,
        },
        include: {
          panelPatient: true,
          selfPayEncounter: true,
          doctor: true,
          department: true,
          serviceRate: true,
        },
      });

      // If advance is collected at booking time
      let receipt = null;
      if (body.advanceAmount && body.advanceAmount > 0) {
        const advDecimal = new Decimal(body.advanceAmount);
        const receiptNumber = await generateReceiptNumber();

        receipt = await tx.paymentReceipt.create({
          data: {
            receiptNumber,
            amount: advDecimal,
            method: body.paymentMethod ?? 'CASH',
            reference: body.paymentReference ?? `Advance for appointment ${appointment.id}`,
            appointmentId: appointment.id,
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
            paymentReceiptId: receipt.id,
          },
        });
      }

      return { appointment, advanceReceipt: receipt };
    });
  },

  async listAppointments(query: ListAppointmentsQuery) {
    const where: Prisma.AppointmentWhereInput = {};

    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.doctorStaffId) where.doctorStaffId = query.doctorStaffId;
    if (query.status) where.status = query.status;

    if (query.date) {
      const startOfDay = new Date(`${query.date}T00:00:00.000Z`);
      const endOfDay = new Date(`${query.date}T23:59:59.999Z`);
      where.slotAt = { gte: startOfDay, lte: endOfDay };
    }

    if (query.search) {
      where.OR = [
        { panelPatient: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { panelPatient: { mrNumber: { contains: query.search, mode: 'insensitive' } } },
        { selfPayEncounter: { fullName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return prisma.appointment.findMany({
      where,
      include: {
        panelPatient: {
          select: { id: true, fullName: true, mrNumber: true, phone: true, status: true, panelMemberId: true, corporatePanel: { select: { id: true, organizationName: true } } },
        },
        selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
        department: { select: { id: true, name: true, code: true } },
        doctor: { select: { id: true, fullName: true, designation: true } },
        serviceRate: { select: { id: true, name: true, standardRate: true } },
        // Pre-Check-In advance (linked via appointmentId) AND post-Check-In
        // receipts (dual-linked, see checkInAppointment) — one source for
        // "Advance Paid" regardless of status.
        paymentReceipts: { where: { isReversed: false }, orderBy: { collectedAt: 'asc' } },
        hospitalInvoices: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            paidTotal: true,
            patientShare: true,
            panelReceivable: true,
            status: true,
            paymentReceipts: true,
          },
        },
      },
      orderBy: { slotAt: 'desc' },
      take: 100,
    });
  },

  async getAppointment(id: string) {
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } },
        selfPayEncounter: true,
        department: true,
        doctor: true,
        serviceRate: true,
        paymentReceipts: { where: { isReversed: false }, orderBy: { collectedAt: 'asc' }, include: { collectedBy: true } },
        hospitalInvoices: {
          include: {
            lines: { include: { serviceRate: true, performedBy: true } },
            paymentReceipts: true,
          },
        },
        createdByUser: { select: { id: true, username: true, displayName: true } },
      },
    });
    if (!appointment) throw new NotFoundError('Appointment not found');
    return appointment;
  },

  async updateAppointment(id: string, body: UpdateAppointmentBody) {
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Appointment not found');
    if (['CANCELLED', 'COMPLETED'].includes(existing.status)) {
      throw new ValidationError(`Cannot update appointment in ${existing.status} status`);
    }
    if (body.slotAt && existing.panelPatientId) {
      const patient = await prisma.panelPatient.findUnique({ where: { id: existing.panelPatientId }, include: { corporatePanel: true } });
      if (!patient) throw new NotFoundError('Panel patient not found');
      assertMembershipEligible(patient, body.slotAt);
    }

    return prisma.appointment.update({
      where: { id },
      data: {
        ...body,
        status: body.slotAt ? 'RESCHEDULED' : existing.status,
      },
      include: {
        doctor: true,
        department: true,
        serviceRate: true,
      },
    });
  },

  async cancelAppointment(id: string, body: CancelAppointmentBody) {
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Appointment not found');
    if (existing.status === 'CHECKED_IN' || existing.status === 'COMPLETED') {
      throw new ValidationError(`Cannot cancel appointment that is already ${existing.status}`);
    }

    const noteAppend = existing.notes
      ? `${existing.notes} | Cancellation Reason: ${body.reason}`
      : `Cancellation Reason: ${body.reason}`;

    return prisma.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: noteAppend,
      },
    });
  },

  async collectAdvance(appointmentId: string, body: CollectAdvanceBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { hospitalInvoices: true },
      });
      if (!appointment) throw new NotFoundError('Appointment not found');

      const amountDecimal = new Decimal(body.amount);
      const receiptNumber = await generateReceiptNumber(tx);

      // If an invoice exists already for this appointment, link to it
      const targetInvoice = appointment.hospitalInvoices[0];

      const receipt = await tx.paymentReceipt.create({
        data: {
          receiptNumber,
          amount: amountDecimal,
          method: body.paymentMethod,
          reference: body.reference ?? `Advance payment for appointment ${appointmentId}`,
          hospitalInvoiceId: targetInvoice?.id,
          appointmentId,
          collectedById: actorId,
        },
      });

      // Universal Cashier ledger update
      await tx.userCashBalance.create({
        data: {
          portalUserId: actorId,
          moduleScope: 'BILLING',
          direction: 'IN',
          amount: amountDecimal,
          category: 'COLLECTION',
          isPhysicalCash: body.paymentMethod === 'CASH',
          paymentReceiptId: receipt.id,
        },
      });

      if (targetInvoice) {
        const newPaidTotal = targetInvoice.paidTotal.plus(amountDecimal);
        const newStatus = patientPaymentStatus(targetInvoice, newPaidTotal);

        await tx.hospitalInvoice.update({
          where: { id: targetInvoice.id },
          data: {
            paidTotal: newPaidTotal,
            status: newStatus,
          },
        });
      }

      return receipt;
    });
  },

  async checkInAppointment(appointmentId: string, body: CheckInAppointmentBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          serviceRate: true,
          hospitalInvoices: { include: { paymentReceipts: true } },
          panelPatient: {
            include: {
              corporatePanel: {
                include: { discountRules: true },
              },
            },
          },
        },
      });

      if (!appointment) throw new NotFoundError('Appointment not found');
      if (appointment.status === 'CHECKED_IN') {
        throw new ValidationError('Appointment is already checked in');
      }
      if (appointment.status === 'CANCELLED') {
        throw new ValidationError('Cannot check-in a cancelled appointment');
      }

      // If invoice already created, just update status
      if (appointment.panelPatient) assertMembershipEligible(appointment.panelPatient);
      let invoice = appointment.hospitalInvoices[0];

      if (!invoice) {
        const rate = appointment.serviceRate.standardRate;
        // v7.2 §2.5/§20/§21 — Patient Share vs Panel Receivable split. Panel
        // Service rule (only tier that exists today) → else NOT_COVERED —
        // shared with `admission.service.ts` via `resolvePanelCoverage`.
        const { discountAmount, discountReason, patientShare, panelReceivable, coverageSnapshot } = resolvePanelCoverage(
          rate,
          appointment.panelPatient?.corporatePanel?.discountRules,
          appointment.serviceRateId, new Date(), appointment.serviceRate.departmentId ?? appointment.departmentId,
          new Decimal(1), appointment.panelPatient,
        );

        const lineNet = rate.minus(discountAmount);
        const invoiceNumber = await generateInvoiceNumber(tx);

        // Advance receipts collected before Check-In link directly via
        // `appointmentId` (set at booking/collectAdvance time) rather than
        // string-matching `reference`.
        const unlinkedReceipts = await tx.paymentReceipt.findMany({
          where: {
            appointmentId: appointment.id,
            hospitalInvoiceId: null,
          },
        });

        const totalAdvance = unlinkedReceipts.reduce(
          (sum, r) => sum.plus(r.amount),
          new Decimal(0),
        );

        const newPaidTotal = totalAdvance;
        const newStatus = patientPaymentStatus(
          { panelPatientId: appointment.panelPatientId, total: lineNet, patientShare, panelReceivable },
          newPaidTotal,
        );

        invoice = await tx.hospitalInvoice.create({
          data: {
            invoiceNumber,
            sourceType: 'APPOINTMENT',
            encounterType: body.encounterType ?? 'OPD',
            appointmentId: appointment.id,
            departmentId: appointment.departmentId,
            panelPatientId: appointment.panelPatientId,
            selfPayEncounterId: appointment.selfPayEncounterId,
            subtotal: rate,
            discountTotal: discountAmount,
            total: lineNet,
            paidTotal: newPaidTotal,
            patientShare,
            panelReceivable,
            status: newStatus,
            createdById: actorId,
            lines: {
              create: {
                serviceRateId: appointment.serviceRateId,
                rateSnapshot: rate,
                quantity: new Decimal(1),
                lineGross: rate,
                discountAmount,
                discountReason,
                lineNet, patientShare, panelReceivable, coverageSnapshot,
                performedByStaffId: appointment.doctorStaffId,
                isCompleted: true,
              },
            },
          },
          include: {
            lines: true,
            paymentReceipts: true,
          },
        });

        // Link the advance receipts to this invoice (kept linked to the
        // appointment too — dual-linked, both reads stay valid).
        if (unlinkedReceipts.length > 0) {
          await tx.paymentReceipt.updateMany({
            where: { id: { in: unlinkedReceipts.map((r) => r.id) } },
            data: { hospitalInvoiceId: invoice.id },
          });
        }
      }

      const updatedAppointment = await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'CHECKED_IN',
          notes: body.notes ? `${appointment.notes ?? ''} | Check-in: ${body.notes}` : appointment.notes,
        },
        include: {
          doctor: true,
          department: true,
          serviceRate: true,
        },
      });

      return {
        appointment: updatedAppointment,
        invoice,
      };
    });
  },
};
