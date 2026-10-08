import { requirePharmacyDepartment } from '@/shared/pharmacyDepartment';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError, AuthorizationError } from '@/shared/errors/AppError';
import { generateInvoiceNumber, generateExpenseNumber } from '@/shared/idGenerator';
import { pharmacyBridgeClient } from '@/shared/pharmacyBridgeClient';
import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { computePharmacyPortion } from '@/shared/pharmacyFifoCredit';
import type {
  ListRequestsQuery,
  DispensedCallbackBody,
  SettlementRequestBody,
  ReleaseSettlementBody,
} from './pharmacy-bridge.schemas';

export const pharmacyBridgeService = {
  // ── List & Get Medicine Requests ──────────────────────────────────────────
  // Read-only. Requests are created via admission.service.ts's
  // `createPharmacyRequest` (dispatches to the standalone Pharmacy system);
  // a local create-and-dispense pair used to live here too — removed
  // 2026-10-05, see pharmacy-bridge.routes.ts's comment for why.
  async listRequests(query: ListRequestsQuery) {
    return prisma.pharmacyClearance.findMany({
      where: {
        status: query.status,
        admissionRecordId: query.admissionRecordId,
      },
      include: {
        admissionRecord: {
          include: {
            panelPatient: true,
            selfPayEncounter: true,
            bed: { include: { room: true } },
          },
        },
        lines: { include: { medicine: true, batch: true } },
        requestedBy: { select: { id: true, username: true } },
        fulfilledBy: { select: { id: true, username: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  },

  async getRequestById(id: string) {
    const req = await prisma.pharmacyClearance.findUnique({
      where: { id },
      include: {
        admissionRecord: {
          include: {
            panelPatient: true,
            selfPayEncounter: true,
            bed: { include: { room: true } },
            doctor: { select: { id: true, fullName: true } },
          },
        },
        lines: { include: { medicine: true, batch: true } },
        pharmacyDispenses: { include: { lines: true } },
        requestedBy: { select: { id: true, username: true } },
        fulfilledBy: { select: { id: true, username: true } },
      },
    });
    if (!req) throw new NotFoundError('Pharmacy clearance request not found');
    return req;
  },

  // ── Dispense Callback from Pharmacy Backend (Webhook) ────────────────────
  async handleDispensedCallback(body: DispensedCallbackBody) {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Concurrency lock per admission reference
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${body.externalAdmissionRef}))`;

      // 2. Find the active admission using Admission ID / Admission Ref
      const admission = await tx.admissionRecord.findFirst({
        where: {
          OR: [
            { admissionNumber: body.externalAdmissionRef },
            { id: body.externalAdmissionRef },
          ],
        },
        include: {
          panelPatient: { include: { corporatePanel: { include: { discountRules: true } } } },
          selfPayEncounter: true,
        },
      });
      if (!admission) throw new NotFoundError(`Admission ${body.externalAdmissionRef} not found`);

      // Lifecycle Rule (§11): Finalized admission cannot silently append historical invoice
      if (admission.status === 'DISCHARGED' || admission.status === 'CANCELLED') {
        throw new ValidationError(`Cannot append pharmacy charges to a finalized/discharged admission (${admission.status})`);
      }

      // 3. Verify MR Number matches that admission (if MR Number provided)
      const patientMrNumber = admission.panelPatient?.mrNumber || admission.selfPayEncounter?.mrNumber || null;
      if (body.patientMrNumber && patientMrNumber && body.patientMrNumber !== patientMrNumber) {
        throw new ValidationError(`Patient MR Number mismatch: callback has ${body.patientMrNumber} but admission has ${patientMrNumber}`);
      }

      // 4. Find the existing ACTIVE patient invoice for that admission
      // FINAL RULE: ONE ACTIVE ADMISSION = ONE PATIENT BILL / INVOICE LEDGER
      // All later charges for that same active admission must update the SAME invoice.
      let hospitalInvoice = await tx.hospitalInvoice.findFirst({
        where: {
          admissionRecordId: admission.id,
          sourceType: 'ADMISSION',
          status: { not: 'VOID' },

        },
        orderBy: { createdAt: 'asc' }, // The original admission invoice created at admission check-in
        include: { lines: true },
      });

      if (!hospitalInvoice) {
        // Fallback: If no primary admission invoice exists yet, create one standard admission invoice
        const invoiceNumber = await generateInvoiceNumber(tx);
        hospitalInvoice = await tx.hospitalInvoice.create({
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
          },
          include: { lines: true },
        });
      }

      // 5. Idempotency Check:
      // Prevent duplicate processing on retries using dispenseEventId or externalRequestRef
      let existingCharge = await tx.hmsPharmacyCharge.findFirst({
        where: {
          admissionRecordId: admission.id,
        },
      });

      const eventKey = body.dispenseEventId || null;
      const reqKey = body.externalRequestRef || null;

      if (
        existingCharge &&
        ((eventKey && existingCharge.processedEventIds.includes(eventKey)) ||
         (reqKey && existingCharge.processedEventIds.includes(reqKey)))
      ) {
        // Idempotent retry: this exact dispense event / request has already been processed!
        return { charge: existingCharge, hospitalInvoice, alreadyProcessed: true, advanceFolded: false };
      }

      const pharmacyDepartment = await requirePharmacyDepartment(tx);
      const legacyService = await tx.serviceRate.findUnique({ where: { code: 'SRV-PHARMACY' } });

      // 7. Prepare Pharmacy Lines
      const totalDecimal = new Decimal(body.totalAmount);
      const subtotalDecimal = new Decimal(body.subtotal);
      const taxDecimal = new Decimal(body.taxTotal);
      const discountDecimal = new Decimal(body.discountTotal);

      // Panel (corporate) patients get the SAME coverage-rule treatment as
      // every other hospital-service line (`admission.service.ts`'s
      // `addAdmissionService`) — a panel's discount rule, if one is matched
      // for the Pharmacy service/department, now also splits pharmacy
      // charges into patientShare/panelReceivable (or writes off a
      // LEGACY_DISCOUNT amount) instead of always billing the patient 100%.
      // Self-pay admissions (no panelPatientId) are unaffected: no rule can
      // match without discount rules, so patientShare stays the full net.
      const panelDiscountRules = admission.panelPatient?.corporatePanel?.discountRules;
      const applyCoverage = (gross: Decimal, quantity: Decimal, reasonPrefix: string) => {
        if (!admission.panelPatientId) {
          return { discountAmount: new Decimal(0), discountReason: reasonPrefix, lineNet: gross, patientShare: gross, panelReceivable: new Decimal(0), coverageSnapshot: undefined as any };
        }
        const coverage = resolvePanelCoverage(gross, panelDiscountRules, legacyService?.id ?? 'PHARMACY', new Date(), pharmacyDepartment.id, quantity, admission.panelPatient);
        return {
          discountAmount: coverage.discountAmount,
          discountReason: coverage.discountReason ? `${reasonPrefix} — ${coverage.discountReason}` : reasonPrefix,
          lineNet: gross.minus(coverage.discountAmount),
          patientShare: coverage.patientShare,
          panelReceivable: coverage.panelReceivable,
          coverageSnapshot: coverage.coverageSnapshot,
        };
      };

      // Prepare itemized lines from dispensed medicines
      const linesToCreate = (body.lines && body.lines.length > 0)
        ? body.lines.map((l) => {
            const gross = new Decimal(l.lineNet);
            const coverage = applyCoverage(
              gross,
              new Decimal(l.quantity),
              `Pharmacy: ${l.medicineName}${l.batchNumber ? ` [Batch: ${l.batchNumber}]` : ''}${l.externalRequestRef ? ` [Req: ${l.externalRequestRef}]` : ''}`,
            );
            return {
              billingSource: 'PHARMACY' as const, descriptionSnapshot: l.medicineName,
              rateSnapshot: new Decimal(l.rate),
              quantity: new Decimal(l.quantity),
              lineGross: gross,
              discountAmount: coverage.discountAmount,
              discountReason: coverage.discountReason,
              lineNet: coverage.lineNet,
              patientShare: coverage.patientShare,
              panelReceivable: coverage.panelReceivable,
              coverageSnapshot: coverage.coverageSnapshot,
            };
          })
        : [
            (() => {
              const coverage = applyCoverage(totalDecimal, new Decimal(1), `Pharmacy Medication Charges${body.externalRequestRef ? ` [Req: ${body.externalRequestRef}]` : ''}`);
              return {
                billingSource: 'PHARMACY' as const, descriptionSnapshot: 'Pharmacy Medication',
                rateSnapshot: totalDecimal,
                quantity: new Decimal(1),
                lineGross: totalDecimal,
                discountAmount: coverage.discountAmount,
                discountReason: coverage.discountReason,
                lineNet: coverage.lineNet,
                patientShare: coverage.patientShare,
                panelReceivable: coverage.panelReceivable,
                coverageSnapshot: coverage.coverageSnapshot,
              };
            })(),
          ];

      // 8. Update Pharmacy Section on the SAME Hospital Invoice:
      // Delete existing pharmacy lines on this invoice (preserving all hospital room, doctor, procedure lines)
      const targetInvoice = hospitalInvoice!;
      await tx.invoiceLineItem.deleteMany({
        where: {
          hospitalInvoiceId: targetInvoice.id,
          billingSource: 'PHARMACY',
        },
      });

      // Insert updated pharmacy lines
      await tx.invoiceLineItem.createMany({
        data: linesToCreate.map((l) => ({
          ...l,
          hospitalInvoiceId: targetInvoice.id,
        })),
      });

      // Historical invoices are retained. Never identify/delete financial history by invoice-number prefix.

      // 9. Recalculate Hospital Invoice Totals (Hospital Charges + Pharmacy Charges):
      const allLines = await tx.invoiceLineItem.findMany({
        where: { hospitalInvoiceId: hospitalInvoice.id },
        orderBy: { createdAt: 'asc' },
      });

      const newSubtotal = allLines.reduce((sum, l) => sum.plus(l.lineGross), new Decimal(0));
      const newDiscount = allLines.reduce((sum, l) => sum.plus(l.discountAmount), new Decimal(0));
      const newTotal = allLines.reduce((sum, l) => sum.plus(l.lineNet), new Decimal(0));
      const newPatientShare = allLines.reduce((sum, l) => sum.plus(l.patientShare), new Decimal(0));
      const newPanelReceivable = allLines.reduce((sum, l) => sum.plus(l.panelReceivable), new Decimal(0));

      // PRESERVE existing paid amount! (§10) — plus fold in any admission
      // advance/deposit collected BEFORE these charges existed
      // (`PaymentReceipt.hospitalInvoiceId: null`, e.g. the deposit taken at
      // admission creation). Without this, that advance sits forever as
      // unallocated credit: the invoice's own `paidTotal` and
      // `HmsPharmacyCharge.patientPaid` never learn about it, so the
      // pharmacy line stays stuck "Unpaid" at Front Desk even though the
      // patient already paid enough to cover it (bug found via live testing
      // 2026-10-06). Same linking pattern as `appointments.service.ts`'s
      // check-in step uses for pre-Check-In advance receipts.
      const previousPaidTotal = hospitalInvoice.paidTotal;
      const unlinkedAdvance = await tx.paymentReceipt.findMany({
        where: { admissionRecordId: admission.id, hospitalInvoiceId: null, isReversed: false },
      });
      const advanceTotal = unlinkedAdvance.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
      if (advanceTotal.greaterThan(0)) {
        await tx.paymentReceipt.updateMany({
          where: { id: { in: unlinkedAdvance.map((r) => r.id) } },
          data: { hospitalInvoiceId: hospitalInvoice.id },
        });
      }
      const paidTotal = previousPaidTotal.plus(advanceTotal);
      const newOutstanding = Decimal.max(0, newPatientShare.minus(paidTotal));
      const newStatus = newOutstanding.equals(0)
        ? 'PAID'
        : paidTotal.greaterThan(0)
        ? 'PARTIALLY_PAID'
        : 'UNPAID';

      hospitalInvoice = await tx.hospitalInvoice.update({
        where: { id: hospitalInvoice.id },
        data: {
          subtotal: newSubtotal,
          discountTotal: newDiscount,
          total: newTotal,
          patientShare: newPatientShare,
          panelReceivable: newPanelReceivable,
          paidTotal,
          status: newStatus,
        },
        include: { lines: true },
      });

      // How much of the just-folded-in advance actually lands on THIS
      // dispense's pharmacy lines (same FIFO-by-posting-order convention as
      // `admissionBillingService.collectPayment`/`getLedger`) — credited
      // onto `HmsPharmacyCharge.patientPaid` right after it's created/
      // updated below (step 11), so Front Desk and the Pharmacy bridge both
      // see it immediately instead of only on the next fresh payment.
      const pharmacyPortionFromAdvance = computePharmacyPortion(allLines, previousPaidTotal, paidTotal);

      // 10. Update Pharmacy Clearance status to DISPENSED
      const allRequestRefs = new Set<string>();
      if (body.externalRequestRef) allRequestRefs.add(body.externalRequestRef);
      for (const line of body.lines || []) {
        if (line.externalRequestRef) allRequestRefs.add(line.externalRequestRef);
      }
      if (allRequestRefs.size > 0) {
        await tx.pharmacyClearance.updateMany({
          where: {
            admissionRecordId: admission.id,
            OR: [
              { medicineRequestNumber: { in: Array.from(allRequestRefs) } },
              { id: { in: Array.from(allRequestRefs) } },
            ],
          },
          data: { status: 'DISPENSED', fulfilledAt: new Date() },
        });
      } else {
        await tx.pharmacyClearance.updateMany({
          where: {
            admissionRecordId: admission.id,
            status: { in: ['REQUESTED', 'ACCEPTED', 'AUTHORIZATION_REQUIRED', 'PARTIALLY_FULFILLED'] },
          },
          data: { status: 'DISPENSED', fulfilledAt: new Date() },
        });
      }

      // Automatically update DualDischargeClearance (PHARMACY) to CLEARED
      await tx.dualDischargeClearance.upsert({
        where: {
          admissionRecordId_clearanceType: {
            admissionRecordId: admission.id,
            clearanceType: 'PHARMACY',
          },
        },
        update: {
          status: 'CLEARED',
          clearedAt: new Date(),
        },
        create: {
          admissionRecordId: admission.id,
          clearanceType: 'PHARMACY',
          status: 'CLEARED',
          clearedAt: new Date(),
        },
      });

      // 11. Update or create HmsPharmacyCharge component record
      const updatedProcessedEventIds = existingCharge ? [...existingCharge.processedEventIds] : [];
      if (eventKey && !updatedProcessedEventIds.includes(eventKey)) {
        updatedProcessedEventIds.push(eventKey);
      }
      if (reqKey && !updatedProcessedEventIds.includes(reqKey)) {
        updatedProcessedEventIds.push(reqKey);
      }

      let targetPharmacyInvoiceNumber = existingCharge?.pharmacyInvoiceNumber || body.pharmacyInvoiceNumber;
      const otherAdmissionCharge = await tx.hmsPharmacyCharge.findUnique({
        where: { pharmacyInvoiceNumber: targetPharmacyInvoiceNumber },
      });
      if (otherAdmissionCharge && otherAdmissionCharge.id !== existingCharge?.id) {
        targetPharmacyInvoiceNumber = `${body.pharmacyInvoiceNumber}-${admission.admissionNumber || admission.id.slice(-6)}`;
      }

      const chargeData = {
        admissionRecordId: admission.id,
        pharmacyInvoiceNumber: targetPharmacyInvoiceNumber,
        pharmacyInvoiceId: body.pharmacyInvoiceId || existingCharge?.pharmacyInvoiceId || null,
        processedEventIds: updatedProcessedEventIds,
        subtotal: subtotalDecimal,
        taxTotal: taxDecimal,
        discountTotal: discountDecimal,
        totalAmount: totalDecimal,
        patientPaid: existingCharge ? existingCharge.patientPaid : new Decimal(0),
        patientOutstanding: Decimal.max(0, totalDecimal.minus(existingCharge ? existingCharge.patientPaid : 0)),
        patientPaymentStatus: (existingCharge && existingCharge.patientPaid.greaterThanOrEqualTo(totalDecimal))
          ? ('CLEARED' as any)
          : existingCharge && existingCharge.patientPaid.greaterThan(0)
          ? ('PARTIALLY_COLLECTED' as any)
          : ('PENDING' as any),
        settlementStatus: existingCharge?.settlementStatus ?? ('NOT_DUE' as any),
        settledAmount: existingCharge?.settledAmount ?? new Decimal(0),
        itemsJson: (body.lines && body.lines.length > 0) ? (body.lines as any) : [],
        dispensedBySnapshot: body.dispensedBy || 'Pharmacy Staff',
        dispensedAt: body.dispensedAt ? new Date(body.dispensedAt) : new Date(),
      };

      let charge;
      if (existingCharge) {
        charge = await tx.hmsPharmacyCharge.update({
          where: { id: existingCharge.id },
          data: chargeData,
        });
      } else {
        charge = await tx.hmsPharmacyCharge.create({
          data: chargeData,
        });
      }

      // Credit the advance-derived pharmacy portion computed above (step 9)
      // on top of whatever `chargeData.patientPaid` already carried
      // forward — same CLEARED/PARTIALLY_COLLECTED rule `collectPayment`
      // applies for a fresh payment.
      if (pharmacyPortionFromAdvance.greaterThan(0)) {
        const newPatientPaid = charge.patientPaid.plus(pharmacyPortionFromAdvance);
        const newPatientOutstanding = Decimal.max(0, charge.totalAmount.minus(newPatientPaid));
        const chargePaidInFull = newPatientOutstanding.equals(0);
        charge = await tx.hmsPharmacyCharge.update({
          where: { id: charge.id },
          data: {
            patientPaid: newPatientPaid,
            patientOutstanding: newPatientOutstanding,
            patientPaymentStatus: chargePaidInFull ? 'CLEARED' : 'PARTIALLY_COLLECTED',
            settlementStatus: chargePaidInFull && charge.settlementStatus === 'NOT_DUE' ? 'PENDING' : charge.settlementStatus,
          },
        });
      }

      // Link clearance to charge if applicable
      if (allRequestRefs.size > 0) {
        await tx.pharmacyClearance.updateMany({
          where: {
            admissionRecordId: admission.id,
            OR: [
              { medicineRequestNumber: { in: Array.from(allRequestRefs) } },
              { id: { in: Array.from(allRequestRefs) } },
            ],
          },
          data: { pharmacyChargeId: charge.id },
        });
      }

      return { charge, hospitalInvoice, alreadyProcessed: false, advanceFolded: pharmacyPortionFromAdvance.greaterThan(0) };
    }, { maxWait: 15000, timeout: 30000 });

    // Resync the authoritative collected total to Pharmacy outside the DB
    // transaction — same non-blocking, error-swallowing pattern
    // `collectPayment` uses, so a webhook retry/network blip here never
    // breaks the dispense callback itself.
    if (result.advanceFolded) {
      pharmacyBridgeClient.reconcileCollection({
        pharmacyInvoiceNumber: result.charge.pharmacyInvoiceNumber,
        authoritativeCollectedAmount: Number(result.charge.patientPaid),
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[pharmacyBridgeService] Failed to notify pharmacy of advance-credited collection:', err);
      });
    }

    return result;
  },

  // ── Inter-Entity Settlement Workflow (Hospital Management ↔ Pharmacy) ───
  async handleSettlementRequest(body: SettlementRequestBody) {
    const charge = await prisma.hmsPharmacyCharge.findUnique({
      where: { pharmacyInvoiceNumber: body.pharmacyInvoiceNumber },
    });
    if (!charge) throw new NotFoundError(`Pharmacy charge for invoice ${body.pharmacyInvoiceNumber} not found`);

    return prisma.$transaction(async (tx) => {
      const settlement = await tx.hmsPharmacySettlement.upsert({
        where: { settlementNumber: body.settlementNumber },
        update: {
          requestedAmount: new Decimal(body.requestedAmount),
          remainingAmount: new Decimal(body.requestedAmount).minus(charge.settledAmount),
          status: 'REQUESTED',
          remarks: body.remarks,
        },
        create: {
          settlementNumber: body.settlementNumber,
          pharmacyChargeId: charge.id,
          pharmacyInvoiceNumber: body.pharmacyInvoiceNumber,
          requestedAmount: new Decimal(body.requestedAmount),
          remainingAmount: new Decimal(body.requestedAmount),
          status: 'REQUESTED',
          requestedByExternal: body.requestedBy,
          remarks: body.remarks,
        },
      });

      await tx.hmsPharmacyCharge.update({
        where: { id: charge.id },
        data: { settlementStatus: 'REQUESTED' },
      });

      return settlement;
    });
  },

  async listSettlements() {
    return prisma.hmsPharmacySettlement.findMany({
      include: {
        pharmacyCharge: {
          include: {
            admissionRecord: {
              include: {
                panelPatient: { select: { fullName: true, mrNumber: true } },
                selfPayEncounter: { select: { fullName: true } },
              },
            },
          },
        },
        releasedByUser: { select: { displayName: true, username: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  },

  /**
   * Releasing money to Pharmacy is restricted to SUPER_ADMIN / ADMIN only —
   * a deliberately tighter rule than the `pharmacy-bridge:edit` module grant
   * (which PHARMACY_SUPER_ADMIN / PHARMACY_MANAGER also hold for managing
   * their own requests), because this one action actually moves money out
   * of the hospital.
   */
  async releaseSettlement(settlementId: string, body: ReleaseSettlementBody, actorId: string, actorRole: string) {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
      throw new AuthorizationError('Only Super Admin or Admin can release a settlement payment to Pharmacy.');
    }

    const settlement = await prisma.hmsPharmacySettlement.findUnique({
      where: { id: settlementId },
      include: { pharmacyCharge: true },
    });
    if (!settlement) throw new NotFoundError('Settlement not found');
    if (settlement.status === 'SETTLED') throw new ValidationError('Settlement is already settled');

    const releaseAmt = new Decimal(body.releasedAmount);
    if (releaseAmt.greaterThan(settlement.remainingAmount)) {
      throw new ValidationError(`Release amount (${releaseAmt}) cannot exceed remaining amount (${settlement.remainingAmount})`);
    }

    const actor = await prisma.portalUser.findUnique({ where: { id: actorId } });
    const newReleasedTotal = settlement.releasedAmount.plus(releaseAmt);
    const newRemaining = settlement.requestedAmount.minus(newReleasedTotal);
    const newStatus = newRemaining.equals(0) ? 'SETTLED' : 'PARTIALLY_RELEASED';

    const result = await prisma.$transaction(async (tx) => {
      const updatedSettlement = await tx.hmsPharmacySettlement.update({
        where: { id: settlement.id },
        data: {
          releasedAmount: newReleasedTotal,
          remainingAmount: newRemaining,
          status: newStatus,
          paymentMethod: body.paymentMethod,
          paymentReference: body.paymentReference,
          remarks: body.remarks,
          releasedById: actorId,
          releasedAt: new Date(),
        },
      });

      await tx.hmsPharmacyCharge.update({
        where: { id: settlement.pharmacyChargeId },
        data: {
          settledAmount: settlement.pharmacyCharge.settledAmount.plus(releaseAmt),
          settlementStatus: newStatus,
        },
      });

      // Record this as real money leaving the hospital — without this, the
      // release updated HMS's own internal receivable tracking but never
      // showed up anywhere HMS's own cash/expense reporting looks (Expense
      // Report, Management Summary), so Admin had no visibility into how
      // much had actually been paid out to Pharmacy.
      const pharmacyDepartment = await requirePharmacyDepartment(tx);
      await tx.expense.create({
        data: {
          expenseNumber: await generateExpenseNumber(tx),
          expenseDate: new Date(),
          category: 'MEDICAL_SUPPLIES',
          amount: releaseAmt,
          paymentMethod: body.paymentMethod,
          paidTo: 'Standalone Pharmacy',
          reference: body.paymentReference,
          description: `Pharmacy settlement release — ${settlement.pharmacyInvoiceNumber} (Settlement ${settlement.settlementNumber})${body.remarks ? `: ${body.remarks}` : ''}`,
          departmentId: pharmacyDepartment.id,
          createdById: actorId,
        },
      });

      return updatedSettlement;
    });

    // Notify Pharmacy Backend via Bridge
    await pharmacyBridgeClient.releaseSettlement({
      settlementNumber: settlement.settlementNumber,
      pharmacyInvoiceNumber: settlement.pharmacyInvoiceNumber,
      releasedAmount: Number(releaseAmt),
      remainingPayable: Number(newRemaining),
      paymentMethod: body.paymentMethod,
      paymentReference: body.paymentReference,
      releasedBy: actor?.displayName || actor?.username || 'Admin',
      releasedAt: new Date().toISOString(),
      remarks: body.remarks,
    });

    return result;
  },

  /**
   * Manual "Resync to Pharmacy" — re-sends the already-correct
   * `HmsPharmacyCharge.patientPaid` (confirmed on this side) to Pharmacy's
   * `PharmacyInvoice.hmsCollectedAmount`, for when the automatic webhook
   * fired inside `collectPayment` silently failed (that call only logs and
   * moves on, so a Front Desk cashier's payment is never blocked by it).
   * Safe to click more than once — `reconcileCollection` sets the
   * authoritative total rather than adding to it.
   */
  async resyncPatientCollected(admissionId: string) {
    const charge = await prisma.hmsPharmacyCharge.findFirst({
      where: { admissionRecordId: admissionId },
    });
    if (!charge) throw new NotFoundError('No pharmacy charge found for this admission');

    await pharmacyBridgeClient.reconcileCollection({
      pharmacyInvoiceNumber: charge.pharmacyInvoiceNumber,
      authoritativeCollectedAmount: Number(charge.patientPaid),
    });

    return charge;
  },

  async listCharges(admissionRecordId?: string) {
    return prisma.hmsPharmacyCharge.findMany({
      where: admissionRecordId ? { admissionRecordId } : undefined,
      include: {
        settlements: true,
        admissionRecord: {
          include: {
            panelPatient: { select: { fullName: true } },
            selfPayEncounter: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};
