import React, { useState, useMemo } from 'react';
import {
  Search,
  RotateCcw,
  Plus,
  Eye,
  Edit2,
  Trash2,
  Building,
  PowerOff,
  Power,
  RefreshCw,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Room, RoomFilterState, Ward } from '../../../types/wardsRoomsBeds';
import { VALID_ROOM_TYPES } from '../../../services/wardsRoomsBedsService';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface RoomTabProps {
  rooms: Room[];
  wards: Ward[];
  onAdd: () => void;
  onView: (room: Room) => void;
  onEdit: (room: Room) => void;
  onToggleStatus: (room: Room) => void;
  onDelete: (room: Room) => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

export const RoomTab: React.FC<RoomTabProps> = ({
  rooms,
  wards,
  onAdd,
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  const [filters, setFilters] = useState<RoomFilterState>({
    searchTerm: '',
    wardId: 'All',
    roomType: 'All',
    status: 'All',
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        const mCode = r.code.toLowerCase().includes(q);
        const mNum = r.roomNumber.toLowerCase().includes(q);
        const mName = r.name.toLowerCase().includes(q);
        const mWard = r.wardName.toLowerCase().includes(q);
        if (!mCode && !mNum && !mName && !mWard) return false;
      }
      if (filters.wardId === 'STANDALONE' && r.wardId) return false;
      else if (filters.wardId !== 'All' && filters.wardId !== 'STANDALONE' && r.wardId !== filters.wardId) return false;
      if (filters.roomType !== 'All' && r.roomType !== filters.roomType) return false;
      if (filters.status !== 'All' && r.status !== filters.status) return false;
      return true;
    });
  }, [rooms, filters]);

  const totalPages = Math.ceil(filteredRooms.length / pageSize) || 1;
  const paginatedRooms = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredRooms.slice(startIndex, startIndex + pageSize);
  }, [filteredRooms, currentPage, pageSize]);

  const isFiltered =
    filters.searchTerm.trim() !== '' ||
    filters.wardId !== 'All' ||
    filters.roomType !== 'All' ||
    filters.status !== 'All';

  const resetFilters = () => {
    setFilters({
      searchTerm: '',
      wardId: 'All',
      roomType: 'All',
      status: 'All',
    });
    setCurrentPage(1);
  };

  return (
    <div id="room-tab-content" className="space-y-4">
      {/* Search & Filter Bar (design.md §4.4) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="relative md:col-span-4">
            <Search className="w-4 h-4 text-[#8b9e95] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="room-search-input"
              type="text"
              value={filters.searchTerm}
              onChange={(e) => {
                setFilters((p) => ({ ...p, searchTerm: e.target.value }));
                setCurrentPage(1);
              }}
              placeholder="Search code, number, name, or ward..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-[#c2e7db] rounded-lg text-[#111827] placeholder:text-[#8b9e95] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            />
          </div>

          <div className="md:col-span-3">
            <select
              id="room-filter-ward"
              aria-label="Filter by ward"
              value={filters.wardId}
              onChange={(e) => {
                setFilters((p) => ({ ...p, wardId: e.target.value }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All Wards</option>
              <option value="STANDALONE">Standalone (No Ward)</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              id="room-filter-type"
              aria-label="Filter by room type"
              value={filters.roomType}
              onChange={(e) => {
                setFilters((p) => ({ ...p, roomType: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All Room Types</option>
              {VALID_ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <select
              id="room-filter-status"
              aria-label="Filter by status"
              value={filters.status}
              onChange={(e) => {
                setFilters((p) => ({ ...p, status: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-2 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="md:col-span-2 flex items-center gap-2 justify-end">
            {isFiltered && (
              <button
                id="room-reset-filters-btn"
                type="button"
                onClick={resetFilters}
                className="p-2 rounded-lg border border-[#e2eae5] text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition-colors shadow-2xs cursor-pointer"
                title="Reset filters"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            <button
              id="add-room-btn"
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Room</span>
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <strong className="text-[#111827] font-semibold">{filteredRooms.length}</strong> of{' '}
            {rooms.length} inpatient rooms
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
            <h2 className="text-[13px] font-bold text-white tracking-wide">Inpatient Rooms Inventory</h2>
            <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
              {filteredRooms.length} {filteredRooms.length === 1 ? 'Room' : 'Rooms'}
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
                title="Print Rooms"
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
            <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredRooms.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{filteredRooms.length}</span> rooms
          </div>
          <div className="text-[11px] text-[#52665e]">
            Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
            <span className="font-bold text-[#111827]">{totalPages}</span>
          </div>
        </div>

        {/* Table Element */}
        <div className="overflow-x-auto">
          <table id="rooms-master-table" className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold text-[11px] uppercase tracking-wider select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 w-12">#</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Room Code</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Room Number</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Room Name</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Ward</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Department</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Type</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Capacity</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Beds Configured</th>
                <th className="py-2.5 px-3.5 text-right border-r border-[#c2e7db]/70">Daily Rate (PKR)</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70">Status</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-xs">
              {paginatedRooms.map((r, idx) => {
                const hasBedsOrAdmissions =
                  (r.bedsConfigured ?? 0) > 0 || (r.admissionLinkageCount ?? 0) > 0;
                const globalIndex = (currentPage - 1) * pageSize + idx + 1;

                return (
                  <tr
                    key={r.id}
                    id={`room-row-${r.id}`}
                    className={`${
                      idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                  >
                    {/* Sequence # */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                      {globalIndex}
                    </td>

                    {/* Room Code */}
                    <td className="py-2.5 px-3.5 font-mono font-bold text-[#08775A] whitespace-nowrap border-r border-[#e2eae5]">
                      {r.code}
                    </td>

                    {/* Room Number */}
                    <td className="py-2.5 px-3.5 font-semibold text-[#111827] whitespace-nowrap border-r border-[#e2eae5]">
                      {r.roomNumber}
                    </td>

                    {/* Room Name */}
                    <td className="py-2.5 px-3.5 font-medium text-[#111827] whitespace-nowrap border-r border-[#e2eae5]">
                      {r.name}
                    </td>

                    {/* Ward */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      {r.wardName || <span className="text-[#8b9e95] italic">Standalone</span>}
                    </td>

                    {/* Department */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      {r.departmentName || '—'}
                    </td>

                    {/* Type */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                        {r.roomType}
                      </span>
                    </td>

                    {/* Capacity */}
                    <td className="py-2.5 px-3 text-center font-mono text-[#111827] border-r border-[#e2eae5] whitespace-nowrap">
                      {r.capacity}
                    </td>

                    {/* Beds Configured */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full font-mono font-bold text-xs ${
                          r.bedsConfigured > r.capacity
                            ? 'text-rose-700 bg-rose-50 border border-rose-200'
                            : 'text-[#111827] bg-[#f6faf8] border border-[#e2eae5]'
                        }`}
                      >
                        {r.bedsConfigured}
                      </span>
                    </td>

                    {/* Daily Rate */}
                    <td className="py-2.5 px-3.5 text-right font-bold text-[#08775A] whitespace-nowrap border-r border-[#e2eae5] font-mono tabular-nums">
                      PKR {(r.dailyRoomRate ?? 0).toLocaleString('en-PK')}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap border-r border-[#e2eae5]">
                      <StatusBadge status={r.status} size="sm" />
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          id={`room-view-btn-${r.id}`}
                          onClick={() => onView(r)}
                          title="View Room Details"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`room-edit-btn-${r.id}`}
                          onClick={() => onEdit(r)}
                          title="Edit Room"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`room-toggle-status-btn-${r.id}`}
                          onClick={() => onToggleStatus(r)}
                          title={r.status === 'Active' ? 'Deactivate Room' : 'Activate Room'}
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            r.status === 'Active'
                              ? 'text-[#52665e] hover:bg-amber-50 hover:text-amber-700'
                              : 'text-[#08775A] hover:bg-[#effaf5]'
                          }`}
                        >
                          {r.status === 'Active' ? (
                            <PowerOff className="w-3.5 h-3.5" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          id={`room-delete-btn-${r.id}`}
                          onClick={() => onDelete(r)}
                          title={
                            hasBedsOrAdmissions
                              ? `Cannot delete: contains ${r.bedsConfigured} bed(s)`
                              : 'Delete Room'
                          }
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            hasBedsOrAdmissions
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

              {paginatedRooms.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-[#52665e]">
                    <Building className="w-8 h-8 text-[#8b9e95] mx-auto mb-2 opacity-50" />
                    <span className="font-semibold text-xs text-[#111827] block">No Rooms Found</span>
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
              <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredRooms.length)}</span> of{' '}
              <span className="font-semibold text-[#111827]">{filteredRooms.length}</span>
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
