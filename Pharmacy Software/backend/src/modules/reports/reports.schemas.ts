import { z } from 'zod';

/** pharmacy.md §14.1 — 8 consolidated report types, one endpoint + type param (mirrors inventory.md step 7). */
export const REPORT_TYPES = [
  'SALES_COLLECTION',
  'HMS_DISPENSE',
  'PURCHASE',
  'STOCK_MOVEMENT',
  'VENDOR_LEDGER',
  'EXPENSE',
  'RETURN_REFUND',
  'BALANCE_SETTLEMENT',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportQuerySchema = z.object({
  type: z.enum(REPORT_TYPES),
  method: z.enum(['CASH','CARD','ONLINE','BANK','UNKNOWN']).optional(),
  cashierId: z.string().max(150).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
