import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });

/** Vendor Code is never accepted from the client — always system-generated (VND-0001…). */
export const createVendorBodySchema = z.object({
  name: z.string().min(1).max(150),
  contactPerson: z.string().max(150).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  paymentTermsDays: z.coerce.number().int().nonnegative().default(0),
});
export type CreateVendorBody = z.infer<typeof createVendorBodySchema>;

export const updateVendorBodySchema = createVendorBodySchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateVendorBody = z.infer<typeof updateVendorBodySchema>;

export const payVendorBodySchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'CARD', 'ONLINE', 'BANK']),
  reference: z.string().max(100).optional(),
  requestKey: z.string().uuid(),
  refundOf: z.string().uuid().optional(),
  paymentAccountId: z.string().uuid().optional(),
});
export type PayVendorBody = z.infer<typeof payVendorBodySchema>;

/**
 * purchase-costing-plan — "Override packaging for this purchase". Lets an
 * Admin/Super Admin receive a specific vendor batch under a DIFFERENT
 * conversion than the medicine's current default (e.g. this shipment's
 * boxes hold 12 strips instead of the usual 10). The override is frozen
 * onto the batch as its own snapshot and NEVER touches Medicine Master's
 * live packaging template unless `applyToMedicineMasterDefault` is true.
 */
const packagingOverrideSchema = z.object({
  purchaseUnitConversionToBase: z.coerce.number().positive(),
  innerBreakdown: z.array(z.object({ unitId: z.string().uuid(), conversionToBase: z.coerce.number().positive() })).optional(),
  applyToMedicineMasterDefault: z.boolean().default(false),
});

const purchaseLineSchema = z.object({
  medicineId: z.string().uuid(),
  batchNumber: z.string().max(60).optional().default(''),
  expiryDate: z.coerce.date(),
  /// medicine-packaging-plan — the unit this line was actually bought in (e.g. "Box"); must be a configured purchase unit for the medicine (or the override below).
  purchaseUnitId: z.string().uuid(),
  /// Quantity in `purchaseUnitId` terms (e.g. 5 Boxes) — server converts to base units and derives landed per-base-unit cost.
  purchaseUnitQuantity: z.coerce.number().positive(),
  /// Vendor's GROSS rate PER purchase unit, before discount (e.g. Rs 1000/Box).
  unitCost: z.coerce.number().nonnegative(),
  discountType: z.enum(['PERCENTAGE', 'FLAT']).default('FLAT'),
  /// Meaning depends on discountType: a percent (0-100) or a flat PKR amount.
  discountValue: z.coerce.number().nonnegative().default(0),
  taxAmount: z.coerce.number().nonnegative().default(0),
  /// Landed-cost component — freight/other charges apportioned to this line.
  freightAmount: z.coerce.number().nonnegative().default(0),
  packagingOverride: packagingOverrideSchema.optional(),
  /// Admin-confirmed selling price per BASE unit. Omit to accept the system-suggested markup price as-is.
  finalSaleRate: z.coerce.number().nonnegative().optional(),
});

/** pharmacy.md §10.1 — Purchase / Stock In. */
export const createPurchaseBodySchema = z.object({
  requestKey: z.string().uuid(),
  vendorId: z.string().uuid(),
  purchaseDate: z.coerce.date(),
  vendorInvoiceNo: z.string().max(100).optional(),
  paymentType: z.enum(['CASH', 'CARD', 'ONLINE', 'BANK']).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(purchaseLineSchema).min(1),
  paymentAccountId: z.string().uuid().optional(),
  paidNow: z.coerce.number().nonnegative().default(0),
  post: z.boolean().default(true),
});
export type CreatePurchaseBody = z.infer<typeof createPurchaseBodySchema>;

/**
 * pharmacy.md §9.1 PURCHASE_RETURN_OUT — purchase-costing-plan: a return
 * must be against a specific batch (never "a medicine in general") so it
 * can use THAT batch's frozen packaging + cost snapshot, never the
 * medicine's current live template/price.
 */
export const purchaseReturnBodySchema = z.object({
  requestKey: z.string().uuid(),
  vendorId: z.string().uuid(),
  lines: z.array(z.object({
    medicineId: z.string().uuid(),
    batchId: z.string().uuid(),
    /// Unit to return in — defaults to the batch's own purchase unit (e.g. whole Boxes) when omitted.
    returnUnitId: z.string().uuid().optional(),
    returnUnitQuantity: z.coerce.number().positive(),
  })).min(1),
  reason: z.string().min(1).max(500),
});
export type PurchaseReturnBody = z.infer<typeof purchaseReturnBodySchema>;
