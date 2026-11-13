import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const batchIdParamsSchema = z.object({ id: z.string().uuid(), batchId: z.string().uuid() });
export const invoiceIdParamsSchema = z.object({ id: z.string().uuid() });

/**
 * medicine-packaging-plan Phase 4 — one additional pack level ABOVE the base
 * unit (e.g. "Strip = 10 Tablet", "Box = 100 Tablet"). The base unit itself
 * (level 0, conversionToBase = 1) is implicit from `baseUnitId` and never
 * sent as one of these.
 */
const packagingLevelInputSchema = z.object({
  unitId: z.string().uuid(),
  conversionToBase: z.coerce.number().positive(),
  isPurchaseUnit: z.boolean().default(false),
  isSaleUnit: z.boolean().default(true),
  overrideSaleRate: z.coerce.number().nonnegative().optional(),
});
export type PackagingLevelInput = z.infer<typeof packagingLevelInputSchema>;

export const createMedicineBodySchema = z.object({
  /// System-generated (MED-0001…) when omitted. Accepted as an explicit override ONLY because an earlier requirement kept Medicine Code editable by an authorized user — unlike every other business code in this app, which is never client-supplied.
  code: z.string().max(40).nullable().optional(),
  barcode: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(150),
  genericName: z.string().max(150).nullable().optional(),
  strength: z.string().max(40).nullable().optional(),
  dosageForm: z.string().max(40).nullable().optional(),
  category: z.string().max(150).nullable().optional(),
  /// Database-driven Therapeutic Category master (Settings -> Medicine Categories) — optional. Pass null to explicitly clear it on update.
  categoryId: z.string().uuid().nullable().optional(),
  /// Configurable packaging (medicine-packaging-plan) — every medicine has one base stock unit.
  baseUnitId: z.string().uuid(),
  baseIsPurchaseUnit: z.boolean().default(true),
  baseIsSaleUnit: z.boolean().default(true),
  packagingLevels: z.array(packagingLevelInputSchema).max(10).default([]),
  batchManaged: z.boolean().default(true),
  reorderLevel: z.coerce.number().nonnegative().default(0),
  purchaseRate: z.coerce.number().nonnegative().optional(),
  saleRate: z.coerce.number().nonnegative().default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  /// Opening Stock fields (optional initial lot when registering a new medicine)
  openingStock: z.coerce.number().nonnegative().optional(),
  openingBatchNumber: z.string().max(60).optional(),
  openingExpiryDate: z.coerce.date().optional(),
  openingCostRate: z.coerce.number().nonnegative().optional(),
});
export type CreateMedicineBody = z.infer<typeof createMedicineBodySchema>;

export const updateMedicineBodySchema = createMedicineBodySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateMedicineBody = z.infer<typeof updateMedicineBodySchema>;

export const listMedicinesQuerySchema = z.object({
  search: z.string().optional(),
  stockStatus: z.enum(['LOW', 'OUT', 'NEAR_EXPIRY', 'EXPIRED']).optional(),
});
export type ListMedicinesQuery = z.infer<typeof listMedicinesQuerySchema>;

export const createBatchBodySchema = z.object({
  batchNumber: z.string().max(60).optional().default(''),
  expiryDate: z.coerce.date(),
  costRate: z.coerce.number().nonnegative(),
  saleRate: z.coerce.number().nonnegative().optional(),
});
export type CreateBatchBody = z.infer<typeof createBatchBodySchema>;

/** Direct stock entry outside the Purchase flow — e.g. authorized opening-stock migration (pharmacy.md §9.1). */
export const openingStockBodySchema = z.object({
  quantity: z.coerce.number().positive(),
  note: z.string().max(500).optional(),
});
export type OpeningStockBody = z.infer<typeof openingStockBodySchema>;

const dispenseLineSchema = z.object({
  medicineId: z.string().uuid(),
  /// Which configured unit this line was sold as (medicine-packaging-plan) — e.g. "Strip". Omit to sell in the medicine's base unit.
  saleUnitId: z.string().uuid().optional(),
  /// Quantity in `saleUnitId` terms (e.g. 2 Strips) — server converts to base units before FEFO allocation.
  saleUnitQuantity: z.coerce.number().positive(),
  discountAmount: z.coerce.number().nonnegative().default(0),
});

