import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { nextCode, peekNextCode, SEQUENCE } from '@/shared/sequence';
import { pharmacyService } from '../pharmacy/pharmacy.service';
import type { CreateVendorBody, UpdateVendorBody, PayVendorBody, CreatePurchaseBody, PurchaseReturnBody } from './vendors.schemas';

/** pharmacy.md §10.3 — Opening + Purchases - Payments - Returns/Credits +/- Adjustments = Closing. */
async function vendorBalance(vendorId: string): Promise<Decimal> {
  const entries = await prisma.vendorLedgerEntry.findMany({ where: { vendorId }, select: { amount: true } });
  return entries.reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
}

/** medicine-packaging-plan — full chain, largest pack first, frozen onto a batch at first purchase. */
async function buildPackagingSnapshotChain(medicineId: string, tx: Prisma.TransactionClient) {
  const medicine = await tx.medicineMaster.findUnique({ where: { id: medicineId }, include: { baseUnit: true } });
  const levels = await tx.medicinePackagingLevel.findMany({ where: { medicineId, isActive: true }, include: { unit: true }, orderBy: { level: 'desc' } });
  const chain = levels.map((l) => ({ unit: l.unit.name, conversionToBase: l.conversionToBase.toNumber() }));
  if (medicine?.baseUnit && !chain.some((c) => c.conversionToBase === 1)) {
    chain.push({ unit: medicine.baseUnit.name, conversionToBase: 1 });
  }
  return chain;
}

/**
 * purchase-costing-plan — category-wise markup, falling back to the global
 * PharmacySettings.defaultMarkupPercent when the medicine's category has no
 * (active) MarkupRule row.
 */
async function resolveMarkupPercent(category: string | null, tx: Prisma.TransactionClient): Promise<Decimal> {
  if (category) {
    const rule = await tx.markupRule.findUnique({ where: { category } });
    if (rule?.isActive) return rule.markupPercent;
  }
  const settings = await tx.pharmacySettings.findFirst();
  return settings?.defaultMarkupPercent ?? new Decimal(20);
}

interface ResolvedPackaging {
  conversionToBase: Decimal;
  snapshotChain: { unit: string; conversionToBase: number }[];
  overridden: boolean;
}

/**
 * purchase-costing-plan "Resolve Packaging" step — either the medicine's
 * current default (MedicinePackagingLevel) or a one-off override for this
 * purchase/batch. The override NEVER mutates Medicine Master unless the
 * caller explicitly opted in (`applyToMedicineMasterDefault`), and even then
 * only the single overridden level is touched.
 */
