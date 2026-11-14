import { z } from 'zod';

/** pharmacy.md §3 Settings screen — tax/discount, receipt, stock/expiry window, high-value approval. */
export const updatePharmacySettingsBodySchema = z.object({
  highValueApprovalEnabled: z.boolean().optional(),
  highValueThreshold: z.coerce.number().min(0).optional(),
  defaultTaxPercent: z.coerce.number().min(0).max(100).optional(),
  maxDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  nearExpiryWindowDays: z.coerce.number().int().min(1).max(3650).optional(),
  receiptHeaderText: z.string().max(200).optional().nullable(),
  receiptFooterText: z.string().max(500).optional().nullable(),
  hospitalName: z.string().max(200).optional().nullable(),
  pharmacySubtitle: z.string().max(200).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  phone: z.string().max(100).optional().nullable(),
  email: z.string().max(150).optional().nullable(),
  footerTerms: z.string().max(1000).optional().nullable(),
  footerMessage: z.string().max(200).optional().nullable(),
  footerPoweredBy: z.string().max(200).optional().nullable(),
  /// purchase-costing-plan — global fallback markup when a medicine's category has no MarkupRule.
  defaultMarkupPercent: z.coerce.number().min(0).max(1000).optional(),
});
export type UpdatePharmacySettingsBody = z.infer<typeof updatePharmacySettingsBodySchema>;

/** purchase-costing-plan — category-wise markup override. */
export const upsertMarkupRuleBodySchema = z.object({
  category: z.string().min(1).max(80),
  markupPercent: z.coerce.number().min(0).max(1000),
  isActive: z.boolean().default(true),
});
export type UpsertMarkupRuleBody = z.infer<typeof upsertMarkupRuleBodySchema>;

export const categoryParamsSchema = z.object({ category: z.string().min(1).max(80) });

/** Add-Medicine-form fix — database-driven Therapeutic Category master. Never deleted, only deactivated. */
export const createMedicineCategoryBodySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
});
export type CreateMedicineCategoryBody = z.infer<typeof createMedicineCategoryBodySchema>;

export const updateMedicineCategoryBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMedicineCategoryBody = z.infer<typeof updateMedicineCategoryBodySchema>;

export const medicineCategoryIdParamsSchema = z.object({ id: z.string().uuid() });

/** Reset testing data schema for pharmacy database */
export const resetDataBodySchema = z.object({
  scope: z.enum(['transactions_only', 'complete']),
  confirmPhrase: z.literal('RESET'),
});
export type ResetDataBody = z.infer<typeof resetDataBodySchema>;
