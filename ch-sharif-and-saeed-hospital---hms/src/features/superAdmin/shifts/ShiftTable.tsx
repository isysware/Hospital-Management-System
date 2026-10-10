import React, { useState, useMemo } from 'react';
import {
  Eye,
  Edit2,
  Copy,
  Power,
  RotateCcw,
  Clock,
  Plus,
  Moon,
  Sun,
  Sunrise,
  Sparkles,
  SearchX,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Shift, ShiftType } from '../../../types/shift';
import {
  format12HourTime,
  formatMinutesToHours,
} from '../../../services/shiftService';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface ShiftTableProps {
  shifts: Shift[];
  totalCount: number;
  onView: (shift: Shift) => void;
  onEdit: (shift: Shift) => void;
  onDuplicate: (shift: Shift) => void;
  onToggleStatus: (shift: Shift) => void;
  onAddNew: () => void;
  onClearFilters: () => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

const renderShiftTypeBadge = (type: ShiftType) => {
  switch (type) {
    case 'MORNING':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
          <Sunrise className="h-2.5 w-2.5" />
          Morning
        </span>
      );
    case 'EVENING':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <Sun className="h-2.5 w-2.5" />
          Evening
        </span>
      );
    case 'NIGHT':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
          <Moon className="h-2.5 w-2.5" />
          Night
        </span>
      );
    case 'CUSTOM':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
          <Sparkles className="h-2.5 w-2.5" />
          Custom
        </span>
      );
  }
};

