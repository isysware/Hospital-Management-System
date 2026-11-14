import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError, ConflictError } from '@/shared/errors/AppError';
import { nextCode, peekNextCode, SEQUENCE } from '@/shared/sequence';
import type { Prisma } from '@prisma/client';
import type {
  CreateMedicineBody,
  UpdateMedicineBody,
  ListMedicinesQuery,
  CreateBatchBody,
  OpeningStockBody,
  DispenseRetailBody,
  AddPaymentBody,
  ListInvoicesQuery,
  StockAdjustmentBody,
  StockMovementsQuery,
  SalesReturnBody,
  PackagingLevelInput,
  BulkImportBody,
} from './pharmacy.schemas';

/** pharmacy.md §3 Settings screen — configured, not hardcoded; one singleton row, auto-created on first read. */
async function getSettings() {
  const existing = await prisma.pharmacySettings.findFirst();
  if (existing) return existing;
  return prisma.pharmacySettings.create({ data: {} });
}

/**
 * medicine-packaging-plan — validates and writes a medicine's full packaging
 * chain (level 0 = base unit, conversionToBase = 1, implicit from
 * baseUnitId; levels 1..n = the caller-supplied `packagingLevels`, sorted by
 * conversionToBase ascending). Shared by create and update (update replaces
 * the whole set — safe because historical PurchaseLine/MedicineBatch rows
 * hold their own frozen snapshot, never a live reference to this table).
 */
async function writePackagingLevels(
  tx: Prisma.TransactionClient,
  medicineId: string,
  baseUnitId: string,
  baseIsPurchaseUnit: boolean,
  baseIsSaleUnit: boolean,
  levels: PackagingLevelInput[],
) {
  const baseUnit = await tx.unit.findUnique({ where: { id: baseUnitId } });
  if (!baseUnit) throw new NotFoundError('Base unit not found');

  const unitIds = new Set([baseUnitId]);
  for (const lvl of levels) {
    if (lvl.conversionToBase <= 1) throw new ValidationError('Each packaging level must convert to more than 1 base unit');
    if (unitIds.has(lvl.unitId)) throw new ValidationError('The same unit cannot appear twice in a medicine\'s packaging');
    unitIds.add(lvl.unitId);
  }
  const unitsFound = await tx.unit.count({ where: { id: { in: [...unitIds] } } });
  if (unitsFound !== unitIds.size) throw new NotFoundError('One or more selected packaging units were not found');

  // "Default Purchase Unit" is singular by design (matches the UI's one dropdown) —
  // base unit + every level together may mark exactly one as the purchase unit.
  const purchaseUnitCount = (baseIsPurchaseUnit ? 1 : 0) + levels.filter((l) => l.isPurchaseUnit).length;
  if (purchaseUnitCount !== 1) throw new ValidationError('Choose exactly one Default Purchase Unit.');
  // At least one unit must be sellable from POS, or nothing could ever be dispensed.
  const saleUnitCount = (baseIsSaleUnit ? 1 : 0) + levels.filter((l) => l.isSaleUnit).length;
  if (saleUnitCount < 1) throw new ValidationError('At least one unit must be marked sellable.');

  const sorted = [...levels].sort((a, b) => a.conversionToBase - b.conversionToBase);

  await tx.medicinePackagingLevel.deleteMany({ where: { medicineId } });
  await tx.medicinePackagingLevel.create({
    data: { medicineId, unitId: baseUnitId, level: 0, conversionToBase: 1, isPurchaseUnit: baseIsPurchaseUnit, isSaleUnit: baseIsSaleUnit },
  });
  for (let i = 0; i < sorted.length; i++) {
    const lvl = sorted[i]!;
    await tx.medicinePackagingLevel.create({
      data: {
        medicineId,
        unitId: lvl.unitId,
        level: i + 1,
        conversionToBase: lvl.conversionToBase,
        isPurchaseUnit: lvl.isPurchaseUnit,
        isSaleUnit: lvl.isSaleUnit,
        overrideSaleRate: lvl.overrideSaleRate,
      },
    });
  }
  return baseUnit.name;
}

export interface BatchAllocation {
  batchId: string | null;
  quantity: Decimal;
  saleRate: Decimal;
  costRate: Decimal;
}

/** FEFO (earliest valid expiry first) with FIFO tie-breaker (oldest batch first), skipping expired/zero-stock batches. */
async function allocateFefoBatches(
  medicineId: string,
  requestedQuantity: Decimal,
  tx: Prisma.TransactionClient,
  reserved: { medicineId: string; batchId: string | null; quantity: Decimal }[] = [],
): Promise<BatchAllocation[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pharmacy-stock'))`;
  const medicine = await tx.medicineMaster.findUnique({
    where: { id: medicineId },
    include: { batches: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }], include: { stockEntries: { select: { quantityDelta: true } } } } },
  });
  if (!medicine || !medicine.isActive) throw new NotFoundError(`Medicine ${medicineId} not found or inactive`);

  if (!medicine.batchManaged) {
    const entries = await tx.stockLedgerEntry.findMany({ where: { medicineId }, select: { quantityDelta: true } });
    const total = entries.reduce((sum, e) => sum.plus(e.quantityDelta), new Decimal(0))
      .minus(reserved.filter(r => r.medicineId === medicineId).reduce((sum, r) => sum.plus(r.quantity), new Decimal(0)));
    if (total.lessThan(requestedQuantity)) {
      throw new ValidationError(`Insufficient stock for "${medicine.name}". Available: ${total}, Requested: ${requestedQuantity}`);
    }
    return [{
      batchId: null,
      quantity: requestedQuantity,
      saleRate: medicine.saleRate,
      costRate: medicine.purchaseRate ?? new Decimal(0),
    }];
  }

  const now = new Date();
  const withStock = medicine.batches
    .filter((b) => b.expiryDate > now)
    .map((b) => ({
      id: b.id,
      saleRate: b.saleRate ?? medicine.saleRate,
      costRate: b.costRate,
      available: b.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0))
        .minus(reserved.filter(r => r.medicineId === medicineId && r.batchId === b.id).reduce((sum, r) => sum.plus(r.quantity), new Decimal(0))),
    }))
    .filter((b) => b.available.greaterThan(0));

  let remaining = requestedQuantity;
  const allocations: BatchAllocation[] = [];
  for (const batch of withStock) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = remaining.lessThan(batch.available) ? remaining : batch.available;
    allocations.push({
      batchId: batch.id,
      quantity: take,
      saleRate: batch.saleRate,
      costRate: batch.costRate,
    });
    remaining = remaining.minus(take);
  }
  if (remaining.greaterThan(0)) {
    const totalAvailable = withStock.reduce((s, b) => s.plus(b.available), new Decimal(0));
    throw new ValidationError(`Insufficient non-expired stock for "${medicine.name}". Available: ${totalAvailable} ${medicine.unit}, Requested: ${requestedQuantity} ${medicine.unit}`);
  }
  return allocations;
}

