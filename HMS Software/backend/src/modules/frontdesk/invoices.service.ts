import { assertSelectableService } from '@/shared/serviceClassification';
import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { assertMembershipEligible } from '@/shared/panelMembership';
import { assertCaseAuthorization } from '@/shared/panelAuthorization';
import { patientPaymentStatus, patientResponsibility, patientBalanceDue } from '@/shared/invoicePaymentStatus';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError, AuthorizationError } from '@/shared/errors/AppError';
import { commissionService } from '@/modules/commission/commission.service';
import { pharmacyBridgeClient } from '@/shared/pharmacyBridgeClient';
import { computePharmacyPortion } from '@/shared/pharmacyFifoCredit';
import type {
  CreateEncounterBody,
  AddServiceLineBody,
  ApplyDiscountBody,
  CollectPaymentBody,
  RefundPaymentBody,
  ListInvoicesQuery,
  SetInvoiceAuthorizationBody,
} from './invoices.schemas';

import { generateInvoiceNumber, generateReceiptNumber, generateMrNumber, generateQueueToken } from '@/shared/idGenerator';
import {
  isEligibleHospitalService,
  validateDiscountAuthorization,
} from '@/shared/discountEligibility';

export const invoicesService = {
  /**
   * Create immediate encounter (Walk-In, OPD, Observation, Emergency) — §4.6 Sub-flow B
   * D16 p.9: "Observation and Emergency are encounter/workflow types, not separate login portals."
   */
  async createEncounter(body: CreateEncounterBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      let selfPayEncounterId = body.selfPayEncounterId;

      let effectiveWeight: Decimal | null = null;
      if (body.weightKg != null) {
        effectiveWeight = new Decimal(body.weightKg);
      } else if (body.newSelfPayPatient?.weightKg != null) {
        effectiveWeight = new Decimal(body.newSelfPayPatient.weightKg);
      } else if (body.notes) {
        const m = body.notes.match(/weight[:\s]+([0-9]+(?:\.[0-9]+)?)/i);
        if (m && m[1]) {
          try {
            effectiveWeight = new Decimal(m[1]);
          } catch {
            // ignore
          }
        }
      }

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
            weightKg: effectiveWeight,
            createdById: actorId,
          },
        });
        selfPayEncounterId = createdSelfPay.id;
      } else if (selfPayEncounterId && effectiveWeight != null) {
        await tx.selfPayEncounter.update({
          where: { id: selfPayEncounterId },
          data: { weightKg: effectiveWeight },
        }).catch(() => { });
      }

      if (body.panelPatientId) {
        const patient = await tx.panelPatient.findUnique({ where: { id: body.panelPatientId }, include: { corporatePanel: true } });
        if (!patient?.isActive || patient.status !== 'ACTIVE' || !patient.corporatePanel.isActive) throw new ValidationError('Panel patient and company must be active');
        assertMembershipEligible(patient);
        assertCaseAuthorization(patient.corporatePanel.authorizationRequired, false, {
          authorizationNumber: body.authorizationNumber,
          authorizationValidUntil: body.authorizationValidUntil,
        });
      }

      if (body.doctorStaffId) {
        const doc = await tx.staff.findUnique({ where: { id: body.doctorStaffId } });
        if (!doc || !doc.isActive) throw new ValidationError('Selected doctor not found or inactive');
        if (doc.category !== 'Doctor') throw new ValidationError('Selected staff is not a Doctor');
      }

      if (body.rmoStaffId) {
        if (body.encounterType !== 'EMERGENCY') {
          throw new ValidationError('RMO can only be assigned to EMERGENCY encounters');
        }
        const rmo = await tx.staff.findUnique({ where: { id: body.rmoStaffId } });
        if (!rmo || !rmo.isActive) throw new ValidationError('Selected RMO not found or inactive');
        if (rmo.category !== 'RMO') throw new ValidationError('Selected staff is not an RMO');
      }

      const invoiceNumber = await generateInvoiceNumber(tx);
      const queueToken = await generateQueueToken(body.encounterType, tx);

      const invoice = await tx.hospitalInvoice.create({
        data: {
          invoiceNumber,
          sourceType: 'WALK_IN',
          encounterType: body.encounterType,
          queueNumber: queueToken?.queueNumber ?? null,
          queueSequence: queueToken?.queueSequence ?? null,
          queueDate: queueToken?.queueDate ?? null,
          panelPatientId: body.panelPatientId,
          selfPayEncounterId,
          departmentId: body.departmentId || null,
          doctorStaffId: body.doctorStaffId || null,
          rmoStaffId: body.rmoStaffId || null,
          notes: body.notes || null,
          weightKg: effectiveWeight,
          subtotal: new Decimal(0),
          discountTotal: new Decimal(0),
          total: new Decimal(0),
          paidTotal: new Decimal(0),
          status: 'UNPAID',
          createdById: actorId,
          authorizationNumber: body.panelPatientId ? body.authorizationNumber || null : null,
          authorizationLimit: body.panelPatientId && body.authorizationLimit != null ? new Decimal(body.authorizationLimit) : null,
          authorizationValidUntil: body.panelPatientId ? body.authorizationValidUntil || null : null,
        },
        include: {
          panelPatient: true,
          selfPayEncounter: true,
          lines: true,
          paymentReceipts: true,
          doctor: true,
          rmo: true,
          department: true,
        },
      });

      if (body.departmentId && (tx as any).department?.findUnique) {
        const dept = await (tx as any).department.findUnique({ where: { id: body.departmentId } });
        if (dept?.fixedPrice && Number(dept.fixedPrice) > 0) {
          const deptFee = new Decimal(dept.fixedPrice);
          const panelPatient = invoice.panelPatientId ? await tx.panelPatient.findUnique({
            where: { id: invoice.panelPatientId }, include: { corporatePanel: { include: { discountRules: true } } },
          }) : null;
          const coverage = resolvePanelCoverage(
            deptFee,
            panelPatient?.corporatePanel?.discountRules,
            'HOSPITAL_SERVICE',
            new Date(),
            dept.id,
            new Decimal(1),
            panelPatient,
          );
          const deptLine = await tx.invoiceLineItem.create({
            data: {
              hospitalInvoiceId: invoice.id,
              billingSource: 'HOSPITAL_SERVICE',
              descriptionSnapshot: `Department Fee - ${dept.name}`,
              rateSnapshot: deptFee,
              quantity: new Decimal(1),
              lineGross: deptFee,
              discountAmount: coverage.discountAmount,
              discountReason: coverage.discountReason,
              lineNet: coverage.eligibleNet,
              patientShare: coverage.patientShare,
              panelReceivable: coverage.panelReceivable,
              coverageSnapshot: coverage.coverageSnapshot,
              isCompleted: true,
            },
          });
          const newStatus = patientPaymentStatus(
            { panelPatientId: invoice.panelPatientId, total: coverage.eligibleNet, patientShare: coverage.patientShare, panelReceivable: coverage.panelReceivable },
            invoice.paidTotal,
          );
          await tx.hospitalInvoice.update({
            where: { id: invoice.id },
            data: {
              subtotal: deptFee,
              discountTotal: coverage.discountAmount,
              total: coverage.eligibleNet,
              patientShare: coverage.patientShare,
              panelReceivable: coverage.panelReceivable,
              status: newStatus,
            },
          });
          invoice.lines = [deptLine as any];
          invoice.subtotal = deptFee;
          invoice.discountTotal = coverage.discountAmount;
          invoice.total = coverage.eligibleNet;
          invoice.patientShare = coverage.patientShare;
          invoice.panelReceivable = coverage.panelReceivable;
          invoice.status = newStatus;
        }
      }

      return invoice;
    });
  },

  /**
   * Add billable service line item to an invoice — §4.6, §8.7
   * Captures rateSnapshot, auto-applies Panel discount rules, updates totals,
   * and triggers doctor commission accrual calculation.
   */
  async addServiceLine(
    invoiceId: string,
    body: AddServiceLineBody,
    _actorId: string,
    actorRole: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.hospitalInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          panelPatient: {
            include: { corporatePanel: { include: { discountRules: true } } },
          },
          lines: true,
        },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status === 'VOID') throw new ValidationError('Cannot modify a void invoice');
      if (invoice.panelPatientId && invoice.lines.some(line => !line.patientShare.plus(line.panelReceivable).equals(line.lineNet))) {
        throw new ValidationError('Historical panel lines need payer reconciliation before adding charges');
      }

      const serviceRate = await tx.serviceRate.findUnique({
        include: { department: { include: { outsourcedProvider: true } } }, where: { id: body.serviceRateId },
      });
      assertSelectableService(serviceRate, body);
      if (!serviceRate) throw new NotFoundError('Service not found');

      // Rate snapshot: frozen at billing time (D15 §15)
      let rate = serviceRate.standardRate;
      if (body.manualRateOverride !== undefined) {
        if (!serviceRate.manualRateOverrideAllowed && !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
          throw new AuthorizationError('Manual rate override is not permitted for this service');
        }
        rate = new Decimal(body.manualRateOverride);
      }

      const qty = new Decimal(body.quantity);

      // Check if line already exists for this service to increment quantity
      const existingLine = invoice.lines.find((l) => {
        if (l.billingSource === 'ROOM_BED') return false;
        if (l.serviceRateId !== serviceRate.id) return false;
        if (!new Decimal(l.rateSnapshot).equals(rate)) return false;
        if (body.performedByStaffId && l.performedByStaffId && l.performedByStaffId !== body.performedByStaffId) {
          return false;
        }
        return true;
      });

      const effectiveQty = existingLine ? new Decimal(existingLine.quantity).plus(qty) : qty;
      const lineGross = rate.mul(effectiveQty);

      // Discount calculation:
      let discountAmount = new Decimal(0);
      let discountReason = body.discountReason ?? existingLine?.discountReason ?? null;

      const coverage = resolvePanelCoverage(lineGross, invoice.panelPatient?.corporatePanel?.discountRules,
        serviceRate.id, new Date(), serviceRate.departmentId, effectiveQty, invoice.panelPatient);
      if (invoice.panelPatientId) {
        if (!invoice.panelPatient?.isActive || invoice.panelPatient.status !== 'ACTIVE' || !invoice.panelPatient.corporatePanel.isActive) throw new ValidationError('Panel patient and company must be active');
        if (invoice.sourceType !== 'ADMISSION') {
          assertMembershipEligible(invoice.panelPatient);
          // Admission invoices carry their authorization on AdmissionRecord
          // instead (checked in admission.service.ts); this invoice's own
          // authorizationNumber only applies to WALK_IN/OPD/OBS/ER encounters.
          assertCaseAuthorization(invoice.panelPatient.corporatePanel.authorizationRequired, coverage.matchedRule?.preauthorizationRequired, {
            authorizationNumber: invoice.authorizationNumber,
            authorizationValidUntil: invoice.authorizationValidUntil,
          });
        }
        if ((body.discountPercent ?? 0) > 0 || (body.discountAmount ?? 0) > 0 || body.manualRateOverride !== undefined) {
          throw new ValidationError('Panel charges use configured contract rates; manual overrides require a separate audited adjustment');
        }
        discountAmount = coverage.discountAmount;
        discountReason = coverage.discountReason;
      }

      // 2. Manual discount override if provided
      if (serviceRate.discountAllowed) {
        if (body.discountPercent !== undefined && body.discountPercent > 0) {
          discountAmount = lineGross.mul(body.discountPercent).div(100);
        } else if (body.discountAmount !== undefined && body.discountAmount > 0) {
          discountAmount = new Decimal(body.discountAmount);
        } else if (existingLine && existingLine.discountAmount.greaterThan(0)) {
          // Proportionately scale existing discount if manual discount was previously set
          discountAmount = existingLine.lineGross.greaterThan(0)
            ? lineGross.mul(existingLine.discountAmount).div(existingLine.lineGross)
            : new Decimal(0);
        }
      }

      // 3. Discount threshold governance check (§16 Q-05) for manual staff discounts
      const hasManualDiscount = (body.discountPercent !== undefined && body.discountPercent > 0) || (body.discountAmount !== undefined && body.discountAmount > 0);
      if (hasManualDiscount) {
        const discountPct = lineGross.greaterThan(0)
          ? discountAmount.mul(100).div(lineGross).toNumber()
          : 0;

        await validateDiscountAuthorization(actorRole, discountAmount, discountPct, 'Discount');
      }

      const lineNet = lineGross.minus(discountAmount);

      let targetLine: any;
      if (existingLine) {
        targetLine = await tx.invoiceLineItem.update({
          where: { id: existingLine.id },
          data: {
            rateSnapshot: rate,
            quantity: effectiveQty,
            lineGross,
            discountAmount,
            discountReason,
            lineNet,
            patientShare: invoice.panelPatientId ? coverage.patientShare : lineNet,
            panelReceivable: invoice.panelPatientId ? coverage.panelReceivable : new Decimal(0),
            coverageSnapshot: invoice.panelPatientId ? coverage.coverageSnapshot : undefined,
            performedByStaffId: existingLine.performedByStaffId ?? (body.performedByStaffId ?? null),
            isCompleted: true,
          },
          include: {
            serviceRate: true,
            performedBy: true,
          },
        });
      } else {
        targetLine = await tx.invoiceLineItem.create({
          data: {
            hospitalInvoiceId: invoice.id,
            serviceRateId: serviceRate.id,
            billingSource: serviceRate.billingSource, descriptionSnapshot: serviceRate.name,
            rateSnapshot: rate,
            quantity: qty,
            lineGross,
            discountAmount,
            discountReason,
            lineNet,
            patientShare: invoice.panelPatientId ? coverage.patientShare : lineNet,
            panelReceivable: invoice.panelPatientId ? coverage.panelReceivable : new Decimal(0),
            coverageSnapshot: invoice.panelPatientId ? coverage.coverageSnapshot : undefined,
            performedByStaffId: body.performedByStaffId ?? null,
            isCompleted: true,
          },
          include: {
            serviceRate: true,
            performedBy: true,
          },
        });
      }

      // Recalculate invoice header totals
      const otherLines = invoice.lines.filter((l) => l.id !== targetLine.id);
      const allLines = [...otherLines, targetLine];
      const newSubtotal = allLines.reduce((acc, l) => acc.plus(l.lineGross), new Decimal(0));
      const newDiscountTotal = allLines.reduce((acc, l) => acc.plus(l.discountAmount), new Decimal(0));
      const newTotal = allLines.reduce((acc, l) => acc.plus(l.lineNet), new Decimal(0));
      const newPatientShare = allLines.reduce((sum, line) => sum.plus(line.patientShare ?? line.lineNet), new Decimal(0));
      const newPanelReceivable = allLines.reduce((sum, line) => sum.plus(line.panelReceivable ?? 0), new Decimal(0));

      const newStatus = patientPaymentStatus(
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
          ...(invoice.departmentId ? {} : { departmentId: serviceRate.departmentId }),
        },
      });

      // Automatically accrue doctor commission if doctor is attached (§4.5, §8.6)
      if (targetLine.performedByStaffId) {
        await commissionService.calculateAndAccrueCommission(
          tx,
          targetLine,
          targetLine.performedByStaffId,
          _actorId,
        );
      }

      return targetLine;
    });
  },

  /**
   * Capture or renew a panel encounter's case authorization/guarantee.
   */
  async setAuthorization(invoiceId: string, body: SetInvoiceAuthorizationBody) {
    const invoice = await prisma.hospitalInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError('Invoice not found');
    if (!invoice.panelPatientId) throw new ValidationError('Authorization only applies to panel-billed encounters');
    if (invoice.status === 'VOID') throw new ValidationError('Cannot modify a void invoice');
    return prisma.hospitalInvoice.update({
      where: { id: invoiceId },
      data: {
        authorizationNumber: body.authorizationNumber !== undefined ? body.authorizationNumber || null : undefined,
        authorizationLimit: body.authorizationLimit !== undefined ? new Decimal(body.authorizationLimit) : undefined,
        authorizationValidUntil: body.authorizationValidUntil !== undefined ? body.authorizationValidUntil : undefined,
      },
    });
  },

  /**
   * Request / apply line or invoice-level discount — §4.6, §8.7
   * Strictly restricted to Hospital Services; Outsourced Lab / Radiology / Pharmacy
   * cannot receive discounts.
   */
  async applyDiscount(
    invoiceId: string,
    body: ApplyDiscountBody,
    _actorId: string,
    actorRole: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.hospitalInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          lines: {
            include: {
              serviceRate: {
                include: { department: true },
              },
            },
          },
          department: true,
        },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.panelPatientId) throw new ValidationError('Posted panel charges cannot be manually repriced; use an audited contract adjustment');
      if (invoice.lines.length === 0) throw new ValidationError('Cannot discount an empty invoice');

      if (body.lineItemId) {
        const line = invoice.lines.find((l) => l.id === body.lineItemId);
        if (!line) throw new NotFoundError('Invoice line item not found');

        if (!isEligibleHospitalService(line.serviceRate || line)) {
          throw new ValidationError(
            `Discounts cannot be applied to this item.`
          );
        }

        let discAmt = new Decimal(0);
        if (body.discountPercent !== undefined) {
          discAmt = line.lineGross.mul(body.discountPercent).div(100);
        } else if (body.discountAmount !== undefined) {
          discAmt = new Decimal(body.discountAmount);
        }

        if (discAmt.greaterThan(line.lineGross)) {
          throw new ValidationError(
            `Discount of PKR ${discAmt.toFixed(2)} exceeds line gross of PKR ${line.lineGross.toFixed(2)}.`
          );
        }

        const discPct = line.lineGross.greaterThan(0)
          ? discAmt.mul(100).div(line.lineGross).toNumber()
          : 0;

        await validateDiscountAuthorization(actorRole, discAmt, discPct, 'Discount');

        const newLineNet = line.lineGross.minus(discAmt);

        await tx.invoiceLineItem.update({
          where: { id: line.id },
          data: {
            discountAmount: discAmt,
            discountReason: body.discountReason,
            lineNet: newLineNet,
          },
        });
      } else {
        // Invoice-wide discount distributed across lines
        const eligibleLines = invoice.lines.filter((l) => isEligibleHospitalService(l.serviceRate || l));
        const nonEligibleLines = invoice.lines.filter((l) => !isEligibleHospitalService(l.serviceRate || l));

        if (eligibleLines.length === 0) {
          throw new ValidationError(
            `Cannot apply discount to this invoice.`
          );
        }

        const eligibleGross = eligibleLines.reduce((acc, l) => acc.plus(l.lineGross), new Decimal(0));
        let totalDiscAmt = new Decimal(0);
        if (body.discountPercent !== undefined) {
          totalDiscAmt = eligibleGross.mul(body.discountPercent).div(100);
        } else if (body.discountAmount !== undefined) {
          totalDiscAmt = new Decimal(body.discountAmount);
        }

        if (totalDiscAmt.greaterThan(eligibleGross)) {
          throw new ValidationError(
            `Discount of PKR ${totalDiscAmt.toFixed(2)} exceeds total charges of PKR ${eligibleGross.toFixed(2)}.`
          );
        }

        const discPct = eligibleGross.greaterThan(0)
          ? totalDiscAmt.mul(100).div(eligibleGross).toNumber()
          : 0;

        await validateDiscountAuthorization(actorRole, totalDiscAmt, discPct, 'Total discount');

        // Distribute discount proportionally across ELIGIBLE Hospital Services lines only!
        // Round to whole rupees so line amounts stay clean integer PKR (no fractional paisas).
        let remainingDiscAmt = totalDiscAmt;
        for (let i = 0; i < eligibleLines.length; i++) {
          const line = eligibleLines[i];
          if (!line) continue;
          let lineDisc: Decimal;
          if (i === eligibleLines.length - 1) {
            lineDisc = remainingDiscAmt;
          } else {
            const ratio = eligibleGross.greaterThan(0) ? line.lineGross.div(eligibleGross) : new Decimal(0);
            lineDisc = totalDiscAmt.mul(ratio).round();
            remainingDiscAmt = remainingDiscAmt.minus(lineDisc);
          }
          const lineNet = line.lineGross.minus(lineDisc);
          await tx.invoiceLineItem.update({
            where: { id: line.id },
            data: {
              discountAmount: lineDisc,
              discountReason: body.discountReason,
              lineNet,
            },
          });
        }

        // Ensure non-eligible lines (Lab / Radiology / Pharmacy) receive 0 discount
        for (const line of nonEligibleLines) {
          if (!line.discountAmount.isZero()) {
            await tx.invoiceLineItem.update({
              where: { id: line.id },
              data: {
                discountAmount: new Decimal(0),
                lineNet: line.lineGross,
              },
            });
          }
        }
      }

      // Recalculate invoice totals
      const refreshedLines = await tx.invoiceLineItem.findMany({
        where: { hospitalInvoiceId: invoice.id },
      });

      for (const line of refreshedLines) {
        const original = invoice.lines.find(l => l.id === line.id);
        if (original && !original.lineNet.equals(line.lineNet)) {
          await commissionService.repriceCommission(tx, line.id, original.lineNet, line.lineNet, _actorId, `Service discount: ${body.discountReason}`);
        }
      }

      const newSubtotal = refreshedLines.reduce((acc, l) => acc.plus(l.lineGross), new Decimal(0));
      const newDiscountTotal = refreshedLines.reduce((acc, l) => acc.plus(l.discountAmount), new Decimal(0));
      const newTotal = refreshedLines.reduce((acc, l) => acc.plus(l.lineNet), new Decimal(0));

      const newStatus = invoice.paidTotal.greaterThanOrEqualTo(newTotal)
        ? 'PAID'
        : invoice.paidTotal.greaterThan(0)
          ? 'PARTIALLY_PAID'
          : 'UNPAID';

      const resolvedDeptId = invoice.departmentId || invoice.lines[0]?.serviceRate?.departmentId || null;

      return tx.hospitalInvoice.update({
        where: { id: invoice.id },
        data: {
          subtotal: newSubtotal,
          discountTotal: newDiscountTotal,
          total: newTotal,
          status: newStatus,
          ...(resolvedDeptId && !invoice.departmentId ? { departmentId: resolvedDeptId } : {}),
        },
        include: {
          lines: { include: { serviceRate: { include: { department: true } }, performedBy: true } },
          paymentReceipts: true,
          department: true,
        },
      });
    });
  },

  /**
   * Collect payment against a Hospital Invoice — §4.6, §8.7
   * Adjusts prior advance payment, creates official receipt, updates paidTotal,
   * and feeds cashier physical cash vs digital balance (§4.9, §8.12).
   */
  async collectPayment(invoiceId: string, body: CollectPaymentBody, actorId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const identity = await tx.hospitalInvoice.findUnique({ where: { id: invoiceId }, select: { admissionRecordId: true } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity?.admissionRecordId ?? invoiceId}))`;
      const invoice = await tx.hospitalInvoice.findUnique({
        where: { id: invoiceId },
        include: { paymentReceipts: true, lines: true },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.sourceType !== 'ADMISSION' && patientPaymentStatus(invoice, invoice.paidTotal) === 'PAID') throw new ValidationError('This invoice is already fully paid');
      if (invoice.status === 'VOID') throw new ValidationError('Cannot pay a void invoice');

      const amountDecimal = new Decimal(body.amount);
      const remainingBalance = patientResponsibility(invoice).minus(invoice.paidTotal);

      if ((invoice.panelPatientId || invoice.sourceType !== 'ADMISSION') && amountDecimal.greaterThan(remainingBalance)) {
        throw new ValidationError(
          `Payment amount of PKR ${amountDecimal.toFixed(2)} exceeds remaining balance of PKR ${remainingBalance.toFixed(2)}`,
        );
      }

      const receiptNumber = await generateReceiptNumber(tx);

      const receipt = await tx.paymentReceipt.create({
        data: {
          receiptNumber,
          hospitalInvoiceId: invoice.id,
          amount: amountDecimal,
          admissionRecordId: invoice.admissionRecordId,
          method: body.paymentMethod,
          reference: body.reference ?? `Payment for Invoice ${invoice.invoiceNumber}`,
          collectedById: actorId,
        },
      });

      // Universal Cash Accountability ledger (§4.9, §8.12)
      // Cash increases physical cash; digital methods tracked as non-physical
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

      const previousPaidTotal = invoice.paidTotal;
      const newPaidTotal = invoice.paidTotal.plus(amountDecimal);
      const newStatus = patientPaymentStatus(invoice, newPaidTotal);

      const updatedInvoice = await tx.hospitalInvoice.update({
        where: { id: invoice.id },
        data: {
          paidTotal: newPaidTotal,
          status: newStatus,
        },
        include: {
          lines: { include: { serviceRate: true, performedBy: true } },
          paymentReceipts: true,
        },
      });

      // ── Pharmacy Charges & Cross-Entity Settlement Reconciliation ──
      const pharmacyNotifications: Array<{ pharmacyInvoiceNumber: string; amount: number; receiptNumber: string }> = [];

      {
        const invoiceLines = await tx.invoiceLineItem.findMany({
          where: { hospitalInvoiceId: invoice.id },
          orderBy: { createdAt: 'asc' },
          select: { billingSource: true, patientShare: true },
        });

        let cursor = new Decimal(0);
        let pharmacyPortion = new Decimal(0);
        for (const line of invoiceLines) {
          const lineStart = cursor;
          const lineEnd = cursor.plus(line.patientShare);
          cursor = lineEnd;
          if (line.billingSource !== 'PHARMACY') continue;
          const overlapStart = Decimal.max(lineStart, previousPaidTotal);
          const overlapEnd = Decimal.min(lineEnd, newPaidTotal);
          if (overlapEnd.greaterThan(overlapStart)) {
            pharmacyPortion = pharmacyPortion.plus(overlapEnd.minus(overlapStart));
          }
        }

        if (pharmacyPortion.greaterThan(0) && invoice.admissionRecordId) {
          const charges = await tx.hmsPharmacyCharge.findMany({
            where: { admissionRecordId: invoice.admissionRecordId },
            orderBy: { createdAt: 'asc' },
          });

          let remainingPortion = pharmacyPortion;
          for (const charge of charges) {
            if (remainingPortion.lessThanOrEqualTo(0)) break;
            const uncollected = Decimal.max(0, charge.totalAmount.minus(charge.patientPaid));
            if (uncollected.lessThanOrEqualTo(0)) continue;

            const alloc = Decimal.min(remainingPortion, uncollected);
            const newPatientPaid = charge.patientPaid.plus(alloc);
            const newPatientOutstanding = Decimal.max(0, charge.totalAmount.minus(newPatientPaid));
            const chargePaidInFull = newPatientOutstanding.equals(0);
            const newPatientPaymentStatus = chargePaidInFull ? 'CLEARED' : 'PARTIALLY_COLLECTED';
            const settlementStatus = chargePaidInFull && charge.settlementStatus === 'NOT_DUE' ? 'PENDING' : charge.settlementStatus;

            await tx.hmsPharmacyCharge.update({
              where: { id: charge.id },
              data: {
                patientPaid: newPatientPaid,
                patientOutstanding: newPatientOutstanding,
                patientPaymentStatus: newPatientPaymentStatus,
                settlementStatus,
                collectedById: actorId,
                collectedAt: new Date(),
              },
            });

            pharmacyNotifications.push({
              pharmacyInvoiceNumber: charge.pharmacyInvoiceNumber,
              amount: Number(alloc),
              receiptNumber,
            });

            remainingPortion = remainingPortion.minus(alloc);
          }

          if (invoice.admissionRecordId) {
            const totalChargesCount = await tx.hmsPharmacyCharge.count({
              where: { admissionRecordId: invoice.admissionRecordId },
            });
            const uncollectedChargesCount = await tx.hmsPharmacyCharge.count({
              where: {
                admissionRecordId: invoice.admissionRecordId,
                patientPaymentStatus: { not: 'CLEARED' },
              },
            });

            if (totalChargesCount > 0 && uncollectedChargesCount === 0) {
              await tx.dualDischargeClearance.upsert({
                where: {
                  admissionRecordId_clearanceType: {
                    admissionRecordId: invoice.admissionRecordId,
                    clearanceType: 'PHARMACY',
                  },
                },
                update: {
                  status: 'CLEARED',
                  clearedById: actorId,
                  clearedAt: new Date(),
                },
                create: {
                  admissionRecordId: invoice.admissionRecordId,
                  clearanceType: 'PHARMACY',
                  status: 'CLEARED',
                  clearedById: actorId,
                  clearedAt: new Date(),
                },
              });
            }
          }
        }
      }

      return { receipt, invoice: updatedInvoice, pharmacyNotifications };
    });

    // Notify Pharmacy Software via Bridge asynchronously outside the DB transaction
    for (const notif of result.pharmacyNotifications || []) {
      pharmacyBridgeClient.notifyPatientCollected({
        pharmacyInvoiceNumber: notif.pharmacyInvoiceNumber,
        collectedAmount: notif.amount,
        receiptNumber: notif.receiptNumber,
        collectedAt: result.receipt.collectedAt.toISOString(),
        method: result.receipt.method,
        collectedBy: result.receipt.collectedById,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[invoicesService] Failed to notify pharmacy of patient collection:', err);
      });
    }

    return { receipt: result.receipt, invoice: result.invoice };
  },

  /**
   * Process refund against an invoice / receipt with strict audit trail — §4.6, §8.7
   * Decreases cashier physical cash (if cash), reduces invoice paidTotal,
   * and creates linked Doctor Commission reversal if commission was accrued.
   */
  async refundPayment(invoiceId: string, body: RefundPaymentBody, actorId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const identity = await tx.hospitalInvoice.findUnique({ where: { id: invoiceId }, select: { admissionRecordId: true } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity?.admissionRecordId ?? invoiceId}))`;
      const invoice = await tx.hospitalInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          lines: { include: { commissionAccrual: true } },
          paymentReceipts: true,
        },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');

      if (body.requestKey) {
        const previous = await tx.paymentReceipt.findUnique({ where: { refundRequestKey: body.requestKey } });
        if (previous) {
          if (previous.hospitalInvoiceId !== invoiceId || !previous.amount.equals(new Decimal(body.amount).negated()) || previous.method !== body.refundMethod || previous.originalReceiptId !== (body.paymentReceiptId ?? null)) {
            throw new ValidationError('Refund request key was already used for a different refund');
          }
          return { refundReceipt: previous, invoice, pharmacyNotifications: [] };
        }
      }
      if (invoice.status === 'VOID') throw new ValidationError('Cannot refund a void invoice');

      const refundAmount = new Decimal(body.amount);
      if (!refundAmount.gt(0)) throw new ValidationError('Refund amount must be positive');
      if (body.paymentReceiptId) {
        const original = invoice.paymentReceipts.find(r => r.id === body.paymentReceiptId && r.amount.gt(0) && !r.isReversed);
        if (!original) throw new ValidationError('Original receipt does not belong to this invoice or is not refundable');
        const refunded = await tx.paymentReceipt.aggregate({ where: { originalReceiptId: original.id }, _sum: { amount: true } });
        const available = original.amount.plus(refunded._sum.amount ?? 0);
        if (refundAmount.gt(available)) throw new ValidationError('Refund exceeds the remaining amount on the original receipt');
      }
      if (refundAmount.greaterThan(invoice.paidTotal)) {
        throw new ValidationError(
          `Refund amount PKR ${refundAmount.toFixed(2)} cannot exceed total paid PKR ${invoice.paidTotal.toFixed(2)}`,
        );
      }

      const receiptNumber = await generateReceiptNumber(tx);

      // Record reversal receipt row (preserving audit trail, no silent deletion per D16 p.22)
      const reversalReceipt = await tx.paymentReceipt.create({
        data: {
          receiptNumber,
          hospitalInvoiceId: invoice.id,
          amount: refundAmount.negated(),
          admissionRecordId: invoice.admissionRecordId,
          originalReceiptId: body.paymentReceiptId,
          refundRequestKey: body.requestKey,
          method: body.refundMethod,
          reference: `Refund for ${invoice.invoiceNumber}: ${body.reason}`,
          collectedById: actorId,
          isReversed: true,
        },
      });

      // Cashier Balance Sheet: OUT transaction reduces expected physical cash
      await tx.userCashBalance.create({
        data: {
          portalUserId: actorId,
          moduleScope: 'BILLING',
          direction: 'OUT',
          amount: refundAmount,
          category: 'REFUND',
          isPhysicalCash: body.refundMethod === 'CASH',
          paymentReceiptId: reversalReceipt.id,
        },
      });

      const newPaidTotal = invoice.paidTotal.minus(refundAmount);
      const newStatus = patientPaymentStatus(invoice, newPaidTotal);

      const updatedInvoice = await tx.hospitalInvoice.update({
        where: { id: invoice.id },
        data: {
          paidTotal: newPaidTotal,
          status: newStatus,
        },
      });

      // Reverse doctor commission accruals for lines where commission was accrued
      const chargePaymentReversed = Decimal.max(0, Decimal.min(invoice.paidTotal, patientResponsibility(invoice)).minus(Decimal.min(newPaidTotal, patientResponsibility(invoice))));
      for (const line of invoice.lines) {
        if (line.commissionAccrual) {
          await commissionService.reverseCommissionAccrual(
            tx,
            line.id,
            `Refund: ${body.reason}`,
            actorId,
            invoice.total.gt(0) ? chargePaymentReversed.div(invoice.total) : new Decimal(0),
          );
        }
      }

      const pharmacyNotifications: Array<{ pharmacyInvoiceNumber: string; authoritativeCollectedAmount: number }> = [];
      if (invoice.admissionRecordId) {
        const lines = await tx.invoiceLineItem.findMany({ where: { hospitalInvoiceId: invoice.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { billingSource: true, patientShare: true } });
        let remaining = computePharmacyPortion(lines, new Decimal(0), newPaidTotal);
        const charges = await tx.hmsPharmacyCharge.findMany({ where: { admissionRecordId: invoice.admissionRecordId }, orderBy: { createdAt: 'asc' } });
        for (const charge of charges) {
          const paid = Decimal.min(charge.patientPaid, remaining);
          remaining = Decimal.max(0, remaining.minus(paid));
          const outstanding = charge.patientOutstanding.plus(charge.patientPaid.minus(paid));
          await tx.hmsPharmacyCharge.update({
            where: { id: charge.id }, data: {
              patientPaid: paid, patientOutstanding: outstanding,
              patientPaymentStatus: outstanding.isZero() ? 'CLEARED' : paid.gt(0) ? 'PARTIALLY_COLLECTED' : 'PENDING',
            }
          });
          pharmacyNotifications.push({ pharmacyInvoiceNumber: charge.pharmacyInvoiceNumber, authoritativeCollectedAmount: Number(paid) });
        }
        await tx.dualDischargeClearance.updateMany({ where: { admissionRecordId: invoice.admissionRecordId, clearanceType: { in: ['HOSPITAL_BILLING', ...(charges.some(c => c.patientPaid.gt(0)) ? ['PHARMACY' as const] : [])] } }, data: { status: 'PENDING', clearedAt: null, clearedById: null } });
      }
      return {
        refundReceipt: reversalReceipt,
        invoice: updatedInvoice,
        pharmacyNotifications,
      };
    });
    for (const notification of result.pharmacyNotifications) {
      await pharmacyBridgeClient.reconcileCollection({ ...notification,
        collectedAt: result.refundReceipt.collectedAt.toISOString(),receiptNumber:result.refundReceipt.receiptNumber,
        method:result.refundReceipt.method,collectedBy:result.refundReceipt.collectedById }).catch(err => {
        console.error('[refundPayment] Pharmacy reconciliation failed:', err);
      });
    }
    return { refundReceipt: result.refundReceipt, invoice: result.invoice };
  },

  /**
   * Printable receipt & invoice view payload (§8.7, D17 p.8)
   */
  async getReceipt(invoiceId: string) {
    const invoice = await prisma.hospitalInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        panelPatient: { include: { corporatePanel: true } },
        selfPayEncounter: true,
        department: true,
        appointment: { include: { doctor: true, department: true } },
        admissionRecord: {
          include: {
            doctor: true,
            department: true,
            bed: {
              include: {
                room: {
                  include: {
                    ward: true,
                  },
                },
              },
            },
          },
        },
        lines: {
          include: {
            serviceRate: {
              include: {
                department: true,
              },
            },
            performedBy: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        paymentReceipts: {
          include: { collectedBy: { select: { id: true, username: true } } },
          orderBy: { collectedAt: 'asc' },
        },
        createdByUser: { select: { id: true, username: true, role: true } },
      },
    });

    if (!invoice) throw new NotFoundError('Invoice not found');

    const hospitalProfile = await prisma.hospitalProfile.findFirst();

    const outstanding = Decimal.max(0, patientResponsibility(invoice).minus(invoice.paidTotal));
    const advanceCredit = Decimal.max(0, invoice.paidTotal.minus(patientResponsibility(invoice)));

    const latestReceipt = invoice.paymentReceipts.length > 0 ? invoice.paymentReceipts[invoice.paymentReceipts.length - 1] : null;
    const receivedNow = latestReceipt ? Number(latestReceipt.amount) : Number(invoice.paidTotal);
    const previouslyPaid = Math.max(0, Number(invoice.paidTotal) - receivedNow);

    const docName =
      invoice.appointment?.doctor?.fullName ||
      invoice.admissionRecord?.doctor?.fullName ||
      invoice.lines[0]?.performedBy?.fullName ||
      'Consultant';

    const patientName = invoice.panelPatient
      ? invoice.panelPatient.fullName
      : invoice.selfPayEncounter?.fullName ?? 'Walk-In Patient';

    const mrNumber = invoice.panelPatient
      ? invoice.panelPatient.mrNumber
      : invoice.selfPayEncounter?.mrNumber ?? '';

    const patientAge = invoice.panelPatient?.dob
      ? Math.max(0, new Date().getFullYear() - new Date(invoice.panelPatient.dob).getFullYear())
      : invoice.selfPayEncounter?.dob
        ? Math.max(0, new Date().getFullYear() - new Date(invoice.selfPayEncounter.dob).getFullYear())
        : null;

    const patientGender = invoice.panelPatient?.gender ?? invoice.selfPayEncounter?.gender ?? null;

    const resolvedWeight =
      invoice.weightKg != null
        ? Number(invoice.weightKg)
        : invoice.admissionRecord?.weightKg != null
          ? Number(invoice.admissionRecord.weightKg)
          : (invoice.selfPayEncounter as any)?.weightKg != null
            ? Number((invoice.selfPayEncounter as any).weightKg)
            : null;

    const filteredLines = invoice.lines.filter(
      (l) => invoice.sourceType !== 'ADMISSION' || l.serviceRate?.code !== 'ADM-ADVANCE'
    );

    const lineItems = filteredLines.map((l) => ({
      lineId: l.id,
      serviceId: l.serviceRateId ?? '',
      serviceCode: l.serviceRate?.code ?? '',
      serviceName: (l.descriptionSnapshot ?? l.serviceRate?.name ?? l.billingSource),
      quantity: Number(l.quantity),
      unitRate: Number(l.rateSnapshot),
      grossAmount: Number(l.lineGross),
      discountAmount: Number(l.discountAmount),
      discountReason: l.discountReason ?? '',
      taxAmount: 0,
      netAmount: Number(l.lineNet),
      sourceType: l.billingSource,
      performedByName: l.performedBy?.fullName ?? '',
      billingUnit: (l.serviceRate?.billingUnit ?? 'Items'),
    }));

    return {
      // Canonical Top-Level Receipt DTO
      receiptNumber: latestReceipt?.receiptNumber || 'RCP-PENDING',
      invoiceNumber: invoice.invoiceNumber,
      encounterType: invoice.encounterType ?? (invoice.sourceType === 'ADMISSION' ? 'ADMISSION' : 'OPD'),
      encounterRef: invoice.sourceType,
      tokenNumber: invoice.queueNumber || null,
      mrNumber,
      patientName,
      patientAge,
      patientGender,
      patientWeight: resolvedWeight,
      doctorName: docName,
      admissionNumber: invoice.admissionRecord?.admissionNumber || null,
      wardName: invoice.admissionRecord?.bed?.room?.ward?.name || null,
      bedNumber: invoice.admissionRecord?.bed?.bedNumber || null,
      dateTime: latestReceipt?.collectedAt || invoice.createdAt,
      lineItems,
      subtotal: Number(invoice.subtotal),
      totalDiscount: Number(invoice.discountTotal),
      totalTax: 0,
      netTotal: Number(invoice.total),
      paidAmount: Number(invoice.paidTotal),
      receivedNow,
      previouslyPaid,
      outstanding: Number(outstanding),
      advanceCredit: Number(advanceCredit),
      paymentMethod: latestReceipt?.method ?? 'CASH',
      collectedBy: latestReceipt?.collectedBy?.username ?? invoice.createdByUser?.username ?? 'Cashier',
      isReprint: false,

      // Nested structures for full backward compatibility
      hospital: {
        name: hospitalProfile?.name ?? 'CH Sharif & Saeed Hospital',
        address: hospitalProfile?.address ?? '',
        phone: hospitalProfile?.contactPhone ?? '',
        email: hospitalProfile?.contactEmail ?? '',
        billingLegalMetadata: hospitalProfile?.billingLegalMetadata ?? {},
      },
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        sourceType: invoice.sourceType,
        encounterType: invoice.encounterType,
        queueNumber: invoice.queueNumber,
        createdAt: invoice.createdAt,
        status: invoice.status === 'VOID' ? 'VOID' : patientPaymentStatus(invoice, invoice.paidTotal),
        subtotal: invoice.subtotal,
        discountTotal: invoice.discountTotal,
        total: invoice.total,
        paidTotal: invoice.paidTotal,
        outstandingBalance: outstanding,
        patientShare: invoice.panelPatientId ? invoice.patientShare : invoice.total,
        panelReceivable: invoice.panelReceivable,
      },
      patient: invoice.panelPatient
        ? {
          type: 'PANEL',
          name: invoice.panelPatient.fullName,
          mrNumber: invoice.panelPatient.mrNumber,
          phone: invoice.panelPatient.phone,
          corporatePanel: invoice.panelPatient.corporatePanel.organizationName,
          age: patientAge,
          gender: patientGender,
          weightKg: resolvedWeight,
        }
        : {
          type: 'SELF_PAY',
          name: invoice.selfPayEncounter?.fullName ?? 'Walk-In Patient',
          mrNumber: invoice.selfPayEncounter?.mrNumber ?? '',
          phone: invoice.selfPayEncounter?.phone,
          cnic: invoice.selfPayEncounter?.cnicOrPassport,
          age: patientAge,
          gender: patientGender,
          weightKg: resolvedWeight,
        },
      lines: lineItems.map((l) => ({
        id: l.lineId,
        billingSource: l.sourceType,
        serviceName: l.serviceName,
        billingUnit: l.billingUnit,
        rate: l.unitRate,
        quantity: l.quantity,
        gross: l.grossAmount,
        discount: l.discountAmount,
        net: l.netAmount,
        performedBy: l.performedByName || 'Hospital',
      })),
      payments: invoice.paymentReceipts.map((p) => ({
        receiptNumber: p.receiptNumber,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        collectedAt: p.collectedAt,
        collectedBy: p.collectedBy.username,
        isReversed: p.isReversed,
      })),
    };
  },

  async listInvoices(query: ListInvoicesQuery) {
    const where: Prisma.HospitalInvoiceWhereInput = {};
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.encounterType) where.encounterType = query.encounterType;
    if (query.status) where.status = query.status;
    if (query.panelPatientId) where.panelPatientId = query.panelPatientId;
    if (query.selfPayEncounterId) where.selfPayEncounterId = query.selfPayEncounterId;

    if (query.date) {
      const startOfDay = new Date(`${query.date}T00:00:00.000Z`);
      const endOfDay = new Date(`${query.date}T23:59:59.999Z`);
      where.createdAt = { gte: startOfDay, lte: endOfDay };
    }

    if (query.search) {
      const s = query.search.trim();
      const sDigits = s.replace(/\D/g, '');
      where.OR = [
        { invoiceNumber: { contains: s, mode: 'insensitive' } },
        { queueNumber: { contains: s, mode: 'insensitive' } },
        { panelPatient: { fullName: { contains: s, mode: 'insensitive' } } },
        { panelPatient: { mrNumber: { contains: s, mode: 'insensitive' } } },
        { panelPatient: { phone: { contains: s, mode: 'insensitive' } } },
        { panelPatient: { cnicOrPassport: { contains: s, mode: 'insensitive' } } },
        { selfPayEncounter: { fullName: { contains: s, mode: 'insensitive' } } },
        { selfPayEncounter: { mrNumber: { contains: s, mode: 'insensitive' } } },
        { selfPayEncounter: { phone: { contains: s, mode: 'insensitive' } } },
        { selfPayEncounter: { cnicOrPassport: { contains: s, mode: 'insensitive' } } },
        { admissionRecord: { panelPatient: { fullName: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { panelPatient: { mrNumber: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { panelPatient: { phone: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { panelPatient: { cnicOrPassport: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { selfPayEncounter: { fullName: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { selfPayEncounter: { mrNumber: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { selfPayEncounter: { phone: { contains: s, mode: 'insensitive' } } } },
        { admissionRecord: { selfPayEncounter: { cnicOrPassport: { contains: s, mode: 'insensitive' } } } },
        ...(sDigits.length >= 4
          ? [
            { panelPatient: { phone: { contains: sDigits, mode: 'insensitive' as const } } },
            { panelPatient: { cnicOrPassport: { contains: sDigits, mode: 'insensitive' as const } } },
            { selfPayEncounter: { phone: { contains: sDigits, mode: 'insensitive' as const } } },
            { selfPayEncounter: { cnicOrPassport: { contains: sDigits, mode: 'insensitive' as const } } },
            { admissionRecord: { panelPatient: { phone: { contains: sDigits, mode: 'insensitive' as const } } } },
            { admissionRecord: { panelPatient: { cnicOrPassport: { contains: sDigits, mode: 'insensitive' as const } } } },
            { admissionRecord: { selfPayEncounter: { phone: { contains: sDigits, mode: 'insensitive' as const } } } },
            { admissionRecord: { selfPayEncounter: { cnicOrPassport: { contains: sDigits, mode: 'insensitive' as const } } } },
          ]
          : []),
      ];
    }

    // Record-type filters (Discounts / Refunds / Payments-Receipts nav items) —
    // applied in the WHERE clause so they hold across the whole table, not
    // just whatever lands inside the `take: 100` most-recent window below.
    if (query.hasDiscount === 'true') where.discountTotal = { gt: 0 };
    if (query.hasRefund === 'true') where.paymentReceipts = { some: { isReversed: true } };
    if (query.hasPayment === 'true') where.paymentReceipts = { some: {} };
    if (query.isPanel === 'true') where.panelPatientId = { not: null };
    if (query.corporatePanelId) where.corporatePanelId = query.corporatePanelId;
    if (query.hasOutstandingBalance === 'true' && !query.status) {
      where.status = { in: ['UNPAID', 'PARTIALLY_PAID'] };
    }

    const invoices = await prisma.hospitalInvoice.findMany({
      where,
      include: {
        panelPatient: {
          select: {
            id: true,
            fullName: true,
            mrNumber: true,
            phone: true,
            cnicOrPassport: true,
            panelMemberId: true,
            corporatePanel: { select: { id: true, code: true, organizationName: true } },
          },
        },
        corporatePanel: { select: { id: true, code: true, organizationName: true } },
        selfPayEncounter: {
          select: {
            id: true,
            fullName: true,
            mrNumber: true,
            phone: true,
            cnicOrPassport: true,
          },
        },
        admissionRecord: {
          select: {
            id: true,
            admissionNumber: true,
            panelPatient: {
              select: { id: true, fullName: true, mrNumber: true, phone: true, cnicOrPassport: true },
            },
            selfPayEncounter: {
              select: { id: true, fullName: true, mrNumber: true, phone: true, cnicOrPassport: true },
            },
          },
        },
        department: { select: { id: true, name: true, code: true } },
        doctor: { select: { id: true, fullName: true, employeeId: true } },
        rmo: { select: { id: true, fullName: true, employeeId: true } },
        lines: { select: { id: true, lineNet: true, quantity: true } },
        paymentReceipts: { select: { id: true, receiptNumber: true, amount: true, method: true, isReversed: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return invoices.map((inv) => ({
      ...inv,
      balanceDue: patientBalanceDue(inv, inv.paidTotal).toNumber(),
      status: inv.status === 'VOID' ? 'VOID' : patientPaymentStatus(inv, inv.paidTotal),
    }));
  },

  async getInvoice(id: string) {
    const invoice = await prisma.hospitalInvoice.findUnique({
      where: { id },
      include: {
        panelPatient: { include: { corporatePanel: true } },
        selfPayEncounter: true,
        department: true,
        doctor: true,
        rmo: true,
        appointment: { include: { doctor: true, department: true } },
        admissionRecord: {
          include: {
            department: true,
            doctor: true,
            rmo: true,
            bed: {
              include: {
                room: {
                  include: {
                    ward: true,
                  },
                },
              },
            },
          },
        },
        lines: {
          include: {
            serviceRate: {
              include: {
                department: true,
              },
            },
            performedBy: true,
            commissionAccrual: true,
          },
        },
        paymentReceipts: {
          include: { collectedBy: { select: { id: true, username: true } } },
          orderBy: { collectedAt: 'asc' },
        },
        createdByUser: { select: { id: true, username: true, role: true } },
      },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');

    const resolvedWeight =
      invoice.weightKg != null
        ? Number(invoice.weightKg)
        : invoice.admissionRecord?.weightKg != null
          ? Number(invoice.admissionRecord.weightKg)
          : (invoice.selfPayEncounter as any)?.weightKg != null
            ? Number((invoice.selfPayEncounter as any).weightKg)
            : (() => {
              const allNotes = String(invoice.notes || invoice.admissionRecord?.notes || invoice.appointment?.notes || '');
              const m = allNotes.match(/weight[:\s]+([0-9]+(?:\.[0-9]+)?)/i);
              return m && m[1] ? Number(m[1]) : null;
            })();

    return {
      ...invoice,
      weightKg: resolvedWeight,
      patientWeight: resolvedWeight,
      balanceDue: patientBalanceDue(invoice, invoice.paidTotal).toNumber(),
      status: invoice.status === 'VOID' ? 'VOID' : patientPaymentStatus(invoice, invoice.paidTotal),
      lines: invoice.lines.filter((l) => invoice.sourceType !== 'ADMISSION' || l.serviceRate?.code !== 'ADM-ADVANCE'),
    };
  },

  async updateInvoiceWeight(id: string, weightKg: number) {
    const invoice = await prisma.hospitalInvoice.findUnique({
      where: { id },
      include: { selfPayEncounter: true, admissionRecord: true },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');

    const dec = new Decimal(weightKg);
    const updated = await prisma.hospitalInvoice.update({
      where: { id },
      data: { weightKg: dec },
    });

    if (invoice.selfPayEncounterId) {
      await prisma.selfPayEncounter.update({
        where: { id: invoice.selfPayEncounterId },
        data: { weightKg: dec },
      }).catch(() => { });
    }

    if (invoice.admissionRecordId) {
      await prisma.admissionRecord.update({
        where: { id: invoice.admissionRecordId },
        data: { weightKg: dec },
      }).catch(() => { });
    }

    return {
      ...updated,
      weightKg: Number(dec),
      patientWeight: Number(dec),
    };
  },
};
