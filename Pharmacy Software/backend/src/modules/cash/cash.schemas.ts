import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });

/** pharmacy.md §11.1 — Admin issues petty cash to a Sales user (or Super Admin to Admin). */
export const issuePettyCashBodySchema = z.object({
  toUserId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  note: z.string().max(300).optional(),
});
export type IssuePettyCashBody = z.infer<typeof issuePettyCashBodySchema>;

export const balanceSheetQuerySchema = z.object({
  preset: z.enum(['shift', 'today', 'yesterday', 'this_week', 'this_month', 'custom']).optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.string().uuid().optional(),
}).superRefine((query, ctx) => {
  if (query.preset === 'custom' && (!query.fromDate || !query.toDate || query.fromDate > query.toDate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose a valid From / To date range.', path: ['fromDate'] });
  }
  if (query.from && query.to && query.from > query.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'From must not be after To.', path: ['from'] });
  }
});
export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

/** pharmacy.md §11.2 — user enters Physical Cash; Expected Cash is system-calculated. */
export const submitSettlementBodySchema = z.object({
  periodFrom: z.coerce.date(),
  periodTo: z.coerce.date(),
  physicalCash: z.coerce.number().nonnegative(),
  varianceReason: z.string().max(500).optional(),
});
export type SubmitSettlementBody = z.infer<typeof submitSettlementBodySchema>;

export const reviewSettlementBodySchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  note: z.string().max(500).optional(),
});
export type ReviewSettlementBody = z.infer<typeof reviewSettlementBodySchema>;

export const listSettlementsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum(['SUBMITTED', 'ACCEPTED', 'REJECTED']).optional(),
});
export type ListSettlementsQuery = z.infer<typeof listSettlementsQuerySchema>;
