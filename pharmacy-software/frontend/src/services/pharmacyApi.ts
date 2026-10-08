import { isCancel } from 'axios';
import apiClient from './apiClient';

/** medicine-packaging-plan — global reusable unit catalog (Box, Strip, Tablet, Vial, custom...). */
export interface Unit {
  id: string;
  name: string;
  shortCode: string | null;
  isSystem: boolean;
  isActive: boolean;
}


/** One packaging level for a medicine — level 0 is always the base unit (conversionToBase = 1). */
export interface PackagingLevel {
  id?: string;
  unitId: string;
  unit?: Unit;
  level: number;
  conversionToBase: string | number;
  isPurchaseUnit: boolean;
  isSaleUnit: boolean;
  overrideSaleRate?: string | number | null;
}

export interface MedicineRow {
  id: string;
  code: string;
  barcode?: string | null;
  name: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  /// Flat display name, sourced server-side from the category relation (falls back to the legacy label if the relation is somehow missing).
  category?: string | null;
  categoryId?: string | null;
  /// null when the medicine has no category at all; false when it has one that's since been deactivated (still displays, just not reselectable).
  categoryActive?: boolean | null;
  unit: string;
  baseUnitId?: string;
  baseUnit?: Unit | null;
  packagingLevels?: PackagingLevel[];
  batchManaged: boolean;
  reorderLevel: string | number;
  saleRate: string | number;
  taxPercent: string | number;
  isActive: boolean;
  currentStock: string | number;
  batchesCount: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  hasExpiredBatch: boolean;
  hasNearExpiryBatch: boolean;
}

export interface ManagementDashboard {
  salesToday: string | number;
  salesCountToday: number;
  purchasesToday: string | number;
  purchasesCountToday: number;
  totalRevenueAllTime?: string | number;
  totalSalesCountAllTime?: number;
  totalMedicines?: number;
  totalStockUnits?: number;
  currentStockValue: string | number;
  lowStockCount: number;
  outOfStockCount: number;
  nearExpiryCount: number;
  expiredCount: number;
  vendorPayable: string | number;
  pendingSettlements: number;
  pendingHmsRequests: number;
  expectedCash: string | number;
  monthlyTrend?: Array<{
    month: string;
    revenue: number;
    purchases: number;
    expenses: number;
    profit: number;
    orders: number;
  }>;
  dailyTrend?: Array<{
    date: string;
    fullDate?: string;
    revenue: number;
    purchases: number;
    expenses: number;
    profit: number;
    orders: number;
  }>;
  categoryDistribution?: Array<{
    category: string;
    count: number;
    stock: number;
    percentage: number;
  }>;
  inventoryOverview?: Array<{
    id: string;
    code: string;
    name: string;
    category: string;
    currentStock: number;
    reorderLevel: number;
    expiryDate: string | null;
    status: 'Healthy' | 'Low Stock' | 'Critical';
    batchNumber: string | null;
  }>;
  lowStockList?: Array<{
    id: string;
    name: string;
    currentStock: number;
    reorderLevel: number;
    unit?: string;
    isOutOfStock?: boolean;
  }>;
  nearExpiryList?: Array<{
    id: string;
    name: string;
    batchNumber: string;
    expiryDate: string;
    daysLeft: number;
    quantityRemaining?: number;
  }>;
  supplierUpdates?: Array<{
    id: string;
    name: string;
    code?: string;
    status: string;
    phone: string;
    paymentTerms?: string;
    openOrdersCount?: number;
    balance?: number;
  }>;
  openPurchaseOrdersCount?: number;
  smartInsights?: Array<{
    id: string;
    title: string;
    message: string;
    type: string;
  }>;
}

export interface SalesDashboard {
  mySalesToday: string | number;
  mySalesCountToday: number;
  cashCollectionToday: string | number;
  cardOnlineCollectionToday: string | number;
  pendingHmsRequests: number;
  expectedCash: string | number;
}

export interface PharmacySettings {
  id: string;
  highValueApprovalEnabled: boolean;
  highValueThreshold: string | number;
  defaultTaxPercent: string | number;
  maxDiscountPercent: string | number;
  nearExpiryWindowDays: number;
  receiptHeaderText: string | null;
  receiptFooterText: string | null;
  /// purchase-costing-plan — global fallback markup when a medicine's category has no MarkupRule.
  defaultMarkupPercent: string | number;
  updatedAt: string;
}

