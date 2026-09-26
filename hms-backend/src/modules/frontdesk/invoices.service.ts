import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { assertMembershipEligible } from '@/shared/panelMembership';
import { assertCaseAuthorization } from '@/shared/panelAuthorization';
import { patientPaymentStatus, patientResponsibility } from '@/shared/invoicePaymentStatus';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError, AuthorizationError } from '@/shared/errors/AppError';
import { commissionService } from '@/modules/commission/commission.service';
import type {
  CreateEncounterBody,
  AddServiceLineBody,
  ApplyDiscountBody,
  CollectPaymentBody,
  RefundPaymentBody,
  ListInvoicesQuery,
  SetInvoiceAuthorizationBody,
} from './invoices.schemas';

import { generateInvoiceNumber, generateReceiptNumber, generateMrNumber } from '@/shared/idGenerator';

const DISCOUNT_APPROVAL_PERCENT_THRESHOLD = 15; // > 15% requires Admin approval
const DISCOUNT_APPROVAL_AMOUNT_THRESHOLD = 1500; // > PKR 1,500 requires Admin approval

function isEligibleHospitalService(serviceRate: any): boolean {
  if (!serviceRate) return true;
  if (serviceRate.discountAllowed === false) return false;
  if (serviceRate.serviceStream === 'LAB') return false;

  const cat = (serviceRate.category || '').toLowerCase();
  if (
    cat.includes('lab') ||
    cat.includes('pathology') ||
    cat.includes('pharmacy') ||
    cat.includes('radiology') ||
    cat.includes('diagnostic')
  ) {
    return false;
  }

  const dept = serviceRate.department;
  if (dept) {
    if (dept.fulfillmentOwnership === 'OUTSOURCED') return false;
    if (Boolean(dept.outsourcedProviderId)) return false;
    if (dept.pharmacyRelated) return false;
    const deptName = (dept.name || '').toLowerCase();
    const deptCode = (dept.code || '').toLowerCase();
    if (
      deptName.includes('lab') ||
      deptName.includes('pathology') ||
      deptName.includes('pharmacy') ||
      deptName.includes('radiology') ||
      deptName.includes('imaging') ||
      deptCode.includes('lab') ||
      deptCode.includes('pharm') ||
      deptCode.includes('rad')
    ) {
      return false;
    }
  }

  return true;
}

