import React, { useState, useMemo } from 'react';
import {
  Search,
  RotateCcw,
  Plus,
  Eye,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  LayoutGrid,
  PowerOff,
  Power,
  RefreshCw,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Ward, WardFilterState } from '../../../types/wardsRoomsBeds';
import { Department } from '../../../types/department';
import { VALID_WARD_TYPES } from '../../../services/wardsRoomsBedsService';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface WardTabProps {
  wards: Ward[];
  departments: Department[];
  onAdd: () => void;
  onView: (ward: Ward) => void;
  onEdit: (ward: Ward) => void;
  onToggleStatus: (ward: Ward) => void;
  onDelete: (ward: Ward) => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

export const WardTab: React.FC<WardTabProps> = ({
  wards,
  departments,
  onAdd,
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  const [filters, setFilters] = useState<WardFilterState>({
    searchTerm: '',
    departmentId: 'All',
    wardType: 'All',
    status: 'All',
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredWards = useMemo(() => {
    return wards.filter((w) => {
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        const mCode = w.code.toLowerCase().includes(q);
        const mName = w.name.toLowerCase().includes(q);
        const mHead = (w.headStaffName || '').toLowerCase().includes(q);
        if (!mCode && !mName && !mHead) return false;
      }
      if (filters.wardType !== 'All' && w.wardType !== filters.wardType) return false;
      if (filters.status !== 'All' && w.status !== filters.status) return false;
      return true;
    });
  }, [wards, filters]);

  const totalPages = Math.ceil(filteredWards.length / pageSize) || 1;
  const paginatedWards = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredWards.slice(startIndex, startIndex + pageSize);
  }, [filteredWards, currentPage, pageSize]);

  const isFiltered =
    filters.searchTerm.trim() !== '' ||
    filters.wardType !== 'All' ||
    filters.status !== 'All';

  const resetFilters = () => {
    setFilters({
      searchTerm: '',
      departmentId: 'All',
      wardType: 'All',
      status: 'All',
    });
    setCurrentPage(1);
  };

  return (
    <div id="ward-tab-content" className="space-y-4">
      {/* Search & Filters (design.md §4.4) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="relative md:col-span-5">
            <Search className="w-4 h-4 text-[#8b9e95] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="ward-search-input"
              type="text"
              value={filters.searchTerm}
              onChange={(e) => {
                setFilters((p) => ({ ...p, searchTerm: e.target.value }));
                setCurrentPage(1);
              }}
              placeholder="Search ward code, name, in-charge..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-[#c2e7db] rounded-lg text-[#111827] placeholder:text-[#8b9e95] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            />
          </div>

          <div className="md:col-span-3">
            <select
              id="ward-filter-type"
              aria-label="Filter by ward type"
              value={filters.wardType}
              onChange={(e) => {
                setFilters((p) => ({ ...p, wardType: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All Ward Types</option>
              {VALID_WARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              id="ward-filter-status"
              aria-label="Filter by status"
              value={filters.status}
              onChange={(e) => {
                setFilters((p) => ({ ...p, status: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Active">Active Only</option>
              <option value="Inactive">Inactive Only</option>
            </select>
          </div>

          <div className="md:col-span-2 flex items-center gap-2 justify-end">
            {isFiltered && (
              <button
                id="ward-reset-filters-btn"
                type="button"
                onClick={resetFilters}
                className="p-2 rounded-lg border border-[#e2eae5] text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition-colors shadow-2xs cursor-pointer"
                title="Reset filters"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            <button
              id="add-ward-btn"
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Ward</span>
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <strong className="text-[#111827] font-semibold">{filteredWards.length}</strong> of{' '}
            {wards.length} inpatient wards
          </div>
          {isFiltered && (
            <span className="text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded text-[11px] font-semibold border border-[#c2e7db]">
              Filters Active
            </span>
          )}
        </div>
      </div>

      {/* Table Container (design.md §4.5) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] overflow-hidden shadow-2xs flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[13px] font-bold text-white tracking-wide">Inpatient Wards Directory</h2>
            <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
              {filteredWards.length} {filteredWards.length === 1 ? 'Ward' : 'Wards'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onExportExcel && (
              <button
                type="button"
                onClick={onExportExcel}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
                title="Export as Excel"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Excel</span>
              </button>
            )}
            {onExportPDF && (
              <button
                type="button"
                onClick={onExportPDF}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
                title="Export as PDF"
              >
                <FileDown className="h-3.5 w-3.5" />
                <span>PDF</span>
              </button>
            )}
            {onPrint && (
              <button
                type="button"
                onClick={onPrint}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
                title="Print Wards"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print</span>
              </button>
            )}
          </div>
        </div>

        {/* Sub-header row */}
        <div className="bg-[#f6faf8] border-b border-[#e2eae5] px-4 py-2 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <span className="font-semibold text-[#111827]">{(currentPage - 1) * pageSize + 1}</span>–
            <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredWards.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{filteredWards.length}</span> wards
          </div>
          <div className="text-[11px] text-[#52665e]">
            Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
            <span className="font-bold text-[#111827]">{totalPages}</span>
          </div>
        </div>

        {/* Table Element */}
        <div className="overflow-x-auto">
          <table id="wards-master-table" className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold text-[11px] uppercase tracking-wider select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 w-12">#</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Ward Code</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Ward Name</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Head / In-charge</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Fixed Fee (PKR)</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Ward Type</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Floor / Location</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Rooms</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Total Beds</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Available Beds</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Status</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-xs">
              {paginatedWards.map((w, idx) => {
                const hasLinkedRoomsOrBeds =
                  (w.roomCount ?? 0) > 0 ||
                  (w.bedCount ?? 0) > 0 ||
                  (w.historicalAdmissionCount ?? 0) > 0;
                const globalIndex = (currentPage - 1) * pageSize + idx + 1;

                return (
                  <tr
                    key={w.id}
                    id={`ward-row-${w.id}`}
                    className={`${
                      idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                  >
                    {/* Sequence # */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                      {globalIndex}
                    </td>

                    {/* Ward Code */}
                    <td className="py-2.5 px-3.5 font-mono font-bold text-[#08775A] whitespace-nowrap border-r border-[#e2eae5]">
                      {w.code}
                    </td>

                    {/* Ward Name */}
                    <td className="py-2.5 px-3.5 font-semibold text-[#111827] whitespace-nowrap border-r border-[#e2eae5]">
                      {w.name}
                      {w.genderPolicy && (
                        <span className="ml-1.5 text-[10px] text-[#52665e] font-normal">
                          ({w.genderPolicy})
                        </span>
                      )}
                    </td>

                    {/* Head / In-charge */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      {w.headStaffName ? (
                        <span className="font-medium text-[#111827]">{w.headStaffName}</span>
                      ) : (
                        <span className="text-[#8b9e95] italic text-[11px]">Not Assigned</span>
                      )}
                    </td>

                    {/* Fixed Fee */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5] font-mono">
                      {w.fixedPrice != null && w.fixedPrice > 0 ? (
                        <span className="font-bold text-[#08775A] tabular-nums">
                          PKR {w.fixedPrice.toLocaleString('en-PK')}
                        </span>
                      ) : (
                        <span className="text-[#8b9e95] text-[11px] italic">Free</span>
                      )}
                    </td>

                    {/* Ward Type */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                        {w.wardType}
                      </span>
                    </td>

                    {/* Floor / Location */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      {w.location ? `${w.floor || ''} - ${w.location}` : w.floor || '—'}
                    </td>

                    {/* Rooms */}
                    <td className="py-2.5 px-3 text-center font-mono font-semibold text-[#111827] border-r border-[#e2eae5] whitespace-nowrap">
                      {w.roomCount}
                    </td>

                    {/* Total Beds */}
                    <td className="py-2.5 px-3 text-center font-mono font-bold text-[#111827] border-r border-[#e2eae5] whitespace-nowrap">
                      {w.bedCount}
                    </td>

                    {/* Available Beds */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-full font-bold text-[#08775A] bg-[#effaf5] border border-[#c2e7db] text-xs font-mono">
                        {w.availableBeds ?? 0}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap border-r border-[#e2eae5]">
                      <StatusBadge status={w.status} size="sm" />
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          id={`ward-view-btn-${w.id}`}
                          onClick={() => onView(w)}
                          title="View Ward Details"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`ward-edit-btn-${w.id}`}
                          onClick={() => onEdit(w)}
                          title="Edit Ward"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`ward-toggle-status-btn-${w.id}`}
                          onClick={() => onToggleStatus(w)}
                          title={w.status === 'Active' ? 'Deactivate Ward' : 'Activate Ward'}
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            w.status === 'Active'
                              ? 'text-[#52665e] hover:bg-amber-50 hover:text-amber-700'
                              : 'text-[#08775A] hover:bg-[#effaf5]'
                          }`}
                        >
                          {w.status === 'Active' ? (
                            <PowerOff className="w-3.5 h-3.5" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          id={`ward-delete-btn-${w.id}`}
                          onClick={() => onDelete(w)}
                          title={
                            hasLinkedRoomsOrBeds
                              ? `Cannot delete: contains ${w.roomCount} room(s) and ${w.bedCount} bed(s)`
                              : 'Delete Ward'
                          }
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            hasLinkedRoomsOrBeds
                              ? 'text-slate-300 cursor-not-allowed opacity-60'
                              : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {paginatedWards.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-[#52665e]">
                    <LayoutGrid className="w-8 h-8 text-[#8b9e95] mx-auto mb-2 opacity-50" />
                    <span className="font-semibold text-xs text-[#111827] block">No Wards Found</span>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="mt-2 text-xs font-semibold text-[#08775A] hover:underline cursor-pointer"
                    >
                      Reset All Filters
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination (design.md §4.5) */}
        <div className="bg-[#f6faf8] border-t border-[#e2eae5] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#52665e]">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-lg border border-[#c2e7db] bg-white px-2.5 py-1 text-xs text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="ml-2">
              Showing <span className="font-semibold text-[#111827]">{(currentPage - 1) * pageSize + 1}</span>–
              <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredWards.length)}</span> of{' '}
              <span className="font-semibold text-[#111827]">{filteredWards.length}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              <span>Previous</span>
            </button>
            <span className="px-2 font-mono text-[11px] font-semibold text-[#111827]">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
