import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError, AuthorizationError } from '@/shared/errors/AppError';
import type { CollectAdmissionPaymentBody, ApplyAdmissionDiscountBody } from './admissionBilling.schemas';
import { admissionService } from '@/modules/admission/admission.service';
import { commissionService } from '@/modules/commission/commission.service';

import { generateReceiptNumber, generateFinalBillNumber } from '@/shared/idGenerator';
import { patientPaymentStatus, patientResponsibility } from '@/shared/invoicePaymentStatus';
import { pharmacyBridgeClient } from '@/shared/pharmacyBridgeClient';
import { computePharmacyPortion } from '@/shared/pharmacyFifoCredit';
import {
  isEligibleHospitalService,
  DISCOUNT_APPROVAL_PERCENT_THRESHOLD,
  DISCOUNT_APPROVAL_AMOUNT_THRESHOLD,
} from '@/shared/discountEligibility';

const invoiceInclude = {
  department: { select: { id: true, name: true, code: true } },
  lines: { include: { serviceRate: { include: { department: true } }, performedBy: true } },
  paymentReceipts: { where: { isReversed: false } },
} as const;

function bedLabel(bed: any): { ward: string | null; room: string | null; bed: string | null } {
  if (!bed) return { ward: null, room: null, bed: null };
  return {
    ward: bed.room?.ward?.name ?? null,
    room: bed.room?.name ?? null,
    bed: bed.bedNumber ?? null,
  };
}

function resolveMrNumber(
  panelPatient: { mrNumber?: string | null } | null | undefined,
  _selfPayEncounterId?: string | null,
): string | null {
  if (panelPatient?.mrNumber) return panelPatient.mrNumber;
  return null;
}

/**
 * Front Desk's consolidated view + payment collection over an admission's
 * **multiple** department invoices (HMS_V7.2_NEW_REQUIREMENTS.md §2.2/§2.10/
 * §2.11) — each department invoice stays independently owned
 * (`admission.service.ts`'s `addAdmissionService` already creates one per
 * department); this module is the presentation/allocation layer over them,
 * never a merge.
 *
 * v7.2 Admission Patient Records + Running Ledger — `listAdmissionRecords`,
 * `getLedger`, and `generateFinalBill` are the new additions: a single
 * flattened, chronological view across every department invoice's lines
 * PLUS every payment receipt (both invoice-allocated and the unallocated
 * admission-level advance/deposit receipts `getStatement`'s totals never
 * counted before). `collectPayment` gains overpayment handling so a
 * guardian paying more than the current outstanding banks the remainder as
 * a credit instead of being rejected.
 */