export const invoicesService = {
  /**
   * Create immediate encounter (Walk-In, OPD, Observation, Emergency) — §4.6 Sub-flow B
   * D16 p.9: "Observation and Emergency are encounter/workflow types, not separate login portals."
   */
  async createEncounter(body: CreateEncounterBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
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
        const patient = await tx.panelPatient.findUnique({ where: { id: body.panelPatientId }, include: { corporatePanel: true } });
        if (!patient?.isActive || patient.status !== 'ACTIVE' || !patient.corporatePanel.isActive) throw new ValidationError('Panel patient and company must be active');
        assertMembershipEligible(patient);
        assertCaseAuthorization(patient.corporatePanel.authorizationRequired, false, {
          authorizationNumber: body.authorizationNumber,
          authorizationValidUntil: body.authorizationValidUntil,
        });
      }

      const invoiceNumber = await generateInvoiceNumber(tx);

      const invoice = await tx.hospitalInvoice.create({
        data: {
          invoiceNumber,
          sourceType: 'WALK_IN',
          encounterType: body.encounterType,
          panelPatientId: body.panelPatientId,
          selfPayEncounterId,
          departmentId: body.departmentId || null,
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
        },
      });

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
        where: { id: body.serviceRateId },
      });
      if (!serviceRate || !serviceRate.isActive) {
        throw new NotFoundError('Service rate not found or inactive');
      }

      // Rate snapshot: frozen at billing time (D15 §15)
      let rate = serviceRate.standardRate;
      if (body.manualRateOverride !== undefined) {
        if (!serviceRate.manualRateOverrideAllowed && !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
          throw new AuthorizationError('Manual rate override is not permitted for this service');
        }
        rate = new Decimal(body.manualRateOverride);
      }

      const qty = new Decimal(body.quantity);
      const lineGross = rate.mul(qty);

      // Discount calculation:
      let discountAmount = new Decimal(0);
      let discountReason = body.discountReason ?? null;

      const coverage = resolvePanelCoverage(lineGross, invoice.panelPatient?.corporatePanel?.discountRules,
        serviceRate.id, new Date(), serviceRate.departmentId, qty, invoice.panelPatient);
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
        }
      }

      // 3. Discount threshold governance check (§16 Q-05) for manual staff discounts
      const hasManualDiscount = (body.discountPercent !== undefined && body.discountPercent > 0) || (body.discountAmount !== undefined && body.discountAmount > 0);
      if (hasManualDiscount) {
        const discountPct = lineGross.greaterThan(0)
          ? discountAmount.mul(100).div(lineGross).toNumber()
          : 0;

        if (
          (discountPct > DISCOUNT_APPROVAL_PERCENT_THRESHOLD ||
            discountAmount.toNumber() > DISCOUNT_APPROVAL_AMOUNT_THRESHOLD) &&
          !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)
        ) {
          throw new AuthorizationError(
            `Discount of PKR ${discountAmount.toFixed(2)} (${discountPct.toFixed(1)}%) exceeds the front desk threshold (Max ${DISCOUNT_APPROVAL_PERCENT_THRESHOLD}% or PKR ${DISCOUNT_APPROVAL_AMOUNT_THRESHOLD}). Please request Admin approval.`,
          );
        }
      }

      const lineNet = lineGross.minus(discountAmount);

      const createdLine = await tx.invoiceLineItem.create({
        data: {
          hospitalInvoiceId: invoice.id,
          serviceRateId: serviceRate.id,
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

      // Recalculate invoice header totals
      const allLines = [...invoice.lines, createdLine];
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
      if (body.performedByStaffId) {
        await commissionService.calculateAndAccrueCommission(
          tx,
          createdLine,
          body.performedByStaffId,
        );
      }

      return createdLine;
    });
  },

  /**
   * Capture or renew a panel encounter's case authorization/guarantee
   * reference after it was already opened (panel.md §15 backlog item 2) —
   * e.g. a service line turns out to match a rule that independently
   * requires preauthorization even though the company-wide policy didn't
   * demand one at intake. Never blocked by an already-expired reference:
   * that is exactly the situation this exists to fix.
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

        if (!isEligibleHospitalService(line.serviceRate)) {
          throw new ValidationError(
            `Discounts are strictly restricted to Hospital Services. '${line.serviceRate?.name || 'This service'}' (Outsourced Lab / Radiology / Pharmacy) cannot receive discounts.`
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

        if (
          (discPct > DISCOUNT_APPROVAL_PERCENT_THRESHOLD ||
            discAmt.toNumber() > DISCOUNT_APPROVAL_AMOUNT_THRESHOLD) &&
          !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)
        ) {
          throw new AuthorizationError(
            `Discount of PKR ${discAmt.toFixed(2)} (${discPct.toFixed(1)}%) requires Admin approval.`
          );
        }

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
        // Invoice-wide discount distributed across eligible Hospital Services lines ONLY
        const eligibleLines = invoice.lines.filter((l) => isEligibleHospitalService(l.serviceRate));
        const nonEligibleLines = invoice.lines.filter((l) => !isEligibleHospitalService(l.serviceRate));

        if (eligibleLines.length === 0) {
          throw new ValidationError(
            `Discounts are strictly restricted to Hospital Services. Invoices without eligible Hospital Services (Outsourced Lab / Pharmacy) cannot receive discounts.`
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
            `Discount of PKR ${totalDiscAmt.toFixed(2)} exceeds total eligible Hospital Services charges of PKR ${eligibleGross.toFixed(2)}. Outsourced Lab, Radiology, and Pharmacy services cannot receive discounts.`
          );
        }

        const discPct = eligibleGross.greaterThan(0)
          ? totalDiscAmt.mul(100).div(eligibleGross).toNumber()
          : 0;

        if (
          (discPct > DISCOUNT_APPROVAL_PERCENT_THRESHOLD ||
            totalDiscAmt.toNumber() > DISCOUNT_APPROVAL_AMOUNT_THRESHOLD) &&
          !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)
        ) {
          throw new AuthorizationError(
            `Total discount of PKR ${totalDiscAmt.toFixed(2)} requires Admin approval.`
          );
        }

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
    return prisma.$transaction(async (tx) => {
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

      return { receipt, invoice: updatedInvoice };
    });
  },

  /**
   * Process refund against an invoice / receipt with strict audit trail — §4.6, §8.7
   * Decreases cashier physical cash (if cash), reduces invoice paidTotal,
   * and creates linked Doctor Commission reversal if commission was accrued.
   */
  async refundPayment(invoiceId: string, body: RefundPaymentBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.hospitalInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          lines: { include: { commissionAccrual: true } },
          paymentReceipts: true,
        },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');

      const refundAmount = new Decimal(body.amount);
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
      for (const line of invoice.lines) {
        if (line.commissionAccrual) {
          await commissionService.reverseCommissionAccrual(
            tx,
            line.id,
            `Refund: ${body.reason}`,
            actorId,
          );
        }
      }

      return {
        refundReceipt: reversalReceipt,
        invoice: updatedInvoice,
      };
    });
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
        appointment: { include: { doctor: true, department: true } },
        lines: { include: { serviceRate: true, performedBy: true } },
        paymentReceipts: { include: { collectedBy: { select: { id: true, username: true } } } },
        createdByUser: { select: { id: true, username: true } },
      },
    });

    if (!invoice) throw new NotFoundError('Invoice not found');

    const hospitalProfile = await prisma.hospitalProfile.findFirst();

    const outstanding = Decimal.max(0, patientResponsibility(invoice).minus(invoice.paidTotal));

    return {
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
          }
        : {
            type: 'SELF_PAY',
            name: invoice.selfPayEncounter?.fullName ?? 'Walk-In Patient',
            mrNumber: invoice.selfPayEncounter?.mrNumber ?? '',
            phone: invoice.selfPayEncounter?.phone,
            cnic: invoice.selfPayEncounter?.cnicOrPassport,
          },
      lines: invoice.lines.filter((l) => invoice.sourceType !== 'ADMISSION' || l.serviceRate.code !== 'ADM-ADVANCE').map((l) => ({
        id: l.id,
        serviceName: l.serviceRate.name,
        billingUnit: l.serviceRate.billingUnit,
        rate: l.rateSnapshot,
        quantity: l.quantity,
        gross: l.lineGross,
        discount: l.discountAmount,
        net: l.lineNet,
        performedBy: l.performedBy?.fullName ?? 'Hospital',
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
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { panelPatient: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { panelPatient: { mrNumber: { contains: query.search, mode: 'insensitive' } } },
        { selfPayEncounter: { fullName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    // Record-type filters (Discounts / Refunds / Payments-Receipts nav items) —
    // applied in the WHERE clause so they hold across the whole table, not
    // just whatever lands inside the `take: 100` most-recent window below.
    if (query.hasDiscount === 'true') where.discountTotal = { gt: 0 };
    if (query.hasRefund === 'true') where.paymentReceipts = { some: { isReversed: true } };
    if (query.hasPayment === 'true') where.paymentReceipts = { some: {} };
    if (query.isPanel === 'true') where.panelPatientId = { not: null };
    // Keyed off the invoice's own frozen corporatePanelId (panel.md §14
    // backlog item 1), not the patient's CURRENT company — an invoice
    // stays listed under the company it was actually billed to even after
    // the patient later transfers to a different company.
    if (query.corporatePanelId) where.corporatePanelId = query.corporatePanelId;
    // Outstanding = still owed: UNPAID or PARTIALLY_PAID only (PAID/VOID have
    // no remaining balance). Only applied when the caller didn't already ask
    // for a specific status — an explicit `status` filter always wins.
    if (query.hasOutstandingBalance === 'true' && !query.status) {
      where.status = { in: ['UNPAID', 'PARTIALLY_PAID'] };
    }

    return prisma.hospitalInvoice.findMany({
      where,
      include: {
        panelPatient: {
          select: {
            id: true,
            fullName: true,
            mrNumber: true,
            panelMemberId: true,
            corporatePanel: { select: { id: true, code: true, organizationName: true } },
          },
        },
        // The invoice's own frozen payer (panel.md §14 backlog item 1) —
        // authoritative for display even if the patient later transfers to
        // a different company; panelPatient.corporatePanel above stays
        // useful for the CURRENT membership context only.
        corporatePanel: { select: { id: true, code: true, organizationName: true } },
        selfPayEncounter: { select: { id: true, fullName: true, mrNumber: true } },
        department: { select: { id: true, name: true, code: true } },
        lines: { select: { id: true, lineNet: true, quantity: true } },
        paymentReceipts: { select: { id: true, receiptNumber: true, amount: true, method: true, isReversed: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  },

  async getInvoice(id: string) {
    const invoice = await prisma.hospitalInvoice.findUnique({
      where: { id },
      include: {
        panelPatient: { include: { corporatePanel: true } },
        selfPayEncounter: true,
        department: true,
        appointment: { include: { doctor: true, department: true } },
        admissionRecord: {
          include: {
            department: true,
            doctor: true,
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
    return { ...invoice, status: invoice.status === 'VOID' ? 'VOID' : patientPaymentStatus(invoice, invoice.paidTotal), lines: invoice.lines.filter((l) => invoice.sourceType !== 'ADMISSION' || l.serviceRate.code !== 'ADM-ADVANCE') };
  },
};
