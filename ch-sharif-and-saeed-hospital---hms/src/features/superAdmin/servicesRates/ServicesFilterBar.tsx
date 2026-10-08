import React from 'react';
import { Search, RotateCcw, Filter } from 'lucide-react';
import { ServiceFilterState } from '../../../types/serviceRates';
import { Department } from '../../../types/department';
import { VALID_SERVICE_CATEGORIES } from '../../../services/serviceRatesService';

interface ServicesFilterBarProps {
  filters: ServiceFilterState;
  onFilterChange: (newFilters: Partial<ServiceFilterState>) => void;
  onResetFilters: () => void;
  departments: Department[];
  totalResults: number;
}

export const ServicesFilterBar: React.FC<ServicesFilterBarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  departments,
  totalResults,
}) => {
  const isFiltered =
    filters.searchTerm.trim() !== '' ||
    filters.departmentId !== 'All' ||
    filters.category !== 'All' ||
    filters.panelEligible !== 'All' ||
    filters.status !== 'All';

  return (
    <div
      id="services-filter-bar"
      className="bg-white rounded-xl border border-slate-200/80 p-4 mb-4 shadow-xs"
    >
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        {/* Search input */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="services-search-input"
            type="text"
            value={filters.searchTerm}
            onChange={(e) => onFilterChange({ searchTerm: e.target.value })}
            placeholder="Search by service code, service name, or department..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] transition-colors"
          />
          {filters.searchTerm && (
            <button
              id="services-clear-search-btn"
              onClick={() => onFilterChange({ searchTerm: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2.5">
          <select aria-label="Provider" value={filters.providerType ?? 'INTERNAL'} onChange={e => onFilterChange({ providerType: e.target.value as 'INTERNAL' | 'OUTSOURCED', departmentId: 'All' })} className="border rounded p-2"><option value="INTERNAL">Hospital / Internal</option><option value="OUTSOURCED">Outsourced</option></select>
          {/* Department */}
          <div className="flex items-center gap-1.5">
            <select
              id="services-department-filter"
              aria-label="Filter by department"
              value={filters.departmentId}
              onChange={(e) => onFilterChange({ departmentId: e.target.value })}
              className="text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            >
              <option value="All">All Departments</option>
              {departments.filter(d => !d.pharmacyRelated && (d.fulfillmentOwnership === 'Outsourced' ? 'OUTSOURCED' : 'INTERNAL') === (filters.providerType ?? 'INTERNAL')).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code}) {d.status === 'Inactive' ? '(Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="flex items-center gap-1.5">
            <select
              id="services-category-filter"
              aria-label="Filter by category"
              value={filters.category}
              onChange={(e) => onFilterChange({ category: e.target.value as any })}
              className="text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            >
              <option value="All">All Categories</option>
              {VALID_SERVICE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Panel Eligible */}
          <div className="flex items-center gap-1.5">
            <select
              id="services-panel-filter"
              aria-label="Filter by panel eligibility"
              value={filters.panelEligible}
              onChange={(e) => onFilterChange({ panelEligible: e.target.value as any })}
              className="text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            >
              <option value="All">Panel Eligibility: All</option>
              <option value="Yes">Panel Eligible (Yes)</option>
              <option value="No">Non-Panel (No)</option>
            </select>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <select
              id="services-status-filter"
              aria-label="Filter by status"
              value={filters.status}
              onChange={(e) => onFilterChange({ status: e.target.value as any })}
              className="text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
            >
              
              <option value="Active">Active Only</option>
              <option value="Inactive">Inactive Only</option>
            </select>
          </div>

          {/* Reset Filter Button */}
          {isFiltered && (
            <button
              id="services-reset-filters-btn"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
              title="Reset all search queries and filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Filter summary status bar */}
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span>
            Showing <strong className="text-slate-800 font-semibold">{totalResults}</strong> service
            {totalResults === 1 ? '' : 's'} matching current criteria
          </span>
        </div>
        {isFiltered && (
          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-medium border border-emerald-200/60">
            Filters Active
          </span>
        )}
      </div>
    </div>
  );
};
