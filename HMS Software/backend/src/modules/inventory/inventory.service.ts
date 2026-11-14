import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { NotFoundError, ValidationError } from '@/shared/errors/AppError';
import type {
  CreateSupplierBody,
  UpdateSupplierBody,
  CreateStockItemBody,
  UpdateStockItemBody,
  CreatePurchaseBody,
  CreateDepartmentIssueBody,
  CreateDepartmentReturnBody,
  CreateSupplierReturnBody,
  CreateAdjustmentBody,
  CreateInventoryExpenseBody,
  PaySupplierBody,
} from './inventory.schemas';
import type { Prisma, StockAdjustmentType } from '@prisma/client';

/** Reject repeated rows before validating balances against a shared snapshot. */
function assertUniqueItems(ids: string[]) {
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('Each item or return line may appear only once. Combine quantities into one line.');
  }
}

// inventory.md §4.2 — the type dictates the direction for every type except
// COUNT_CORRECTION, which genuinely can go either way.
const FIXED_ADJUSTMENT_DIRECTION: Partial<Record<StockAdjustmentType, 'INCREASE' | 'DECREASE'>> = {
  DAMAGE: 'DECREASE',
  EXPIRY: 'DECREASE',
  LOSS: 'DECREASE',
  QUARANTINE: 'DECREASE',
  SURPLUS: 'INCREASE',
};

/**
 * Single source of truth for a supplier's running payable, used by
 * `listSuppliers`, `getSupplierLedger` and `paySupplier`'s overpayment guard
 * (inventory.md §5's formula) — previously duplicated ad hoc in two places
 * and missing the ADJUSTMENT entry type in one of them.
 * PURCHASE_CREDIT/ADJUSTMENT amounts are pre-signed and add straight in;
 * PAYMENT/RETURN/CREDIT_NOTE are stored as positive magnitudes and always
 * reduce payable.
 */
function computeOutstanding(entries: { entryType: string; amount: Decimal | string | number }[]): Decimal {
  return entries.reduce((acc, entry) => {
    const amount = new Decimal(entry.amount);
    return entry.entryType === 'PURCHASE_CREDIT' || entry.entryType === 'ADJUSTMENT' ? acc.plus(amount) : acc.minus(amount);
  }, new Decimal(0));
}

export interface InventoryBatchAllocation {
  batchNo: string | null;
  expiryDate: Date | null;
  costRate: Decimal;
  quantity: Decimal;
}

export interface InventoryActiveBatch {
  batchNo: string | null;
  expiryDate: Date | null;
  costRate: Decimal;
  available: Decimal;
}

export function computeInventoryActiveBatches(
  stockLedgerEntries: Array<{
    quantityDelta: Decimal | number | string;
    batchNo: string | null;
    expiryDate: Date | null;
    createdAt: Date;
  }>,
  purchaseOrderLines: Array<{
    batchNo: string | null;
    rate: Decimal | number | string;
  }>,
): InventoryActiveBatch[] {
  type BatchAccumulator = {
    batchNo: string | null;
    expiryDate: Date | null;
    firstSeen: Date;
    available: Decimal;
  };

  const batchMap = new Map<string, BatchAccumulator>();

  for (const entry of stockLedgerEntries) {
    const bNo = entry.batchNo?.trim() || null;
    const expStr = entry.expiryDate instanceof Date
      ? entry.expiryDate.toISOString().slice(0, 10)
      : (entry.expiryDate ? String(entry.expiryDate).slice(0, 10) : 'NO_EXP');
    const key = `${bNo ?? '__UNBATCHED__'}::${expStr}`;

    const existing = batchMap.get(key);
    const delta = new Decimal(entry.quantityDelta);
    const createdAt = entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt);
    const expDate = entry.expiryDate
      ? (entry.expiryDate instanceof Date ? entry.expiryDate : new Date(entry.expiryDate))
      : null;

    if (!existing) {
      batchMap.set(key, {
        batchNo: bNo,
        expiryDate: expDate,
        firstSeen: createdAt,
        available: delta,
      });
    } else {
      existing.available = existing.available.plus(delta);
      if (createdAt < existing.firstSeen) {
        existing.firstSeen = createdAt;
      }
    }
  }

  const defaultRate = purchaseOrderLines.length > 0 && purchaseOrderLines[0]
    ? new Decimal(purchaseOrderLines[0].rate)
    : new Decimal(0);

  const getCostRate = (batchNo: string | null): Decimal => {
    if (!batchNo) return defaultRate;
    const matched = purchaseOrderLines.find(
      (pol) => pol.batchNo?.trim().toLowerCase() === batchNo.trim().toLowerCase(),
    );
    return matched ? new Decimal(matched.rate) : defaultRate;
  };

  const now = new Date();

  // Filter positive available stock
  const positiveBatches = Array.from(batchMap.values()).filter((b) => b.available.greaterThan(0));

  // Filter out expired batches (safety for hospital inventory)
  const nonExpiredBatches = positiveBatches.filter((b) => {
    if (b.expiryDate && b.expiryDate < now) return false;
    return true;
  });

  // Sort by FEFO (earliest expiry first), with FIFO fallback (oldest firstSeen first)
  nonExpiredBatches.sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      const expDiff = a.expiryDate.getTime() - b.expiryDate.getTime();
      if (expDiff !== 0) return expDiff;
      return a.firstSeen.getTime() - b.firstSeen.getTime();
    }
    if (a.expiryDate && !b.expiryDate) return -1;
    if (!a.expiryDate && b.expiryDate) return 1;
    return a.firstSeen.getTime() - b.firstSeen.getTime();
  });

  return nonExpiredBatches.map((b) => ({
    batchNo: b.batchNo,
    expiryDate: b.expiryDate,
    costRate: getCostRate(b.batchNo),
    available: b.available,
  }));
}

