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
      serviceRateId: string;
      quantity: Decimal;
      lineGross: Decimal;
      lineNet: Decimal;
      discountAmount: Decimal;
    },
    doctorStaffId: string,
  ) {
    // 1. Check if commission is already accrued for this invoice line (enforces 1:1 constraint)
    const existing = await tx.doctorCommissionAccrual.findUnique({
      where: { invoiceLineItemId: lineItem.id },
    });
    if (existing) return existing;

    const now = new Date();

    // PDF §9 — only "+ Commission" salary types earn commission. A staff member
    // whose current Salary Profile is plain Monthly/Daily earns none, even if
    // an old rule is still open. (No salary profile yet = legacy commission-only doctor.)
    const salaryProfile = await tx.staffSalaryProfile.findFirst({
      where: { staffId: doctorStaffId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { salaryBasis: true },
    });
    if (salaryProfile && !isCommissionBasis(salaryProfile.salaryBasis)) return null;

    // 2. Query doctor-specific rule for this specific service rate
    let rule = await tx.doctorCommissionRule.findFirst({
      where: {
        staffId: doctorStaffId,
        serviceRateId: lineItem.serviceRateId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
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
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
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
    const hospitalShare = lineItem.lineNet.minus(commissionAmount);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

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
  ) {
    const accrual = await tx.doctorCommissionAccrual.findUnique({
      where: { invoiceLineItemId },
    });
    if (!accrual) return null;

    return tx.commissionReversal.create({
      data: {
        doctorCommissionAccrualId: accrual.id,
        reversalAmount: accrual.commissionAmount,
        reason,
        reversedById,
      },
    });
  },

  async createCommissionRule(body: CreateCommissionRuleBody, actorId: string) {
    const salaryProfile = await prisma.staffSalaryProfile.findFirst({
      where: { staffId: body.staffId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
      select: { salaryBasis: true },
    });
    if (salaryProfile && !isCommissionBasis(salaryProfile.salaryBasis)) {
      throw new ValidationError('This staff member is on a salary type without commission. Change the Salary Type to Monthly + Commission or Daily + Commission first.');
    }
    return prisma.doctorCommissionRule.create({
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
    if (query.startDate && query.endDate) {
      where.periodStart = { gte: new Date(query.startDate) };
      where.periodEnd = { lte: new Date(`${query.endDate}T23:59:59.999Z`) };
    }

    return prisma.doctorCommissionAccrual.findMany({
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
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  },

  /** Commission Run's "Approve" step (staff.md §20) — locks an accrual before it can be paid out. */
  async approveAccrual(id: string, actorId: string) {
    const accrual = await prisma.doctorCommissionAccrual.findUnique({ where: { id } });
    if (!accrual) throw new NotFoundError('Commission accrual not found');
    if (accrual.status !== 'ACCRUED') {
      throw new ConflictError('Only a freshly accrued commission line can be approved.');
    }
    return prisma.doctorCommissionAccrual.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
      include: { doctor: { select: { id: true, fullName: true, employeeId: true } }, payouts: true },
    });
  },

  /** Only an APPROVED (or already PARTIALLY_PAID) accrual can be paid — mirrors Payroll's slip-payment gate. */
  async payAccrual(id: string, body: PayAccrualBody, actorId: string) {
    const accrual = await prisma.doctorCommissionAccrual.findUnique({ where: { id }, include: { payouts: true, reversals: true } });
    if (!accrual) throw new NotFoundError('Commission accrual not found');
    if (accrual.status !== 'APPROVED' && accrual.status !== 'PARTIALLY_PAID') {
      throw new ConflictError('Only an approved commission accrual can be paid.');
    }
    const alreadyPaid = accrual.payouts.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
    const reversed = accrual.reversals.reduce((sum, r) => sum.plus(r.reversalAmount), new Decimal(0));
    const payable = accrual.commissionAmount.minus(reversed);
    const remaining = payable.minus(alreadyPaid);
    if (remaining.lte(0)) throw new ConflictError('This commission accrual is already fully paid (or fully reversed).');
    if (new Decimal(body.amount).gt(remaining)) {
      throw new ValidationError(`Payment amount exceeds the remaining balance of ${remaining.toFixed(2)}.`);
    }

    return prisma.$transaction(async (tx) => {
      await tx.commissionPayout.create({
        data: { doctorCommissionAccrualId: id, amount: body.amount, method: body.method, reference: body.reference, paidById: actorId },
      });
      const newPaidTotal = alreadyPaid.plus(body.amount);
      const newStatus = newPaidTotal.gte(payable) ? 'PAID' : 'PARTIALLY_PAID';
      return tx.doctorCommissionAccrual.update({
        where: { id },
        data: { status: newStatus },
        include: { doctor: { select: { id: true, fullName: true, employeeId: true } }, payouts: true, reversals: true },
      });
    });
  },
};
