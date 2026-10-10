import React from 'react';
import { Search, RotateCcw, Filter } from 'lucide-react';
import { ShiftFilterState, ShiftType, ShiftStatus } from '../../../types/shift';
import { Department } from '../../../types/department';

interface ShiftFilterBarProps {
  filters: ShiftFilterState;
  onFilterChange: (newFilters: ShiftFilterState) => void;
  onReset: () => void;
  departments: Department[];
  totalCount: number;
  filteredCount: number;
}

export const ShiftFilterBar: React.FC<ShiftFilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  departments,
  totalCount,
  filteredCount,
}) => {
  const isFiltered =
    Boolean(filters.searchTerm) ||
    filters.departmentId !== 'ALL' ||
    filters.shiftType !== 'ALL' ||
    filters.schedule !== 'ALL' ||
    filters.status !== 'ALL';

  return (
    <div className="bg-white rounded-xl border border-[#e2eae5] p-4 shadow-2xs space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
        {/* 1. Search Box */}
        <div className="lg:col-span-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#52665e]" />
          <input
            type="text"
            value={filters.searchTerm}
            onChange={(e) =>
              onFilterChange({ ...filters, searchTerm: e.target.value })
            }
            placeholder="Search shift code, title, department..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#fbfdfc] hover:bg-white focus:bg-white border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors"
          />
        </div>

        {/* 2. Department Dropdown */}
        <div className="lg:col-span-3">
          <select
            value={filters.departmentId}
            onChange={(e) =>
              onFilterChange({ ...filters, departmentId: e.target.value })
            }
            className="w-full px-2.5 py-1.5 text-xs bg-[#fbfdfc] hover:bg-white focus:bg-white border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors text-slate-700"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} {d.status === 'Inactive' ? '(Inactive)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Shift Type Dropdown */}
        <div className="lg:col-span-2">
          <select
            value={filters.shiftType}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                shiftType: e.target.value as 'ALL' | ShiftType,
              })
            }
            className="w-full px-2.5 py-1.5 text-xs bg-[#fbfdfc] hover:bg-white focus:bg-white border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors text-slate-700"
          >
            <option value="ALL">All Types</option>
            <option value="MORNING">Morning Shift</option>
            <option value="EVENING">Evening Shift</option>
            <option value="NIGHT">Night Shift</option>
            <option value="CUSTOM">Custom Shift</option>
          </select>
        </div>

        {/* 4. Schedule (Day vs Overnight) Dropdown */}
        <div className="lg:col-span-2">
          <select
            value={filters.schedule}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                schedule: e.target.value as 'ALL' | 'DAY' | 'OVERNIGHT',
              })
            }
            className="w-full px-2.5 py-1.5 text-xs bg-[#fbfdfc] hover:bg-white focus:bg-white border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors text-slate-700"
          >
            <option value="ALL">All Schedules</option>
            <option value="DAY">Standard Day Duty</option>
            <option value="OVERNIGHT">Overnight Duty (+1 Day)</option>
          </select>
        </div>

        {/* 5. Status Dropdown */}
        <div className="lg:col-span-1">
          <select
            value={filters.status}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                status: e.target.value as 'ALL' | ShiftStatus,
              })
            }
            className="w-full px-2 py-1.5 text-xs bg-[#fbfdfc] hover:bg-white focus:bg-white border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors text-slate-700"
          >
            <option value="ALL">Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {/* Filter Status Bar with Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#e2eae5] text-xs">
        <div className="flex items-center gap-2 text-[#52665e]">
          <Filter className="h-3.5 w-3.5 text-[#08775A]" />
          <span>
            Showing <strong className="text-[#123e2b]">{filteredCount}</strong> of{' '}
            <strong className="text-[#123e2b]">{totalCount}</strong> shifts
          </span>
          {isFiltered && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              Filters Active
            </span>
          )}
        </div>

        {isFiltered && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#08775A] hover:text-[#065f46] hover:bg-[#effaf5] rounded-md transition-colors cursor-pointer border border-transparent hover:border-[#c2e7db]"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>
    </div>
  );
};
