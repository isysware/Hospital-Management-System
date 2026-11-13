import { prisma } from '../db/client';
import { AuthorizationError } from './errors/AppError';

/**
 * Evaluates whether an invoice line or service item is eligible for discount.
 * All hospital services, doctor charges, room/bed charges, and encounter fees
 * are eligible for discounts by default unless explicitly excluded (e.g. outsourced vendors).
 */
export function isEligibleHospitalService(serviceRateOrLine: any): boolean {
  if (!serviceRateOrLine) return true;
  // If a full line item is passed, or an object containing billingSource
  if (serviceRateOrLine.billingSource === 'DOCTOR_CHARGE' || serviceRateOrLine.billingSource === 'ROOM_BED') {
    return true;
  }
  // If serviceRate object has providerType OUTSOURCED, it can be excluded if desired, but internal is eligible
  if (serviceRateOrLine.providerType === 'OUTSOURCED' || serviceRateOrLine.fulfillmentOwnership === 'OUTSOURCED') {
    return false;
  }
  if (serviceRateOrLine.discountAllowed === false) {
    return false;
  }
  return true;
}

export const DISCOUNT_APPROVAL_PERCENT_THRESHOLD = 15; // default fallback > 15% requires Admin approval
export const DISCOUNT_APPROVAL_AMOUNT_THRESHOLD = 1500; // default fallback > PKR 1,500 requires Admin approval

export async function getHospitalDiscountPolicy() {
  try {
    const profile = await prisma.hospitalProfile.findFirst();
    const ext = (profile?.extendedProfile as Record<string, any>) || {};
    return {
      approvalRequired: ext.discountApprovalRequired !== false,
      maxPercentThreshold: typeof ext.discountMaxPercentThreshold === 'number' ? ext.discountMaxPercentThreshold : DISCOUNT_APPROVAL_PERCENT_THRESHOLD,
      maxAmountThreshold: typeof ext.discountMaxAmountThreshold === 'number' ? ext.discountMaxAmountThreshold : DISCOUNT_APPROVAL_AMOUNT_THRESHOLD,
      overallAllowed: ext.discountOverallAllowed !== false,
    };
  } catch {
    return {
      approvalRequired: true,
      maxPercentThreshold: DISCOUNT_APPROVAL_PERCENT_THRESHOLD,
      maxAmountThreshold: DISCOUNT_APPROVAL_AMOUNT_THRESHOLD,
      overallAllowed: true,
    };
  }
}

export async function validateDiscountAuthorization(
  actorRole: string,
  discountAmount: any,
  discountPct: number,
  contextDesc: string = 'Discount'
): Promise<void> {
  const policy = await getHospitalDiscountPolicy();
  const amtNum = typeof discountAmount === 'number' ? discountAmount : (discountAmount?.toNumber ? discountAmount.toNumber() : Number(discountAmount || 0));

  if (!policy.overallAllowed && !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    throw new AuthorizationError('Hospital-wide discounts are currently disabled in Hospital Overview.');
  }

  if (policy.approvalRequired && !['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) {
    if (discountPct > policy.maxPercentThreshold || amtNum > policy.maxAmountThreshold) {
      throw new AuthorizationError(
        `${contextDesc} of PKR ${amtNum.toFixed(2)} (${discountPct.toFixed(1)}%) exceeds front desk limit (Max ${policy.maxPercentThreshold}% or PKR ${policy.maxAmountThreshold}). Please request Admin approval.`
      );
    }
  }
}