/**
 * Syncs `medicineMaster.saleRate` to the active FEFO/FIFO batch's selling price
 * (the earliest-expiring, oldest-created non-expired batch with stock > 0).
 * Keeps Medicine Master display/fallback pricing aligned with the next batch to dispense.
 */
async function syncEffectiveSaleRate(medicineId: string, tx: Prisma.TransactionClient): Promise<void> {
  const medicine = await tx.medicineMaster.findUnique({
    where: { id: medicineId },
    include: {
      batches: {
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
        include: { stockEntries: { select: { quantityDelta: true } } },
      },
    },
  });
  if (!medicine || !medicine.batchManaged) return;

  const now = new Date();
  const activeBatch = medicine.batches.find((b) => {
    if (b.expiryDate <= now) return false;
    const available = b.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
    return available.greaterThan(0);
  });

  if (activeBatch && activeBatch.saleRate !== null && !medicine.saleRate.equals(activeBatch.saleRate)) {
    await tx.medicineMaster.update({
      where: { id: medicineId },
      data: { saleRate: activeBatch.saleRate },
    });
  }
}

async function currentStock(medicineId: string): Promise<Decimal> {
  const entries = await prisma.stockLedgerEntry.findMany({ where: { medicineId }, select: { quantityDelta: true } });
  return entries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
}

