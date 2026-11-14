import apiClient from './apiClient';

export interface BackendSupplier {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
  terms?: string;
  isActive: boolean;
  outstandingBalance: string | number;
}

export interface BackendStockBatch {
  batchNo: string | null;
  expiryDate: string | null;
  costRate: string | number;
  available: string | number;
}

export interface BackendStockItem {
  id: string;
  code: string;
  name: string;
  category?: string;
  unit: string;
  location?: string;
  reorderLevel: string | number;
  currentStock: string | number;
  isLowStock: boolean;
  isActive: boolean;
  activeBatches?: BackendStockBatch[];
}

export const inventoryApiService = {
  // Suppliers
  async getSuppliers(search?: string) {
    const res = await apiClient.get<{ data: BackendSupplier[] }>('/inventory/suppliers', {
      params: { search },
    });
    return res.data.data;
  },

  async createSupplier(data: {
    name: string;
    contact?: string;
    phone?: string;
    address?: string;
    terms?: string;
  }) {
    const res = await apiClient.post<{ data: BackendSupplier }>('/inventory/suppliers', data);
    return res.data.data;
  },

  async updateSupplier(
    id: string,
    data: Partial<{ name: string; contact: string; phone: string; address: string; terms: string; isActive: boolean }>,
  ) {
    const res = await apiClient.patch<{ data: BackendSupplier }>(`/inventory/suppliers/${id}`, data);
    return res.data.data;
  },

  async getSupplierLedger(id: string) {
    const res = await apiClient.get<{ data: any }>(`/inventory/suppliers/${id}/ledger`);
    return res.data.data;
  },

  async deleteSupplier(id: string) {
    const res = await apiClient.delete<{ data: any }>(`/inventory/suppliers/${id}`);
    return res.data.data;
  },

  async paySupplier(id: string, data: { amount: number; paymentMethod: 'PETTY_CASH' | 'MANAGEMENT_DIRECT' | 'ONLINE'; reference?: string }) {
    const res = await apiClient.post<{ data: any }>(`/inventory/suppliers/${id}/payments`, data);
    return res.data.data;
  },

  // Stock Items
  async getStockItems(search?: string) {
    const res = await apiClient.get<{ data: BackendStockItem[] }>('/inventory/items', {
      params: { search },
    });
    return res.data.data;
  },

  async createStockItem(data: {
    code?: string;
    name: string;
    category?: string;
    unit: string;
    location?: string;
    reorderLevel?: number;
    supplierId?: string;
    initialQuantity?: number;
    unitCost?: number;
  }) {
    const res = await apiClient.post<{ data: BackendStockItem }>('/inventory/items', data);
    return res.data.data;
  },

  async updateStockItem(
    id: string,
    data: Partial<{ name: string; category: string; unit: string; location: string; reorderLevel: number; isActive: boolean }>,
  ) {
    const res = await apiClient.patch<{ data: BackendStockItem }>(`/inventory/items/${id}`, data);
    return res.data.data;
  },

  async deleteStockItem(id: string) {
    const res = await apiClient.delete<{ data: any }>(`/inventory/items/${id}`);
    return res.data.data;
  },

  async getItemLedger(id: string) {
    const res = await apiClient.get<{ data: any }>(`/inventory/items/${id}/ledger`);
    return res.data.data;
  },

  // Purchases (Stock In)
  async createPurchase(data: {
    supplierId: string;
    invoiceReference?: string;
    paymentMethod: 'PETTY_CASH' | 'MANAGEMENT_DIRECT' | 'ONLINE' | 'CREDIT';
    lines: Array<{
      stockItemId: string;
      quantity: number;
      rate: number;
      batchNo?: string;
      expiryDate?: string;
    }>;
  }) {
    const res = await apiClient.post<{ data: any }>('/inventory/purchases', data);
    return res.data.data;
  },

  // Department Issues
  async issueToDepartment(data: {
    departmentId: string;
    receivedByName?: string;
    lines: Array<{
      stockItemId: string;
      quantity: number;
    }>;
  }) {
    const res = await apiClient.post<{ data: any }>('/inventory/department-issues', data);
    return res.data.data;
  },

  // Department Returns
  async receiveDepartmentReturn(data: {
    departmentRequisitionId: string;
    returnedByName?: string;
    lines: Array<{
      departmentRequisitionLineId: string;
      quantity: number;
      condition: 'USABLE' | 'DAMAGED' | 'EXPIRED';
    }>;
  }) {
    const res = await apiClient.post<{ data: any }>('/inventory/department-returns', data);
    return res.data.data;
  },

  // Supplier Returns
  async returnToSupplier(data: {
    supplierId: string;
    purchaseOrderId: string;
    reason: string;
    refundMethod: 'SUPPLIER_CREDIT' | 'CASH_REFUND';
    lines: Array<{ stockItemId: string; quantity: number; rate: number }>;
  }) {
    const res = await apiClient.post<{ data: any }>('/inventory/supplier-returns', data);
    return res.data.data;
  },

  // Adjustments (Damage/Expiry/Count Correction/Loss/Surplus/Quarantine)
  async createAdjustment(data: {
    stockItemId: string;
    batchNo?: string;
    type: 'DAMAGE' | 'EXPIRY' | 'COUNT_CORRECTION' | 'LOSS' | 'SURPLUS' | 'QUARANTINE';
    direction: 'INCREASE' | 'DECREASE';
    quantity: number;
    reason: string;
    requiresApproval?: boolean;
    supplierId?: string;
  }) {
    const res = await apiClient.post<{ data: any }>('/inventory/adjustments', data);
    return res.data.data;
  },

  async listAdjustments() {
    const res = await apiClient.get<{ data: any[] }>('/inventory/adjustments');
    return res.data.data;
  },

  // Petty Cash Received (read-only — credited by Admin/Super Admin via fund-requests)
  async listPettyCash() {
    const res = await apiClient.get<{ data: any[] }>('/inventory/petty-cash');
    return res.data.data;
  },

  // Inventory Expenses
  async createInventoryExpense(data: {
    expenseDate?: string;
    category: string;
    amount: number;
    paymentMethod: 'CASH' | 'CARD' | 'BANK' | 'ONLINE';
    payee?: string;
    description?: string;
    reference?: string;
  }) {
    const res = await apiClient.post<{ data: any }>('/inventory/expenses', data);
    return res.data.data;
  },

  async listInventoryExpenses() {
    const res = await apiClient.get<{ data: any[] }>('/inventory/expenses');
    return res.data.data;
  },

  // My cash position — same generic `/cash/balance-sheet` Front Desk uses
  // (frontdeskApiService.getCashBalance), scope-resolved server-side from
  // the caller's own role (inventory.md §7.3, §9 step 2).
  async getCashBalance(period?: { preset?: string; fromDate?: string; toDate?: string }) {
    const res = await apiClient.get<{ data: any }>('/cash/balance-sheet', { params: period });
    return res.data.data;
  },

  // Dashboard KPIs (inventory.md §3, §9 step 10) — one call covers Total
  // Stock Value / Low Stock / Near Expiry / Supplier Payable (point-in-time)
  // plus Stock In / Department Issues for the given period.
  async getInventorySummary(params?: {
    preset?: string;
    fromDate?: string;
    toDate?: string;
    category?: string;
    nearExpiryDays?: number;
  }) {
    const res = await apiClient.get<{ data: any }>('/reports/inventory/summary', { params });
    return res.data.data;
  },
};
