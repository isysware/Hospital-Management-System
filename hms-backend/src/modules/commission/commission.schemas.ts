import { z } from 'zod';

export const commissionRuleIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createCommissionRuleSchema = z.object({
  staffId: z.string().uuid(),
  serviceRateId: z.string().uuid().optional().nullable(),
  ruleType: z.enum(['FIXED_PER_SERVICE', 'PERCENTAGE']),
  rate: z.coerce.number().positive(),
  basis: z.enum(['GROSS', 'NET']).default('NET'),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().optional().nullable(),
  // v7.2 Doctor Commission Tax (HMS_V7.2_NEW_REQUIREMENTS.md §2.7) —
  // independent of any salary tax; effective-dated via this same rule.
  commissionTaxMethod: z.enum(['PERCENTAGE', 'FIXED']).optional().nullable(),
  commissionTaxValue: z.coerce.number().nonnegative().optional().nullable(),
});

export type CreateCommissionRuleBody = z.infer<typeof createCommissionRuleSchema>;

export const listCommissionRulesQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
  serviceRateId: z.string().uuid().optional(),
});

export type ListCommissionRulesQuery = z.infer<typeof listCommissionRulesQuerySchema>;

export const listAccrualsQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
  status: z.enum(['ACCRUED', 'GENERATED', 'APPROVED', 'PARTIALLY_PAID', 'PAID']).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ListAccrualsQuery = z.infer<typeof listAccrualsQuerySchema>;

export const accrualIdParamsSchema = z.object({ id: z.string().uuid() });

export const payAccrualBodySchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']),
  reference: z.string().max(200).optional(),
});
export type PayAccrualBody = z.infer<typeof payAccrualBodySchema>;