/** purchase-costing-plan — category-wise markup override (falls back to PharmacySettings.defaultMarkupPercent). */
export interface MarkupRule {
  id: string;
  category: string;
  markupPercent: string | number;
  isActive: boolean;
}

/** Add-Medicine-form fix — database-driven Therapeutic Category master (Settings -> Medicine Categories). */
export interface MedicineCategory {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const pharmacyApi = {
  getManagementDashboard: () => apiClient.get<{ data: ManagementDashboard }>('/dashboard/management').then((r) => r.data.data),
  getSalesDashboard: () => apiClient.get<{ data: SalesDashboard }>('/dashboard/sales').then((r) => r.data.data),

  listMedicines: (search?: string) => apiClient.get<{ data: MedicineRow[] }>('/pharmacy/medicines', { params: { search } }).then((r) => r.data.data),
  /** Preview only (not reserved) — the actual code is decided server-side at create time. */
  getNextMedicineCode: () => apiClient.get<{ data: { code: string } }>('/pharmacy/medicines/next-code').then((r) => r.data.data.code),
  createMedicine: (body: Record<string, unknown>) => apiClient.post('/pharmacy/medicines', body).then((r) => r.data.data),
  updateMedicine: (id: string, body: Record<string, unknown>) => apiClient.patch(`/pharmacy/medicines/${id}`, body).then((r) => r.data.data),
  getMedicineBatches: (id: string) => apiClient.get<{ data: any[] }>(`/pharmacy/medicines/${id}/batches`).then((r) => r.data.data),
  getMedicinePackaging: (id: string) => apiClient.get<{ data: { medicineId: string; baseUnitId: string; levels: PackagingLevel[] } }>(`/pharmacy/medicines/${id}/packaging`).then((r) => r.data.data),

  // Units (medicine-packaging-plan)
  listUnits: () => apiClient.get<{ data: Unit[] }>('/units').then((r) => r.data.data),
  createUnit: (body: { name: string; shortCode?: string }) => apiClient.post<{ data: Unit }>('/units', body).then((r) => r.data.data),

  listVendors: (search?: string) => apiClient.get('/vendors', { params: { search } }).then((r) => r.data.data),
  /** Preview only (not reserved) — the actual code is decided server-side at create time. */
  getNextVendorCode: () => apiClient.get<{ data: { code: string } }>('/vendors/next-code').then((r) => r.data.data.code),
  createVendor: (body: Record<string, unknown>) => apiClient.post('/vendors', body).then((r) => r.data.data),
  /** Preview only (not reserved) — the actual purchase number ("PO-0001…") is decided server-side at create/post time. */
  getNextPurchaseCode: () => apiClient.get<{ data: { code: string } }>('/vendors/purchases/next-code').then((r) => r.data.data.code),

  // Purchase Orders — the procurement reminder screen (what we want to order).
  // Zero stock/cost/ledger impact; distinct from the Purchase/Stock-In above
  // (what we actually received).
  listPurchaseOrders: (status?: 'OPEN' | 'CONVERTED' | 'CANCELLED') =>
    apiClient.get('/purchase-orders', { params: { status } }).then((r) => r.data.data),
  getPurchaseOrder: (id: string) => apiClient.get(`/purchase-orders/${id}`).then((r) => r.data.data),
  /** Preview only (not reserved) — the actual order number ("PREQ-0001…") is decided server-side at create time. */
  getNextPurchaseOrderCode: () => apiClient.get<{ data: { code: string } }>('/purchase-orders/next-code').then((r) => r.data.data.code),
  createPurchaseOrder: (body: Record<string, unknown>) => apiClient.post('/purchase-orders', body).then((r) => r.data.data),
  cancelPurchaseOrder: (id: string) => apiClient.post(`/purchase-orders/${id}/cancel`).then((r) => r.data.data),
  markPurchaseOrderConverted: (id: string) => apiClient.post(`/purchase-orders/${id}/mark-converted`).then((r) => r.data.data),

  listInvoices: () => apiClient.get('/pharmacy/invoices').then((r) => r.data.data),
  getInvoiceById: (id: string) => apiClient.get(`/pharmacy/invoices/${id}`).then((r) => r.data.data),
  dispenseRetail: (body: Record<string, unknown>) => apiClient.post('/pharmacy/dispense', body).then((r) => r.data.data),
  salesReturn: (body: Record<string, unknown>) => apiClient.post('/pharmacy/sales-returns', body).then((r) => r.data.data),