export const ShiftTable: React.FC<ShiftTableProps> = ({
  shifts,
  totalCount,
  onView,
  onEdit,
  onDuplicate,
  onToggleStatus,
  onAddNew,
  onClearFilters,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(shifts.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedShifts = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return shifts.slice(start, start + pageSize);
  }, [shifts, safePage, pageSize]);

  // 1. Completely Empty Dataset
  if (totalCount === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e2eae5] p-12 text-center shadow-xs">
        <div className="h-14 w-14 rounded-full bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center mx-auto mb-4">
          <Clock className="h-7 w-7" />
        </div>
        <h3 className="text-base font-bold text-[#123e2b]">
          No Duty Shifts Configured
        </h3>
        <p className="text-xs text-[#52665e] max-w-md mx-auto mt-1.5 leading-relaxed">
          The hospital operates 24/7. Configure departmental master duty shifts
          with customizable working hours, arrival tolerances, and weekly off schedules.
        </p>

        <button
          type="button"
          onClick={onAddNew}
          className="mt-4 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Create First Shift</span>
        </button>
      </div>
    );
  }

  // 2. Filter Result Empty
  if (shifts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e2eae5] p-10 text-center shadow-xs">
        <SearchX className="h-10 w-10 text-[#52665e]/60 mx-auto mb-3" />
        <h4 className="text-sm font-bold text-[#123e2b]">
          No matching shifts found
        </h4>
        <p className="text-xs text-[#52665e] mt-1 max-w-sm mx-auto">
          No configured shifts match your active search and filter combinations.
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 px-3 py-1.5 text-xs font-semibold text-[#08775A] bg-[#effaf5] hover:bg-[#d8f3e7] border border-[#c2e7db] rounded-lg transition-colors cursor-pointer"
        >
          Clear Active Filters
        </button>
      </div>
    );
  }

  // 3. Regular Table View
  return (
    <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
      {/* Dark Emerald Header Strip */}
      <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Clock className="h-4 w-4 text-[#c2e7db]" />
          <span className="font-semibold text-xs tracking-wide">
            Master Duty Shifts Registry
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
            {shifts.length} {shifts.length === 1 ? 'Shift' : 'Shifts'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onExportExcel && (
            <button
              onClick={onExportExcel}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#effaf5] hover:text-white bg-white/10 hover:bg-white/20 rounded-md transition-colors border border-white/10 cursor-pointer"
              title="Export to Excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#c2e7db]" />
              <span className="hidden sm:inline">Excel</span>
            </button>
          )}
          {onExportPDF && (
            <button
              onClick={onExportPDF}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#effaf5] hover:text-white bg-white/10 hover:bg-white/20 rounded-md transition-colors border border-white/10 cursor-pointer"
              title="Export to PDF"
            >
              <FileDown className="h-3.5 w-3.5 text-[#c2e7db]" />
              <span className="hidden sm:inline">PDF</span>
            </button>
          )}
          {onPrint && (
            <button
              onClick={onPrint}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#effaf5] hover:text-white bg-white/10 hover:bg-white/20 rounded-md transition-colors border border-white/10 cursor-pointer"
              title="Print Register"
            >
              <Printer className="h-3.5 w-3.5 text-[#c2e7db]" />
              <span className="hidden sm:inline">Print</span>
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
              <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60">Shift Code</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60">Shift Name</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60">Department</th>
              <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Type</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60">Timing</th>
              <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Net Hours</th>
              <th className="py-2.5 px-2.5 border-r border-[#c2e7db]/60">Break</th>
              <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Default Grace</th>
              <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Weekly Off</th>
              <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Status</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60">Updated By</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60">Updated Date</th>
              <th className="py-2.5 px-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e2eae5] text-slate-700">
            {paginatedShifts.map((shift, idx) => {
              const rowNumber = (safePage - 1) * pageSize + idx + 1;
              const isEven = idx % 2 === 0;
              return (
                <tr
                  key={shift.id}
                  className={`transition-colors ${
                    isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                  } hover:bg-[#e7f6f1]/40 border-b border-[#e2eae5]`}
                >
                  {/* 0. Index # */}
                  <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20 whitespace-nowrap">
                    {rowNumber}
                  </td>

                  {/* 1. Shift Code */}
                  <td className="py-2.5 px-3.5 font-mono font-bold text-[#123e2b] whitespace-nowrap border-r border-[#e2eae5]">
                    {shift.code}
                  </td>

                  {/* 2. Shift Name */}
                  <td className="py-2.5 px-3.5 font-semibold text-[#111827] whitespace-nowrap border-r border-[#e2eae5]">
                    {shift.name}
                  </td>

                  {/* 3. Department */}
                  <td className="py-2.5 px-3.5 text-slate-700 whitespace-nowrap border-r border-[#e2eae5]">
                    <span className="font-medium">{shift.departmentName}</span>
                  </td>

                  {/* 4. Type */}
                  <td className="py-2.5 px-3 whitespace-nowrap border-r border-[#e2eae5]">
                    {renderShiftTypeBadge(shift.shiftType)}
                  </td>

                  {/* 5. Timing */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                    <div className="font-medium text-[#111827] flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px]">
                      <span>{format12HourTime(shift.startTime)}</span>
                      <span className="text-slate-400">–</span>
                      <span>{format12HourTime(shift.endTime)}</span>
                      {shift.isOvernight && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 font-sans">
                          <Moon className="h-2.5 w-2.5" />
                          Overnight
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 6. Net Working Hours */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-bold text-[#08775A] border-r border-[#e2eae5] font-mono">
                    {formatMinutesToHours(shift.netWorkingMinutes)}
                  </td>

                  {/* 7. Break */}
                  <td className="py-2.5 px-2.5 whitespace-nowrap text-[#52665e] border-r border-[#e2eae5] font-mono">
                    {shift.breakMinutes > 0 ? `${shift.breakMinutes}m` : '0m'}
                  </td>

                  {/* 8. Default Grace */}
                  <td className="py-2.5 px-3 whitespace-nowrap text-[#52665e] text-[11px] border-r border-[#e2eae5] font-mono">
                    <span>{shift.defaultArrivalGraceMinutes}m in / {shift.defaultEarlyExitToleranceMinutes}m out</span>
                  </td>

                  {/* 9. Weekly Off */}
                  <td className="py-2.5 px-3 whitespace-nowrap text-[11px] text-[#52665e] border-r border-[#e2eae5]">
                    {shift.defaultWeeklyOffDays && shift.defaultWeeklyOffDays.length > 0 ? (
                      <span
                        title={shift.defaultWeeklyOffDays.join(', ')}
                        className="inline-block max-w-[130px] truncate"
                      >
                        {shift.defaultWeeklyOffDays.join(', ')}
                      </span>
                    ) : (
                      <span className="text-slate-400">None (24/7)</span>
                    )}
                  </td>

                  {/* 10. Status */}
                  <td className="py-2.5 px-3 whitespace-nowrap border-r border-[#e2eae5]">
                    <StatusBadge status={shift.status} />
                  </td>

                  {/* 11. Updated By */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-700 font-medium border-r border-[#e2eae5] max-w-[130px] truncate" title={shift.updatedByName}>
                    {shift.updatedByName || '—'}
                  </td>

                  {/* 12. Updated Date */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap text-[11px] text-[#52665e] border-r border-[#e2eae5] font-mono">
                    {shift.updatedAt || '—'}
                  </td>

                  {/* 13. Actions */}
                  <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {/* View Details */}
                      <button
                        type="button"
                        onClick={() => onView(shift)}
                        className="p-1 hover:bg-[#effaf5] text-[#52665e] hover:text-[#08775A] rounded-md transition-colors cursor-pointer"
                        title="View Shift Details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>

                      {/* Edit */}
                      <button
                        type="button"
                        onClick={() => onEdit(shift)}
                        className="p-1 hover:bg-[#effaf5] text-[#52665e] hover:text-blue-600 rounded-md transition-colors cursor-pointer"
                        title="Edit Shift"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>

                      {/* Duplicate */}
                      <button
                        type="button"
                        onClick={() => onDuplicate(shift)}
                        className="p-1 hover:bg-[#effaf5] text-[#52665e] hover:text-amber-600 rounded-md transition-colors cursor-pointer"
                        title="Duplicate Shift"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>

                      {/* Toggle Status */}
                      <button
                        type="button"
                        onClick={() => onToggleStatus(shift)}
                        className={`p-1 hover:bg-[#effaf5] rounded-md transition-colors cursor-pointer ${
                          shift.status === 'ACTIVE'
                            ? 'text-slate-400 hover:text-rose-600'
                            : 'text-slate-400 hover:text-emerald-600'
                        }`}
                        title={shift.status === 'ACTIVE' ? 'Deactivate Shift' : 'Reactivate Shift'}
                      >
                        {shift.status === 'ACTIVE' ? (
                          <Power className="h-3.5 w-3.5" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-2.5 bg-[#fbfdfc] border-t border-[#e2eae5] flex flex-wrap items-center justify-between gap-3 text-xs text-[#52665e]">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="px-2 py-0.5 border border-[#c2e7db] rounded bg-white text-xs text-[#123e2b] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span className="text-[#52665e] ml-2">
            Showing <strong className="text-[#123e2b]">{(safePage - 1) * pageSize + 1}</strong> to{' '}
            <strong className="text-[#123e2b]">{Math.min(safePage * pageSize, shifts.length)}</strong> of{' '}
            <strong className="text-[#123e2b]">{shifts.length}</strong> shifts
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="p-1 rounded border border-[#c2e7db] bg-white text-[#52665e] hover:bg-[#effaf5] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Previous Page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="px-2 py-0.5 text-xs font-semibold text-[#123e2b]">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="p-1 rounded border border-[#c2e7db] bg-white text-[#52665e] hover:bg-[#effaf5] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Next Page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