export const admissionBillingService = {
  /**
   * Running Bill / Interim Statement (§2.10) — explicitly not a final
   * discharge invoice.
   *
   * FIX (billing correctness): a payment collected when nothing was yet
   * outstanding (§2.11's overpayment/pure-advance case — e.g. the deposit
   * taken at admission creation, or an "additional deposit" collected
   * later) is stored as an UNALLOCATED `PaymentReceipt`
   * (`hospitalInvoiceId: null`, `admissionRecordId` set) — it was never
   * added to any specific department invoice's `paidTotal`. Every prior
   * version of this function computed outstanding as plain
   * `invoice.total - invoice.paidTotal`, which completely ignored that
   * credit and overstated what the patient still owes by exactly the
   * unallocated amount. `getLedger`/`listAdmissionRecords` already summed
   * ALL receipts (allocated + unallocated) correctly — this brings
   * `getStatement` in line with them, netting the credit against the
   * oldest outstanding invoice(s) first (FIFO) so the per-invoice numbers
   * shown here still sum to the corrected consolidated total.
   */
  async getStatement(admissionId: string) {
    const admission = await prisma.admissionRecord.findUnique({
      where: { id: admissionId },
      include: {
        panelPatient: { select: { id: true, fullName: true, mrNumber: true } },
        selfPayEncounter: { select: { id: true, fullName: true } },
        hospitalInvoices: { where: { sourceType: 'ADMISSION' }, include: invoiceInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!admission) throw new NotFoundError('Admission record not found');

    const pharmacyCharge = await prisma.hmsPharmacyCharge.findFirst({
      where: { admissionRecordId: admissionId },
      orderBy: { createdAt: 'desc' },
    });

    const pendingClearances = await prisma.pharmacyClearance.findMany({
      where: {
        admissionRecordId: admissionId,
        status: { in: ['REQUESTED', 'AUTHORIZATION_REQUIRED', 'ACCEPTED', 'PARTIALLY_FULFILLED'] },
      },
      include: {
        lines: { include: { medicine: true, batch: true } },
        requestedBy: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });

    const unallocated = await prisma.paymentReceipt.aggregate({
      where: { admissionRecordId: admissionId, hospitalInvoiceId: null, isReversed: false },
      _sum: { amount: true },
    });
    let remainingCredit = unallocated._sum.amount ?? new Decimal(0);
    const unallocatedCreditTotal = remainingCredit;

    const departmentInvoices = admission.hospitalInvoices.map((inv) => {
      const rawOutstanding = Decimal.max(0, patientResponsibility(inv).minus(inv.paidTotal));
      const creditApplied = Decimal.min(remainingCredit, rawOutstanding);
      remainingCredit = remainingCredit.minus(creditApplied);

      // No separate "INV-PHARM-..." invoice exists anymore — pharmacy charges
      // are lines (serviceRate code SRV-PHARMACY) on this SAME consolidated
      // admission invoice (see the collectPayment FIFO note below), so detect
      // by line content instead of the now-dead invoice-number prefix.
      const isPharmacy =
        inv.lines?.some((l: any) => l.billingSource === 'PHARMACY');

      return {
        ...inv,
        outstanding: rawOutstanding.minus(creditApplied),
        creditApplied,
        // Single source of truth for "can this line be discounted" — same
        // helper `applyDiscount` enforces server-side — so the Front Desk UI
        // never has to re-derive (and risk drifting from) the eligibility rule.
        lines: inv.lines?.map((l: any) => ({ ...l, isDiscountEligible: isEligibleHospitalService(l.serviceRate) })),
        panelPatientId: inv.panelPatientId,
        isDiscountEligibleInvoice: !inv.panelPatientId && (inv.lines ?? []).some((l: any) => isEligibleHospitalService(l.serviceRate)),
        pharmacyDetails: isPharmacy && pharmacyCharge ? {
          pharmacyInvoiceNumber: pharmacyCharge.pharmacyInvoiceNumber,
          items: pharmacyCharge.itemsJson,
          dispensedBy: pharmacyCharge.dispensedBySnapshot,
          dispensedAt: pharmacyCharge.dispensedAt,
          patientPaymentStatus: pharmacyCharge.patientPaymentStatus,
          settlementStatus: pharmacyCharge.settlementStatus,
        } : null,
      };
    });

    const consolidated = departmentInvoices.reduce(
      (acc, inv) => ({
        subtotal: acc.subtotal.plus(inv.subtotal),
        discountTotal: acc.discountTotal.plus(inv.discountTotal),
        total: acc.total.plus(inv.total),
        paidTotal: acc.paidTotal.plus(inv.paidTotal),
        patientShare: acc.patientShare.plus(inv.patientShare),
        panelReceivable: acc.panelReceivable.plus(inv.panelReceivable),
        outstanding: acc.outstanding.plus(inv.outstanding),
      }),
      {
        subtotal: new Decimal(0),
        discountTotal: new Decimal(0),
        total: new Decimal(0),
        paidTotal: new Decimal(0),
        patientShare: new Decimal(0),
        panelReceivable: new Decimal(0),
        outstanding: new Decimal(0),
      },
    );

    const pendingItems = pendingClearances.flatMap((c) =>
      c.lines.map((l) => {
        const rate = Number(l.medicine?.saleRate ?? l.batch?.costRate ?? 0);
        const qty = Number(l.requestedQuantity);
        const amount = rate * qty;
        return {
          medicineName: l.medicine?.name || 'Medicine',
          quantity: qty,
          unitPrice: rate,
          totalPrice: amount,
          status: 'REQUESTED',
          requestNumber: c.medicineRequestNumber,
        };
      }),
    );
    const pendingTotal = pendingItems.reduce((sum, it) => sum + it.totalPrice, 0);

    let effectivePharmacyCharge: any = pharmacyCharge;
    if (pendingClearances.length > 0) {
      if (effectivePharmacyCharge) {
        const existingItems = Array.isArray(effectivePharmacyCharge.itemsJson) ? effectivePharmacyCharge.itemsJson : [];
        effectivePharmacyCharge = {
          ...effectivePharmacyCharge,
          subtotal: effectivePharmacyCharge.subtotal.plus(pendingTotal),
          totalAmount: effectivePharmacyCharge.totalAmount.plus(pendingTotal),
          patientOutstanding: effectivePharmacyCharge.patientOutstanding.plus(pendingTotal),
          itemsJson: [...existingItems, ...pendingItems],
        };
      } else {
        effectivePharmacyCharge = {
          id: 'pending',
          pharmacyInvoiceNumber: pendingClearances[0]?.medicineRequestNumber ?? 'REQ-PENDING',
          subtotal: new Decimal(pendingTotal),
          taxTotal: new Decimal(0),
          discountTotal: new Decimal(0),
          totalAmount: new Decimal(pendingTotal),
          patientPaid: new Decimal(0),
          patientOutstanding: new Decimal(pendingTotal),
          patientPaymentStatus: 'PENDING',
          settlementStatus: 'NOT_DUE',
          itemsJson: pendingItems,
          dispensedBySnapshot: pendingClearances[0]?.requestedBy?.displayName ?? 'Doctor (Pending Dispense)',
          dispensedAt: null,
        };
      }

      consolidated.subtotal = consolidated.subtotal.plus(pendingTotal);
      consolidated.total = consolidated.total.plus(pendingTotal);
      consolidated.patientShare = consolidated.patientShare.plus(pendingTotal);
      consolidated.outstanding = consolidated.outstanding.plus(pendingTotal);
    }

    // Real money collected includes the unallocated advance/deposit that
    // isn't sitting in any invoice's own `paidTotal`; any of it not yet
    // consumed by an outstanding invoice (`remainingCredit`) is a genuine
    // available credit, same concept as `getLedger`'s `availableCredit`.
    consolidated.paidTotal = consolidated.paidTotal.plus(unallocatedCreditTotal).minus(remainingCredit);

    return {
      admissionId: admission.id,
      admissionNumber: admission.admissionNumber,
      status: admission.status,
      isNotFinalDischargeInvoice: true,
      departmentInvoices,
      consolidated,
      unallocatedCreditTotal,
      availableCredit: remainingCredit,
      pharmacyCharge: effectivePharmacyCharge ? {
        id: effectivePharmacyCharge.id,
        pharmacyInvoiceNumber: effectivePharmacyCharge.pharmacyInvoiceNumber,
        subtotal: effectivePharmacyCharge.subtotal,
        taxTotal: effectivePharmacyCharge.taxTotal,
        discountTotal: effectivePharmacyCharge.discountTotal,
        totalAmount: effectivePharmacyCharge.totalAmount,
        patientPaid: effectivePharmacyCharge.patientPaid,
        patientOutstanding: effectivePharmacyCharge.patientOutstanding,
        patientPaymentStatus: effectivePharmacyCharge.patientPaymentStatus,
        settlementStatus: effectivePharmacyCharge.settlementStatus,
        items: effectivePharmacyCharge.itemsJson,
        dispensedBy: effectivePharmacyCharge.dispensedBySnapshot,
        dispensedAt: effectivePharmacyCharge.dispensedAt,
      } : null,
    };
  },

  /**
   * Admission Patient Records list (Front Desk) — one row per checked-in
   * admission (active + historical), never per department invoice. Current
   * Charges / Total Paid / Outstanding are consolidated across every
   * department invoice AND every payment receipt on the admission
   * (allocated or unallocated advance/deposit) — unlike `getStatement`'s
   * `consolidated.paidTotal`, which only sums `HospitalInvoice.paidTotal`
   * and so misses unallocated advance receipts.
   */
  async listAdmissionRecords() {
    const admissions = await prisma.admissionRecord.findMany({
      where: { OR: [{ admittedAt: { not: null } }, { status: { in: ['PLANNED', 'CONFIRMED'] } }] },
      include: {
        panelPatient: { select: { id: true, fullName: true, mrNumber: true } },
        selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
        bed: { include: { room: { include: { ward: true } } } },
        hospitalInvoices: { where: { sourceType: 'ADMISSION' }, select: { id: true, total: true, patientShare: true, panelReceivable: true, panelPatientId: true } },
        pharmacyClearances: {
          where: {
            status: { in: ['REQUESTED', 'AUTHORIZATION_REQUIRED', 'ACCEPTED', 'PARTIALLY_FULFILLED'] },
          },
          include: {
            lines: { include: { medicine: true, batch: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const admissionIds = admissions.map((a) => a.id);
    const allInvoiceIds = admissions.flatMap((a) => a.hospitalInvoices.map((i) => i.id));

    const receipts =
      admissionIds.length === 0
        ? []
        : await prisma.paymentReceipt.findMany({
            where: {
              isReversed: false,
              OR: [{ admissionRecordId: { in: admissionIds } }, { hospitalInvoiceId: { in: allInvoiceIds } }],
            },
            select: {
              amount: true,
              admissionRecordId: true,
              hospitalInvoice: { select: { admissionRecordId: true } },
            },
          });

    const paidByAdmission = new Map<string, Decimal>();
    for (const r of receipts) {
      const admId = r.admissionRecordId ?? r.hospitalInvoice?.admissionRecordId;
      if (!admId) continue;
      paidByAdmission.set(admId, (paidByAdmission.get(admId) ?? new Decimal(0)).plus(r.amount));
    }

    return admissions.map((a) => {
      // Patient-facing: what the patient owes (patient share on panel invoices), not the company's part.
      const billedCharges = a.hospitalInvoices.reduce((sum, inv) => sum.plus(patientResponsibility(inv)), new Decimal(0));
      const pendingPharmacyTotal = (a.pharmacyClearances || []).reduce((clearanceSum, c) => {
        const lineTotal = (c.lines || []).reduce((sum, l) => {
          const rate = l.medicine?.saleRate ?? l.batch?.costRate ?? new Decimal(0);
          return sum.plus(new Decimal(rate).mul(l.requestedQuantity));
        }, new Decimal(0));
        return clearanceSum.plus(lineTotal);
      }, new Decimal(0));

      const currentCharges = billedCharges.plus(pendingPharmacyTotal);
      const totalPaid = paidByAdmission.get(a.id) ?? new Decimal(0);
      const outstanding = Decimal.max(0, currentCharges.minus(totalPaid));
      const availableCredit = Decimal.max(0, totalPaid.minus(currentCharges));
      const billingStatus =
        currentCharges.equals(0) && totalPaid.equals(0)
          ? 'NO_CHARGES'
          : totalPaid.greaterThanOrEqualTo(currentCharges) && currentCharges.greaterThan(0)
            ? 'PAID'
            : totalPaid.greaterThan(0)
              ? 'PARTIALLY_PAID'
              : 'UNPAID';

      return {
        id: a.id,
        admissionNumber: a.admissionNumber,
        panelPatientId: a.panelPatientId ?? null,
        selfPayEncounterId: a.selfPayEncounterId ?? a.selfPayEncounter?.id ?? null,
        patientName: a.panelPatient?.fullName ?? a.selfPayEncounter?.fullName ?? 'Unknown',
        patientMrNumber: resolveMrNumber(a.panelPatient, a.selfPayEncounterId ?? a.selfPayEncounter?.id),
        payerType: a.panelPatientId ? 'PANEL' : 'SELF_PAY',
        admittedAt: a.admittedAt,
        ...bedLabel(a.bed),
        currentCharges,
        totalPaid,
        outstanding,
        availableCredit,
        clinicalStatus: a.status,
        billingStatus,
      };
    });
  },

  /**
   * Running Admission Ledger — every charge (invoice line) and every
   * payment (receipt, allocated or unallocated) for this admission,
   * flattened into one chronological list with a running balance. This is
   * the read model behind the Front Desk "Admission Patient Record" page —
   * it never creates or mutates anything.
   */
  async getLedger(admissionId: string, readOnly = false) {
    const admission = await prisma.admissionRecord.findUnique({
      where: { id: admissionId },
      include: {
        department: { select: { id: true, name: true } },
        panelPatient: { include: { corporatePanel: { select: { id: true, organizationName: true } } } },
        selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
        bed: { include: { room: { include: { ward: true } } } },
        hospitalInvoices: {
          where: { sourceType: 'ADMISSION' },
          include: {
            department: { select: { id: true, name: true } },
            lines: { include: { serviceRate: true, performedBy: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        pharmacyClearances: {
          where: {
            status: { in: ['REQUESTED', 'AUTHORIZATION_REQUIRED', 'ACCEPTED', 'PARTIALLY_FULFILLED'] },
          },
          include: {
            lines: { include: { medicine: true, batch: true } },
            requestedBy: { select: { id: true, username: true, displayName: true } },
          },
          orderBy: { requestedAt: 'asc' },
        },
      },
    });
    if (!admission) throw new NotFoundError('Admission record not found');

    const invoiceIds = admission.hospitalInvoices.map((inv) => inv.id);

    const receipts = await prisma.paymentReceipt.findMany({
      where: {
        isReversed: false,
        OR: [{ admissionRecordId: admissionId }, { hospitalInvoiceId: { in: invoiceIds } }],
      },
      include: {
        collectedBy: { select: { id: true, username: true, displayName: true } },
        hospitalInvoice: { select: { id: true, department: { select: { name: true } } } },
      },
      orderBy: { collectedAt: 'asc' },
    });

    const pendingPharmacyLines = (admission.pharmacyClearances || []).flatMap((c) =>
      c.lines.map((l) => {
        const rate = l.medicine?.saleRate ?? l.batch?.costRate ?? new Decimal(0);
        const amount = new Decimal(rate).mul(l.requestedQuantity);
        return {
          id: l.id,
          date: c.requestedAt,
          type: 'Pharmacy',
          department: 'Pharmacy',
          description: `${l.medicine?.name || 'Medicine'} [Requested - Pending Dispense]`,
          qty: l.requestedQuantity,
          rate: rate,
          grossAmount: amount,
          discountAmount: new Decimal(0),
          discountReason: `Req: ${c.medicineRequestNumber}`,
          amount: amount,
          reference: c.medicineRequestNumber,
          postedBy: c.requestedBy?.displayName ?? c.requestedBy?.username ?? 'Doctor',
          isPendingPharmacy: true,
        };
      }),
    );

    const billedCharges = admission.hospitalInvoices.reduce((sum, inv) => sum.plus(patientResponsibility(inv)), new Decimal(0));
    const pendingPharmacyTotal = pendingPharmacyLines.reduce((sum, pl) => sum.plus(pl.amount), new Decimal(0));
    const totalCharges = billedCharges.plus(pendingPharmacyTotal);
    const totalPaid = receipts.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
    const outstandingBalance = Decimal.max(0, totalCharges.minus(totalPaid));
    const availableCredit = Decimal.max(0, totalPaid.minus(totalCharges));

    // Keep Front Desk reconciliation; Admission portal reads must never change status or beds.
    if (!readOnly && admission.status === 'DISCHARGE_PENDING' && outstandingBalance.lessThanOrEqualTo(0)) {
      const reconcile = await admissionService.reconcileAdmissionDischarge(prisma, admissionId);
      if (reconcile.isDischarged) {
        admission.status = 'DISCHARGED';
      }
    }

    // Flatten all service lines across invoices and sort chronologically
    const invoiceLines = admission.hospitalInvoices
      .flatMap((inv) =>
        inv.lines.map((l) => {
          const isSelf =
            l.discountReason?.includes('Self-Arranged') ||
            l.discountReason?.includes('Self Arranged');

          return {
            id: l.id,
            billingSource: l.billingSource,
            date: l.createdAt,
            type: /ward\s*fixed/i.test((l.descriptionSnapshot ?? l.serviceRate?.name ?? l.billingSource)) ? 'Ward Price' : (l.descriptionSnapshot ?? l.serviceRate?.name ?? l.billingSource),
            department: inv.department?.name ?? null,
            description: isSelf
              ? '[Self-Arranged]'
              : (l.discountReason || (/ward\s*fixed/i.test((l.descriptionSnapshot ?? l.serviceRate?.name ?? l.billingSource)) ? 'Ward Price' : (l.descriptionSnapshot ?? l.serviceRate?.name ?? l.billingSource))),
            qty: l.quantity,
            rate: l.rateSnapshot,
            grossAmount: l.lineGross,
            discountAmount: l.discountAmount,
            discountReason: l.discountReason,
            amount: l.lineNet,
            reference: inv.invoiceNumber,
            postedBy: l.performedBy?.fullName ?? null,
            isPendingPharmacy: false,
          };
        }),
      );

    const allLines = [...invoiceLines, ...pendingPharmacyLines].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Settle payments against services in FIFO order so each service row shows its exact paid & due amounts
    let remainingPaymentPool = new Decimal(totalPaid);

    const entries = allLines.map((l) => {
      let paidForLine = new Decimal(0);
      if (remainingPaymentPool.greaterThan(0)) {
        if (remainingPaymentPool.greaterThanOrEqualTo(l.amount)) {
          paidForLine = l.amount;
          remainingPaymentPool = remainingPaymentPool.minus(l.amount);
        } else {
          paidForLine = remainingPaymentPool;
          remainingPaymentPool = new Decimal(0);
        }
      }

      const dueForLine = Decimal.max(0, l.amount.minus(paidForLine));
      const isSelfArranged =
        l.description?.includes('Self-Arranged') ||
        l.description?.includes('Self Arranged');

      const lineStatus: 'PAID' | 'UNPAID' | 'PARTIAL' | 'SELF' | 'REQUESTED' =
        isSelfArranged
          ? 'SELF'
          : (l as any).isPendingPharmacy && dueForLine.greaterThan(0) && paidForLine.equals(0)
            ? 'REQUESTED'
            : dueForLine.equals(0)
              ? 'PAID'
              : paidForLine.greaterThan(0)
                ? 'PARTIAL'
                : 'UNPAID';

      return {
        billingSource: (l as any).billingSource ?? 'PHARMACY',
        date: l.date,
        type: l.type,
        department: l.department,
        description: l.description,
        qty: l.qty,
        rate: l.rate,
        grossAmount: l.grossAmount,
        discountAmount: l.discountAmount,
        discountReason: l.discountReason,
        debit: l.amount,
        credit: paidForLine,
        paidAmount: paidForLine,
        dueAmount: dueForLine,
        status: lineStatus,
        runningBalance: dueForLine,
        reference: l.reference,
        postedBy: l.postedBy,
      };
    });

    const receiptSummaries = receipts.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      amount: r.amount,
      method: r.method,
      reference: r.reference,
      collectedAt: r.collectedAt,
      collectedByName: r.collectedBy?.displayName ?? r.collectedBy?.username ?? null,
    }));

    let panel: Record<string, Decimal> | null = null;
    if (admission.panelPatientId) {
      const patientShare = admission.hospitalInvoices.reduce((sum, inv) => sum.plus(inv.patientShare), new Decimal(0));
      const panelReceivable = admission.hospitalInvoices.reduce((sum, inv) => sum.plus(inv.panelReceivable), new Decimal(0));

      const realizedGroups =
        invoiceIds.length === 0
          ? []
          : await prisma.panelRemittanceAllocation.groupBy({
              by: ['hospitalInvoiceId'],
              where: { hospitalInvoiceId: { in: invoiceIds } },
              _sum: { allocatedAmount: true },
            });
      const panelRealized = realizedGroups.reduce((sum, g) => sum.plus(g._sum.allocatedAmount ?? new Decimal(0)), new Decimal(0));
      const patientPaid = totalPaid;

      panel = {
        grossCharges: totalCharges,
        patientShare,
        panelReceivable,
        patientPaid,
        panelRealized,
        patientOutstanding: Decimal.max(0, patientShare.minus(patientPaid)),
        panelOutstanding: Decimal.max(0, panelReceivable.minus(panelRealized)),
      };
    }

    return {
      departmentId: admission.departmentId,
      departmentName: admission.department?.name ?? null,
      admissionId: admission.id,
      admissionNumber: admission.admissionNumber,
      panelPatientId: admission.panelPatientId ?? null,
      selfPayEncounterId: admission.selfPayEncounterId ?? admission.selfPayEncounter?.id ?? null,
      status: admission.status,
      medicationMode: admission.medicationMode,
      payerType: admission.panelPatientId ? 'PANEL' : 'SELF_PAY',
      patientName: admission.panelPatient?.fullName ?? admission.selfPayEncounter?.fullName ?? 'Unknown',
      patientMrNumber: resolveMrNumber(admission.panelPatient, admission.selfPayEncounterId ?? admission.selfPayEncounter?.id),
      panelName: admission.panelPatient?.corporatePanel?.organizationName ?? null,
      admittedAt: admission.admittedAt,
      ...bedLabel(admission.bed),
      finalBillNumber: admission.finalBillNumber,
      finalBillGeneratedAt: admission.finalBillGeneratedAt,
      entries,
      receipts: receiptSummaries,
      summary: { totalCharges, totalPaid, outstandingBalance, availableCredit },
      panel,
    };
  },

  /**
   * Front Desk discretionary discount on an admission's running bill —
   * strictly restricted to Hospital Services lines (ward/room, doctor fee,
   * procedures). Pharmacy (`SRV-PHARMACY`) and Outsourced Lab/Radiology
   * lines living on this same consolidated invoice (addAdmissionService's
   * "1 Admission = 1 Single Master Invoice", pharmacy-bridge.service.ts's
   * §8) are never eligible — same rule, same `isEligibleHospitalService`
   * helper, as `invoices.service.ts`'s OPD-invoice `applyDiscount`, so the
   * two call sites can't drift apart on what counts as discountable.
   *
   * Panel-patient admissions are blocked entirely, same as the OPD
   * counterpart: panel charges are governed by the corporate contract's
   * discount rules, not front-desk discretion.
   */
  async applyDiscount(admissionId: string, body: ApplyAdmissionDiscountBody, actorId: string, actorRole: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.hospitalInvoice.findFirst({
        where: { admissionRecordId: admissionId, sourceType: 'ADMISSION', status: { not: 'VOID' } },
        orderBy: { createdAt: 'asc' },
        include: {
          lines: { include: { serviceRate: { include: { department: true } } } },
        },
      });

      if (!invoice) throw new NotFoundError('No invoice found for this admission yet');
      if (invoice.panelPatientId) {
        throw new ValidationError('Posted panel charges cannot be manually repriced; use an audited contract adjustment');
      }
      if (invoice.lines.length === 0) throw new ValidationError('Cannot discount an empty invoice');

      if (body.lineItemId) {
        const line = invoice.lines.find((l) => l.id === body.lineItemId);
        if (!line) throw new NotFoundError('Invoice line item not found');

        if (!isEligibleHospitalService(line.serviceRate)) {
          throw new ValidationError(
            `Discounts are strictly restricted to Hospital Services. '${line.serviceRate?.name || 'This service'}' (Outsourced Lab / Radiology / Pharmacy) cannot receive discounts.`,
          );
        }

        let discAmt = new Decimal(0);
        if (body.discountPercent !== undefined) {
          discAmt = line.lineGross.mul(body.discountPercent).div(100);
        } else if (body.discountAmount !== undefined) {
          discAmt = new Decimal(body.discountAmount);
        }

        if (discAmt.greaterThan(line.lineGross)) {
          throw new ValidationError(`Discount of PKR ${discAmt.toFixed(2)} exceeds line gross of PKR ${line.lineGross.toFixed(2)}.`);
        }

        const discPct = line.lineGross.greaterThan(0) ? discAmt.mul(100).div(line.lineGross).toNumber() : 0;

        if (
          (discPct > DISCOUNT_APPROVAL_PERCENT_THRESHOLD || discAmt.toNumber() > DISCOUNT_APPROVAL_AMOUNT_THRESHOLD) &&
          !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)
        ) {
          throw new AuthorizationError(`Discount of PKR ${discAmt.toFixed(2)} (${discPct.toFixed(1)}%) requires Admin approval.`);
        }

        const newLineNet = line.lineGross.minus(discAmt);

        await tx.invoiceLineItem.update({
          where: { id: line.id },
          data: {
            discountAmount: discAmt,
            discountReason: body.discountReason,
            lineNet: newLineNet,
            // Self-pay admission lines always have panelReceivable = 0, so
            // patientShare must track lineNet 1:1 for the ledger/statement
            // (patientResponsibility) totals to stay correct after a manual discount.
            patientShare: newLineNet,
          },
        });
      } else {
        // Invoice-wide discount distributed across eligible Hospital Services lines ONLY
        const eligibleLines = invoice.lines.filter((l) => isEligibleHospitalService(l.serviceRate));
        const nonEligibleLines = invoice.lines.filter((l) => !isEligibleHospitalService(l.serviceRate));

        if (eligibleLines.length === 0) {
          throw new ValidationError(
            'Discounts are strictly restricted to Hospital Services. This admission has no eligible Hospital Services charges (only Outsourced Lab / Pharmacy) to discount.',
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
            `Discount of PKR ${totalDiscAmt.toFixed(2)} exceeds total eligible Hospital Services charges of PKR ${eligibleGross.toFixed(2)}. Outsourced Lab, Radiology, and Pharmacy services cannot receive discounts.`,
          );
        }

        const discPct = eligibleGross.greaterThan(0) ? totalDiscAmt.mul(100).div(eligibleGross).toNumber() : 0;

        if (
          (discPct > DISCOUNT_APPROVAL_PERCENT_THRESHOLD || totalDiscAmt.toNumber() > DISCOUNT_APPROVAL_AMOUNT_THRESHOLD) &&
          !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)
        ) {
          throw new AuthorizationError(`Total discount of PKR ${totalDiscAmt.toFixed(2)} requires Admin approval.`);
        }

        // Distribute proportionally across eligible lines, largest-remainder on the last line
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
              patientShare: lineNet,
            },
          });
        }

        // Non-eligible lines (Lab / Radiology / Pharmacy) never carry a discount
        for (const line of nonEligibleLines) {
          if (!line.discountAmount.isZero()) {
            await tx.invoiceLineItem.update({
              where: { id: line.id },
              data: { discountAmount: new Decimal(0), lineNet: line.lineGross, patientShare: line.lineGross },
            });
          }
        }
      }

      // Recalculate invoice totals + reprice any doctor commission affected
      const refreshedLines = await tx.invoiceLineItem.findMany({ where: { hospitalInvoiceId: invoice.id } });

      for (const line of refreshedLines) {
        const original = invoice.lines.find((l) => l.id === line.id);
        if (original && !original.lineNet.equals(line.lineNet)) {
          await commissionService.repriceCommission(tx, line.id, original.lineNet, line.lineNet, actorId, `Service discount: ${body.discountReason}`);
        }
      }

      const newSubtotal = refreshedLines.reduce((acc, l) => acc.plus(l.lineGross), new Decimal(0));
      const newDiscountTotal = refreshedLines.reduce((acc, l) => acc.plus(l.discountAmount), new Decimal(0));
      const newTotal = refreshedLines.reduce((acc, l) => acc.plus(l.lineNet), new Decimal(0));
      const newPatientShare = refreshedLines.reduce((acc, l) => acc.plus(l.patientShare), new Decimal(0));
      const newOutstanding = Decimal.max(0, newPatientShare.minus(invoice.paidTotal));
      const newStatus = newOutstanding.equals(0)
        ? 'PAID'
        : invoice.paidTotal.greaterThan(0)
        ? 'PARTIALLY_PAID'
        : 'UNPAID';

      return tx.hospitalInvoice.update({
        where: { id: invoice.id },
        data: {
          subtotal: newSubtotal,
          discountTotal: newDiscountTotal,
          total: newTotal,
          patientShare: newPatientShare,
          status: newStatus,
        },
        include: {
          lines: { include: { serviceRate: true, performedBy: true } },
          paymentReceipts: true,
        },
      });
    });
  },

  /**
   * Payment Allocation (§2.11) — one physical collection, split across
   * however many department invoices the amount is allocated to. Explicit
   * `allocations` wins; otherwise auto-allocated proportional to each
   * invoice's current outstanding (largest-remainder rounding so the split
   * always sums to exactly the collected amount).
   *
   * v7.2 Admission Ledger — overpayment (or a payment collected when
   * nothing is currently outstanding, including before any department
   * invoice exists yet) no longer rejects the collection: every outstanding
   * invoice is settled in full and the remainder is banked as one
   * unallocated advance/deposit `PaymentReceipt` (`hospitalInvoiceId: null`,
   * `admissionRecordId` set) — this is the "guardian pays 20,000 advance
   * against 14,000 of charges, 6,000 becomes Patient Credit" case from the
   * spec (§7/§8), and the "additional deposit before any service has
   * posted" case.
   */
  async collectPayment(admissionId: string, body: CollectAdmissionPaymentBody, actorId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundError('Admission record not found');

      const invoices = await tx.hospitalInvoice.findMany({
        where: { admissionRecordId: admissionId, sourceType: 'ADMISSION' },
      });

      const amountDecimal = new Decimal(body.amount);
      let allocations: { invoiceId: string | null; amount: Decimal }[];

      if (body.allocations && body.allocations.length > 0) {
        const byId = new Map(invoices.map((inv) => [inv.id, inv]));
        let sum = new Decimal(0);
        const explicit = body.allocations.map((a) => {
          const invoice = byId.get(a.invoiceId);
          if (!invoice) throw new ValidationError(`Invoice ${a.invoiceId} does not belong to this admission`);
          const amt = new Decimal(a.amount);
          // Patient collection can never exceed the PATIENT's own share —
          // `invoice.total` also includes the panel company's receivable,
          // which is only ever realized via a company remittance, never
          // collected as patient cash (same rule as invoices.service.ts's
          // `collectPayment`). Bug found via live user testing 2026-09-23:
          // a panel-patient admission invoice let Front Desk collect the
          // full total (patient + panel share) as one "patient" payment.
          const collectibleFromPatient = invoice.panelPatientId ? invoice.patientShare : invoice.total;
          const outstanding = collectibleFromPatient.minus(invoice.paidTotal);
          if (amt.greaterThan(outstanding)) {
            throw new ValidationError(
              `Allocation to ${invoice.invoiceNumber} (${amt.toString()}) exceeds its outstanding patient balance (${outstanding.toString()})`,
            );
          }
          sum = sum.plus(amt);
          return { invoiceId: a.invoiceId as string | null, amount: amt };
        });
        if (sum.greaterThan(amountDecimal)) {
          throw new ValidationError(
            `Allocations (${sum.toString()}) cannot exceed the collected amount (${amountDecimal.toString()})`,
          );
        }
        // Any leftover (amount collected minus what was explicitly
        // allocated) banks as an unallocated advance/deposit credit rather
        // than requiring an exact sum-match.
        const remainder = amountDecimal.minus(sum);
        allocations = remainder.greaterThan(0) ? [...explicit, { invoiceId: null, amount: remainder }] : explicit;
      } else {
        // Same patient-share-only cap as the explicit-allocation branch
        // above — auto-allocation must never treat the panel company's
        // receivable as patient-collectible. Any amount beyond the sum of
        // every invoice's own patient share correctly falls through to the
        // unallocated advance/credit branch below, which is legitimate
        // (a real advance/deposit) — it just never masquerades as having
        // settled the panel's portion.
        const outstandingByInvoice = invoices
          .map((inv) => ({ invoice: inv, outstanding: (inv.panelPatientId ? inv.patientShare : inv.total).minus(inv.paidTotal) }))
          .filter((x) => x.outstanding.greaterThan(0));
        const totalOutstanding = outstandingByInvoice.reduce((sum, x) => sum.plus(x.outstanding), new Decimal(0));

        if (totalOutstanding.lessThanOrEqualTo(0)) {
          // Nothing outstanding (no department invoice yet, or every
          // invoice already settled) — the whole amount is a pure
          // advance/deposit credit.
          allocations = [{ invoiceId: null, amount: amountDecimal }];
        } else if (amountDecimal.greaterThan(totalOutstanding)) {
          // Overpayment — settle every outstanding invoice in full, bank
          // the remainder as unallocated credit.
          const settled = outstandingByInvoice.map((x) => ({ invoiceId: x.invoice.id as string | null, amount: x.outstanding }));
          const remainder = amountDecimal.minus(totalOutstanding);
          allocations = [...settled, { invoiceId: null, amount: remainder }];
        } else {
          let allocated = new Decimal(0);
          allocations = outstandingByInvoice.map((x, idx) => {
            const isLast = idx === outstandingByInvoice.length - 1;
            const share = isLast
              ? amountDecimal.minus(allocated)
              : amountDecimal.mul(x.outstanding).div(totalOutstanding).toDecimalPlaces(2);
            allocated = allocated.plus(share);
            return { invoiceId: x.invoice.id as string | null, amount: share };
          });
        }
      }

      // 1 single customer receipt for the payment transaction (one payment = one receipt record)
      const primaryInvoice = allocations.find((a) => a.invoiceId)?.invoiceId
        ? invoices.find((i) => i.id === allocations.find((a) => a.invoiceId)!.invoiceId)
        : null;

      const receipt = await tx.paymentReceipt.create({
        data: {
          receiptNumber: await generateReceiptNumber(tx),
          amount: amountDecimal,
          method: body.paymentMethod,
          reference:
            body.reference ??
            `Payment for admission ${admission.admissionNumber}`,
          hospitalInvoiceId: allocations.length === 1 ? primaryInvoice?.id : null,
          admissionRecordId: admissionId,
          collectedById: actorId,
        },
      });

      // 1 single cash drawer entry for the cashier
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

      // Update paidTotal & status for each allocated invoice
      const pharmacyNotifications: Array<{ pharmacyInvoiceNumber: string; amount: number; receiptNumber: string }> = [];

      // Pharmacy charges are appended as `SRV-PHARMACY` line items directly
      // onto the admission's one consolidated invoice (pharmacy-bridge.service.ts
      // §8's "ONE ACTIVE ADMISSION = ONE PATIENT BILL") — there is no longer a
      // separate "INV-PHARM-..." invoice to detect by invoice number (that
      // legacy shape is actively deleted on sight, see pharmacy-bridge.service.ts
      // §"Clean up any legacy erroneous INV-PHARM-... invoices"). Resolve the
      // pharmacy service rate once so every allocation below can tell whether
      // the invoice it's paying actually carries pharmacy lines.


      for (const alloc of allocations) {
        if (alloc.amount.lessThanOrEqualTo(0) || !alloc.invoiceId) continue;
        const invoice = invoices.find((i) => i.id === alloc.invoiceId);
        if (invoice) {
          const previousPaidTotal = invoice.paidTotal;
          const newPaidTotal = invoice.paidTotal.plus(alloc.amount);
          const newStatus = patientPaymentStatus(invoice, newPaidTotal);
          await tx.hospitalInvoice.update({
            where: { id: invoice.id },
            data: { paidTotal: newPaidTotal, status: newStatus },
          });

          // Figure out how much of THIS payment lands on pharmacy lines.
          // Charges on the invoice are settled FIFO by posting order (same
          // convention `getLedger` uses), so walk the lines in that order and
          // take the overlap between [previousPaidTotal, newPaidTotal) and
          // each pharmacy line's own patient-share span.
          {
            const invoiceLines = await tx.invoiceLineItem.findMany({
              where: { hospitalInvoiceId: invoice.id },
              orderBy: { createdAt: 'asc' },
              select: { billingSource: true, patientShare: true },
            });

            const pharmacyPortion = computePharmacyPortion(invoiceLines, previousPaidTotal, newPaidTotal);

            if (pharmacyPortion.greaterThan(0)) {
              const charge = await tx.hmsPharmacyCharge.findFirst({
                where: { admissionRecordId: admissionId },
              });
              if (charge) {
                const newPatientPaid = charge.patientPaid.plus(pharmacyPortion);
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
                  },
                });

                pharmacyNotifications.push({
                  pharmacyInvoiceNumber: charge.pharmacyInvoiceNumber,
                  amount: Number(pharmacyPortion),
                  receiptNumber: receipt.receiptNumber,
                });
              }
            }
          }
        }
      }

      // Check if all pharmacy charges for this admission are now cleared.
      // Gated on totalChargesCount > 0 — otherwise an admission that never
      // used Hospital-Managed pharmacy (zero HmsPharmacyCharge rows) would
      // vacuously pass this check on its very first, pharmacy-unrelated
      // payment and get falsely stamped PHARMACY=CLEARED with this cashier
      // as clearedBy, even though nothing pharmacy-related was collected.
      const totalChargesCount = await tx.hmsPharmacyCharge.count({
        where: { admissionRecordId: admissionId },
      });
      const uncollectedChargesCount = await tx.hmsPharmacyCharge.count({
        where: {
          admissionRecordId: admissionId,
          patientPaymentStatus: { not: 'CLEARED' },
        },
      });

      if (totalChargesCount > 0 && uncollectedChargesCount === 0) {
        // Mark dual discharge clearance as CLEARED
        await tx.dualDischargeClearance.upsert({
          where: {
            admissionRecordId_clearanceType: {
              admissionRecordId: admissionId,
              clearanceType: 'PHARMACY',
            },
          },
          update: {
            status: 'CLEARED',
            clearedById: actorId,
            clearedAt: new Date(),
          },
          create: {
            admissionRecordId: admissionId,
            clearanceType: 'PHARMACY',
            status: 'CLEARED',
            clearedById: actorId,
            clearedAt: new Date(),
          },
        });
      }

      // Reconcile discharge status: if doctor already clinically discharged and balance is now 0, auto-discharge & free bed
      const reconcile = await admissionService.reconcileAdmissionDischarge(tx, admissionId, actorId);

      return {
        receipts: [receipt],
        allocations: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
        isDischarged: reconcile.isDischarged,
        pharmacyNotifications,
      };
    });

    // Notify Pharmacy Software via Bridge asynchronously outside the DB transaction
    for (const notif of result.pharmacyNotifications) {
      pharmacyBridgeClient.notifyPatientCollected({
        pharmacyInvoiceNumber: notif.pharmacyInvoiceNumber,
        collectedAmount: notif.amount,
        receiptNumber: notif.receiptNumber,
        collectedAt: new Date().toISOString(),
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[admissionBillingService] Failed to notify pharmacy of patient collection:', err);
      });
    }

    return {
      receipts: result.receipts,
      allocations: result.allocations,
      isDischarged: result.isDischarged,
    };
  },

  /**
   * Generate Invoice / Final Bill (§10) — idempotent: the first call mints
   * one `finalBillNumber` on the `AdmissionRecord` and freezes it there;
   * every later call (double-click, re-print, re-open) returns the exact
   * same number and a fresh ledger snapshot instead of minting a new one or
   * touching any charge. Never creates/modifies a `HospitalInvoice` or
   * `InvoiceLineItem` — the final bill is a read over the ledger that has
   * already accumulated, per §10 ("must use all eligible charges already
   * recorded... no duplicate charge may appear").
   */
  async generateFinalBill(admissionId: string, actorId: string) {
    const { finalBillNumber, finalBillGeneratedAt } = await prisma.$transaction(async (tx) => {
      const admission = await tx.admissionRecord.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundError('Admission record not found');
      if (admission.finalBillNumber) {
        return { finalBillNumber: admission.finalBillNumber, finalBillGeneratedAt: admission.finalBillGeneratedAt };
      }

      const generatedNumber = await generateFinalBillNumber(tx);
      const generatedAt = new Date();
      await tx.admissionRecord.update({
        where: { id: admissionId },
        data: { finalBillNumber: generatedNumber, finalBillGeneratedAt: generatedAt, finalBillGeneratedById: actorId },
      });
      return { finalBillNumber: generatedNumber, finalBillGeneratedAt: generatedAt };
    });

    const ledger = await this.getLedger(admissionId);
    return { ...ledger, finalBillNumber, finalBillGeneratedAt };
  },
};