  getBalanceSheet: () => apiClient.get('/cash/balance-sheet').then((r) => r.data.data),
  listSettlements: () => apiClient.get('/cash/settlements').then((r) => r.data.data),
  submitSettlement: (body: Record<string, unknown>) => apiClient.post('/cash/settlements', body).then((r) => r.data.data),

  listExpenses: () => apiClient.get('/expenses').then((r) => r.data.data),
  createExpense: (body: Record<string, unknown>) => apiClient.post('/expenses', body).then((r) => r.data.data),

  listUsers: () => apiClient.get('/users').then((r) => r.data.data),
  createUser: (body: Record<string, unknown>) => apiClient.post('/users', body).then((r) => r.data.data),

  // HMS Requests (pharmacy.md §7)
  getHmsSettings: () => apiClient.get('/hms-requests/settings').then((r) => r.data.data),
  updateHmsSettings: (body: Record<string, unknown>) => apiClient.put('/hms-requests/settings', body).then((r) => r.data.data),
  listHmsRequests: (status?: string) => apiClient.get('/hms-requests', { params: { status } }).then((r) => r.data.data),
  createHmsRequest: (body: Record<string, unknown>) => apiClient.post('/hms-requests', body).then((r) => r.data.data),
  approveHmsRequest: (id: string) => apiClient.post(`/hms-requests/${id}/approve`).then((r) => r.data.data),
  rejectHmsRequest: (id: string, reason: string) => apiClient.post(`/hms-requests/${id}/reject`, { reason }).then((r) => r.data.data),
  fulfillHmsRequest: (id: string, lines: { requestLineId: string; dispenseQuantity: number }[]) =>
    apiClient.post(`/hms-requests/${id}/fulfill`, { lines }).then((r) => r.data.data),

  // HMS Receivables & Settlement Requests — money HMS collected from the
  // patient on Pharmacy's behalf (admission-linked dispenses) that Pharmacy
  // still needs HMS to hand back. Request only; release happens on the HMS
  // side (Super Admin / Admin) and arrives here via `settlementReleaseCallback`.
  listHmsReceivables: () => apiClient.get('/hms-requests/receivables/list').then((r) => r.data.data),
  requestHmsSettlement: (body: { invoiceNumber: string; amountRequested: number; remarks?: string }) =>
    apiClient.post('/hms-requests/settlements/request', body).then((r) => r.data.data),

  // Settings (pharmacy.md §3)
  getPharmacySettings: () => apiClient.get<{ data: PharmacySettings }>('/settings').then((r) => r.data.data),
  updatePharmacySettings: (body: Partial<PharmacySettings>) => apiClient.put<{ data: PharmacySettings }>('/settings', body).then((r) => r.data.data),

  // Markup Rules (purchase-costing-plan)
  listMarkupRules: () => apiClient.get<{ data: MarkupRule[] }>('/settings/markup-rules').then((r) => r.data.data),
  upsertMarkupRule: (body: { category: string; markupPercent: number; isActive?: boolean }) =>
    apiClient.put<{ data: MarkupRule }>('/settings/markup-rules', body).then((r) => r.data.data),
  deleteMarkupRule: (category: string) => apiClient.delete(`/settings/markup-rules/${encodeURIComponent(category)}`),

  // Medicine Categories (Add-Medicine-form fix) — database-driven Therapeutic Category master.
  listMedicineCategories: () => apiClient.get<{ data: MedicineCategory[] }>('/settings/medicine-categories').then((r) => r.data.data),
  createMedicineCategory: (body: { name: string; description?: string }) =>
    apiClient.post<{ data: MedicineCategory }>('/settings/medicine-categories', body).then((r) => r.data.data),
  updateMedicineCategory: (id: string, body: { name?: string; description?: string; isActive?: boolean }) =>
    apiClient.patch<{ data: MedicineCategory }>(`/settings/medicine-categories/${id}`, body).then((r) => r.data.data),

  // Purchases (purchase-costing-plan)
  postDraftPurchase: (id: string) => apiClient.post(`/vendors/purchases/${id}/post`).then((r) => r.data.data),

  // Testing Reset
  resetTestingData: (body: { scope: 'transactions_only' | 'complete'; confirmPhrase: 'RESET' }) =>
    apiClient.post<{ data: { scope: string; cleared: Record<string, number> } }>('/settings/reset-data', body).then((r) => r.data.data),
};