const paymentInputSchema = z.object({
  method: z.enum(['CASH', 'CARD', 'ONLINE']),
  amount: z.coerce.number().positive(),
  reference: z.string().max(100).optional(),
});

/** pharmacy.md §6 — POS direct sale. Real payment(s)/tax/discount, not hardcoded-PAID (§19.2 fix). */
export const dispenseRetailBodySchema = z.object({
  customerName: z.string().max(150).optional(),
  lines: z.array(dispenseLineSchema).min(1),
  invoiceDiscount: z.coerce.number().nonnegative().default(0),
  payments: z.array(paymentInputSchema).default([]),
});
export type DispenseRetailBody = z.infer<typeof dispenseRetailBodySchema>;

export const addPaymentBodySchema = paymentInputSchema;
export type AddPaymentBody = z.infer<typeof addPaymentBodySchema>;

export const listInvoicesQuerySchema = z.object({
  channel: z.enum(['RETAIL', 'HMS_LINKED']).optional(),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const stockAdjustmentBodySchema = z.object({
  medicineId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  type: z.enum(['DAMAGE', 'EXPIRY', 'COUNT_CORRECTION', 'LOSS', 'SURPLUS', 'QUARANTINE']),
  quantity: z.coerce.number().positive(),
  reason: z.string().min(1).max(500),
});
export type StockAdjustmentBody = z.infer<typeof stockAdjustmentBodySchema>;

/** pharmacy.md §9.1 SALES_RETURN_IN — controlled return against an original completed invoice line. */
export const salesReturnBodySchema = z.object({
  invoiceId: z.string().uuid(),
  lines: z.array(z.object({ invoiceLineId: z.string().uuid(), quantity: z.coerce.number().positive(), restock: z.boolean().default(true) })).min(1),
  reason: z.string().min(1).max(500),
  refundMethod: z.enum(['CASH', 'CARD', 'ONLINE']),
});
export type SalesReturnBody = z.infer<typeof salesReturnBodySchema>;

export const stockMovementsQuerySchema = z.object({
  medicineId: z.string().uuid().optional(),
  movementType: z.enum(['PURCHASE_IN', 'POS_SALE_OUT', 'HMS_DISPENSE_OUT', 'SALES_RETURN_IN', 'PURCHASE_RETURN_OUT', 'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'OPENING_STOCK']).optional(),
});
export type StockMovementsQuery = z.infer<typeof stockMovementsQuerySchema>;

export const bulkImportRowSchema = z.object({
  name: z.string().min(1, 'Medicine Name is required').max(150),
  strength: z.string().max(40).nullish(),
  genericName: z.string().max(150).nullish(),
  dosageForm: z.string().max(40).nullish(),
  category: z.string().max(150).nullish(),
  baseUnit: z.string().min(1, 'Base Stock Unit is required').max(50),
  innerPackUnit: z.string().max(50).nullish(),
  baseUnitsPerInnerPack: z.coerce.number().positive().nullish(),
  defaultPurchaseUnit: z.string().max(50).nullish(),
  baseUnitsPerPurchaseUnit: z.coerce.number().positive().nullish(),
  defaultSalePrice: z.coerce.number().nonnegative().default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  reorderAlertQty: z.coerce.number().nonnegative().default(0),
  barcode: z.string().max(64).nullish(),
  trackBatchExpiry: z.union([
    z.boolean(),
    z.string().transform((v) => !['no', 'n', '0', 'false'].includes(v.trim().toLowerCase())),
  ]).default(true),
  openingStockQty: z.coerce.number().nonnegative().default(0),
  batchNumber: z.string().max(60).nullish(),
  expiryDate: z.string().nullish(),
  purchaseCostRate: z.coerce.number().nonnegative().nullish(),
});
export type BulkImportRow = z.infer<typeof bulkImportRowSchema>;

export const bulkImportBodySchema = z.object({
  items: z.array(bulkImportRowSchema).min(1, 'At least one medicine item is required').max(2500),
});
export type BulkImportBody = z.infer<typeof bulkImportBodySchema>;

