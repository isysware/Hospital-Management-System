import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import { cashService } from '@/modules/cash/cash.service';
import { settlementService } from '@/modules/cash/settlement.service';
import { getPositiveBatchBalances } from '@/shared/inventoryBatchBalances';
import type {
  InventorySummaryQuery,
  StockMovementReportQuery,
  PurchaseReportQuery,
  DepartmentIssueReturnReportQuery,
  SupplierReportQuery,
  InventoryExpenseReportQuery,
  StockStatusReportQuery,
  CashSettlementReportQuery,
} from './inventoryReports.schemas';

/**
 * Inventory Reporting Center (inventory.md §7/§8, §9 step 7) — one report
 * per PDF's 8-report list, each reading real posted source tables (no mock
 * rows), same convention as `frontdeskReportsService`.
 */

const userSummarySelect = { id: true, displayName: true, username: true } as const;

/** `preset: 'all'` → no date filter (full history); anything else resolves normally. */
function resolveRangeOrAll(query: { preset: string; fromDate?: string; toDate?: string }) {
  if (query.preset === 'all') return null;
  return resolveDateRange(query as Parameters<typeof resolveDateRange>[0]);
}

const ALL_TIME_PERIOD = { label: 'All Time', start: null as string | null, end: null as string | null };

export const inventoryReportsService = {
  /** Report 1 — Inventory Summary: stock, purchases, issues, returns, low stock, expiry, supplier due. */
  async getInventorySummary(query: InventorySummaryQuery) {
    const range = resolveRangeOrAll(query);
    const nearExpiryThreshold = new Date(Date.now() + query.nearExpiryDays * 24 * 60 * 60 * 1000);

    const [items, purchasesInRange, movementsInRange, supplierLedgerAll, nearExpiryBatches] = await Promise.all([
      prisma.stockItem.findMany({
        where: { isActive: true, ...(query.category ? { category: query.category } : {}) },
        include: { stockLedgerEntries: { select: { quantityDelta: true } }, purchaseOrderLines: { select: { rate: true }, take: 1, orderBy: { id: 'desc' } } },
      }),
      prisma.purchaseOrder.findMany({
        where: range ? { createdAt: { gte: range.start, lte: range.end } } : {},
        select: { totalAmount: true },
      }),
      prisma.stockLedger.findMany({
        where: range ? { createdAt: { gte: range.start, lte: range.end } } : {},
        select: { movementType: true },
      }),
      prisma.supplierLedger.findMany({ select: { entryType: true, amount: true } }).catch(() => []),
      getPositiveBatchBalances(nearExpiryThreshold),
    ]);

    let totalStockValue = new Decimal(0);
    let lowStockCount = 0;
    let outOfStockCount = 0;
    for (const item of items) {
      const currentStock = item.stockLedgerEntries.reduce((sum, e) => sum.plus(e.quantityDelta), new Decimal(0));
      const lastRate = item.purchaseOrderLines[0]?.rate ?? new Decimal(0);
      totalStockValue = totalStockValue.plus(currentStock.mul(lastRate));
      if (currentStock.lessThanOrEqualTo(0)) outOfStockCount += 1;
      else if (currentStock.lessThanOrEqualTo(item.reorderLevel)) lowStockCount += 1;
    }

    const issuesInRange = movementsInRange.filter((m) => m.movementType === 'DEPARTMENT_ISSUE').length;
    const stockInCount = movementsInRange.filter((m) => m.movementType === 'PURCHASE_RECEIPT').length;
    const returnsInRange = movementsInRange.filter(
      (m) => m.movementType === 'DEPARTMENT_RETURN' || m.movementType === 'SUPPLIER_RETURN',
    ).length;

    const supplierPayable = supplierLedgerAll.reduce(
      (acc, e) => {
        if (e.entryType === 'PURCHASE_CREDIT') return acc.plus(e.amount);
        if ((e.entryType as string) === 'ADJUSTMENT') return acc.plus(e.amount);
        return acc.minus(e.amount);
      },
      new Decimal(0),
    );

    return {
      period: range ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } : ALL_TIME_PERIOD,
      totalItems: items.length,
      // Approximated from each item's most recent purchase rate — this repo
      // has no persisted weighted-average/FIFO cost yet.
      totalStockValue,
      lowStockCount,
      outOfStockCount,
      nearExpiryCount: nearExpiryBatches.length,
      purchasesInRangeCount: purchasesInRange.length,
      purchasesInRangeAmount: purchasesInRange.reduce((s, p) => s.plus(p.totalAmount), new Decimal(0)),
      stockInCountInRange: stockInCount,
      issuesInRangeCount: issuesInRange,
      returnsInRangeCount: returnsInRange,
      supplierPayable,
    };
  },

  /** Report 2 — Stock Movement: every StockLedger entry in one ledger. */
  async getStockMovementReport(query: StockMovementReportQuery) {
    const range = resolveRangeOrAll(query);
    const where: Prisma.StockLedgerWhereInput = {
      ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.stockItemId ? { stockItemId: query.stockItemId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.category ? { stockItem: { category: query.category } } : {}),
    };

    const rows = await prisma.stockLedger.findMany({
      where,
      include: { stockItem: { select: { id: true, code: true, name: true, unit: true, category: true } }, actor: { select: userSummarySelect } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    return {
      period: range ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } : ALL_TIME_PERIOD,
      totalMovements: rows.length,
      rows,
    };
  },

  /** Report 3 — Purchase / Stock In: GRN/purchase details, supplier, totals, paid/due. */
  async getPurchaseReport(query: PurchaseReportQuery) {
    const range = resolveRangeOrAll(query);
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
    };

    const rows = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        createdByUser: { select: userSummarySelect },
        lines: {
          select: {
            stockItemId: true,
            quantity: true,
            rate: true,
            batchNo: true,
            expiryDate: true,
            stockItem: { select: { code: true, name: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const totalAmount = rows.reduce((s, r) => s.plus(r.totalAmount), new Decimal(0));
    const totalDue = rows.reduce((s, r) => (r.paymentMethod === 'CREDIT' ? s.plus(r.totalAmount) : s), new Decimal(0));

    return {
      period: range ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } : ALL_TIME_PERIOD,
      totalPurchases: rows.length,
      totalAmount,
      totalPaid: totalAmount.minus(totalDue),
      totalDue,
      rows,
    };
  },

  /** Report 4 — Department Issue & Return: issued, returned and net quantity per requisition. */
  async getDepartmentIssueReturnReport(query: DepartmentIssueReturnReportQuery) {
    const range = resolveRangeOrAll(query);
    const where: Prisma.DepartmentRequisitionWhereInput = {
      ...(range ? { issuedAt: { gte: range.start, lte: range.end } } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.issuedById ? { issuedById: query.issuedById } : {}),
    };

    const rows = await prisma.departmentRequisition.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        issuedBy: { select: userSummarySelect },
        lines: { include: { stockItem: { select: { id: true, code: true, name: true, unit: true } } } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });

    return {
      period: range ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } : ALL_TIME_PERIOD,
      totalRequisitions: rows.length,
      rows: rows.map((r) => ({
        id: r.id,
        department: r.department.name,
        status: r.status,
        issuedBy: r.issuedBy.displayName || r.issuedBy.username,
        issuedAt: r.issuedAt,
        receivedByName: r.receivedByName,
        lines: r.lines.map((l) => ({
          id: l.id,
          stockItemId: l.stockItemId,
          item: l.stockItem.name,
          unit: l.stockItem.unit,
          issuedQty: l.quantity,
          returnedQty: l.returnedQuantity,
          netQty: l.quantity.minus(l.returnedQuantity),
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          costRate: l.costRate,
        })),
      })),
    };
  },

  /** Report 5 — Supplier Report: ledger statement / outstanding per supplier. */
  async getSupplierReport(query: SupplierReportQuery) {
    const range = resolveRangeOrAll(query);
    const where: Prisma.SupplierLedgerWhereInput = {
      ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.transactionType ? { entryType: query.transactionType } : {}),
    };

    const rows = await prisma.supplierLedger.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } }, actor: { select: userSummarySelect } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const totalPurchaseCredit = rows.reduce((s, r) => (r.entryType === 'PURCHASE_CREDIT' ? s.plus(r.amount) : s), new Decimal(0));
    const totalPaymentsAndReturns = rows.reduce(
      (s, r) => (r.entryType !== 'PURCHASE_CREDIT' ? s.plus(r.amount) : s),
      new Decimal(0),
    );

    return {
      period: range ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } : ALL_TIME_PERIOD,
      totalEntries: rows.length,
      totalPurchaseCredit,
      totalPaymentsAndReturns,
      netMovement: totalPurchaseCredit.minus(totalPaymentsAndReturns),
      rows,
    };
  },

  /** Report 6 — Expense Report: Inventory Expenses by category/method/user. */
  async getInventoryExpenseReport(query: InventoryExpenseReportQuery) {
    const range = resolveRangeOrAll(query);
    const where: Prisma.InventoryExpenseWhereInput = {
      ...(range ? { expenseDate: { gte: range.start, lte: range.end } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
    };

    const rows = await prisma.inventoryExpense.findMany({
      where,
      include: { createdByUser: { select: userSummarySelect } },
      orderBy: { expenseDate: 'desc' },
      take: 1000,
    });

    return {
      period: range ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } : ALL_TIME_PERIOD,
      totalExpenses: rows.length,
      totalAmount: rows.reduce((s, r) => s.plus(r.amount), new Decimal(0)),
      rows,
    };
  },

  /** Report 7 — Stock Status: current stock, low/out-of-stock, batch/expiry. */
  async getStockStatusReport(query: StockStatusReportQuery) {
    const items = await prisma.stockItem.findMany({
      where: {
        isActive: true,
        ...(query.category ? { category: query.category } : {}),
        ...(query.stockItemId ? { id: query.stockItemId } : {}),
      },
      include: { stockLedgerEntries: { select: { quantityDelta: true } } },
      orderBy: { name: 'asc' },
    });

    const expiryThreshold = query.expiryWindowDays
      ? new Date(Date.now() + query.expiryWindowDays * 24 * 60 * 60 * 1000)
      : undefined;
    const batches = await getPositiveBatchBalances(expiryThreshold);
    const batchesByItem = new Map<string, typeof batches>();
    for (const b of batches) {
      const list = batchesByItem.get(b.stockItemId) ?? [];
      list.push(b);
      batchesByItem.set(b.stockItemId, list);
    }

    const rows = items
      .map((item) => {
        const currentStock = item.stockLedgerEntries.reduce((sum, e) => sum.plus(e.quantityDelta), new Decimal(0));
        const status: 'OUT' | 'LOW' | 'NORMAL' = currentStock.lessThanOrEqualTo(0)
          ? 'OUT'
          : currentStock.lessThanOrEqualTo(item.reorderLevel)
            ? 'LOW'
            : 'NORMAL';
        return {
          id: item.id,
          code: item.code,
          name: item.name,
          category: item.category,
          unit: item.unit,
          currentStock,
          reorderLevel: item.reorderLevel,
          status,
          batches: (batchesByItem.get(item.id) ?? []).map((b) => ({ batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: b.balance })),
        };
      })
      .filter((r) => !query.status || r.status === query.status);

    return { totalItems: rows.length, rows };
  },

  /** Report 8 — Cash & Settlement: the calling Inventory user's own Balance Sheet + Settlement history. */
  async getCashSettlementReport(portalUserId: string, query: CashSettlementReportQuery) {
    // Balance Sheet has no "all time" concept — 'all' falls back to 'shift'
    // (current unsettled custody); Settlement history supports 'all' natively.
    const balanceSheetPreset = query.preset === 'all' ? 'shift' : query.preset;
    const [balanceSheet, settlements] = await Promise.all([
      cashService.getCashierBalanceSheet(portalUserId, { preset: balanceSheetPreset, fromDate: query.fromDate, toDate: query.toDate }),
      settlementService.listMySettlements(portalUserId, {
        preset: query.preset,
        fromDate: query.fromDate,
        toDate: query.toDate,
        status: query.status,
      }),
    ]);

    return { balanceSheet, settlements };
  },
};