async function resolvePackaging(
  line: CreatePurchaseBody['lines'][number],
  medicine: { id: string; name: string; baseUnitId?: string },
  tx: Prisma.TransactionClient,
): Promise<ResolvedPackaging> {
  if (!line.packagingOverride) {
    // 1. Check if the selected unit is directly the medicine's base unit
    if (medicine.baseUnitId && line.purchaseUnitId === medicine.baseUnitId) {
      return {
        conversionToBase: new Decimal(1),
        snapshotChain: await buildPackagingSnapshotChain(line.medicineId, tx),
        overridden: false,
      };
    }

    // 2. Check if the selected unit is any configured packaging level for this medicine
    const packagingLevel = await tx.medicinePackagingLevel.findFirst({
      where: { medicineId: line.medicineId, unitId: line.purchaseUnitId, isActive: true },
    });
    if (packagingLevel) {
      return {
        conversionToBase: packagingLevel.conversionToBase,
        snapshotChain: await buildPackagingSnapshotChain(line.medicineId, tx),
        overridden: false,
      };
    }

    throw new ValidationError(`Selected unit is not configured as a purchase or packaging unit for "${medicine.name}"`);
  }

  const override = line.packagingOverride;
  const purchaseUnit = await tx.unit.findUnique({ where: { id: line.purchaseUnitId } });
  if (!purchaseUnit) throw new NotFoundError('Purchase unit not found');
  const conversionToBase = new Decimal(override.purchaseUnitConversionToBase);

  // Build the override's own snapshot chain: the overridden purchase unit at
  // its new conversion, any inner levels the caller supplied, and the base
  // unit at 1 — largest first, matching buildPackagingSnapshotChain's shape.
  const medicineRow = await tx.medicineMaster.findUniqueOrThrow({ where: { id: line.medicineId }, include: { baseUnit: true } });
  const innerUnits = override.innerBreakdown ? await tx.unit.findMany({ where: { id: { in: override.innerBreakdown.map((l) => l.unitId) } } }) : [];
  const innerById = new Map(innerUnits.map((u) => [u.id, u.name]));
  const snapshotChain = [
    { unit: purchaseUnit.name, conversionToBase: conversionToBase.toNumber() },
    ...(override.innerBreakdown ?? []).map((l) => ({ unit: innerById.get(l.unitId) ?? '?', conversionToBase: l.conversionToBase })).sort((a, b) => b.conversionToBase - a.conversionToBase),
    { unit: medicineRow.baseUnit.name, conversionToBase: 1 },
  ];

  if (override.applyToMedicineMasterDefault) {
    const level = await tx.medicinePackagingLevel.findFirst({ where: { medicineId: line.medicineId, unitId: line.purchaseUnitId, isActive: true } });
    if (level) {
      await tx.medicinePackagingLevel.update({ where: { id: level.id }, data: { conversionToBase } });
    } else {
      // The overridden unit wasn't part of the medicine's packaging at all (brand-new pack level) — add it as a new level.
      const maxLevel = await tx.medicinePackagingLevel.aggregate({ where: { medicineId: line.medicineId }, _max: { level: true } });
      await tx.medicinePackagingLevel.create({
        data: { medicineId: line.medicineId, unitId: line.purchaseUnitId, level: (maxLevel._max.level ?? 0) + 1, conversionToBase, isPurchaseUnit: true, isSaleUnit: false },
      });
    }
  }

  return { conversionToBase, snapshotChain, overridden: true };
}

