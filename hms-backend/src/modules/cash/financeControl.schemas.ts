import { z } from 'zod';

/** Same date-range shape as the rest of the reporting surface (`dashboard.schemas.ts`) — kept consistent on purpose. */
const dateRangeSchema = z.object({
  preset: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'custom']).default('today'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const listBalanceSheetsQuerySchema = dateRangeSchema.extend({
  portalUserId: z.string().uuid().optional(),
  onlyUnsettled: z.coerce.boolean().optional(),
});
export type ListBalanceSheetsQuery = z.infer<typeof listBalanceSheetsQuerySchema>;

/**
 * reporting.md §2 #8 — My Balance Sheet period: `shift` (default) is the live
 * unsettled custody the cashier settles; any other preset is a historical
 * view over every ledger entry in that range, settled or not.
 */
export const myBalanceSheetQuerySchema = z.object({
  preset: z.enum(['shift', 'today', 'yesterday', 'this_week', 'this_month', 'custom']).default('shift'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export type MyBalanceSheetQuery = z.infer<typeof myBalanceSheetQuerySchema>;

/** reporting.md §2 #9 — My Account Settlement history: From/To + Settlement Status. `all` (default) = full history. */
export const mySettlementsQuerySchema = z.object({
  preset: z.enum(['all', 'today', 'yesterday', 'this_week', 'this_month', 'custom']).default('all'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  status: z.enum(['PREPARED', 'SUBMITTED', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'RETURNED', 'REJECTED', 'REVERSED']).optional(),
});
export type MySettlementsQuery = z.infer<typeof mySettlementsQuerySchema>;

export const listSettlementsQuerySchema = dateRangeSchema.extend({
  portalUserId: z.string().uuid().optional(),
  status: z.enum(['PREPARED', 'SUBMITTED', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'RETURNED', 'REJECTED', 'REVERSED']).optional(),
});
export type ListSettlementsQuery = z.infer<typeof listSettlementsQuerySchema>;

export const financeKpisQuerySchema = dateRangeSchema;
export type FinanceKpisQuery = z.infer<typeof financeKpisQuerySchema>;

export const settlementIdParamsSchema = z.object({ id: z.string().uuid() });

export const reviewSettlementBodySchema = z
  .object({
    action: z.enum(['ACCEPT', 'PARTIALLY_ACCEPT', 'RETURN', 'REJECT']),
    remarks: z.string().optional(),
  })
  .refine((body) => (body.action === 'RETURN' || body.action === 'REJECT' ? !!body.remarks?.trim() : true), {
    message: 'Remarks are required when returning or rejecting a settlement.',
    path: ['remarks'],
  });
export type ReviewSettlementBody = z.infer<typeof reviewSettlementBodySchema>;

export const reverseSettlementBodySchema = z.object({
  reason: z.string().min(1, 'A reversal reason is required.'),
});
export type ReverseSettlementBody = z.infer<typeof reverseSettlementBodySchema>;
