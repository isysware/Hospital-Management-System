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

export const commissionInclude = {
  doctor: { select: { id: true, fullName: true, employeeId: true } },
  invoiceLineItem: { include: { serviceRate: true, hospitalInvoice: { select: { id: true, invoiceNumber: true, status: true } } } },
  payouts: true, reversals: true, adjustments: true,
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
    actorId?: string,
  ) {
    if (!lineItem.serviceRateId) return null;
    // 1. Check if commission is already accrued for this invoice line (enforces 1:1 constraint)
    const existing = await tx.doctorCommissionAccrual.findUnique({
      where: { invoiceLineItemId: lineItem.id },
    });
    if (existing) return existing;

    const source = await tx.invoiceLineItem.findUnique({ where: { id: lineItem.id }, include: { hospitalInvoice: true } });
    if (!source?.serviceRateId || !source.isCompleted || source.hospitalInvoice.status === 'VOID' || source.performedByStaffId !== doctorStaffId) return null;
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

    // 4. Determine eligible base amount: default is NET (Gross - Discount) per D15 §4
    const eligibleAmount = rule.basis === 'GROSS' ? lineItem.lineGross : lineItem.lineNet;

    // 5. Calculate commission amount
    let commissionAmount = new Decimal(0);
    if (rule.ruleType === 'FIXED_PER_SERVICE') {
      commissionAmount = rule.rate.mul(lineItem.quantity);
    } else {
      // PERCENTAGE rule
      commissionAmount = eligibleAmount.mul(rule.rate).div(100);
    }

    // 6. Hospital Remaining Share = Net Service Amount - Doctor Commission
    commissionAmount = commissionAmount.toDecimalPlaces(2);
    const hospitalShare = lineItem.lineNet.minus(commissionAmount);
    const commissionTaxAmount = Decimal.min(commissionAmount,
      rule.commissionTaxMethod === 'PERCENTAGE' ? commissionAmount.mul(rule.commissionTaxValue ?? 0).div(100)
        : rule.commissionTaxMethod === 'FIXED' ? rule.commissionTaxValue ?? new Decimal(0) : new Decimal(0),
    ).toDecimalPlaces(2);

    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfDay = startOfDay;

    const ruleSnapshot = {
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
      postedById: actorId ?? source.hospitalInvoice.createdById,
      hospitalRemainingShare: hospitalShare.toNumber(),
      calculatedAt: now.toISOString(),
    };

    // 7. Create DoctorCommissionAccrual record
    return tx.doctorCommissionAccrual.create({
      data: {
        staffId: doctorStaffId,
        invoiceLineItemId: lineItem.id,
        periodType: 'DAILY',
        periodStart: startOfDay,
        periodEnd: endOfDay,
        commissionAmount,
        ruleSnapshot,
        status: 'ACCRUED',
      },
    });
  },

  /**
   * Commission reversal engine — called when a service line is refunded or cancelled
   * Never silently deletes the original statement; creates a linked reversal (§4.5, D16 p.21).
   */
  async reverseCommissionAccrual(
    tx: Prisma.TransactionClient,
    invoiceLineItemId: string,
    reason: string,
    reversedById: string,
    fraction = new Decimal(1),
  ) {
    await tx.$queryRaw`SELECT id FROM doctor_commission_accruals WHERE invoice_line_item_id = ${invoiceLineItemId} FOR UPDATE`;
    const accrual = await tx.doctorCommissionAccrual.findUnique({
      where: { invoiceLineItemId }, include: { reversals: true },
    });
    if (!accrual) return null;

    const priceChanges = accrual.reversals.filter(r => r.source === 'SERVICE_REPRICE').reduce((s, r) => s.plus(r.reversalAmount), new Decimal(0));
    const serviceGross = Decimal.max(accrual.commissionAmount.minus(priceChanges), 0);
    const alreadyReversed = accrual.reversals.filter(r => r.source !== 'SERVICE_REPRICE').reduce((s, r) => s.plus(r.reversalAmount), new Decimal(0));
    const amount = Decimal.min(serviceGross.minus(alreadyReversed), serviceGross.mul(fraction)).toDecimalPlaces(2);
    if (amount.lte(0)) return null;
    return tx.commissionReversal.create({
      data: {
        doctorCommissionAccrualId: accrual.id,
        reversalAmount: amount,
        reason,
        reversedById,
      },
    });
  },

  /** Discount corrections append a signed reversal instead of rewriting earnings. */
  async repriceCommission(tx: Prisma.TransactionClient, lineId: string, oldNet: Decimal, newNet: Decimal, actorId: string, reason: string) {
    await tx.$queryRaw`SELECT id FROM doctor_commission_accruals WHERE invoice_line_item_id = ${lineId} FOR UPDATE`;
    const accrual = await tx.doctorCommissionAccrual.findUnique({ where: { invoiceLineItemId: lineId }, include: { reversals: true } });
    if (!accrual || oldNet.equals(newNet)) return;
    const rule = accrual.ruleSnapshot as Record<string, unknown>;
    if (rule.ruleType !== 'PERCENTAGE' || rule.basis !== 'NET') return;
    if (accrual.reversals.some(r => r.source === 'REFUND')) throw new ConflictError('A refunded commission service requires a separate commission adjustment, not repricing.');
    const amount = oldNet.minus(newNet).mul(String(rule.rate)).div(100).toDecimalPlaces(2);
    if (amount.isZero()) return;
    await tx.commissionReversal.create({ data: { doctorCommissionAccrualId: accrual.id, reversalAmount: amount, source: 'SERVICE_REPRICE', reason, reversedById: actorId } });
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

  async payAccrual(id: string, body: PayAccrualBody, actorId: string) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM doctor_commission_accruals WHERE id = ${id} FOR UPDATE`;
      const accrual = await tx.doctorCommissionAccrual.findUnique({ where: { id }, include: commissionInclude });
      if (!accrual) throw new NotFoundError('Commission accrual not found');
      if (!['APPROVED', 'PARTIALLY_PAID'].includes(accrual.status)) throw new ConflictError('Only approved commission can be paid.');
      const balance = commissionBalance(accrual);
      if (balance.remaining.lte(0) || new Decimal(body.amount).gt(balance.remaining)) throw new ValidationError(`Payment exceeds remaining commission ${balance.remaining.toFixed(2)}.`);
      await tx.commissionPayout.create({ data: { doctorCommissionAccrualId: id, amount: body.amount, method: body.method, reference: body.reference, paidById: actorId } });
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