export const pharmacyService = {
  allocateFefoBatches,
  syncEffectiveSaleRate,

  /** Preview only — not reserved. See `peekNextCode` doc comment. */
  async peekNextMedicineCode() {
    return peekNextCode(SEQUENCE.MEDICINE);
  },

  // ── Medicine Master (pharmacy.md §9) ────────────────────────────────────
  async createMedicine(body: CreateMedicineBody, actorId: string) {
    const rawBarcode = body.barcode?.trim() || null;
    const rawCode = body.code?.trim() || null;
    const rawGenericName = body.genericName?.trim() || null;
    const rawStrength = body.strength?.trim() || null;
    const rawDosageForm = body.dosageForm?.trim() || null;
    const rawCategory = (body as any).category?.trim() || null;

    if (rawCode) {
      const dup = await prisma.medicineMaster.findFirst({
        where: {
          OR: [
            { code: rawCode },
            ...(rawBarcode ? [{ barcode: rawBarcode }] : [])
          ]
        }
      });
      if (dup) {
        if (dup.code === rawCode) throw new ConflictError(`Medicine code "${rawCode}" already exists`);
        if (rawBarcode && dup.barcode === rawBarcode) throw new ConflictError(`Barcode "${rawBarcode}" already exists`);
        throw new ConflictError('Medicine code or barcode already exists');
      }
    } else if (rawBarcode) {
      const dup = await prisma.medicineMaster.findFirst({ where: { barcode: rawBarcode } });
      if (dup) throw new ConflictError(`Barcode "${rawBarcode}" already exists`);
    }

    const {
      baseUnitId,
      baseIsPurchaseUnit,
      baseIsSaleUnit,
      packagingLevels,
      code: _c,
      barcode: _b,
      genericName: _g,
      strength: _s,
      dosageForm: _d,
      category: _cat,
      categoryId,
      openingStock,
      openingBatchNumber,
      openingExpiryDate,
      openingCostRate,
      ...rest
    } = body as any;

    return prisma.$transaction(async (tx) => {
      const baseUnit = await tx.unit.findUnique({ where: { id: baseUnitId } });
      if (!baseUnit) throw new NotFoundError('Base unit not found');

      let categoryLabel: string | null = null;
      if (categoryId) {
        const category = await tx.medicineCategory.findUnique({ where: { id: categoryId } });
        if (!category) throw new NotFoundError('Medicine category not found');
        categoryLabel = category.name;
      } else if (rawCategory) {
        categoryLabel = rawCategory;
      }

      // If no code requested, automatically generate next sequence; otherwise advance sequence
      let code = rawCode;
      if (!code) {
        code = await nextCode(tx, SEQUENCE.MEDICINE);
      } else {
        const match = code.match(/^MED-(\d+)$/);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num)) {
            await tx.$executeRaw`
              INSERT INTO document_sequences (key, last_value, updated_at)
              VALUES (${SEQUENCE.MEDICINE.key}, ${num}, now())
              ON CONFLICT (key) DO UPDATE SET last_value = GREATEST(document_sequences.last_value, ${num}), updated_at = now()
            `;
          }
        }
      }

      const medicine = await tx.medicineMaster.create({
        data: {
          ...rest,
          code,
          barcode: rawBarcode,
          genericName: rawGenericName,
          strength: rawStrength,
          dosageForm: rawDosageForm,
          categoryId: categoryId || null,
          categoryLabel,
          unit: baseUnit.name,
          baseUnitId,
          createdById: actorId
        }
      });

      // Throwing here (bad packaging level) rolls the whole transaction back — the medicine row never persists.
      await writePackagingLevels(tx, medicine.id, baseUnitId, baseIsPurchaseUnit, baseIsSaleUnit, packagingLevels);

      // Handle direct Opening Stock (if provided)
      const opStockNum = Number(openingStock) || 0;
      if (opStockNum > 0) {
        if (medicine.batchManaged) {
          const batchNumber = openingBatchNumber?.trim() || '';
          let expiryDate = openingExpiryDate ? new Date(openingExpiryDate) : null;
          if (!expiryDate || isNaN(expiryDate.getTime())) {
            expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
          }
          const costRate = openingCostRate !== undefined && openingCostRate !== null
            ? new Decimal(openingCostRate)
            : medicine.purchaseRate ?? medicine.saleRate.mul(0.8);

          const batch = await tx.medicineBatch.create({
            data: {
              medicineId: medicine.id,
              batchNumber,
              expiryDate,
              costRate,
              saleRate: medicine.saleRate,
              createdById: actorId,
            },
          });

          await tx.stockLedgerEntry.create({
            data: {
              medicineId: medicine.id,
              batchId: batch.id,
              movementType: 'OPENING_STOCK',
              quantityDelta: new Decimal(opStockNum),
              referenceTable: 'opening_stock',
              referenceId: batch.id,
              note: `Opening stock on creation (${opStockNum} ${baseUnit.name})`,
              actorId,
            },
          });
        } else {
          await tx.stockLedgerEntry.create({
            data: {
              medicineId: medicine.id,
              batchId: null,
              movementType: 'OPENING_STOCK',
              quantityDelta: new Decimal(opStockNum),
              referenceTable: 'opening_stock',
              referenceId: medicine.id,
              note: `Opening stock on creation (${opStockNum} ${baseUnit.name})`,
              actorId,
            },
          });
        }
        await syncEffectiveSaleRate(medicine.id, tx);
      }

      return medicine;
    });
  },

  async updateMedicine(id: string, body: UpdateMedicineBody) {
    const existing = await prisma.medicineMaster.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Medicine not found');

    const rawBarcode = body.barcode !== undefined ? (body.barcode?.trim() || null) : undefined;
    const rawCode = body.code !== undefined ? (body.code?.trim() || null) : undefined;

    if (rawCode && rawCode !== existing.code) {
      const dup = await prisma.medicineMaster.findFirst({ where: { code: rawCode, id: { not: id } } });
      if (dup) throw new ConflictError(`Medicine code "${rawCode}" already exists`);
    }
    if (rawBarcode && rawBarcode !== existing.barcode) {
      const dup = await prisma.medicineMaster.findFirst({ where: { barcode: rawBarcode, id: { not: id } } });
      if (dup) throw new ConflictError(`Barcode "${rawBarcode}" already exists`);
    }
    const { baseUnitId, baseIsPurchaseUnit, baseIsSaleUnit, packagingLevels, categoryId, code: _c, barcode: _b, ...rest } = body as any;
    return prisma.$transaction(async (tx) => {
      // Database-driven Therapeutic Category master — `categoryId` absent = leave untouched, explicit null = clear it, a uuid = set it (kept in sync with categoryLabel for legacy string readers).
      let categoryPatch: { categoryId?: string | null; categoryLabel?: string | null } = {};
      if (categoryId !== undefined) {
        if (categoryId === null) {
          categoryPatch = { categoryId: null, categoryLabel: null };
        } else {
          const category = await tx.medicineCategory.findUnique({ where: { id: categoryId } });
          if (!category) throw new NotFoundError('Medicine category not found');
          categoryPatch = { categoryId, categoryLabel: category.name };
        }
      }
      let unitPatch: { unit?: string; baseUnitId?: string } = {};
      const effectiveBaseUnitId = baseUnitId ?? existing.baseUnitId;
      if (baseUnitId || packagingLevels !== undefined) {
        const baseUnitName = await writePackagingLevels(
          tx,
          id,
          effectiveBaseUnitId,
          baseIsPurchaseUnit ?? true,
          baseIsSaleUnit ?? true,
          packagingLevels ?? [],
        );
        unitPatch = { unit: baseUnitName, baseUnitId: effectiveBaseUnitId };
      }
      return tx.medicineMaster.update({ where: { id }, data: { ...rest, ...unitPatch, ...categoryPatch } });
    });
  },

  /** Ordered packaging chain for Purchase/POS unit selectors (medicine-packaging-plan). */
  async getPackaging(medicineId: string) {
    const medicine = await prisma.medicineMaster.findUnique({ where: { id: medicineId } });
    if (!medicine) throw new NotFoundError('Medicine not found');
    const levels = await prisma.medicinePackagingLevel.findMany({
      where: { medicineId, isActive: true },
      include: { unit: true },
      orderBy: { level: 'asc' },
    });
    return { medicineId, baseUnitId: medicine.baseUnitId, levels };
  },

  async listMedicines(query: ListMedicinesQuery) {
    const [medicines, settings] = await Promise.all([
      prisma.medicineMaster.findMany({
        where: query.search
          ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }, { barcode: { contains: query.search, mode: 'insensitive' } }] }
          : undefined,
        include: {
          batches: {
            include: { stockEntries: { select: { quantityDelta: true } } },
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
          },
          stockEntries: { select: { quantityDelta: true } },
          baseUnit: true,
          category: true,
          packagingLevels: { include: { unit: true }, orderBy: { level: 'asc' } },
        },
        orderBy: { name: 'asc' },
      }),
      getSettings(),
    ]);

    const now = new Date();
    const nearExpiryCutoff = new Date(now.getTime() + settings.nearExpiryWindowDays * 86_400_000);

    const rows = medicines.map((m) => {
      const stock = m.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
      const isLow = stock.lessThanOrEqualTo(m.reorderLevel);
      const isOut = stock.lessThanOrEqualTo(0);
      const hasExpired = m.batches.some((b) => b.expiryDate <= now);
      const hasNearExpiry = m.batches.some((b) => b.expiryDate > now && b.expiryDate <= nearExpiryCutoff);
      const activeBatches = m.batches
        .filter((b) => b.expiryDate > now)
        .map((b) => {
          const avail = b.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
          return {
            id: b.id,
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            saleRate: b.saleRate ?? m.saleRate,
            costRate: b.costRate,
            available: avail,
          };
        })
        .filter((b) => b.available.greaterThan(0));
      return {
        id: m.id,
        code: m.code,
        barcode: m.barcode,
        name: m.name,
        genericName: m.genericName,
        strength: m.strength,
        dosageForm: m.dosageForm,
        /// Flat string for old consumers (filters, CSV, table cell) — sourced from the relation, falling back to the legacy label cache.
        category: m.category?.name ?? m.categoryLabel,
        categoryId: m.categoryId,
        categoryActive: m.category?.isActive ?? null,
        unit: m.unit,
        baseUnitId: m.baseUnitId,
        baseUnit: m.baseUnit,
        packagingLevels: m.packagingLevels,
        batchManaged: m.batchManaged,
        reorderLevel: m.reorderLevel,
        purchaseRate: m.purchaseRate,
        saleRate: m.saleRate,
        taxPercent: m.taxPercent,
        isActive: m.isActive,
        currentStock: stock,
        batchesCount: m.batches.length,
        activeBatches,
        isLowStock: isLow && !isOut,
        isOutOfStock: isOut,
        hasExpiredBatch: hasExpired,
        hasNearExpiryBatch: hasNearExpiry,
      };
    });

    if (!query.stockStatus) return rows;
    return rows.filter((r) => {
      if (query.stockStatus === 'LOW') return r.isLowStock;
      if (query.stockStatus === 'OUT') return r.isOutOfStock;
      if (query.stockStatus === 'NEAR_EXPIRY') return r.hasNearExpiryBatch;
      return r.hasExpiredBatch;
    });
  },

  // ── Batches ──────────────────────────────────────────────────────────────
  async createBatch(medicineId: string, body: CreateBatchBody, actorId: string) {
    const medicine = await prisma.medicineMaster.findUnique({ where: { id: medicineId } });
    if (!medicine) throw new NotFoundError('Medicine not found');
    return prisma.medicineBatch.create({ data: { medicineId, ...body, createdById: actorId } });
  },

  async getMedicineBatches(medicineId: string) {
    const batches = await prisma.medicineBatch.findMany({ where: { medicineId }, include: { stockEntries: { select: { quantityDelta: true } }, purchaseUnit: true }, orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }] });
    const now = new Date();
    return batches.map((b) => ({
      id: b.id,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate,
      costRate: b.costRate,
      saleRate: b.saleRate,
      currentStock: b.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0)),
      isExpired: b.expiryDate <= now,
      // purchase-costing-plan — Purchase Return needs this batch's own frozen packaging snapshot, not the medicine's live default.
      purchaseUnitId: b.purchaseUnitId,
      purchaseUnit: b.purchaseUnit,
      purchaseUnitConversionToBase: b.purchaseUnitConversionToBase,
      packagingSnapshotJson: b.packagingSnapshotJson,
    }));
  },

  /** Authorized opening-stock / migration entry only — never the normal receiving path (that's Purchase, pharmacy.md §10.1). */
  async receiveOpeningStock(medicineId: string, batchId: string | null, body: OpeningStockBody, actorId: string) {
    const medicine = await prisma.medicineMaster.findUnique({ where: { id: medicineId } });
    if (!medicine) throw new NotFoundError('Medicine not found');
    if (batchId) {
      const batch = await prisma.medicineBatch.findUnique({ where: { id: batchId } });
      if (!batch || batch.medicineId !== medicineId) throw new NotFoundError('Batch not found for this medicine');
    }
    return prisma.stockLedgerEntry.create({
      data: {
        medicineId,
        batchId,
        movementType: 'OPENING_STOCK',
        quantityDelta: new Decimal(body.quantity),
        referenceTable: 'opening_stock',
        referenceId: medicineId,
        note: body.note,
        actorId,
      },
    });
  },

  async stockMovements(query: StockMovementsQuery) {
    return prisma.stockLedgerEntry.findMany({
      where: { medicineId: query.medicineId, movementType: query.movementType },
      include: { medicine: { select: { id: true, name: true, code: true } }, batch: { select: { id: true, batchNumber: true } }, actor: { select: { id: true, fullName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  },

  async createStockAdjustment(body: StockAdjustmentBody, actorId: string) {
    const medicine = await prisma.medicineMaster.findUnique({ where: { id: body.medicineId } });
    if (!medicine) throw new NotFoundError('Medicine not found');
    const isNegative = body.type !== 'SURPLUS';
    const delta = isNegative ? new Decimal(body.quantity).negated() : new Decimal(body.quantity);

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pharmacy-stock'))`;
      if (medicine.batchManaged && !body.batchId) throw new ValidationError('Select a batch for this stock adjustment');
      if (body.batchId && !await tx.medicineBatch.findFirst({ where: { id: body.batchId, medicineId: body.medicineId } })) {
        throw new ValidationError('Batch does not belong to this medicine');
      }
      const balance = await tx.stockLedgerEntry.aggregate({ where: { medicineId: body.medicineId, batchId: body.batchId ?? null }, _sum: { quantityDelta: true } });
      if (new Decimal(balance._sum.quantityDelta ?? 0).plus(delta).lessThan(0)) throw new ValidationError('Adjustment would create negative stock');
      const adjustmentNumber = await nextCode(tx, SEQUENCE.STOCK_ADJUSTMENT);
      const adjustment = await tx.stockAdjustment.create({
        data: { adjustmentNumber, medicineId: body.medicineId, batchId: body.batchId, type: body.type, quantity: new Decimal(body.quantity), reason: body.reason, createdById: actorId },
      });
      await tx.stockLedgerEntry.create({
        data: {
          medicineId: body.medicineId,
          batchId: body.batchId,
          movementType: isNegative ? 'NEGATIVE_ADJUSTMENT' : 'POSITIVE_ADJUSTMENT',
          quantityDelta: delta,
          referenceTable: 'stock_adjustments',
          referenceId: adjustment.id,
          note: body.reason,
          actorId,
        },
      });
      await syncEffectiveSaleRate(body.medicineId, tx);
      return adjustment;
    });
  },

  // ── POS Retail Dispensing (pharmacy.md §6 — real tax/discount/split payment/outstanding, §19.2 fix) ──
  async dispenseRetail(body: DispenseRetailBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      let subtotal = new Decimal(0);
      let discountTotal = new Decimal(0);
      let taxTotal = new Decimal(0);
      const linesToCreate: Prisma.PharmacyInvoiceLineCreateManyInvoiceInput[] = [];
      const stockDeductions: { medicineId: string; batchId: string | null; quantity: Decimal }[] = [];

      for (const reqLine of body.lines) {
        const medicine = await tx.medicineMaster.findUnique({ where: { id: reqLine.medicineId } });
        if (!medicine || !medicine.isActive) throw new NotFoundError(`Medicine ${reqLine.medicineId} not found or inactive`);

        // medicine-packaging-plan — resolve the sold unit (default: base unit) to a
        // base-unit quantity + an effective per-base-unit rate, ONCE per line; every
        // line below this (FEFO split across batches, discount, tax) is byte-for-byte
        // the pre-packaging base-unit math, now just fed a converted quantity/rate.
        const saleUnitId = reqLine.saleUnitId ?? medicine.baseUnitId;
        const packagingLevel = await tx.medicinePackagingLevel.findFirst({ where: { medicineId: medicine.id, unitId: saleUnitId, isActive: true, isSaleUnit: true } });
        if (!packagingLevel) throw new ValidationError(`Selected unit is not configured as a sale unit for "${medicine.name}"`);
        const conversionToBase = packagingLevel.conversionToBase;
        const reqQty = new Decimal(reqLine.saleUnitQuantity).mul(conversionToBase);
        const overrideSaleRate = packagingLevel.overrideSaleRate ? packagingLevel.overrideSaleRate.div(conversionToBase) : null;
        const lineDiscount = new Decimal(reqLine.discountAmount || 0);
        const allocations = await allocateFefoBatches(medicine.id, reqQty, tx, stockDeductions);
        const lineGrossTotal = allocations.reduce((sum, a) => sum.plus(a.quantity.mul(overrideSaleRate ?? a.saleRate)), new Decimal(0));
        if (lineDiscount.greaterThan(lineGrossTotal)) throw new ValidationError('Line discount exceeds medicine value');

        for (let i = 0; i < allocations.length; i++) {
          const alloc = allocations[i]!;
          const allocSaleRate = overrideSaleRate ?? alloc.saleRate;
          const allocGross = alloc.quantity.mul(allocSaleRate);
          const allocDiscount = lineDiscount.mul(alloc.quantity).div(reqQty);
          const taxable = allocGross.minus(allocDiscount);
          const allocTax = taxable.mul(medicine.taxPercent).div(100);
          const allocNet = taxable.plus(allocTax);

          subtotal = subtotal.plus(allocGross);
          discountTotal = discountTotal.plus(allocDiscount);
          taxTotal = taxTotal.plus(allocTax);

          linesToCreate.push({
            medicineId: medicine.id,
            batchId: alloc.batchId,
            quantity: alloc.quantity,
            rateSnapshot: allocSaleRate,
            costRateSnapshot: alloc.costRate,
            discountAmount: allocDiscount,
            taxAmount: allocTax,
            lineNet: allocNet,
            saleUnitId,
            saleUnitQuantity: alloc.quantity.div(conversionToBase),
          });
          stockDeductions.push({ medicineId: medicine.id, batchId: alloc.batchId, quantity: alloc.quantity });
        }
      }

      const invoiceDiscount = new Decimal(body.invoiceDiscount || 0);

      // pharmacy.md §3 Settings "Tax/discount" policy — 0 means no cap configured.
      const settings = await tx.pharmacySettings.findFirst();
      const maxDiscountPercent = settings?.maxDiscountPercent ?? new Decimal(0);
      if (maxDiscountPercent.greaterThan(0) && subtotal.greaterThan(0)) {
        const discountPercent = discountTotal.plus(invoiceDiscount).div(subtotal).mul(100);
        if (discountPercent.greaterThan(maxDiscountPercent)) {
          throw new ValidationError(`Total discount (${discountPercent.toFixed(2)}%) exceeds the configured policy cap of ${maxDiscountPercent}%`);
        }
      }

      const total = subtotal.minus(discountTotal).plus(taxTotal).minus(invoiceDiscount);
      if (total.lessThan(0)) throw new ValidationError('Invoice discount exceeds the invoice total');

      const paidTotal = body.payments.reduce((s, p) => s.plus(p.amount), new Decimal(0));
      if (paidTotal.greaterThan(total)) throw new ValidationError('Payment amount exceeds invoice total');
      const outstanding = total.minus(paidTotal);
      const status = outstanding.lessThanOrEqualTo(0) ? 'PAID' : paidTotal.greaterThan(0) ? 'PARTIALLY_PAID' : 'UNPAID';

      const invoiceNumber = await nextCode(tx, SEQUENCE.INVOICE_RETAIL);
      const invoice = await tx.pharmacyInvoice.create({
        data: {
          invoiceNumber,
          channel: 'RETAIL',
          customerName: body.customerName,
          subtotal,
          discountTotal: discountTotal.plus(invoiceDiscount),
          taxTotal,
          total,
          paidTotal,
          outstanding,
          status,
          dispensedById: actorId,
          lines: { create: linesToCreate },
          payments: body.payments.length ? { create: body.payments.map((p) => ({ amount: new Decimal(p.amount), method: p.method, reference: p.reference, collectedById: actorId })) } : undefined,
        },
        include: {
          lines: { include: { medicine: true, batch: true, saleUnit: true } },
          payments: { include: { collectedByUser: { select: { id: true, fullName: true, username: true } } } },
          dispensedByUser: { select: { id: true, fullName: true, username: true } },
          medicineRequests: { include: { lines: true } },
        },
      });

      for (const d of stockDeductions) {
        await tx.stockLedgerEntry.create({
          data: { medicineId: d.medicineId, batchId: d.batchId, movementType: 'POS_SALE_OUT', quantityDelta: d.quantity.negated(), referenceTable: 'pharmacy_invoices', referenceId: invoice.id, actorId },
        });
      }
      const uniqueMedIds = Array.from(new Set(stockDeductions.map((d) => d.medicineId)));
      for (const medId of uniqueMedIds) {
        await syncEffectiveSaleRate(medId, tx);
      }

      if (paidTotal.greaterThan(0)) {
        const byMethod = new Map<string, Decimal>();
        for (const p of body.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? new Decimal(0)).plus(p.amount));
        for (const [method, amount] of byMethod) {
          await tx.cashLedgerEntry.create({
            data: { portalUserId: actorId, direction: 'IN', amount, category: 'POS_COLLECTION', isPhysicalCash: method === 'CASH', referenceTable: 'pharmacy_invoices', referenceId: invoice.id },
          });
        }
      }

      return invoice;
    });
  },

  async addPayment(invoiceId: string, body: AddPaymentBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`;
      const invoice = await tx.pharmacyInvoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status === 'PAID') throw new ConflictError('Invoice is already fully paid');
      // HMS-linked invoices are paid by the patient at the HMS Front Desk,
      // never at this pharmacy counter — "collecting" one here would log a
      // physical-cash entry that was never actually received, while leaving
      // `hmsCollectedAmount`/`hmsReceivable` (the real cross-entity receivable)
      // untouched. That money only ever moves through the settlement
      // workflow: `createSettlementRequest` → HMS releases it → `handleSettlementRelease`.
      if (invoice.channel === 'HMS_LINKED') {
        throw new ValidationError(
          'HMS-linked invoices are collected by the patient at the HMS Front Desk, not here. Use "Request Settlement" on this invoice to collect what HMS owes Pharmacy.',
        );
      }
      const amount = new Decimal(body.amount);
      if (amount.greaterThan(invoice.outstanding)) throw new ValidationError(`Payment exceeds outstanding balance of ${invoice.outstanding}`);

      await tx.pharmacyPayment.create({ data: { invoiceId, amount, method: body.method, reference: body.reference, collectedById: actorId } });
      const newPaid = invoice.paidTotal.plus(amount);
      const newOutstanding = invoice.outstanding.minus(amount);
      const newStatus = newOutstanding.lessThanOrEqualTo(0) ? 'PAID' : 'PARTIALLY_PAID';

      const updated = await tx.pharmacyInvoice.update({
        where: { id: invoiceId },
        data: { paidTotal: newPaid, outstanding: newOutstanding, status: newStatus },
        include: { lines: true, payments: true },
      });

      await tx.cashLedgerEntry.create({
        data: { portalUserId: actorId, direction: 'IN', amount, category: 'POS_COLLECTION', isPhysicalCash: body.method === 'CASH', referenceTable: 'pharmacy_invoices', referenceId: invoiceId },
      });

      return updated;
    });
  },

  async listInvoices(query: ListInvoicesQuery) {
    return prisma.pharmacyInvoice.findMany({
      where: { channel: query.channel, status: query.status },
      include: {
        lines: { include: { medicine: true, batch: true, saleUnit: true } },
        payments: { include: { collectedByUser: { select: { id: true, fullName: true, username: true } } } },
        dispensedByUser: { select: { id: true, fullName: true, username: true } },
        medicineRequests: { include: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  },

  // ── Sales Return (pharmacy.md §9.1 SALES_RETURN_IN) ─────────────────────
  async salesReturn(body: SalesReturnBody, actorId: string, transaction?: Prisma.TransactionClient) {
    const execute = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${body.invoiceId}))`;
      const invoice = await tx.pharmacyInvoice.findUnique({ where: { id: body.invoiceId }, include: { lines: { include: { batch: true } } } });
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.channel === 'HMS_LINKED') throw new ValidationError('HMS-linked returns require the HMS billing/refund workflow; no pharmacy drawer refund is permitted.');
      if (new Set(body.lines.map(l=>l.invoiceLineId)).size !== body.lines.length) throw new ValidationError('Duplicate return line');
      if (body.requestKey) {
        const previous = await tx.pharmacyFinancialEvent.findUnique({ where: { eventKey: 'return:'+body.requestKey } });
        if (previous) throw new ConflictError('This return request has already been posted');
      }
      let returnedCost = new Decimal(0);
      let refundTotal = new Decimal(0);
      let grossRefundTotal = new Decimal(0);
      let taxRefundTotal = new Decimal(0);
      let discountRefundTotal = new Decimal(0);

      for (const returnLine of body.lines) {
        const line = invoice.lines.find((l) => l.id === returnLine.invoiceLineId);
        if (!line) throw new NotFoundError(`Invoice line ${returnLine.invoiceLineId} not found on invoice ${invoice.invoiceNumber}`);
        const qty = new Decimal(returnLine.quantity);
        const previouslyReturned = line.returnedQuantity || new Decimal(0);
        const remainingReturnable = line.quantity.minus(previouslyReturned);

        if (qty.greaterThan(remainingReturnable)) {
          throw new ValidationError(
            `Return quantity (${qty}) exceeds remaining returnable quantity (${remainingReturnable}) for this line`
          );
        }

        const proportion = qty.div(line.quantity);
        const lineGrossRefund = line.rateSnapshot.mul(qty);
        const lineTaxRefund = line.taxAmount.mul(proportion);
        const lineDiscountRefund = line.discountAmount.mul(proportion);
        const originalTotal = invoice.total.plus(invoice.lines.reduce((sum,l)=>sum.plus(l.returnedValue),new Decimal(0)));
        const originalLinesNet = invoice.lines.reduce((sum,l)=>sum.plus(l.lineNet),new Decimal(0));
        const invoiceDiscountShare = originalLinesNet.gt(0) ? Decimal.max(0,originalLinesNet.minus(originalTotal)).mul(line.lineNet).div(originalLinesNet).mul(proportion) : new Decimal(0);
        const refundAmount = line.lineNet.mul(proportion).minus(invoiceDiscountShare).toDecimalPlaces(2);
        if(returnLine.restock) returnedCost = returnedCost.plus(qty.mul(line.costRateSnapshot ?? line.batch?.costRate ?? 0));

        grossRefundTotal = grossRefundTotal.plus(lineGrossRefund);
        taxRefundTotal = taxRefundTotal.plus(lineTaxRefund);
        discountRefundTotal = discountRefundTotal.plus(lineDiscountRefund).plus(invoiceDiscountShare);
        refundTotal = refundTotal.plus(refundAmount);

        // Update returned metrics on line
        await tx.pharmacyInvoiceLine.update({
          where: { id: line.id },
          data: {
            returnedQuantity: previouslyReturned.plus(qty),
            returnedValue: (line.returnedValue || new Decimal(0)).plus(refundAmount),
          },
        });

        if (returnLine.restock) {
          await tx.stockLedgerEntry.create({
            data: {
              medicineId: line.medicineId,
              batchId: line.batchId,
              movementType: 'SALES_RETURN_IN',
              quantityDelta: qty,
              referenceTable: 'pharmacy_invoices',
              referenceId: invoice.id,
              note: body.reason,
              actorId,
            },
          });
          await syncEffectiveSaleRate(line.medicineId, tx);
        }
      }

      const cashRefund = Decimal.min(refundTotal, invoice.paidTotal);
      const referenceNo = await nextCode(tx, SEQUENCE.RETURN);
      const refund = await tx.cashLedgerEntry.create({
        data: {
          portalUserId: actorId,
          direction: 'OUT',
          amount: cashRefund,
          category: 'REFUND',
          referenceNo,
          isPhysicalCash: body.refundMethod === 'CASH',
          referenceTable: 'pharmacy_invoices',
          referenceId: invoice.id,
          note: `${referenceNo}: ${body.reason}`,
        },
      });

      await tx.pharmacyFinancialEvent.create({ data: {
        invoiceId:invoice.id,eventKey:body.requestKey?'return:'+body.requestKey:referenceNo,kind:'RETURN',occurredAt:refund.occurredAt,
        collectionDelta:cashRefund.negated(),saleDelta:refundTotal.negated(),taxDelta:taxRefundTotal.negated(),
        grossDelta:grossRefundTotal.negated(),discountDelta:discountRefundTotal.negated(),costDelta:returnedCost.negated(),
        method:body.refundMethod,actorId,reference:refund.id,
      } });
      // Update invoice totals reflecting the reversal
      const newSubtotal = Decimal.max(0, invoice.subtotal.minus(grossRefundTotal));
      const newDiscountTotal = Decimal.max(0, invoice.discountTotal.minus(discountRefundTotal));
      const newTaxTotal = Decimal.max(0, invoice.taxTotal.minus(taxRefundTotal));
      const newTotal = Decimal.max(0, invoice.total.minus(refundTotal));
      const newPaidTotal = Decimal.max(0, invoice.paidTotal.minus(cashRefund));
      const newOutstanding = Decimal.max(0, newTotal.minus(newPaidTotal));
      const newStatus = newTotal.isZero()
        ? 'PAID'
        : newOutstanding.isZero()
        ? 'PAID'
        : newPaidTotal.greaterThan(0)
        ? 'PARTIALLY_PAID'
        : 'UNPAID';

      await tx.pharmacyInvoice.update({
        where: { id: invoice.id },
        data: {
          subtotal: newSubtotal,
          discountTotal: newDiscountTotal,
          taxTotal: newTaxTotal,
          total: newTotal,
          paidTotal: newPaidTotal,
          outstanding: newOutstanding,
          status: newStatus,
        },
      });

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        returnReferenceNo: referenceNo,
        refundTotal: cashRefund,
        returnedSaleAmount: refundTotal,
        refundMethod: body.refundMethod,
        cashLedgerEntryId: refund.id,
        newTotal,
        newPaidTotal,
      };
    };
    return transaction ? execute(transaction) : prisma.$transaction(execute);
  },

  async getInvoiceById(id: string) {
    const invoice = await prisma.pharmacyInvoice.findUnique({
      where: { id },
      include: {
        lines: { include: { medicine: true, batch: true, saleUnit: true } },
        payments: { include: { collectedByUser: { select: { id: true, fullName: true } } } },
        dispensedByUser: { select: { id: true, fullName: true, username: true } },
        medicineRequests: { include: { lines: true } },
      },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');
    return invoice;
  },

  async bulkImportMedicines(body: BulkImportBody, actorId: string) {
    let createdCount = 0;
    let updatedCount = 0;
    const errors: Array<{ row: number; medicine: string; error: string }> = [];
    const successfulItems: Array<{ id: string; code: string; name: string; isNew: boolean }> = [];

    // Helper: case-insensitive get or create unit
    const resolveUnit = async (tx: Prisma.TransactionClient, rawName: string) => {
      const name = rawName.trim();
      const existing = await tx.unit.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
      if (existing) return existing;
      return tx.unit.create({
        data: {
          name,
          isSystem: false,
          createdById: actorId,
        },
      });
    };

    // Helper: case-insensitive get or create category
    const resolveCategory = async (tx: Prisma.TransactionClient, rawCategory?: string | null) => {
      if (!rawCategory || !rawCategory.trim()) return { id: null, name: null };
      const name = rawCategory.trim();
      const existing = await tx.medicineCategory.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
      if (existing) return { id: existing.id, name: existing.name };
      const created = await tx.medicineCategory.create({
        data: {
          name,
          createdById: actorId,
        },
      });
      return { id: created.id, name: created.name };
    };

    for (let index = 0; index < body.items.length; index++) {
      const row = body.items[index]!;
      const rowNum = index + 1;

      try {
        await prisma.$transaction(async (tx) => {
          const medName = row.name.trim();
          const rawBarcode = row.barcode?.trim() || null;
          const rawStrength = row.strength?.trim() || null;
          const rawGeneric = row.genericName?.trim() || null;
          const rawDosage = row.dosageForm?.trim() || null;

          // Check if barcode already belongs to a DIFFERENT medicine
          if (rawBarcode) {
            const conflict = await tx.medicineMaster.findFirst({
              where: {
                barcode: rawBarcode,
                NOT: {
                  AND: [
                    { name: { equals: medName, mode: 'insensitive' } },
                    rawStrength ? { strength: { equals: rawStrength, mode: 'insensitive' } } : {},
                  ],
                },
              },
            });
            if (conflict) {
              throw new ValidationError(`Barcode "${rawBarcode}" already belongs to medicine "${conflict.name}" (${conflict.code})`);
            }
          }

          // Check for existing medicine by barcode OR (name + strength)
          let existingMed = null;
          if (rawBarcode) {
            existingMed = await tx.medicineMaster.findFirst({
              where: { barcode: rawBarcode },
            });
          }
          if (!existingMed) {
            existingMed = await tx.medicineMaster.findFirst({
              where: {
                name: { equals: medName, mode: 'insensitive' },
                ...(rawStrength ? { strength: { equals: rawStrength, mode: 'insensitive' } } : { strength: null }),
              },
            });
          }

          const categoryData = await resolveCategory(tx, row.category);
          const baseUnit = await resolveUnit(tx, row.baseUnit);

          // Option 1 Packaging & Pack-Rate Derivation:
          // Users enter rates (TP / MRP) and opening quantity in terms of the Default Purchase Unit (e.g. Box).
          const purchaseUnitRaw = row.defaultPurchaseUnit?.trim() || row.baseUnit.trim();
          const isBasePurchaseUnit = purchaseUnitRaw.toLowerCase() === row.baseUnit.trim().toLowerCase();

          let purchaseConversionToBase = 1;
          if (!isBasePurchaseUnit) {
            if (row.innerPackUnit && purchaseUnitRaw.toLowerCase() === row.innerPackUnit.trim().toLowerCase()) {
              purchaseConversionToBase = Number(row.baseUnitsPerInnerPack) || 1;
            } else {
              purchaseConversionToBase = Number(row.baseUnitsPerPurchaseUnit) || (Number(row.baseUnitsPerInnerPack) ? Number(row.baseUnitsPerInnerPack) * 10 : 1);
            }
          }
          if (purchaseConversionToBase <= 0) purchaseConversionToBase = 1;

          // Convert pack prices to per-base-unit rates (e.g. Rs 450 per Box / 100 = Rs 4.50 per Tablet)
          const rawSalePrice = Number(row.defaultSalePrice || 0);
          const saleRatePerBase = purchaseConversionToBase > 1 && rawSalePrice > 0
            ? rawSalePrice / purchaseConversionToBase
            : rawSalePrice;

          const rawPurchaseCost = row.purchaseCostRate !== undefined && row.purchaseCostRate !== null
            ? Number(row.purchaseCostRate)
            : null;
          const purchaseRatePerBase = rawPurchaseCost !== null && rawPurchaseCost > 0
            ? (purchaseConversionToBase > 1 ? rawPurchaseCost / purchaseConversionToBase : rawPurchaseCost)
            : null;

          // Convert opening stock from Packs/Boxes to Base Units (e.g. 5 boxes x 100 = 500 tablets)
          const rawOpeningPacks = Number(row.openingStockQty) || 0;
          const openingStockBaseUnits = rawOpeningPacks * purchaseConversionToBase;

          let medicineId: string;
          let medicineCode: string;
          let isNew = false;

          if (existingMed) {
            // Update existing medicine master
            const updated = await tx.medicineMaster.update({
              where: { id: existingMed.id },
              data: {
                genericName: rawGeneric ?? existingMed.genericName,
                dosageForm: rawDosage ?? existingMed.dosageForm,
                categoryId: categoryData.id ?? existingMed.categoryId,
                categoryLabel: categoryData.name ?? existingMed.categoryLabel,
                saleRate: row.defaultSalePrice !== undefined ? new Decimal(saleRatePerBase) : existingMed.saleRate,
                taxPercent: row.taxPercent !== undefined ? new Decimal(row.taxPercent) : existingMed.taxPercent,
                reorderLevel: row.reorderAlertQty !== undefined ? new Decimal(row.reorderAlertQty) : existingMed.reorderLevel,
                purchaseRate: purchaseRatePerBase !== null ? new Decimal(purchaseRatePerBase) : existingMed.purchaseRate,
                barcode: rawBarcode ?? existingMed.barcode,
              },
            });
            medicineId = updated.id;
            medicineCode = updated.code;
            updatedCount++;
          } else {
            // Create new medicine master
            isNew = true;
            medicineCode = await nextCode(tx, SEQUENCE.MEDICINE);

            const created = await tx.medicineMaster.create({
              data: {
                code: medicineCode,
                name: medName,
                strength: rawStrength,
                genericName: rawGeneric,
                dosageForm: rawDosage,
                categoryId: categoryData.id,
                categoryLabel: categoryData.name,
                unit: baseUnit.name,
                baseUnitId: baseUnit.id,
                batchManaged: Boolean(row.trackBatchExpiry),
                reorderLevel: new Decimal(row.reorderAlertQty || 0),
                saleRate: new Decimal(saleRatePerBase || 0),
                purchaseRate: purchaseRatePerBase !== null ? new Decimal(purchaseRatePerBase) : null,
                taxPercent: new Decimal(row.taxPercent || 0),
                barcode: rawBarcode,
                createdById: actorId,
              },
            });
            medicineId = created.id;

            // Build packaging levels
            const packagingLevels: PackagingLevelInput[] = [];

            // Level 1: Inner Pack Unit (if provided and conversion > 1)
            let innerUnit: any = null;
            if (row.innerPackUnit && row.innerPackUnit.trim()) {
              const innerConv = Number(row.baseUnitsPerInnerPack) || 0;
              if (innerConv > 1 && row.innerPackUnit.trim().toLowerCase() !== row.baseUnit.trim().toLowerCase()) {
                innerUnit = await resolveUnit(tx, row.innerPackUnit);
                const isInnerPurchase = !isBasePurchaseUnit && purchaseUnitRaw.toLowerCase() === row.innerPackUnit.trim().toLowerCase();
                packagingLevels.push({
                  unitId: innerUnit.id,
                  conversionToBase: innerConv,
                  isPurchaseUnit: isInnerPurchase,
                  isSaleUnit: true,
                });
              }
            }

            // Outer Pack Unit (if different from base and inner pack)
            if (!isBasePurchaseUnit && (!innerUnit || purchaseUnitRaw.toLowerCase() !== innerUnit.name.toLowerCase())) {
              const outerUnit = await resolveUnit(tx, purchaseUnitRaw);
              const outerConv = Number(row.baseUnitsPerPurchaseUnit) || (packagingLevels[0] ? packagingLevels[0].conversionToBase * 10 : 10);
              packagingLevels.push({
                unitId: outerUnit.id,
                conversionToBase: outerConv,
                isPurchaseUnit: true,
                isSaleUnit: true,
              });
            }

            // Ensure exactly one purchase unit is designated
            const purchaseCount = (isBasePurchaseUnit ? 1 : 0) + packagingLevels.filter((l) => l.isPurchaseUnit).length;
            const finalBasePurchase = purchaseCount === 1 ? isBasePurchaseUnit : true;
            if (purchaseCount !== 1) {
              packagingLevels.forEach((l) => {
                l.isPurchaseUnit = false;
              });
            }

            await writePackagingLevels(tx, medicineId, baseUnit.id, finalBasePurchase, true, packagingLevels);
            createdCount++;
          }

          // Handle Opening Stock (in base units derived from packs)
          if (openingStockBaseUnits > 0) {
            if (row.trackBatchExpiry) {
              const batchNumber = row.batchNumber?.trim() || `INIT-${medicineCode}`;
              let expiryDate = row.expiryDate ? new Date(row.expiryDate) : null;
              if (!expiryDate || isNaN(expiryDate.getTime())) {
                expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
              }
              const costRate = purchaseRatePerBase !== null
                ? purchaseRatePerBase
                : saleRatePerBase * 0.8;

              let batch = batchNumber
                ? await tx.medicineBatch.findFirst({
                    where: { medicineId, batchNumber },
                  })
                : null;
              if (!batch) {
                batch = await tx.medicineBatch.create({
                  data: {
                    medicineId,
                    batchNumber,
                    expiryDate,
                    costRate: new Decimal(costRate),
                    saleRate: saleRatePerBase ? new Decimal(saleRatePerBase) : null,
                    createdById: actorId,
                  },
                });
              }

              await tx.stockLedgerEntry.create({
                data: {
                  medicineId,
                  batchId: batch.id,
                  movementType: 'OPENING_STOCK',
                  quantityDelta: new Decimal(openingStockBaseUnits),
                  referenceTable: 'opening_stock',
                  referenceId: batch.id,
                  note: `Excel bulk import opening stock (${rawOpeningPacks} ${purchaseUnitRaw})`,
                  actorId,
                },
              });
            } else {
              await tx.stockLedgerEntry.create({
                data: {
                  medicineId,
                  batchId: null,
                  movementType: 'OPENING_STOCK',
                  quantityDelta: new Decimal(openingStockBaseUnits),
                  referenceTable: 'opening_stock',
                  referenceId: medicineId,
                  note: `Excel bulk import opening stock (${rawOpeningPacks} ${purchaseUnitRaw})`,
                  actorId,
                },
              });
            }
          }

          successfulItems.push({ id: medicineId, code: medicineCode, name: medName, isNew });
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          medicine: row.name,
          error: err.message || 'Unknown import error',
        });
      }
    }

    return {
      total: body.items.length,
      createdCount,
      updatedCount,
      failedCount: errors.length,
      errors,
      successfulItems,
    };
  },

  currentStock,
};
