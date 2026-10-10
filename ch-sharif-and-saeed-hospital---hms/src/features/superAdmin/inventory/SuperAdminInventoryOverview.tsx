import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Boxes,
  Search,
  Filter,
  RefreshCw,
  Plus,
  Truck,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Loader2,
  AlertTriangle,
  SlidersHorizontal,
  Package,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
} from 'lucide-react';
import {
  BackendStockItem,
  BackendSupplier,
  inventoryApiService,
} from '../../../services/inventoryApiService';
import { HospitalKpiHeader } from '../../../components/common/HospitalKpiHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';

export const SuperAdminInventoryOverview: React.FC = () => {
  const [items, setItems] = useState<BackendStockItem[]>([]);
  const [suppliers, setSuppliers] = useState<BackendSupplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStockStatus, setSelectedStockStatus] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [itemsData, suppliersData] = await Promise.all([
        inventoryApiService.getStockItems(),
        inventoryApiService.getSuppliers().catch(() => []),
      ]);
      setItems(itemsData);
      setSuppliers(suppliersData);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load central inventory items from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Extract unique categories from items
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => {
      if (it.category && it.category.trim()) {
        set.add(it.category.trim());
      }
    });
    return Array.from(set).sort();
  }, [items]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Category filter
      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
        return false;
      }

      // Stock status filter
      const currentQty = Number(item.currentStock) || 0;
      const reorderLvl = Number(item.reorderLevel) || 0;
      if (selectedStockStatus === 'LOW_STOCK' && !item.isLowStock && currentQty > reorderLvl) {
        return false;
      }
      if (selectedStockStatus === 'OUT_OF_STOCK' && currentQty > 0) {
        return false;
      }
      if (selectedStockStatus === 'IN_STOCK' && currentQty === 0) {
        return false;
      }
      if (selectedStockStatus === 'INACTIVE' && item.isActive) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesCode = item.code.toLowerCase().includes(q);
        const matchesLoc = (item.location || '').toLowerCase().includes(q);
        const matchesCat = (item.category || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesLoc && !matchesCat) {
          return false;
        }
      }

      return true;
    });
  }, [items, selectedCategory, selectedStockStatus, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedItems = useMemo(() => {
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [filteredItems, startIndex, pageSize]);

  // KPI Calculations
  const kpiStats = useMemo(() => {
    const totalItems = items.length;
    const lowStockCount = items.filter(
      (it) => it.isLowStock || (Number(it.currentStock) <= Number(it.reorderLevel) && Number(it.currentStock) > 0)
    ).length;
    const outOfStockCount = items.filter((it) => (Number(it.currentStock) || 0) <= 0).length;
    const activeSuppliersCount = suppliers.filter((s) => s.isActive).length;

    return {
      totalItems,
      lowStockCount,
      outOfStockCount,
      activeSuppliersCount,
    };
  }, [items, suppliers]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (filteredItems.length === 0) return;
    const headers = ['#', 'SKU Code', 'Item Name', 'Category', 'Unit', 'Location', 'Current Stock', 'Reorder Level', 'Stock Condition', 'Status'];
    const csvRows = filteredItems.map((it, idx) => {
      const currentQty = Number(it.currentStock) || 0;
      const reorderLvl = Number(it.reorderLevel) || 0;
      const condition = currentQty <= 0 ? 'Out of Stock' : it.isLowStock || currentQty <= reorderLvl ? 'Low Stock' : 'Optimal';
      return [
        idx + 1,
        `"${it.code}"`,
        `"${it.name.replace(/"/g, '""')}"`,
        `"${it.category || 'General'}"`,
        `"${it.unit}"`,
        `"${it.location || 'Central Store'}"`,
        currentQty,
        reorderLvl,
        `"${condition}"`,
        `"${it.isActive ? 'Active' : 'Inactive'}"`,
      ];
    });

    const csvContent = [headers.join(','), ...csvRows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `inventory_master_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
        <span>Loading central inventory catalog &amp; stock levels…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          type="button"
          onClick={loadData}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div id="super-admin-inventory-overview" className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Page Header Block (design.md §4.1) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#111827]">
              Central Inventory &amp; Stock Oversight
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#129b70]" />
              Warehouse Ledger Master
            </span>
          </div>
          <p className="text-xs text-[#52665e] max-w-2xl leading-relaxed">
            Consolidated overview of hospital medical supplies, consumables, pharmaceutical bulk items, reorder thresholds, and active vendor accounts.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Refresh Stock"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#08775A]" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Export CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            title="Print Stock Register"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* 2. Top-Border Inventory KPIs (design.md §4.2) */}
      <HospitalKpiHeader
        cards={[
          {
            title: 'Total Stock Items',
            value: kpiStats.totalItems,
            subtitle: 'Catalogued SKUs in database',
            icon: Boxes,
            accentColor: '#08775A',
            category: 'INVENTORY MASTER',
          },
          {
            title: 'Low Stock Warnings',
            value: kpiStats.lowStockCount,
            subtitle: 'At or below reorder level',
            icon: AlertTriangle,
            accentColor: '#d97706',
            category: 'RESTOCK REQUIRED',
          },
          {
            title: 'Out of Stock SKUs',
            value: kpiStats.outOfStockCount,
            subtitle: 'Zero quantity available',
            icon: ShieldAlert,
            accentColor: '#dc2626',
            category: 'CRITICAL VOID',
          },
          {
            title: 'Active Suppliers',
            value: kpiStats.activeSuppliersCount,
            subtitle: 'Contracted vendors & dealers',
            icon: Truck,
            accentColor: '#0284c7',
            category: 'SUPPLY CHAIN',
          },
        ]}
      />

      {/* 3. Filter Toolbar (design.md §4.4) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex-1 w-full sm:w-auto relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#52665e]/60" />
          <input
            type="text"
            placeholder="Search by SKU code, item description, category, or bin location..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-3 py-1.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg text-xs bg-white text-[#111827] placeholder-[#52665e]/60 focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Category Selector */}
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs py-1.5 px-2.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg bg-white text-[#111827] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value="ALL">All Categories ({categories.length})</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Stock Condition Selector */}
          <select
            value={selectedStockStatus}
            onChange={(e) => {
              setSelectedStockStatus(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs py-1.5 px-2.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg bg-white text-[#111827] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value="ALL">All Stock Levels</option>
            <option value="IN_STOCK">In Stock (Available)</option>
            <option value="LOW_STOCK">Low Stock (Restock Warning)</option>
            <option value="OUT_OF_STOCK">Out of Stock (Zero Balance)</option>
            <option value="INACTIVE">Deactivated Items</option>
          </select>

          {(searchQuery || selectedCategory !== 'ALL' || selectedStockStatus !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('ALL');
                setSelectedStockStatus('ALL');
                setCurrentPage(1);
              }}
              className="text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1.5 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* 4. Data Table (design.md §4.5) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-emerald-300" />
            <span className="font-semibold text-xs tracking-wide">
              Central Hospital Stock &amp; Warehouse Inventory Register
            </span>
          </div>
          <span className="text-[11px] text-emerald-200 font-mono">
            {filteredItems.length} SKU(s) matching
          </span>
        </div>

        {/* Sub-header row */}
        <div className="bg-[#f6faf8] border-b border-[#e2eae5] px-4 py-2 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <span className="font-semibold text-[#111827]">{filteredItems.length > 0 ? startIndex + 1 : 0}</span>–
            <span className="font-semibold text-[#111827]">{Math.min(startIndex + pageSize, filteredItems.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{filteredItems.length}</span> items
          </div>
          <div className="text-[11px] text-[#52665e]">
            Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
            <span className="font-bold text-[#111827]">{totalPages}</span>
          </div>
        </div>

        {/* Table Container */}
        <div className="overflow-x-auto min-h-[350px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold uppercase text-[11px] tracking-wider select-none sticky top-0 z-10">
                <th className="w-12 py-2.5 px-3 text-center border-r border-[#c2e7db]/70">#</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">SKU Code</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Item Description</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Category</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 whitespace-nowrap">UoM</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Store Location</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 text-right whitespace-nowrap">Current Stock</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 text-right whitespace-nowrap">Reorder Level</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 text-center whitespace-nowrap">Stock Condition</th>
                <th className="py-2.5 px-3 text-center whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-[#111827]">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[#8b9e95]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Package className="h-8 w-8 text-[#8b9e95]/40" />
                      <span className="font-semibold text-xs text-[#111827]">No inventory items found</span>
                      <span className="text-[11px] text-[#52665e]">Adjust search filters or verify central warehouse inventory catalog</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item, idx) => {
                  const globalIndex = startIndex + idx + 1;
                  const currentQty = Number(item.currentStock) || 0;
                  const reorderLvl = Number(item.reorderLevel) || 0;
                  const isOutOfStock = currentQty <= 0;
                  const isLow = !isOutOfStock && (item.isLowStock || currentQty <= reorderLvl);

                  return (
                    <tr
                      key={item.id}
                      className={`${
                        idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                      } hover:bg-[#e7f6f1]/40 transition-colors border-b border-[#e2eae5]`}
                    >
                      {/* # Index */}
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                        {globalIndex}
                      </td>

                      {/* SKU Code */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                        <span className="font-mono text-[11px] font-bold text-[#08775A] bg-[#effaf5] px-2.5 py-0.5 rounded border border-[#c2e7db]">
                          {item.code}
                        </span>
                      </td>

                      {/* Item Name */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap font-semibold text-[#111827]">
                        {item.name}
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap text-[#52665e]">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {item.category || 'General'}
                        </span>
                      </td>

                      {/* Unit */}
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] whitespace-nowrap font-mono text-xs text-[#52665e]">
                        {item.unit}
                      </td>

                      {/* Location */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap text-[#52665e]">
                        {item.location || 'Central Warehouse'}
                      </td>

                      {/* Current Stock */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] text-right whitespace-nowrap font-mono font-bold">
                        <span
                          className={`px-2 py-0.5 rounded ${
                            isOutOfStock
                              ? 'text-rose-700 bg-rose-50 border border-rose-200'
                              : isLow
                              ? 'text-amber-800 bg-amber-50 border border-amber-200'
                              : 'text-emerald-800 bg-emerald-50 border border-emerald-200'
                          }`}
                        >
                          {currentQty.toLocaleString()} {item.unit}
                        </span>
                      </td>

                      {/* Reorder Level */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] text-right whitespace-nowrap font-mono text-[#52665e]">
                        {reorderLvl.toLocaleString()} {item.unit}
                      </td>

                      {/* Stock Condition */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] text-center whitespace-nowrap">
                        {isOutOfStock ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            <ShieldAlert className="w-3 h-3 text-rose-600" />
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Low Stock Warning
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Optimal
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <StatusBadge status={item.isActive ? 'Active' : 'Inactive'} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer (design.md §4.5) */}
        <div className="bg-[#f6faf8] border-t border-[#e2eae5] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#52665e]">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="py-1 px-2 border border-[#c2e7db] rounded bg-white text-xs text-[#111827] focus:outline-hidden focus:border-[#08775A]"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-medium text-[#111827]">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 rounded border border-[#e2eae5] bg-white hover:bg-[#f6faf8] text-[#52665e] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1 rounded border border-[#e2eae5] bg-white hover:bg-[#f6faf8] text-[#52665e] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
