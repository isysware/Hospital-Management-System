import React from 'react';
import { Search, RotateCcw, Filter, Users } from 'lucide-react';
import {
  PatientFilterState,
  PATIENT_GENDERS,
  PAYER_TYPES,
  PATIENT_STATUSES,
} from '../../../types/patient';
import { getActiveCorporatePanels } from '../../../services/panelService';

interface PatientFilterBarProps {
  filters: PatientFilterState;
  onFilterChange: <K extends keyof PatientFilterState>(key: K, value: PatientFilterState[K]) => void;
  onResetFilters: () => void;
  totalCount: number;
  filteredCount: number;
}

export const PatientFilterBar: React.FC<PatientFilterBarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  totalCount,
  filteredCount,
}) => {
  const activePanels = getActiveCorporatePanels();

  const isFiltered =
    Boolean(filters.searchTerm.trim()) ||
    filters.gender !== 'ALL' ||
    filters.payerType !== 'ALL' ||
    filters.panelId !== 'ALL' ||
    filters.status !== 'ALL';

  return (
    <div className="bg-white border border-[#e2eae5] rounded-xl p-4 shadow-2xs mb-4 space-y-3">
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        {/* Search input */}
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#52665e] pointer-events-none" />
          <input
            type="text"
            value={filters.searchTerm}
            onChange={(e) => onFilterChange('searchTerm', e.target.value)}
            placeholder="Search by MR Number, Patient Name, CNIC, Phone, Panel ID..."
            className="w-full pl-9 pr-8 py-1.5 bg-[#fbfdfc] border border-[#c2e7db] rounded-lg text-xs text-[#123e2b] placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-[#08775A] focus:ring-1 focus:ring-[#08775A] transition-colors"
          />
          {filters.searchTerm && (
            <button
              onClick={() => onFilterChange('searchTerm', '')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded-sm cursor-pointer"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
          {/* Gender */}
          <select
            value={filters.gender}
            onChange={(e) => onFilterChange('gender', e.target.value as any)}
            className="px-2.5 py-1.5 bg-[#fbfdfc] border border-[#c2e7db] rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:border-[#08775A] focus:ring-1 focus:ring-[#08775A]"
            title="Filter by Gender"
          >
            <option value="ALL">Gender: All</option>
            {PATIENT_GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          {/* Payer Type */}
          <select
            value={filters.payerType}
            onChange={(e) => onFilterChange('payerType', e.target.value as any)}
            className="px-2.5 py-1.5 bg-[#fbfdfc] border border-[#c2e7db] rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:border-[#08775A] focus:ring-1 focus:ring-[#08775A]"
            title="Filter by Payer Type"
          >
            <option value="ALL">Payer: All</option>
            {PAYER_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {pt}
              </option>
            ))}
          </select>

          {/* Corporate Panel */}
          <select
            value={filters.panelId}
            onChange={(e) => onFilterChange('panelId', e.target.value)}
            disabled={filters.payerType === 'Self Pay'}
            className="px-2.5 py-1.5 bg-[#fbfdfc] border border-[#c2e7db] rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:border-[#08775A] focus:ring-1 focus:ring-[#08775A] disabled:opacity-50 disabled:bg-slate-100"
            title="Filter by Panel"
          >
            <option value="ALL">Panel: All</option>
            {activePanels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Status */}
          <select
            value={filters.status}
            onChange={(e) => onFilterChange('status', e.target.value as any)}
            className="px-2.5 py-1.5 bg-[#fbfdfc] border border-[#c2e7db] rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:border-[#08775A] focus:ring-1 focus:ring-[#08775A]"
            title="Filter by Status"
          >
            <option value="ALL">Status: All</option>
            {PATIENT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter Status Bar with Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#e2eae5] text-xs">
        <div className="flex items-center gap-2 text-[#52665e]">
          <Filter className="h-3.5 w-3.5 text-[#08775A]" />
          <span>
            Showing <strong className="text-[#123e2b]">{filteredCount}</strong> of{' '}
            <strong className="text-[#123e2b]">{totalCount}</strong> patients in registry
          </span>
          {isFiltered && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              Filtered
            </span>
          )}
        </div>

        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilters}
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