export async function allocateInventoryFefoBatches(
  stockItemId: string,
  requestedQuantity: Decimal,
  tx: Prisma.TransactionClient,
): Promise<InventoryBatchAllocation[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;

  const item = await tx.stockItem.findUnique({
    where: { id: stockItemId },
    include: {
      stockLedgerEntries: {
        select: {
          quantityDelta: true,
          batchNo: true,
          expiryDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      purchaseOrderLines: {
        select: {
          batchNo: true,
          rate: true,
        },
      },
    },
  });

  if (!item || !item.isActive) {
    throw new NotFoundError(`Stock item ${stockItemId} not found or inactive`);
  }

  const activeBatches = computeInventoryActiveBatches(item.stockLedgerEntries, item.purchaseOrderLines);
  const totalAvailable = activeBatches.reduce((sum, b) => sum.plus(b.available), new Decimal(0));

  if (totalAvailable.lessThan(requestedQuantity)) {
    throw new ValidationError(
      `Insufficient non-expired stock for "${item.name}". Available: ${totalAvailable.toString()} ${item.unit}, Requested: ${requestedQuantity.toString()} ${item.unit}. Cannot drive stock negative.`,
    );
  }

  let remaining = requestedQuantity;
  const allocations: InventoryBatchAllocation[] = [];

  for (const batch of activeBatches) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = remaining.lessThan(batch.available) ? remaining : batch.available;
    allocations.push({
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      costRate: batch.costRate,
      quantity: take,
    });
    remaining = remaining.minus(take);
  }

  return allocations;
}

export const inventoryService = {
  allocateInventoryFefoBatches,
  computeInventoryActiveBatches,
  // ── Suppliers ──────────────────────────────────────────────────────────
  async createSupplier(body: CreateSupplierBody, actorId: string) {
    return prisma.supplier.create({
      data: {
        ...body,
        createdById: actorId,
      },
    });
  },

  async updateSupplier(id: string, body: UpdateSupplierBody) {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Supplier not found');
    return prisma.supplier.update({ where: { id }, data: body });
  },

  async listSuppliers(search?: string) {
    const suppliers = await prisma.supplier.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { contact: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        supplierLedger: true,
      },
      orderBy: { name: 'asc' },
    });

    return suppliers.map((s) => {
      const outstanding = computeOutstanding(s.supplierLedger);

      return {
        id: s.id,
        name: s.name,
        contact: s.contact,
        phone: s.phone,
        address: s.address,
        terms: s.terms,
        isActive: s.isActive,
        outstandingBalance: outstanding,
      };
    });
  },

  async getSupplierLedger(supplierId: string) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        supplierLedger: {
          include: { actor: { select: { id: true, username: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!supplier) throw new NotFoundError('Supplier not found');

    const totalOutstanding = computeOutstanding(supplier.supplierLedger);

    // Fetch associated purchase orders so line items are displayed in the ledger
    const poIds = supplier.supplierLedger
      .filter((e) => e.referenceTable === 'purchase_orders' && e.referenceId)
      .map((e) => e.referenceId as string);

    const purchaseOrders =
      poIds.length > 0
        ? await prisma.purchaseOrder.findMany({
            where: { id: { in: poIds } },
            include: {
              lines: {
                include: {
                  stockItem: { select: { id: true, code: true, name: true, unit: true } },
                },
              },
            },
          })
        : [];

    const poMap = new Map(purchaseOrders.map((p) => [p.id, p]));

    const enrichedEntries = supplier.supplierLedger.map((entry) => {
      const po = entry.referenceId ? poMap.get(entry.referenceId) : null;
      return {
        ...entry,
        items: po
          ? po.lines.map((l) => ({
              itemCode: l.stockItem.code,
              itemName: l.stockItem.name,
              unit: l.stockItem.unit,
              quantity: l.quantity,
              rate: l.rate,
              batchNo: l.batchNo,
            }))
          : [],
        invoiceReference: po?.invoiceReference || null,
      };
    });

    return {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        contact: supplier.contact,
        phone: supplier.phone,
        terms: supplier.terms,
      },
      totalOutstanding,
      ledgerEntries: enrichedEntries,
    };
  },

  /** Pay Supplier (inventory.md §5.2, §9 step 12) — reduces payable; a
   * PETTY_CASH payment also deducts the paying user's own physical cash
   * (mirrors createPurchase's cash-purchase deduction). */
  async paySupplier(supplierId: string, body: PaySupplierBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, include: { supplierLedger: true } });
      if (!supplier || !supplier.isActive) throw new NotFoundError('Supplier not found or inactive');

      const amount = new Decimal(body.amount);

      // Previously unguarded — a "Pay" click stayed clickable even after the
      // bill was already settled, so repeated clicks kept posting fresh
      // PAYMENT rows with nothing to stop them (§5's Paid/Due tracking gap).
      const outstanding = computeOutstanding(supplier.supplierLedger);
      if (outstanding.lessThanOrEqualTo(0)) {
        throw new ValidationError(`${supplier.name}'s account is already fully settled — there is no outstanding balance to pay.`);
      }
      if (amount.greaterThan(outstanding)) {
        throw new ValidationError(`Payment of PKR ${amount.toFixed(2)} exceeds the outstanding balance of PKR ${outstanding.toFixed(2)} for ${supplier.name}.`);
      }

      let payRef = body.reference?.trim();
      if (!payRef) {
        const count = await tx.supplierLedger.count({ where: { entryType: 'PAYMENT' } });
        const nextNum = (count + 1) % 100 || 1;
        payRef = `PAY-${String(nextNum).padStart(2, '0')}`;
      }

      const entry = await tx.supplierLedger.create({
        data: {
          supplierId,
          entryType: 'PAYMENT',
          amount,
          referenceTable: 'suppliers',
          referenceId: payRef,
          actorId,
        },
      });

      if (body.paymentMethod === 'PETTY_CASH') {
        const userCashEntries = await tx.userCashBalance.findMany({
          where: { portalUserId: actorId, isSettled: false, isPhysicalCash: true },
        });
        const currentPhysicalCash = userCashEntries.reduce(
          (sum, e) => (e.direction === 'IN' ? sum.plus(e.amount) : sum.minus(e.amount)),
          new Decimal(0),
        );
        if (currentPhysicalCash.lessThan(amount)) {
          throw new ValidationError(
            `Insufficient petty cash balance (Current: PKR ${currentPhysicalCash.toFixed(2)}, Required: PKR ${amount.toFixed(2)}).`,
          );
        }

        await tx.userCashBalance.create({
          data: {
            portalUserId: actorId,
            moduleScope: 'INVENTORY',
            direction: 'OUT',
            amount,
            category: 'PURCHASE',
            isPhysicalCash: true,
            note: `Supplier payment — ${supplier.name}${body.reference ? ` (Ref: ${body.reference})` : ''}`,
          },
        });
      }

      return entry;
    });
  },

  /** Delete Supplier and clean up related records safely */
  async deleteSupplier(supplierId: string) {
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundError('Supplier not found');

    await prisma.supplier.update({ where: { id: supplierId }, data: { isActive: false } });
    return { success: true, message: 'Supplier deactivated; history retained' };
  },

  async deleteStockItem(stockItemId: string) {
    const item = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!item) throw new NotFoundError('Stock item not found');
    await prisma.stockItem.update({ where: { id: stockItemId }, data: { isActive: false } });
    return { success: true, message: 'Stock item deactivated; history retained' };
  },

  // ── Stock Items & Running Balance ──────────────────────────────────────
  async createStockItem(body: CreateStockItemBody, actorId: string) {
    let itemCode = body.code?.trim();
    if (!itemCode) {
      const items = await prisma.stockItem.findMany({ select: { code: true } });
      let maxNum = 0;
      for (const it of items) {
        const m = it.code.match(/ITM-?(\d+)/i);
        if (m && m[1]) {
          const n = parseInt(m[1], 10);
          if (n < 100 && n > maxNum) maxNum = n;
        }
      }
      const nextNum = (maxNum + 1) % 100 || 1;
      itemCode = `ITM-${String(nextNum).padStart(2, '0')}`;
    }

    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const item = await tx.stockItem.create({
        data: {
          code: itemCode,
          name: body.name,
          category: body.category,
          unit: body.unit,
          location: body.location,
          reorderLevel: new Decimal(body.reorderLevel),
          createdById: actorId,
        },
      });

      const initialQty = body.initialQuantity ? new Decimal(body.initialQuantity) : new Decimal(0);
      const rate = body.unitCost ? new Decimal(body.unitCost) : new Decimal(0);

      if (initialQty.greaterThan(0)) {
        const supplier = body.supplierId
          ? await tx.supplier.findUnique({ where: { id: body.supplierId } })
          : null;

        if (supplier) {
          const poCount = await tx.purchaseOrder.count();
          const nextGrn = (poCount + 1) % 100 || 1;
          const invoiceRef = `GRN-${String(nextGrn).padStart(2, '0')}`;
          const batchNo = `BN-${String(nextGrn).padStart(2, '0')}`;
          const totalAmount = initialQty.mul(rate);

          const po = await tx.purchaseOrder.create({
            data: {
              supplierId: supplier.id,
              status: 'RECEIVED',
              invoiceReference: invoiceRef,
              paymentMethod: 'CREDIT',
              totalAmount,
              createdById: actorId,
              approvedById: actorId,
              approvedAt: new Date(),
              lines: {
                create: [
                  {
                    stockItemId: item.id,
                    quantity: initialQty,
                    rate,
                    receivedQuantity: initialQty,
                    batchNo,
                  },
                ],
              },
            },
          });

          await tx.stockLedger.create({
            data: {
              stockItemId: item.id,
              movementType: 'PURCHASE_RECEIPT',
              quantityDelta: initialQty,
              batchNo,
              referenceTable: 'purchase_orders',
              referenceId: po.id,
              actorId,
            },
          });

          await tx.supplierLedger.create({
            data: {
              supplierId: supplier.id,
              entryType: 'PURCHASE_CREDIT',
              amount: totalAmount,
              referenceTable: 'purchase_orders',
              referenceId: po.id,
              actorId,
            },
          });
        } else {
          await tx.stockLedger.create({
            data: {
              stockItemId: item.id,
              movementType: 'POSITIVE_ADJUSTMENT',
              quantityDelta: initialQty,
              batchNo: 'BN-01',
              referenceTable: 'stock_items',
              referenceId: item.id,
              actorId,
            },
          });
        }
      }

      return item;
    });
  },

  async updateStockItem(id: string, body: UpdateStockItemBody) {
    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Stock item not found');
    return prisma.stockItem.update({
      where: { id },
      data: {
        ...body,
        reorderLevel: body.reorderLevel !== undefined ? new Decimal(body.reorderLevel) : undefined,
      },
    });
  },

  async listStockItems(search?: string) {
    const items = await prisma.stockItem.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        stockLedgerEntries: {
          select: {
            quantityDelta: true,
            batchNo: true,
            expiryDate: true,
            createdAt: true,
          },
        },
        purchaseOrderLines: {
          select: {
            batchNo: true,
            rate: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return items.map((item) => {
      const currentStock = item.stockLedgerEntries.reduce(
        (sum, entry) => sum.plus(entry.quantityDelta),
        new Decimal(0),
      );
      const isLowStock = currentStock.lessThanOrEqualTo(item.reorderLevel);
      const activeBatches = computeInventoryActiveBatches(item.stockLedgerEntries, item.purchaseOrderLines);

      return {
        id: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        unit: item.unit,
        location: item.location,
        reorderLevel: item.reorderLevel,
        isActive: item.isActive,
        currentStock,
        isLowStock,
        activeBatches: activeBatches.map((b) => ({
          batchNo: b.batchNo,
          expiryDate: b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : null,
          costRate: b.costRate,
          available: b.available,
        })),
      };
    });
  },

  async getItemLedger(stockItemId: string) {
    const item = await prisma.stockItem.findUnique({
      where: { id: stockItemId },
      include: {
        stockLedgerEntries: {
          include: { actor: { select: { id: true, username: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundError('Stock item not found');

    const runningStock = item.stockLedgerEntries.reduce(
      (sum, e) => sum.plus(e.quantityDelta),
      new Decimal(0),
    );

    return {
      item: { id: item.id, code: item.code, name: item.name, unit: item.unit },
      currentStock: runningStock,
      movements: item.stockLedgerEntries,
    };
  },

  // ── Fund Requests / Petty Cash Received (inventory.md §6.1, §9 step 6) ──
  async approveFundRequest(recipientUserId: string, amount: number, reason: string, issuedById: string) {
    const amountDecimal = new Decimal(amount);

    // Credits recipient's UserCashBalance (§4.8, D16 p.17)
    return prisma.userCashBalance.create({
      data: {
        portalUserId: recipientUserId,
        moduleScope: 'INVENTORY',
        direction: 'IN',
        amount: amountDecimal,
        category: 'PETTY_CASH_ISSUE',
        isPhysicalCash: true,
        note: reason,
        issuedById,
      },
    });
  },

  /** Petty Cash Received tab — the calling user's own receipts. */
  async listPettyCash(portalUserId: string) {
    return prisma.userCashBalance.findMany({
      where: { portalUserId, moduleScope: 'INVENTORY', category: 'PETTY_CASH_ISSUE' },
      include: { issuedByUser: { select: { id: true, displayName: true, username: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });
  },

  // ── Inventory Expenses (inventory.md §6.1, §9 step 6) ──────────────────
  /**
   * Deliberately separate from `expensesService` (Super Admin/Admin's
   * hospital-wide operating-expense ledger) — this one also posts a
   * `UserCashBalance` OUT/EXPENSE entry so it reduces the creating
   * Inventory user's own expected cash (§6.2 formula).
   */
  async createInventoryExpense(body: CreateInventoryExpenseBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const amount = new Decimal(body.amount);

      let expRef = body.reference?.trim();
      if (!expRef) {
        const expCount = await tx.inventoryExpense.count();
        const nextNum = (expCount + 1) % 100 || 1;
        expRef = `EXP-${String(nextNum).padStart(2, '0')}`;
      }

      const expense = await tx.inventoryExpense.create({
        data: {
          expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
          category: body.category,
          amount,
          paymentMethod: body.paymentMethod,
          payee: body.payee,
          description: body.description,
          reference: expRef,
          createdById: actorId,
        },
      });

      await tx.userCashBalance.create({
        data: {
          portalUserId: actorId,
          moduleScope: 'INVENTORY',
          direction: 'OUT',
          amount,
          category: 'EXPENSE',
          isPhysicalCash: body.paymentMethod === 'CASH',
          note: body.description ?? body.category,
        },
      });

      return expense;
    });
  },

  /** Inventory Expenses tab — the calling user's own recorded expenses. */
  async listInventoryExpenses(actorId: string) {
    return prisma.inventoryExpense.findMany({
      where: { createdById: actorId },
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
  },

  // ── Purchase Orders & Goods Receipt ────────────────────────────────────
  /**
   * Posts stock IN (+delta) into StockLedger; cash payment reduces user cash balance.
   */
  async createPurchase(body: CreatePurchaseBody, actorId: string) {
    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier || !supplier.isActive) {
        throw new NotFoundError('Supplier not found or inactive');
      }

      let totalAmount = new Decimal(0);
      const linesData = [];

      for (const line of body.lines) {
        const item = await tx.stockItem.findUnique({ where: { id: line.stockItemId } });
        if (!item || !item.isActive) {
          throw new NotFoundError(`Stock item ${line.stockItemId} not found or inactive`);
        }
        const qty = new Decimal(line.quantity);
        const rate = new Decimal(line.rate);
        const batchNo: string =
          line.batchNo?.trim() ||
          `BN-${String((linesData.length + 1) % 100 || 1).padStart(2, '0')}`;
        totalAmount = totalAmount.plus(qty.mul(rate));
        linesData.push({
          stockItemId: item.id,
          quantity: qty,
          rate,
          receivedQuantity: qty,
          batchNo,
          expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
        });
      }

      // If paid by PETTY_CASH, verify user has sufficient physical cash balance
      if (body.paymentMethod === 'PETTY_CASH') {
        const userCashEntries = await tx.userCashBalance.findMany({
          where: { portalUserId: actorId, isSettled: false, isPhysicalCash: true },
        });
        const currentPhysicalCash = userCashEntries.reduce((sum, entry) => {
          return entry.direction === 'IN' ? sum.plus(entry.amount) : sum.minus(entry.amount);
        }, new Decimal(0));

        if (currentPhysicalCash.lessThan(totalAmount)) {
          throw new ValidationError(
            `Insufficient petty cash balance (Current: PKR ${currentPhysicalCash.toFixed(2)}, Required: PKR ${totalAmount.toFixed(2)}). Request petty cash advance first.`,
          );
        }

        // Deduct from user's UserCashBalance
        await tx.userCashBalance.create({
          data: {
            portalUserId: actorId,
            moduleScope: 'INVENTORY',
            direction: 'OUT',
            amount: totalAmount,
            category: 'PURCHASE',
            isPhysicalCash: true,
          },
        });
      }

      // Auto-generate GRN / invoice reference if omitted
      let invoiceRef = body.invoiceReference?.trim();
      if (!invoiceRef) {
        const poCount = await tx.purchaseOrder.count();
        const nextGrn = (poCount + 1) % 100 || 1;
        invoiceRef = `GRN-${String(nextGrn).padStart(2, '0')}`;
      }

      // Create PurchaseOrder record
      const po = await tx.purchaseOrder.create({
        data: {
          supplierId: supplier.id,
          status: 'RECEIVED',
          invoiceReference: invoiceRef,
          paymentMethod: body.paymentMethod,
          totalAmount,
          createdById: actorId,
          approvedById: actorId,
          approvedAt: new Date(),
          lines: {
            create: linesData,
          },
        },
        include: { lines: { include: { stockItem: true } } },
      });

      // Post +IN movement for each line to StockLedger (§6.1, §6.10)
      for (const line of po.lines) {
        await tx.stockLedger.create({
          data: {
            stockItemId: line.stockItemId,
            movementType: 'PURCHASE_RECEIPT',
            quantityDelta: line.quantity, // +IN
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            referenceTable: 'purchase_orders',
            referenceId: po.id,
            actorId,
          },
        });
      }

      // Post to SupplierLedger
      if (body.paymentMethod === 'CREDIT') {
        await tx.supplierLedger.create({
          data: {
            supplierId: supplier.id,
            entryType: 'PURCHASE_CREDIT',
            amount: totalAmount,
            referenceTable: 'purchase_orders',
            referenceId: po.id,
            actorId,
          },
        });
      } else {
        // Immediate settlement (e.g. Petty cash / direct payment)
        await tx.supplierLedger.create({
          data: {
            supplierId: supplier.id,
            entryType: 'PAYMENT',
            amount: totalAmount,
            referenceTable: 'purchase_orders',
            referenceId: po.id,
            actorId,
          },
        });
      }

      return po;
    });
  },

  // ── Department Issue & Return ──────────────────────────────────────────
  /**
   * Requisition -> Issue stock -> Deduct StockLedger with department tag.
   * Allocates stock across batches using FEFO (earliest expiry first) with
   * FIFO tie-breaker. Negative stock is blocked (§4.8, D06 p.1).
   */
  async issueToDepartment(body: CreateDepartmentIssueBody, actorId: string) {
    assertUniqueItems(body.lines.map(line => line.stockItemId));
    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const department = await tx.department.findUnique({ where: { id: body.departmentId } });
      if (!department) throw new NotFoundError('Department not found');

      // Pre-allocate FEFO batches for each requested item
      const allocatedLines: Array<{
        stockItemId: string;
        allocations: InventoryBatchAllocation[];
      }> = [];

      for (const line of body.lines) {
        const requestedQty = new Decimal(line.quantity);
        const allocations = await allocateInventoryFefoBatches(line.stockItemId, requestedQty, tx);
        allocatedLines.push({
          stockItemId: line.stockItemId,
          allocations,
        });
      }

      // Flatten allocations into DepartmentRequisitionLines with batch & rate details
      const requisitionLinesData = allocatedLines.flatMap((al) =>
        al.allocations.map((alloc) => ({
          stockItemId: al.stockItemId,
          quantity: alloc.quantity,
          batchNo: alloc.batchNo,
          expiryDate: alloc.expiryDate,
          costRate: alloc.costRate,
        })),
      );

      // Create DepartmentRequisition
      const requisition = await tx.departmentRequisition.create({
        data: {
          departmentId: department.id,
          status: 'ISSUED',
          issuedById: actorId,
          receivedByName: body.receivedByName,
          lines: {
            create: requisitionLinesData,
          },
        },
        include: { lines: { include: { stockItem: true } } },
      });

      // Post -OUT movement for each allocated batch line to StockLedger
      for (const line of requisition.lines) {
        await tx.stockLedger.create({
          data: {
            stockItemId: line.stockItemId,
            movementType: 'DEPARTMENT_ISSUE',
            quantityDelta: line.quantity.negated(), // -OUT
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            referenceTable: 'department_requisitions',
            referenceId: requisition.id,
            actorId,
          },
        });
      }

      return requisition;
    });
  },

  /**
   * Department Return (inventory.md §4.2, §9 step 3) — brings unused/
   * returned stock back from a department against its original issue.
   * USABLE quantity is posted back to StockLedger as +IN; DAMAGED/EXPIRED
   * quantity is not (Quarantine/Adjustment routing is §9 step 5, not yet
   * built) but still counts against the line's `returnedQuantity` so a
   * department can never be credited for returning more than was issued.
   */
  async receiveDepartmentReturn(body: CreateDepartmentReturnBody, actorId: string) {
    assertUniqueItems(body.lines.map(line => line.departmentRequisitionLineId));
    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const requisition = await tx.departmentRequisition.findUnique({
        where: { id: body.departmentRequisitionId },
        include: { lines: true },
      });
      if (!requisition) throw new NotFoundError('Department requisition not found');
      if (requisition.status === 'CLOSED') {
        throw new ValidationError('This requisition has already been fully returned.');
      }

      const lineById = new Map(requisition.lines.map((l) => [l.id, l]));

      for (const returnLine of body.lines) {
        const line = lineById.get(returnLine.departmentRequisitionLineId);
        if (!line) {
          throw new NotFoundError(
            `Requisition line ${returnLine.departmentRequisitionLineId} not found on requisition ${requisition.id}`,
          );
        }

        const qty = new Decimal(returnLine.quantity);
        const remaining = line.quantity.minus(line.returnedQuantity);
        if (qty.greaterThan(remaining)) {
          throw new ValidationError(
            `Cannot return ${qty.toString()} — only ${remaining.toString()} still outstanding on this line ` +
              `(issued ${line.quantity.toString()}, already returned ${line.returnedQuantity.toString()}).`,
          );
        }

        await tx.departmentRequisitionLine.update({
          where: { id: line.id },
          data: { returnedQuantity: line.returnedQuantity.plus(qty) },
        });

        if (returnLine.condition === 'USABLE') {
          await tx.stockLedger.create({
            data: {
              stockItemId: line.stockItemId,
              movementType: 'DEPARTMENT_RETURN',
              quantityDelta: qty, // +IN
              batchNo: line.batchNo,
              expiryDate: line.expiryDate,
              referenceTable: 'department_requisition_lines',
              referenceId: line.id,
              actorId,
            },
          });
        }
        // DAMAGED/EXPIRED: intentionally no StockLedger entry — see doc
        // comment above.
      }

      const refreshedLines = await tx.departmentRequisitionLine.findMany({
        where: { departmentRequisitionId: requisition.id },
      });
      const allReturned = refreshedLines.every((l) => l.returnedQuantity.greaterThanOrEqualTo(l.quantity));
      const anyReturned = refreshedLines.some((l) => l.returnedQuantity.greaterThan(0));
      const nextStatus = allReturned ? 'CLOSED' : anyReturned ? 'PARTIALLY_RETURNED' : requisition.status;

      return tx.departmentRequisition.update({
        where: { id: requisition.id },
        data: { status: nextStatus },
        include: { lines: { include: { stockItem: true } }, department: true },
      });
    });
  },

  // ── Supplier Return ─────────────────────────────────────────────────────
  /**
   * Returns purchased stock to a supplier (inventory.md §5.2, §9 step 4).
   * Posts -OUT to StockLedger (negative stock blocked, same guard as
   * `issueToDepartment`), and a `RETURN` SupplierLedger entry that reduces
   * what's owed per §5's balance formula. `refundMethod: 'CASH_REFUND'`
   * additionally credits the acting user's own physical cash — otherwise
   * the money the hospital gets back would be invisible to their Balance
   * Sheet (PROJECT_MASTER_SPEC.md §4.8 Sub-flow C).
   */
  async returnToSupplier(body: CreateSupplierReturnBody, actorId: string) {
    assertUniqueItems(body.lines.map(line => line.stockItemId));
    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier || !supplier.isActive) {
        throw new NotFoundError('Supplier not found or inactive');
      }

      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id: body.purchaseOrderId } });
      if (!purchaseOrder || purchaseOrder.supplierId !== supplier.id) {
        throw new NotFoundError('Purchase order not found for this supplier');
      }

      let totalAmount = new Decimal(0);
      const validatedLines: Array<{ stockItemId: string; quantity: Decimal }> = [];

      for (const line of body.lines) {
        const item = await tx.stockItem.findUnique({
          where: { id: line.stockItemId },
          include: { stockLedgerEntries: { select: { quantityDelta: true } } },
        });
        if (!item || !item.isActive) {
          throw new NotFoundError(`Stock item ${line.stockItemId} not found or inactive`);
        }

        const currentStock = item.stockLedgerEntries.reduce(
          (sum, e) => sum.plus(e.quantityDelta),
          new Decimal(0),
        );
        const qty = new Decimal(line.quantity);
        if (currentStock.lessThan(qty)) {
          throw new ValidationError(
            `Insufficient stock for "${item.name}" (Available: ${currentStock.toString()} ${item.unit}, Returning: ${qty.toString()} ${item.unit}). Cannot drive stock negative.`,
          );
        }

        totalAmount = totalAmount.plus(qty.mul(new Decimal(line.rate)));
        validatedLines.push({ stockItemId: item.id, quantity: qty });
      }

      for (const line of validatedLines) {
        await tx.stockLedger.create({
          data: {
            stockItemId: line.stockItemId,
            movementType: 'SUPPLIER_RETURN',
            quantityDelta: line.quantity.negated(), // -OUT
            referenceTable: 'purchase_orders',
            referenceId: purchaseOrder.id,
            actorId,
          },
        });
      }

      await tx.supplierLedger.create({
        data: {
          supplierId: supplier.id,
          entryType: 'RETURN',
          amount: totalAmount,
          referenceTable: 'purchase_orders',
          referenceId: purchaseOrder.id,
          actorId,
        },
      });

      if (body.refundMethod === 'CASH_REFUND') {
        await tx.userCashBalance.create({
          data: {
            portalUserId: actorId,
            moduleScope: 'INVENTORY',
            direction: 'IN',
            amount: totalAmount,
            category: 'REFUND',
            isPhysicalCash: true,
          },
        });
      }

      return { supplierId: supplier.id, purchaseOrderId: purchaseOrder.id, totalAmount, refundMethod: body.refundMethod };
    });
  },

  // ── Adjustment ───────────────────────────────────────────────────────────
  /**
   * Damage/Expiry/Count Correction/Loss/Surplus/Quarantine (inventory.md
   * §4.2, §9 step 5). Records a `StockAdjustment` row and posts the matching
   * signed `StockLedger` entry (negative stock blocked on DECREASE, same
   * guard used everywhere else in this file).
   */
  async createAdjustment(body: CreateAdjustmentBody, actorId: string) {
    const fixedDirection = FIXED_ADJUSTMENT_DIRECTION[body.type];
    if (fixedDirection && fixedDirection !== body.direction) {
      throw new ValidationError(
        `Adjustment type ${body.type} must be a stock ${fixedDirection === 'INCREASE' ? 'increase' : 'decrease'}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      // All inventory stock mutations share this transaction-scoped lock.
      // The next request reads balances only after the prior transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hms-inventory-ledger'))`;
      const item = await tx.stockItem.findUnique({
        where: { id: body.stockItemId },
        include: { stockLedgerEntries: { select: { quantityDelta: true } } },
      });
      if (!item || !item.isActive) throw new NotFoundError('Stock item not found or inactive');

      const qty = new Decimal(body.quantity);
      if (body.direction === 'DECREASE') {
        const currentStock = item.stockLedgerEntries.reduce(
          (sum, e) => sum.plus(e.quantityDelta),
          new Decimal(0),
        );
        if (currentStock.lessThan(qty)) {
          throw new ValidationError(
            `Insufficient stock for "${item.name}" (Available: ${currentStock.toString()} ${item.unit}, Adjusting: ${qty.toString()} ${item.unit}). Cannot drive stock negative.`,
          );
        }
      }

      const adjustment = await tx.stockAdjustment.create({
        data: {
          stockItemId: item.id,
          batchNo: body.batchNo,
          type: body.type,
          quantity: qty,
          reason: body.reason,
          requiresApproval: body.requiresApproval,
          createdById: actorId,
        },
      });

      await tx.stockLedger.create({
        data: {
          stockItemId: item.id,
          movementType: body.direction === 'INCREASE' ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT',
          quantityDelta: body.direction === 'INCREASE' ? qty : qty.negated(),
          batchNo: body.batchNo,
          referenceTable: 'stock_adjustments',
          referenceId: adjustment.id,
          actorId,
        },
      });

      // inventory.md §5 "Add Approved Adjustment" — approved adjustment against
      // stock bought from a specific vendor also posts to that vendor's ledger,
      // valued off their most recent purchase rate for this item (previously
      // missing entirely: adjustments never touched SupplierLedger — §7.3 gap).
      if (body.supplierId) {
        const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
        if (!supplier || !supplier.isActive) throw new NotFoundError('Supplier not found or inactive');

        const lastPurchaseLine = await tx.purchaseOrderLine.findFirst({
          where: {
            stockItemId: item.id,
            ...(body.batchNo ? { batchNo: body.batchNo } : {}),
            purchaseOrder: { supplierId: body.supplierId },
          },
          orderBy: { purchaseOrder: { createdAt: 'desc' } },
        });
        if (!lastPurchaseLine) {
          throw new ValidationError(`No purchase history found for "${item.name}" from this supplier — cannot link adjustment to their ledger.`);
        }

        const signedAmount = qty.mul(lastPurchaseLine.rate).mul(body.direction === 'INCREASE' ? 1 : -1);
        await tx.supplierLedger.create({
          data: {
            supplierId: body.supplierId,
            entryType: 'ADJUSTMENT',
            amount: signedAmount,
            referenceTable: 'stock_adjustments',
            referenceId: adjustment.id,
            actorId,
          },
        });
      }

      return adjustment;
    });
  },

  /** Adjustment tab history — richer than the plain stock ledger (type + reason). */
  async listAdjustments() {
    return prisma.stockAdjustment.findMany({
      include: {
        stockItem: { select: { id: true, code: true, name: true, unit: true } },
        createdByUser: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  },
};
