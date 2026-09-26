import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError } from '@/shared/errors/AppError';
import { resolvePanelCoverage } from '@/shared/panelCoverage';
import { assertMembershipEligible, membershipIneligibilityReasons } from '@/shared/panelMembership';
import type { ContractResolutionQuery, RecordPanelRemittanceBody } from './panelBilling.schemas';

import { generateRemittanceNumber } from '@/shared/idGenerator';

/**
 * Panel Billing (HMS_V7.2_NEW_REQUIREMENTS.md §2.5/§3.3): Panel Verification,
 * Contract Resolution, Panel Interim Statement, and Panel Remittance. Reuses
 * the existing `resolvePanelCoverage()` helper (already shared by Appointments
 * and Admission billing) so coverage math never drifts, and mirrors
 * `admissionBilling.service.ts`'s payment-allocation algorithm exactly for
 * remittance allocation across department invoices.
 */
export const panelBillingService = {
  /** Panel Verification — confirms active membership before any billing action. */
  async verifyPanelPatient(panelPatientId: string) {
    const panelPatient = await prisma.panelPatient.findUnique({
      where: { id: panelPatientId },
      include: { corporatePanel: true },
    });
    if (!panelPatient) throw new NotFoundError('Panel patient not found');

    const reasons = membershipIneligibilityReasons(panelPatient);

    return {
      panelPatient: {
        id: panelPatient.id,
        mrNumber: panelPatient.mrNumber,
        fullName: panelPatient.fullName,
        panelMemberId: panelPatient.panelMemberId,
        membershipStatus: panelPatient.membershipStatus,
        membershipValidFrom: panelPatient.membershipValidFrom,
        membershipValidTo: panelPatient.membershipValidTo,
        status: panelPatient.status,
        isActive: panelPatient.isActive,
      },
      corporatePanel: {
        id: panelPatient.corporatePanel.id,
        code: panelPatient.corporatePanel.code,
        organizationName: panelPatient.corporatePanel.organizationName,
        isActive: panelPatient.corporatePanel.isActive,
      },
      membershipActive: reasons.length === 0,
      reasons,
    };
  },

  /** Contract Resolution — Contract Amount / Patient Share / Panel Receivable preview for one service. */
  async resolveContract(query: ContractResolutionQuery) {
    const panelPatient = await prisma.panelPatient.findUnique({
      where: { id: query.panelPatientId },
      include: { corporatePanel: { include: { discountRules: true } } },
    });
    if (!panelPatient) throw new NotFoundError('Panel patient not found');

    const serviceRate = await prisma.serviceRate.findUnique({ where: { id: query.serviceRateId } });
    if (!serviceRate) throw new NotFoundError('Service not found');

    const quantity = new Decimal(query.quantity ?? 1);
    const contractAmount = serviceRate.standardRate.mul(quantity);

    if (panelPatient.isActive === false || (panelPatient.status && panelPatient.status !== 'ACTIVE') || panelPatient.corporatePanel.isActive === false) {
      throw new ValidationError('Panel patient and company must be active');
    }
    if (serviceRate.isActive === false || serviceRate.isDeleted) throw new ValidationError('Service is inactive');
    assertMembershipEligible(panelPatient);
    const resolution = resolvePanelCoverage(contractAmount, panelPatient.corporatePanel.discountRules, query.serviceRateId, new Date(), serviceRate.departmentId, quantity, panelPatient);
    const matchingRule = resolution.matchedRule;
    const source = resolution.source;

    return {
      serviceRateId: serviceRate.id,
      serviceCode: serviceRate.code,
      serviceName: serviceRate.name,
      quantity: quantity.toNumber(),
      contractAmount: resolution.eligibleNet,
      grossAmount: contractAmount,
      matchedScope: matchingRule?.scope ?? (matchingRule ? 'SERVICE' : null),
      coverageSnapshot: resolution.coverageSnapshot,
      patientShare: resolution.patientShare,
      panelReceivable: resolution.panelReceivable,
      discountAmount: resolution.discountAmount,
      discountReason: resolution.discountReason,
      coveragePercent: matchingRule?.coveragePercent ?? null,
      capAmount: matchingRule?.capAmount ?? null,
      preauthorizationRequired: matchingRule?.preauthorizationRequired ?? false,
      source,
    };
  },

  /**
   * Panel Interim Statement — every invoice with a panel receivable for this
   * panel (optionally one patient). Patient Share (collected/outstanding)
   * and Panel Receivable (realized via remittance/outstanding) are always
   * reported separately, never blended (v7.2 hard rule). Patient Share
   * Collected is derived as `min(paidTotal, patientShare)` — Front Desk only
   * ever collects Patient Share in cash from a panel patient (panel
   * receivable is realized solely via remittance, never patient cash), so
   * this holds exactly under correct operation.
   */
  async getPanelStatement(corporatePanelId: string, panelPatientId?: string) {
    const corporatePanel = await prisma.corporatePanel.findUnique({ where: { id: corporatePanelId } });
    if (!corporatePanel) throw new NotFoundError('Corporate panel not found');

    if (panelPatientId) {
      const patient = await prisma.panelPatient.findUnique({ where: { id: panelPatientId }, select: { id: true } });
      if (!patient) throw new NotFoundError('Panel patient not found');
    }

    // "Active patients" reports this panel's CURRENT roster — a distinct
    // question from which invoices historically belong to this company
    // (below), which must not shrink just because a patient later
    // transferred to a different company.
    const currentRoster = await prisma.panelPatient.findMany({
      where: panelPatientId ? { id: panelPatientId, corporatePanelId } : { corporatePanelId },
      select: { id: true },
    });
    const activePatientsCount = currentRoster.length;

    // Keyed off the invoice's own frozen corporatePanelId (panel.md §14
    // backlog item 1), never re-derived from panelPatient's CURRENT
    // company — a receivable stays on the books of the company it was
    // actually billed to, even after the patient transfers elsewhere.
    const invoiceWhere: Prisma.HospitalInvoiceWhereInput = panelPatientId
      ? { corporatePanelId, panelPatientId, panelReceivable: { gt: 0 }, status: { not: 'VOID' } }
      : { corporatePanelId, panelReceivable: { gt: 0 }, status: { not: 'VOID' } };
    const invoices = await prisma.hospitalInvoice.findMany({
      where: invoiceWhere,
      include: {
        department: { select: { id: true, name: true, code: true } },
        panelPatient: { select: { id: true, fullName: true, mrNumber: true, panelMemberId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const invoiceIds = invoices.map((inv) => inv.id);
    const realizedGroups =
      invoiceIds.length === 0
        ? []
        : await prisma.panelRemittanceAllocation.groupBy({
            by: ['hospitalInvoiceId'],
            where: { hospitalInvoiceId: { in: invoiceIds } },
            _sum: { allocatedAmount: true },
          });
    const realizedByInvoice = new Map(realizedGroups.map((g) => [g.hospitalInvoiceId, g._sum.allocatedAmount ?? new Decimal(0)]));

    const rows = invoices.map((inv) => {
      const panelReceivableRealized = realizedByInvoice.get(inv.id) ?? new Decimal(0);
      const patientShareCollected = inv.paidTotal.lessThan(inv.patientShare) ? inv.paidTotal : inv.patientShare;
      return {
        hospitalInvoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        createdAt: inv.createdAt,
        sourceType: inv.sourceType,
        encounterType: inv.encounterType,
        panelPatient: inv.panelPatient,
        department: inv.department,
        total: inv.total,
        patientShare: inv.patientShare,
        patientShareCollected,
        patientShareOutstanding: inv.patientShare.minus(patientShareCollected),
        panelReceivable: inv.panelReceivable,
        panelReceivableRealized,
        panelReceivableOutstanding: inv.panelReceivable.minus(panelReceivableRealized),
      };
    });

    const consolidated = rows.reduce(
      (acc, r) => ({
        patientShare: acc.patientShare.plus(r.patientShare),
        patientShareCollected: acc.patientShareCollected.plus(r.patientShareCollected),
        patientShareOutstanding: acc.patientShareOutstanding.plus(r.patientShareOutstanding),
        panelReceivable: acc.panelReceivable.plus(r.panelReceivable),
        panelReceivableRealized: acc.panelReceivableRealized.plus(r.panelReceivableRealized),
        panelReceivableOutstanding: acc.panelReceivableOutstanding.plus(r.panelReceivableOutstanding),
      }),
      {
        patientShare: new Decimal(0),
        patientShareCollected: new Decimal(0),
        patientShareOutstanding: new Decimal(0),
        panelReceivable: new Decimal(0),
        panelReceivableRealized: new Decimal(0),
        panelReceivableOutstanding: new Decimal(0),
      },
    );

    return {
      corporatePanelId: corporatePanel.id,
      corporatePanelName: corporatePanel.organizationName,
      activePatientsCount,
      invoices: rows,
      consolidated,
    };
  },

  /**
   * Panel Remittance — record an incoming payment from the panel company and
   * allocate it across this panel's outstanding department invoices. Never
   * touches `HospitalInvoice.paidTotal`/`status` (those track patient cash
   * only); realization lives entirely in `PanelRemittanceAllocation`.
   */
  async recordRemittance(corporatePanelId: string, body: RecordPanelRemittanceBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const corporatePanel = await tx.corporatePanel.findUnique({ where: { id: corporatePanelId } });
      if (!corporatePanel) throw new NotFoundError('Corporate panel not found');

      // Serialize remittances per company: two payments recorded at the same
      // moment would otherwise both read the same outstanding balances and
      // together over-allocate (over-realize) the receivable.
      await tx.$queryRaw`SELECT id FROM corporate_panels WHERE id = ${corporatePanelId} FOR UPDATE`;

      // Keyed off each invoice's own frozen corporatePanelId (panel.md §14
      // backlog item 1) so a remittance always allocates against the exact
      // company it was actually paid by, even for invoices whose patient
      // has since transferred to a different company.
      const invoices = await tx.hospitalInvoice.findMany({
        where: { corporatePanelId, panelReceivable: { gt: 0 }, status: { not: 'VOID' } },
        orderBy: { createdAt: 'asc' },
      });
      if (invoices.length === 0) {
        throw new NotFoundError('No panel-receivable invoices exist for this panel');
      }

      const realizedGroups = await tx.panelRemittanceAllocation.groupBy({
        by: ['hospitalInvoiceId'],
        where: { hospitalInvoiceId: { in: invoices.map((i) => i.id) } },
        _sum: { allocatedAmount: true },
      });
      const realizedByInvoice = new Map(realizedGroups.map((g) => [g.hospitalInvoiceId, g._sum.allocatedAmount ?? new Decimal(0)]));
      const outstandingByInvoice = new Map(
        invoices.map((inv) => [inv.id, inv.panelReceivable.minus(realizedByInvoice.get(inv.id) ?? new Decimal(0))]),
      );

      const amountDecimal = new Decimal(body.amount);
      let allocations: { hospitalInvoiceId: string; amount: Decimal }[];

      if (body.allocations && body.allocations.length > 0) {
        // Each entry is checked against the invoice's outstanding on its own,
        // so the same invoice listed twice could otherwise be over-allocated.
        const seen = new Set<string>();
        for (const a of body.allocations) {
          if (seen.has(a.hospitalInvoiceId)) throw new ValidationError('Each invoice can appear only once in a remittance allocation');
          seen.add(a.hospitalInvoiceId);
        }
        const byId = new Map(invoices.map((inv) => [inv.id, inv]));
        let sum = new Decimal(0);
        allocations = body.allocations.map((a) => {
          const invoice = byId.get(a.hospitalInvoiceId);
          if (!invoice) throw new ValidationError(`Invoice ${a.hospitalInvoiceId} does not belong to this panel`);
          const amt = new Decimal(a.amount);
          const outstanding = outstandingByInvoice.get(invoice.id)!;
          if (amt.greaterThan(outstanding)) {
            throw new ValidationError(
              `Allocation to ${invoice.invoiceNumber} (${amt.toString()}) exceeds its outstanding panel receivable (${outstanding.toString()})`,
            );
          }
          sum = sum.plus(amt);
          return { hospitalInvoiceId: invoice.id, amount: amt };
        });
        if (!sum.equals(amountDecimal)) {
          throw new ValidationError(`Allocations (${sum.toString()}) must sum to exactly the remittance amount (${amountDecimal.toString()})`);
        }
      } else {
        const eligible = invoices
          .map((inv) => ({ invoice: inv, outstanding: outstandingByInvoice.get(inv.id)! }))
          .filter((x) => x.outstanding.greaterThan(0));
        const totalOutstanding = eligible.reduce((sum, x) => sum.plus(x.outstanding), new Decimal(0));

        if (totalOutstanding.lessThanOrEqualTo(0)) {
          throw new ValidationError('Nothing outstanding to allocate this remittance against for this panel');
        }
        if (amountDecimal.greaterThan(totalOutstanding)) {
          throw new ValidationError(
            `Amount (${amountDecimal.toString()}) exceeds total outstanding panel receivable (${totalOutstanding.toString()}). Provide explicit allocations for any advance/credit portion.`,
          );
        }

        // Proportional shares rounded DOWN to the paisa (never above an
        // invoice's outstanding), then the leftover paisas go to the oldest
        // invoices that still have room — so the total is exact and no
        // invoice is ever allocated more than it owes.
        allocations = eligible.map((x) => ({
          hospitalInvoiceId: x.invoice.id,
          amount: Decimal.min(x.outstanding, amountDecimal.mul(x.outstanding).div(totalOutstanding).toDecimalPlaces(2, Decimal.ROUND_DOWN)),
        }));
        let leftover = amountDecimal.minus(allocations.reduce((s, a) => s.plus(a.amount), new Decimal(0)));
        for (let i = 0; i < allocations.length && leftover.greaterThan(0); i++) {
          const room = eligible[i]!.outstanding.minus(allocations[i]!.amount);
          const add = Decimal.min(room, leftover);
          allocations[i]!.amount = allocations[i]!.amount.plus(add);
          leftover = leftover.minus(add);
        }
      }

      const remittance = await tx.panelRemittance.create({
        data: {
          remittanceNumber: await generateRemittanceNumber(tx),
          corporatePanelId,
          amount: amountDecimal,
          method: body.method,
          reference: body.reference,
          remarks: body.remarks,
          receivedAt: body.receivedAt ?? new Date(),
          receivedById: actorId,
          allocations: {
            create: allocations
              .filter((a) => a.amount.greaterThan(0))
              .map((a) => ({ hospitalInvoiceId: a.hospitalInvoiceId, allocatedAmount: a.amount })),
          },
        },
        include: { allocations: true },
      });

      return remittance;
    });
  },

  /**
   * Panel Company Ledger — one chronological, running-balance statement of
   * the company's payable: every panel-covered invoice is a debit (the
   * company's receivable portion only, never the patient's share) and every
   * recorded remittance is a credit. Patient co-pay is reported alongside as
   * a separate total and never folded into the company balance (v7.2 hard
   * rule: patient share and panel receivable are always distinct).
   */
  async getPanelLedger(corporatePanelId: string) {
    const corporatePanel = await prisma.corporatePanel.findUnique({ where: { id: corporatePanelId } });
    if (!corporatePanel) throw new NotFoundError('Corporate panel not found');

    // Both keyed off each invoice's own frozen corporatePanelId (panel.md
    // §14 backlog item 1) — the company that actually owns this ledger, not
    // whichever company the patient currently belongs to.
    const [chargeInvoices, allPatientInvoices, remittances] = await Promise.all([
      prisma.hospitalInvoice.findMany({
        where: { corporatePanelId, panelReceivable: { gt: 0 }, status: { not: 'VOID' } },
        select: {
          id: true,
          invoiceNumber: true,
          createdAt: true,
          panelReceivable: true,
          sourceType: true,
          panelPatient: { select: { fullName: true, mrNumber: true } },
          department: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.hospitalInvoice.findMany({
        where: { corporatePanelId, status: { not: 'VOID' } },
        select: { patientShare: true, paidTotal: true },
      }),
      prisma.panelRemittance.findMany({
        where: { corporatePanelId },
        select: { id: true, remittanceNumber: true, amount: true, receivedAt: true, method: true, reference: true },
        orderBy: { receivedAt: 'asc' },
      }),
    ]);

    type LedgerEntry = {
      date: Date;
      type: 'CHARGE' | 'REMITTANCE';
      reference: string;
      description: string;
      patientName: string | null;
      debit: Decimal;
      credit: Decimal;
    };

    const entries: LedgerEntry[] = [
      ...chargeInvoices.map((inv) => ({
        date: inv.createdAt,
        type: 'CHARGE' as const,
        reference: inv.invoiceNumber,
        description: [inv.sourceType, inv.department?.name].filter(Boolean).join(' — '),
        patientName: inv.panelPatient?.fullName ?? null,
        debit: inv.panelReceivable,
        credit: new Decimal(0),
      })),
      ...remittances.map((r) => ({
        date: r.receivedAt,
        type: 'REMITTANCE' as const,
        reference: r.remittanceNumber,
        description: [r.method, r.reference].filter(Boolean).join(' — ') || 'Remittance received',
        patientName: null,
        debit: new Decimal(0),
        credit: r.amount,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = new Decimal(0);
    const rows = entries.map((e) => {
      runningBalance = runningBalance.plus(e.debit).minus(e.credit);
      return { ...e, runningBalance };
    });

    const totalDebit = entries.reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
    const totalCredit = entries.reduce((sum, e) => sum.plus(e.credit), new Decimal(0));

    const patientShareTotal = allPatientInvoices.reduce((sum, inv) => sum.plus(inv.patientShare), new Decimal(0));
    const patientShareCollected = allPatientInvoices.reduce((sum, inv) => {
      const collected = inv.paidTotal.lessThan(inv.patientShare) ? inv.paidTotal : inv.patientShare;
      return sum.plus(collected);
    }, new Decimal(0));

    return {
      corporatePanelId: corporatePanel.id,
      corporatePanelName: corporatePanel.organizationName,
      entries: rows,
      totals: {
        totalDebit,
        totalCredit,
        closingBalance: runningBalance,
      },
      patientCoPay: {
        total: patientShareTotal,
        collected: patientShareCollected,
        outstanding: patientShareTotal.minus(patientShareCollected),
      },
    };
  },

  async listRemittances(corporatePanelId: string) {
    const corporatePanel = await prisma.corporatePanel.findUnique({ where: { id: corporatePanelId } });
    if (!corporatePanel) throw new NotFoundError('Corporate panel not found');

    return prisma.panelRemittance.findMany({
      where: { corporatePanelId },
      include: {
        allocations: {
          include: { hospitalInvoice: { select: { id: true, invoiceNumber: true, departmentId: true } } },
        },
        receivedByUser: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
  },
};
