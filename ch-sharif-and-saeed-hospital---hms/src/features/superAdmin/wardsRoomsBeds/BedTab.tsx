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
  Bed as BedIcon,
  PowerOff,
  Power,
  Filter,
  User,
  AlertTriangle,
  Clock,
  RefreshCw,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Bed, BedFilterState, Ward, Room } from '../../../types/wardsRoomsBeds';
import { VALID_BED_TYPES } from '../../../services/wardsRoomsBedsService';

interface BedTabProps {
  beds: Bed[];
  wards: Ward[];
  rooms: Room[];
  onAdd: () => void;
  onView: (bed: Bed) => void;
  onEdit: (bed: Bed) => void;
  onToggleOperational: (bed: Bed) => void;
  onDelete: (bed: Bed) => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

export const BedTab: React.FC<BedTabProps> = ({
  beds,
  wards,
  rooms,
  onAdd,
  onView,
  onEdit,
  onToggleOperational,
  onDelete,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  const [filters, setFilters] = useState<BedFilterState>({
    searchTerm: '',
    wardId: 'All',
    roomId: 'All',
    bedType: 'All',
    occupancyStatus: 'All',
    operationalStatus: 'All',
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const availableRoomsForFilter = useMemo(() => {
    if (filters.wardId === 'All') return rooms;
    return rooms.filter((r) => r.wardId === filters.wardId);
  }, [rooms, filters.wardId]);

  const filteredBeds = useMemo(() => {
    return beds.filter((b) => {
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        const mCode = b.code.toLowerCase().includes(q);
        const mNum = b.bedNumber.toLowerCase().includes(q);
        const mRoom = b.roomNumber.toLowerCase().includes(q);
        const mWard = b.wardName.toLowerCase().includes(q);
        const mPat = b.currentPatientName?.toLowerCase().includes(q) ?? false;
        const mMrn = b.currentPatientMrn?.toLowerCase().includes(q) ?? false;
        if (!mCode && !mNum && !mRoom && !mWard && !mPat && !mMrn) return false;
      }
      if (filters.wardId !== 'All' && b.wardId !== filters.wardId) return false;
      if (filters.roomId !== 'All' && b.roomId !== filters.roomId) return false;
      if (filters.bedType !== 'All' && b.bedType !== filters.bedType) return false;
      if (filters.occupancyStatus !== 'All' && b.occupancyStatus !== filters.occupancyStatus)
        return false;
      if (filters.operationalStatus !== 'All' && b.operationalStatus !== filters.operationalStatus)
        return false;
      return true;
    });
  }, [beds, filters]);

  const totalPages = Math.ceil(filteredBeds.length / pageSize) || 1;
  const paginatedBeds = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredBeds.slice(startIndex, startIndex + pageSize);
  }, [filteredBeds, currentPage, pageSize]);

  const isFiltered =
    filters.searchTerm.trim() !== '' ||
    filters.wardId !== 'All' ||
    filters.roomId !== 'All' ||
    filters.bedType !== 'All' ||
    filters.occupancyStatus !== 'All' ||
    filters.operationalStatus !== 'All';

  const resetFilters = () => {
    setFilters({
      searchTerm: '',
      wardId: 'All',
      roomId: 'All',
      bedType: 'All',
      occupancyStatus: 'All',
      operationalStatus: 'All',
    });
    setCurrentPage(1);
  };

  const getOccupancyBadge = (status: Bed['occupancyStatus']) => {
    switch (status) {
      case 'Available':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded-full border border-[#c2e7db]">
            <CheckCircle2 className="w-3 h-3 text-[#129b70]" />
            Available
          </span>
        );
      case 'Occupied':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
            <User className="w-3 h-3 text-indigo-600" />
            Occupied
          </span>
        );
      case 'Reserved':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            Reserved
          </span>
        );
      case 'Maintenance':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            Maintenance
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div id="bed-tab-content" className="space-y-4">
      {/* Search & Filter Bar (design.md §4.4) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="relative md:col-span-3">
            <Search className="w-4 h-4 text-[#8b9e95] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="bed-search-input"
              type="text"
              value={filters.searchTerm}
              onChange={(e) => {
                setFilters((p) => ({ ...p, searchTerm: e.target.value }));
                setCurrentPage(1);
              }}
              placeholder="Search bed, room, patient, MRN..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-[#c2e7db] rounded-lg text-[#111827] placeholder:text-[#8b9e95] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            />
          </div>

          {/* Ward */}
          <div className="md:col-span-2">
            <select
              id="bed-filter-ward"
              aria-label="Filter by ward"
              value={filters.wardId}
              onChange={(e) => {
                setFilters((p) => ({ ...p, wardId: e.target.value, roomId: 'All' }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-2.5 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All Wards</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Room */}
          <div className="md:col-span-2">
            <select
              id="bed-filter-room"
              aria-label="Filter by room"
              value={filters.roomId}
              onChange={(e) => {
                setFilters((p) => ({ ...p, roomId: e.target.value }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-2.5 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">All Rooms</option>
              {availableRoomsForFilter.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.roomNumber} - {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Bed Type */}
          <div className="md:col-span-1">
            <select
              id="bed-filter-type"
              aria-label="Filter by bed type"
              value={filters.bedType}
              onChange={(e) => {
                setFilters((p) => ({ ...p, bedType: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-1.5 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">Type: All</option>
              {VALID_BED_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Occupancy Status */}
          <div className="md:col-span-1">
            <select
              id="bed-filter-occupancy"
              aria-label="Filter by occupancy status"
              value={filters.occupancyStatus}
              onChange={(e) => {
                setFilters((p) => ({ ...p, occupancyStatus: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-1.5 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">Census</option>
              <option value="Available">Available</option>
              <option value="Occupied">Occupied</option>
              <option value="Reserved">Reserved</option>
              <option value="Maintenance">Maintenance</option>
            </select>
          </div>

          {/* Operational Status */}
          <div className="md:col-span-1">
            <select
              id="bed-filter-operational"
              aria-label="Filter by operational status"
              value={filters.operationalStatus}
              onChange={(e) => {
                setFilters((p) => ({ ...p, operationalStatus: e.target.value as any }));
                setCurrentPage(1);
              }}
              className="w-full text-xs py-2 px-1.5 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
            >
              <option value="All">Ops: All</option>
              <option value="Active">In Service</option>
              <option value="Out of Service">Out of Service</option>
              <option value="Decommissioned">Decom</option>
            </select>
          </div>

          {/* Action buttons */}
          <div className="md:col-span-2 flex items-center gap-2 justify-end">
            {isFiltered && (
              <button
                id="bed-reset-filters-btn"
                type="button"
                onClick={resetFilters}
                className="p-2 rounded-lg border border-[#e2eae5] text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition-colors shadow-2xs cursor-pointer"
                title="Reset filters"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            <button
              id="add-bed-btn"
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Bed</span>
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <strong className="text-[#111827] font-semibold">{filteredBeds.length}</strong> of{' '}
            {beds.length} configured beds
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
            <h2 className="text-[13px] font-bold text-white tracking-wide">Hospital Bed Capacity Registry</h2>
            <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
              {filteredBeds.length} {filteredBeds.length === 1 ? 'Bed' : 'Beds'}
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
                title="Print Beds"
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
            <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredBeds.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{filteredBeds.length}</span> beds
          </div>
          <div className="text-[11px] text-[#52665e]">
            Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
            <span className="font-bold text-[#111827]">{totalPages}</span>
          </div>
        </div>

        {/* Table Element */}
        <div className="overflow-x-auto">
          <table id="beds-master-table" className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold text-[11px] uppercase tracking-wider select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 w-12">#</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Bed Code</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Bed Number</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Room</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Ward</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Bed Type</th>
                <th className="py-2.5 px-3.5 text-center border-r border-[#c2e7db]/70">Occupancy Status</th>
                <th className="py-2.5 px-3.5 text-center border-r border-[#c2e7db]/70">Operational Status</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Current Admitted Patient</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-xs">
              {paginatedBeds.map((b, idx) => {
                const isOccupied = b.occupancyStatus === 'Occupied';
                const hasHistory = (b.historicalAdmissionCount ?? 0) > 0;
                const globalIndex = (currentPage - 1) * pageSize + idx + 1;

                return (
                  <tr
                    key={b.id}
                    id={`bed-row-${b.id}`}
                    className={`${
                      idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                  >
                    {/* Sequence # */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                      {globalIndex}
                    </td>

                    {/* Bed Code */}
                    <td className="py-2.5 px-3.5 font-mono font-bold text-[#08775A] whitespace-nowrap border-r border-[#e2eae5]">
                      {b.code}
                    </td>

                    {/* Bed Number */}
                    <td className="py-2.5 px-3.5 font-semibold text-[#111827] whitespace-nowrap border-r border-[#e2eae5]">
                      {b.bedNumber}
                    </td>

                    {/* Room */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      {b.roomId ? `${b.roomNumber} - ${b.roomName}` : <span className="text-[#8b9e95] italic">Direct Ward Bed</span>}
                    </td>

                    {/* Ward */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      {b.wardName || <span className="text-[#8b9e95] italic">Standalone</span>}
                    </td>

                    {/* Bed Type */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                        {b.bedType}
                      </span>
                    </td>

                    {/* Occupancy Status */}
                    <td className="py-2.5 px-3.5 text-center whitespace-nowrap border-r border-[#e2eae5]">
                      {getOccupancyBadge(b.occupancyStatus)}
                    </td>

                    {/* Operational Status */}
                    <td className="py-2.5 px-3.5 text-center whitespace-nowrap border-r border-[#e2eae5]">
                      {b.operationalStatus === 'Active' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#08775A] bg-[#effaf5] px-2.5 py-0.5 rounded-full border border-[#c2e7db]">
                          <CheckCircle2 className="w-3 h-3 text-[#129b70]" />
                          In Service
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          {b.operationalStatus}
                        </span>
                      )}
                    </td>

                    {/* Current Admitted Patient */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      {isOccupied && b.currentPatientName ? (
                        <span className="font-semibold text-indigo-900 whitespace-nowrap" title={`MRN: ${b.currentPatientMrn || 'N/A'} • Adm: ${b.admissionDate || 'N/A'}`}>
                          {b.currentPatientName} <span className="text-[10px] text-indigo-600 font-mono font-normal">({b.currentPatientMrn || 'N/A'})</span>
                        </span>
                      ) : (
                        <span className="text-[#8b9e95] italic text-xs">Vacant</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          id={`bed-view-btn-${b.id}`}
                          onClick={() => onView(b)}
                          title="View Bed Details"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`bed-edit-btn-${b.id}`}
                          onClick={() => onEdit(b)}
                          title="Edit Bed"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`bed-toggle-status-btn-${b.id}`}
                          onClick={() => onToggleOperational(b)}
                          disabled={isOccupied}
                          title={
                            isOccupied
                              ? 'Cannot take bed out of service: Bed is currently occupied by admitted patient.'
                              : b.operationalStatus === 'Active'
                              ? 'Take Bed Out of Service'
                              : 'Return Bed to Active Service'
                          }
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isOccupied
                              ? 'text-slate-300 cursor-not-allowed opacity-60'
                              : b.operationalStatus === 'Active'
                              ? 'text-[#52665e] hover:bg-amber-50 hover:text-amber-700'
                              : 'text-[#08775A] hover:bg-[#effaf5]'
                          }`}
                        >
                          {b.operationalStatus === 'Active' ? (
                            <PowerOff className="w-3.5 h-3.5" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          id={`bed-delete-btn-${b.id}`}
                          onClick={() => onDelete(b)}
                          disabled={isOccupied || hasHistory}
                          title={
                            isOccupied
                              ? 'Cannot delete: Bed is currently occupied.'
                              : hasHistory
                              ? 'Cannot delete: Bed has historical admissions. Decommission instead.'
                              : 'Delete Bed'
                          }
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isOccupied || hasHistory
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

              {paginatedBeds.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[#52665e]">
                    <BedIcon className="w-8 h-8 text-[#8b9e95] mx-auto mb-2 opacity-50" />
                    <span className="font-semibold text-xs text-[#111827] block">No Beds Found</span>
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
              <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredBeds.length)}</span> of{' '}
              <span className="font-semibold text-[#111827]">{filteredBeds.length}</span>
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