export const vendorsService = {
  /** Preview only — not reserved. See `peekNextCode` doc comment. */
  async peekNextVendorCode() {
    return peekNextCode(SEQUENCE.VENDOR);
  },

  /** Preview only — not reserved. See `peekNextCode` doc comment. */
  async peekNextPurchaseCode() {
    return peekNextCode(SEQUENCE.PURCHASE);
  },

  async create(body: CreateVendorBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, SEQUENCE.VENDOR);
      return tx.vendor.create({ data: { ...body, code, createdById: actorId } });
    });
  },

  async update(id: string, body: UpdateVendorBody) {
    const existing = await prisma.vendor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vendor not found');
    return prisma.vendor.update({ where: { id }, data: body });
  },

  async list(search?: string) {
    const vendors = await prisma.vendor.findMany({
      where: search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : undefined,
      orderBy: { name: 'asc' },
    });
    const withBalance = await Promise.all(vendors.map(async (v) => ({ ...v, currentPayable: await vendorBalance(v.id) })));
    return withBalance;
  },

  async getLedger(vendorId: string) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('Vendor not found');
    const entries = await prisma.vendorLedgerEntry.findMany({
      where: { vendorId },
      include: { actor: { select: { id: true, fullName: true, username: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const purchaseIds = entries
      .filter((e) => e.referenceTable === 'purchases' && e.referenceId)
      .map((e) => e.referenceId as string);

    const purchases = purchaseIds.length > 0
      ? await prisma.purchase.findMany({
          where: { id: { in: purchaseIds } },
          select: { id: true, purchaseNumber: true, vendorInvoiceNo: true },
        })
      : [];
    const purchaseMap = new Map(purchases.map((p) => [p.id, p]));

    let running = new Decimal(0);
    const rows = entries.map((e) => {
      running = running.plus(e.amount);
      const purchase = e.referenceId ? purchaseMap.get(e.referenceId) : null;
      let voucherNo = e.referenceNo;
      if (!voucherNo) {
        if (purchase) {
          voucherNo = e.entryType === 'PAYMENT' ? `${purchase.purchaseNumber}-PAY` : purchase.purchaseNumber;
        } else if (e.description?.includes('PO-')) {
          const match = e.description.match(/PO-\d+/);
          voucherNo = match ? (e.entryType === 'PAYMENT' ? `${match[0]}-PAY` : match[0]) : null;
        } else if (e.description?.includes('VPAY-')) {
          voucherNo = e.description.match(/VPAY-\d+/)?.[0] ?? null;
        } else if (e.description?.includes('RET-')) {
          voucherNo = e.description.match(/RET-\d+/)?.[0] ?? null;
        }
      }
      if (!voucherNo) {
        voucherNo = `VND-${e.id.slice(0, 6).toUpperCase()}`;
      }

      return {
        ...e,
        referenceNo: voucherNo,
        voucherNo,
        vendorInvoiceNo: purchase?.vendorInvoiceNo || null,
        runningBalance: running,
      };
    });
    return { vendor, currentPayable: running, entries: rows };
  },

  /**
   * pharmacy.md §10.1 Purchase / Stock In — purchase-costing-plan pipeline:
   * validate vendor/medicine/batch/expiry -> resolve packaging (default or
   * override) -> calculate base qty -> calculate NET (landed) purchase cost
   * (gross - discount + tax + freight) -> calculate effective cost per base
   * unit from that landed total (never the raw vendor rate) -> calculate a
   * markup-rule suggested sale price -> post: create/update batch, stock IN
   * in base units, freeze packaging+cost+price snapshots, update vendor
   * ledger, stock movement, actor. A DRAFT (`post:false`) never touches
   * stock/ledger — only a later `post:true` call does.
   */
  async createPurchase(body: CreatePurchaseBody, actorId: string) {
    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
    if (!vendor) throw new NotFoundError('Vendor not found');

    return prisma.$transaction(async (tx) => {
      let subtotal = new Decimal(0);
      let discountTotal = new Decimal(0);
      let taxTotal = new Decimal(0);
      let freightTotal = new Decimal(0);
      const lineRows: {
        medicineId: string; batchId: string | null; quantity: Decimal; unitCost: Decimal;
        discountType: 'PERCENTAGE' | 'FLAT'; discountAmount: Decimal; taxAmount: Decimal; freightAmount: Decimal; lineTotal: Decimal;
        purchaseUnitId: string; purchaseUnitQuantity: Decimal; conversionToBaseSnapshot: Decimal; packagingOverridden: boolean;
        suggestedSaleRate: Decimal; finalSaleRate: Decimal;
      }[] = [];
      // Per-medicine selling-price updates to apply after lines are built (medicine.saleRate drives POS pricing going forward).
      const medicineSaleRateUpdates = new Map<string, Decimal>();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const line of body.lines) {
        // ── Validate Medicine ──────────────────────────────────────────
        const medicine = await tx.medicineMaster.findUnique({ where: { id: line.medicineId } });
        if (!medicine) throw new NotFoundError(`Medicine ${line.medicineId} not found`);
        if (!medicine.isActive) throw new ValidationError(`"${medicine.name}" is inactive and cannot be purchased`);

        // ── Validate Expiry ────────────────────────────────────────────
        if (line.expiryDate < today) throw new ValidationError(`Batch "${line.batchNumber}" expiry date (${line.expiryDate.toISOString().slice(0, 10)}) is in the past`);

        // ── Resolve Packaging (default or override) ───────────────────
        const packaging = await resolvePackaging(line, medicine, tx);
        const conversionToBase = packaging.conversionToBase;

        // ── Validate Batch — packaging snapshot integrity ─────────────
        const existingBatch = await tx.medicineBatch.findUnique({ where: { medicineId_batchNumber: { medicineId: line.medicineId, batchNumber: line.batchNumber } } });
        if (existingBatch?.purchaseUnitConversionToBase && !existingBatch.purchaseUnitConversionToBase.equals(conversionToBase)) {
          throw new ValidationError(`Batch "${line.batchNumber}" was already received with a different pack size (1 unit = ${existingBatch.purchaseUnitConversionToBase} base units then, ${conversionToBase} now). Use a new batch number for this packaging.`);
        }

        // ── Calculate Base Qty ─────────────────────────────────────────
        const purchaseQty = new Decimal(line.purchaseUnitQuantity);
        const baseQty = purchaseQty.mul(conversionToBase);

        // ── Calculate Net Purchase Cost (landed) ───────────────────────
        const grossAmount = purchaseQty.mul(line.unitCost);
        const discountAmount = line.discountType === 'PERCENTAGE' ? grossAmount.mul(line.discountValue).div(100) : new Decimal(line.discountValue);
        if (discountAmount.greaterThan(grossAmount)) throw new ValidationError(`Discount on "${medicine.name}" exceeds its gross amount`);
        const tax = new Decimal(line.taxAmount);
        const freight = new Decimal(line.freightAmount);
        const netPurchaseCost = grossAmount.minus(discountAmount).plus(tax).plus(freight);

        // ── Calculate Base Unit Cost — from the LANDED total, never the raw vendor rate ──
        const effectiveCostPerBaseUnit = netPurchaseCost.div(baseQty);

        // ── Calculate Suggested Sale Price ──────────────────────────────
        const markupPercent = await resolveMarkupPercent(medicine.categoryLabel, tx);
        const suggestedSaleRate = effectiveCostPerBaseUnit.mul(new Decimal(1).plus(markupPercent.div(100)));
        const finalSaleRate = line.finalSaleRate != null ? new Decimal(line.finalSaleRate) : suggestedSaleRate;

        const batch = await tx.medicineBatch.upsert({
          where: { medicineId_batchNumber: { medicineId: line.medicineId, batchNumber: line.batchNumber } },
          create: {
            medicineId: line.medicineId, batchNumber: line.batchNumber, expiryDate: line.expiryDate, costRate: effectiveCostPerBaseUnit, saleRate: finalSaleRate, createdById: actorId,
            purchaseUnitId: line.purchaseUnitId, purchaseUnitConversionToBase: conversionToBase, packagingSnapshotJson: packaging.snapshotChain,
          },
          update: { costRate: effectiveCostPerBaseUnit, saleRate: finalSaleRate },
        });

        subtotal = subtotal.plus(grossAmount);
        discountTotal = discountTotal.plus(discountAmount);
        taxTotal = taxTotal.plus(tax);
        freightTotal = freightTotal.plus(freight);
        medicineSaleRateUpdates.set(line.medicineId, finalSaleRate);

        lineRows.push({
          medicineId: line.medicineId, batchId: batch.id, quantity: baseQty, unitCost: effectiveCostPerBaseUnit,
          discountType: line.discountType, discountAmount, taxAmount: tax, freightAmount: freight, lineTotal: netPurchaseCost,
          purchaseUnitId: line.purchaseUnitId, purchaseUnitQuantity: purchaseQty, conversionToBaseSnapshot: conversionToBase, packagingOverridden: packaging.overridden,
          suggestedSaleRate, finalSaleRate,
        });
      }

      const total = subtotal.minus(discountTotal).plus(taxTotal).plus(freightTotal);
      const paidNow = new Decimal(body.paidNow);
      if (paidNow.greaterThan(total)) throw new ValidationError('Paid Now cannot exceed the purchase total');
      const vendorDue = total.minus(paidNow);
      const purchaseNumber = await nextCode(tx, SEQUENCE.PURCHASE);

      const purchase = await tx.purchase.create({
        data: {
          purchaseNumber,
          vendorId: body.vendorId,
          purchaseDate: body.purchaseDate,
          vendorInvoiceNo: body.vendorInvoiceNo,
          paymentType: body.paymentType,
          notes: body.notes,
          status: body.post ? 'POSTED' : 'DRAFT',
          subtotal,
          discountTotal,
          taxTotal,
          freightTotal,
          total,
          paidNow,
          vendorDue,
          createdById: actorId,
          lines: { create: lineRows },
        },
        include: { lines: { include: { medicine: true, batch: true, purchaseUnit: true } }, vendor: true },
      });

      // Draft purchases never touch stock, vendor ledger, or selling prices — only a later post:true does.
      if (body.post) {
        for (const line of lineRows) {
          await tx.stockLedgerEntry.create({
            data: { medicineId: line.medicineId, batchId: line.batchId, movementType: 'PURCHASE_IN', quantityDelta: line.quantity, referenceTable: 'purchases', referenceId: purchase.id, actorId },
          });
        }
        // FEFO/FIFO: keep medicineMaster.saleRate synced to the earliest active batch's selling price instead of blindly overwriting with the newest batch.
        const touchedMedicineIds = new Set(lineRows.map((l) => l.medicineId));
        for (const medicineId of touchedMedicineIds) {
          await pharmacyService.syncEffectiveSaleRate(medicineId, tx);
        }
        await tx.vendorLedgerEntry.create({
          data: { vendorId: body.vendorId, entryType: 'PURCHASE_CREDIT', amount: total, referenceNo: purchaseNumber, description: `Purchase ${purchaseNumber}`, referenceTable: 'purchases', referenceId: purchase.id, actorId },
        });
        if (paidNow.greaterThan(0)) {
          await tx.vendorLedgerEntry.create({
            data: { vendorId: body.vendorId, entryType: 'PAYMENT', amount: paidNow.negated(), referenceNo: `${purchaseNumber}-PAY`, description: `Paid on purchase ${purchaseNumber}`, referenceTable: 'purchases', referenceId: purchase.id, actorId },
          });
          await tx.cashLedgerEntry.create({
            data: { portalUserId: actorId, direction: 'OUT', amount: paidNow, category: 'VENDOR_PAYMENT', isPhysicalCash: body.paymentType === 'CASH', referenceTable: 'purchases', referenceId: purchase.id },
          });
        }
      }

      return purchase;
    });
  },

  /** Posts a previously-saved DRAFT purchase — same stock/ledger/price-snapshot effects as `createPurchase({ post: true })`, without re-entering line data. */
  async postPurchase(purchaseId: string, actorId: string) {
    const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId }, include: { lines: true } });
    if (!purchase) throw new NotFoundError('Purchase not found');
    if (purchase.status === 'POSTED') throw new ConflictError('Purchase is already posted');

    return prisma.$transaction(async (tx) => {
      for (const line of purchase.lines) {
        await tx.stockLedgerEntry.create({
          data: { medicineId: line.medicineId, batchId: line.batchId, movementType: 'PURCHASE_IN', quantityDelta: line.quantity, referenceTable: 'purchases', referenceId: purchase.id, actorId },
        });
      }
      const touchedMedicineIds = new Set(purchase.lines.map((l) => l.medicineId));
      for (const medicineId of touchedMedicineIds) {
        await pharmacyService.syncEffectiveSaleRate(medicineId, tx);
      }
      await tx.vendorLedgerEntry.create({
        data: { vendorId: purchase.vendorId, entryType: 'PURCHASE_CREDIT', amount: purchase.total, referenceNo: purchase.purchaseNumber, description: `Purchase ${purchase.purchaseNumber}`, referenceTable: 'purchases', referenceId: purchase.id, actorId },
      });
      if (purchase.paidNow.greaterThan(0)) {
        await tx.vendorLedgerEntry.create({
          data: { vendorId: purchase.vendorId, entryType: 'PAYMENT', amount: purchase.paidNow.negated(), referenceNo: `${purchase.purchaseNumber}-PAY`, description: `Paid on purchase ${purchase.purchaseNumber}`, referenceTable: 'purchases', referenceId: purchase.id, actorId },
        });
        await tx.cashLedgerEntry.create({
          data: { portalUserId: actorId, direction: 'OUT', amount: purchase.paidNow, category: 'VENDOR_PAYMENT', isPhysicalCash: purchase.paymentType === 'CASH', referenceTable: 'purchases', referenceId: purchase.id },
        });
      }
      return tx.purchase.update({ where: { id: purchaseId }, data: { status: 'POSTED' }, include: { lines: { include: { medicine: true, batch: true } }, vendor: true } });
    });
  },

  async payVendor(vendorId: string, body: PayVendorBody, actorId: string) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('Vendor not found');
    const amount = new Decimal(body.amount);

    return prisma.$transaction(async (tx) => {
      const referenceNo = await nextCode(tx, SEQUENCE.VENDOR_PAYMENT);
      const entry = await tx.vendorLedgerEntry.create({
        data: { vendorId, entryType: 'PAYMENT', amount: amount.negated(), referenceNo, description: `Vendor payment (${body.method})`, referenceTable: 'vendor_payments', referenceId: vendorId, actorId },
      });
      await tx.cashLedgerEntry.create({
        data: { portalUserId: actorId, direction: 'OUT', amount, category: 'VENDOR_PAYMENT', isPhysicalCash: body.method === 'CASH', referenceTable: 'vendor_ledger_entries', referenceId: entry.id },
      });
      return entry;
    });
  },

  /**
   * pharmacy.md §9.1 PURCHASE_RETURN_OUT + vendor RETURN_CREDIT —
   * purchase-costing-plan: always resolves quantity/cost from the TARGET
   * BATCH's own frozen packaging + landed-cost snapshot (never the
   * medicine's current live packaging/price), and never returns more than
   * that batch currently has in stock.
   */
  async purchaseReturn(body: PurchaseReturnBody, actorId: string) {
    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
    if (!vendor) throw new NotFoundError('Vendor not found');

    return prisma.$transaction(async (tx) => {
      let total = new Decimal(0);
      const stockDeductions: { medicineId: string; batchId: string; quantity: Decimal }[] = [];

      for (const line of body.lines) {
        const batch = await tx.medicineBatch.findUnique({ where: { id: line.batchId }, include: { stockEntries: { select: { quantityDelta: true } } } });
        if (!batch || batch.medicineId !== line.medicineId) throw new NotFoundError('Batch not found for this medicine');
        if (!batch.purchaseUnitConversionToBase) throw new ValidationError('This batch has no packaging snapshot to return against');

        // Resolve conversion from the BATCH's own snapshot — its own purchase unit by default, or another unit found in its frozen chain.
        let conversionToBase = batch.purchaseUnitConversionToBase;
        if (line.returnUnitId && line.returnUnitId !== batch.purchaseUnitId) {
          const returnUnit = await tx.unit.findUnique({ where: { id: line.returnUnitId } });
          if (!returnUnit) throw new NotFoundError('Return unit not found');
          const chain = (batch.packagingSnapshotJson as { unit: string; conversionToBase: number }[] | null) ?? [];
          const match = chain.find((c) => c.unit === returnUnit.name);
          if (!match) throw new ValidationError(`"${returnUnit.name}" was not part of this batch's packaging when it was purchased`);
          conversionToBase = new Decimal(match.conversionToBase);
        }

        const returnQty = new Decimal(line.returnUnitQuantity);
        const baseQty = returnQty.mul(conversionToBase);
        const availableQty = batch.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
        if (baseQty.greaterThan(availableQty)) throw new ValidationError(`Cannot return more than currently in stock for batch "${batch.batchNumber}" (available: ${availableQty})`);

        // Value the return at the batch's own frozen landed cost — not today's medicine-level cost.
        const lineTotal = baseQty.mul(batch.costRate);
        total = total.plus(lineTotal);
        stockDeductions.push({ medicineId: line.medicineId, batchId: batch.id, quantity: baseQty });
      }

      const referenceNo = await nextCode(tx, SEQUENCE.RETURN);
      for (const d of stockDeductions) {
        await tx.stockLedgerEntry.create({
          data: { medicineId: d.medicineId, batchId: d.batchId, movementType: 'PURCHASE_RETURN_OUT', quantityDelta: d.quantity.negated(), referenceTable: 'purchase_returns', referenceId: body.vendorId, note: `${referenceNo}: ${body.reason}`, actorId },
        });
      }
      const touchedMedicineIds = new Set(stockDeductions.map((d) => d.medicineId));
      for (const medicineId of touchedMedicineIds) {
        await pharmacyService.syncEffectiveSaleRate(medicineId, tx);
      }
      return tx.vendorLedgerEntry.create({
        data: { vendorId: body.vendorId, entryType: 'RETURN_CREDIT', amount: total.negated(), referenceNo, description: body.reason, referenceTable: 'purchase_returns', referenceId: body.vendorId, actorId },
      });
    });
  },
};
