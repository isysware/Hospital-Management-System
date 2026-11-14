import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import type { Prisma } from '@prisma/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import type {
  CreateCommissionRuleBody,
  ListCommissionRulesQuery,
  ListAccrualsQuery,
  PayAccrualBody,
} from './commission.schemas';
import { isCommissionBasis } from '@/modules/identity/staff.schemas';
import { commissionBalance } from './commission.calc';
import { syncLineCollections, collectedCommission } from './commission.collections';
import { postStaffPaymentCash } from '@/modules/cash/staffPaymentCash';

export const commissionInclude = {
  doctor: { select: { id: true, fullName: true, employeeId: true } },
  invoiceLineItem: { include: { serviceRate: true, hospitalInvoice: { select: { id: true, invoiceNumber: true, status: true } } } },
  collectionEvent: true, payouts: true, reversals: true, adjustments: true,
} as const;

export function commissionStatement<T extends Parameters<typeof commissionBalance>[0]>(row: T) {
  return { ...row, balance: commissionBalance(row) };
}

export const commissionService = {
  /**
   * Core Doctor Commission calculation engine (§4.5, §8.6, D15 §4).
   * Resolves doctor-specific rules with fallback to doctor default rule.
   * Calculates Doctor Commission & Hospital Remaining Share.
   */
  async calculateAndAccrueCommission(
    tx: Prisma.TransactionClient,
    lineItem: {
      id: string;
      serviceRateId: string | null;
      quantity: Decimal;
      lineGross: Decimal;
      lineNet: Decimal;
      discountAmount: Decimal;
    },
    doctorStaffId: string,
    actorId: string,
  ) {
    if (!lineItem.serviceRateId) return null;
    await tx.$queryRaw`SELECT id FROM invoice_line_items WHERE id = ${lineItem.id} FOR UPDATE`;
    const contract = await tx.commissionCollectionEvent.findUnique({ where: { sourceKey: `CONTRACT:${lineItem.id}` } });
    if (contract) return syncLineCollections(tx, lineItem.id, actorId);
    const existing = await tx.doctorCommissionAccrual.findFirst({ where: { invoiceLineItemId: lineItem.id }, orderBy: { createdAt: 'asc' } });
    if (existing) {
      const source = await tx.invoiceLineItem.findUniqueOrThrow({ where: { id: lineItem.id }, include: { hospitalInvoice: { include: { paymentReceipts: true, panelRemittanceAllocations: true } } } });
      await tx.commissionCollectionEvent.create({ data: {
        sourceKey: `CONTRACT:${lineItem.id}`, invoiceLineItemId: lineItem.id, occurredAt: source.createdAt,
        collectedAmount: 0, commissionAmount: 0,
        ruleSnapshot: { ...(existing.ruleSnapshot as Prisma.JsonObject), staffId: existing.staffId, legacy: true,
          openingSources: [...source.hospitalInvoice.paymentReceipts.map(r => `RECEIPT:${r.id}`), ...source.hospitalInvoice.panelRemittanceAllocations.map(r => `PANEL:${r.id}`)] },
      } });
      return syncLineCollections(tx, lineItem.id, actorId);
    }

    const source = await tx.invoiceLineItem.findUnique({ where: { id: lineItem.id }, include: { hospitalInvoice: true } });
    if (!source?.serviceRateId || ['PHARMACY', 'ROOM_BED'].includes(source.billingSource) || !source.isCompleted || source.hospitalInvoice.status === 'VOID' || source.performedByStaffId !== doctorStaffId) return null;
    const assignment = await tx.staffService.findFirst({ where: {
      staffId: doctorStaffId, serviceRateId: source.serviceRateId, isActive: true,
      staff: { isActive: true }, serviceRate: { isActive: true, isDeleted: false },
    } });
    if (!assignment) return null;
    // Select the rule/profile applicable when the service was posted.
    const now = source.createdAt;

    // PDF §9 — only "+ Commission" salary types earn commission. A staff member
    // whose Salary Profile is plain Monthly/Daily (or missing) earns none,
    // even if an old commission rule is still open.
    const salaryProfile = await tx.staffSalaryProfile.findFirst({
      where: { staffId: doctorStaffId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { salaryBasis: true },
    });
    if (!salaryProfile || !isCommissionBasis(salaryProfile.salaryBasis)) return null;

    // 2. Query doctor-specific rule for this specific service rate
    let rule = await tx.doctorCommissionRule.findFirst({
      where: {
        staffId: doctorStaffId,
        serviceRateId: lineItem.serviceRateId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // 3. Fallback to doctor's default commission rule (serviceRateId = null)
    if (!rule) {
      rule = await tx.doctorCommissionRule.findFirst({
        where: {
          staffId: doctorStaffId,
          serviceRateId: null,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
    }

    if (!rule) {
      // Doctor has no commission rule configured
      return null;
    }

    // Freeze the contractual full-collection amount using the same calculator
    // that recognizes each subsequent receipt. This snapshot is not an accrual.
    const { gross: commissionAmount, tax: commissionTaxAmount } = collectedCommission(rule, lineItem, lineItem.lineNet);
    const hospitalShare = lineItem.lineNet.minus(commissionAmount);

    const ruleSnapshot = {
      staffId: doctorStaffId,
      ruleId: rule.id,
      ruleType: rule.ruleType,
      rate: rule.rate.toNumber(),
      basis: rule.basis,
      serviceRateId: lineItem.serviceRateId,
      lineGross: lineItem.lineGross.toNumber(),
      discountAmount: lineItem.discountAmount.toNumber(),
      lineNet: lineItem.lineNet.toNumber(),
      commissionAmount: commissionAmount.toNumber(),
      commissionTaxMethod: rule.commissionTaxMethod,
      commissionTaxValue: rule.commissionTaxValue?.toNumber() ?? null,
      commissionTaxAmount: commissionTaxAmount.toNumber(),
      postedById: actorId,
      hospitalRemainingShare: hospitalShare.toNumber(),
      calculatedAt: now.toISOString(),
    };

    await tx.commissionCollectionEvent.create({ data: {
      sourceKey: `CONTRACT:${lineItem.id}`, invoiceLineItemId: lineItem.id,
      occurredAt: now, collectedAmount: 0, commissionAmount: 0, ruleSnapshot,
    } });
    return syncLineCollections(tx, lineItem.id, actorId);
  },

  async syncInvoiceCollections(tx: Prisma.TransactionClient, invoiceId: string, actorId: string) {
    const lines = await tx.invoiceLineItem.findMany({ where: { hospitalInvoiceId: invoiceId }, include: { commissionAccruals: { select: { staffId: true }, take: 1 } }, orderBy: { id: 'asc' } });
    for (const line of lines) {
      const doctorId = line.performedByStaffId ?? line.commissionAccruals[0]?.staffId;
      if (doctorId) await this.calculateAndAccrueCommission(tx, line, doctorId, actorId);
    }
  },

  /**
   * Commission reversal engine — called when a service line is refunded or cancelled
   * Never silently deletes the original statement; creates a linked reversal (§4.5, D16 p.21).
   */
  async reverseCommissionAccrual(
    tx: Prisma.TransactionClient,
    invoiceLineItemId: string,
    _reason: string,
    reversedById: string,
    _fraction = new Decimal(1),
  ) {
    // Receipts are authoritative. Replaying a refund cannot reverse commission twice.
    return syncLineCollections(tx, invoiceLineItemId, reversedById);
  },

  async repriceCommission(tx: Prisma.TransactionClient, lineId: string, oldNet: Decimal, newNet: Decimal, actorId: string, _reason: string) {
    if (oldNet.equals(newNet)) return;
    const line = await tx.invoiceLineItem.findUniqueOrThrow({ where: { id: lineId } });
    await this.syncInvoiceCollections(tx, line.hospitalInvoiceId, actorId);
  },

  async createCommissionRule(body: CreateCommissionRuleBody, actorId: string) {
    const salaryProfile = await prisma.staffSalaryProfile.findFirst({
      where: { staffId: body.staffId, effectiveFrom: { lte: body.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: body.effectiveFrom } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { salaryBasis: true },
    });
    if (!salaryProfile || !isCommissionBasis(salaryProfile.salaryBasis)) {
      throw new ValidationError('This staff member is on a salary type without commission. Change the Salary Type to Monthly + Commission or Daily + Commission first.');
    }
    const assignment = await prisma.staffService.findFirst({ where: {
      staffId: body.staffId, ...(body.serviceRateId ? { serviceRateId: body.serviceRateId } : {}),
      isActive: true, staff: { isActive: true }, serviceRate: { isActive: true, isDeleted: false },
    } });
    if (!assignment) throw new ValidationError('Commission requires an active service assigned to this staff member.');
    return prisma.$transaction(async tx => {
      const future = await tx.doctorCommissionRule.findFirst({ where: {
        staffId: body.staffId, serviceRateId: body.serviceRateId ?? null, effectiveFrom: { gte: body.effectiveFrom },
      } });
      if (future) throw new ConflictError('A rule already starts on or after this date. Choose a later effective date to preserve history.');
      await tx.doctorCommissionRule.updateMany({ where: {
        staffId: body.staffId, serviceRateId: body.serviceRateId ?? null,
        effectiveFrom: { lt: body.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: body.effectiveFrom } }],
      }, data: { effectiveTo: body.effectiveFrom } });
      return tx.doctorCommissionRule.create({
      data: {
        staffId: body.staffId,
        serviceRateId: body.serviceRateId ?? null,
        ruleType: body.ruleType,
        rate: new Decimal(body.rate),
        basis: body.basis,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        commissionTaxMethod: body.commissionTaxMethod ?? null,
        commissionTaxValue: body.commissionTaxValue != null ? new Decimal(body.commissionTaxValue) : null,
        createdById: actorId,
      },
      include: {
        doctor: { select: { id: true, fullName: true, designation: true } },
        serviceRate: { select: { id: true, name: true, standardRate: true } },
      },
    });
    });
  },

  async listCommissionRules(query: ListCommissionRulesQuery) {
    return prisma.doctorCommissionRule.findMany({
      where: {
        staffId: query.staffId,
        serviceRateId: query.serviceRateId,
      },
      include: {
        doctor: { select: { id: true, fullName: true, designation: true } },
        serviceRate: { select: { id: true, name: true, standardRate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async listAccruals(query: ListAccrualsQuery) {
    const where: Prisma.DoctorCommissionAccrualWhereInput = {};
    if (query.staffId) where.staffId = query.staffId;
    if (query.status) where.status = query.status;
    if (query.startDate) where.periodStart = { gte: new Date(query.startDate) };
    if (query.endDate) where.periodEnd = { lte: new Date(`${query.endDate}T23:59:59.999Z`) };

    const rows = await prisma.doctorCommissionAccrual.findMany({
      where,
      include: {
        doctor: { select: { id: true, fullName: true, designation: true } },
        invoiceLineItem: {
          include: {
            serviceRate: true,
            hospitalInvoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
        collectionEvent: true,
        reversals: true,
        payouts: true,
        adjustments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(commissionStatement);
  },

  /** Standalone approvals are retained for existing accruals; run lines approve together. */
  async approveAccrual(id: string, actorId: string) {
    const updated = await prisma.doctorCommissionAccrual.updateMany({
      where: { id, status: 'ACCRUED', commissionRunId: null },
      data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
    });
    if (!updated.count) throw new ConflictError('Only an unassigned accrued line can be approved here. Approve generated lines from their Commission Run.');
    return commissionStatement(await prisma.doctorCommissionAccrual.findUniqueOrThrow({ where: { id }, include: commissionInclude }));
  },

  async approveAllAccruals(actorId: string, staffId?: string) {
    const where: any = { status: 'ACCRUED', commissionRunId: null };
    if (staffId) {
      where.staffId = staffId;
    }
    const updated = await prisma.doctorCommissionAccrual.updateMany({
      where,
      data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
    });
    return { count: updated.count };
  },

  async payAccrual(id: string, body: PayAccrualBody, actorId: string) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM doctor_commission_accruals WHERE id = ${id} FOR UPDATE`;
      const accrual = await tx.doctorCommissionAccrual.findUnique({ where: { id }, include: commissionInclude });
      if (!accrual) throw new NotFoundError('Commission accrual not found');
      const previous = await tx.commissionPayout.findUnique({ where: { requestKey: body.requestKey } });
      if (previous) {
        if (previous.doctorCommissionAccrualId !== id || previous.paidById !== actorId || !previous.amount.equals(body.amount) || previous.method !== body.method || (previous.reference ?? '') !== (body.reference ?? '')) throw new ConflictError('Payment request key was already used for different payment details.');
        return commissionStatement(accrual);
      }
      if (!['APPROVED', 'PARTIALLY_PAID'].includes(accrual.status)) throw new ConflictError('Only approved commission can be paid.');
      const balance = commissionBalance(accrual);
      if (balance.remaining.lte(0) || new Decimal(body.amount).gt(balance.remaining)) throw new ValidationError(`Payment exceeds remaining commission ${balance.remaining.toFixed(2)}.`);
      const cashEntryId = await postStaffPaymentCash(tx, actorId, new Decimal(body.amount), body.method, 'COMMISSION_PAYMENT', `Commission payment for accrual ${id}`);
      await tx.commissionPayout.create({ data: { doctorCommissionAccrualId: id, ...body, paidById: actorId, cashEntryId } });
      return commissionStatement(await tx.doctorCommissionAccrual.update({
        where: { id }, data: { status: balance.paid.plus(body.amount).gte(balance.payable) ? 'PAID' : 'PARTIALLY_PAID' }, include: commissionInclude,
      }));
    });
  },

  async adjustAccrual(id: string, body: { amount: number; reason: string }, actorId: string) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM doctor_commission_accruals WHERE id = ${id} FOR UPDATE`;
      const row = await tx.doctorCommissionAccrual.findUnique({ where: { id }, include: commissionInclude });
      if (!row) throw new NotFoundError('Commission accrual not found');
      if (!row.approvedAt) throw new ConflictError('Approve commission before posting a correction.');
      const balance = commissionBalance(row);
      if (balance.payable.plus(body.amount).lt(0)) throw new ValidationError('Correction cannot reduce payable below zero.');
      await tx.commissionAdjustment.create({ data: { accrualId: id, ...body, createdById: actorId } });
      const payable = balance.payable.plus(body.amount);
      return commissionStatement(await tx.doctorCommissionAccrual.update({ where: { id }, data: {
        status: balance.paid.gte(payable) ? 'PAID' : balance.paid.gt(0) ? 'PARTIALLY_PAID' : 'APPROVED',
      }, include: commissionInclude }));
    });
  },
};
