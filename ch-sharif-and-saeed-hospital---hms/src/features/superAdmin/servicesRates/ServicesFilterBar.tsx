import React from 'react';
import { Search, RotateCcw, Filter, RefreshCw } from 'lucide-react';
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
    filters.status !== 'All' ||
    filters.providerType !== 'INTERNAL';

  return (
    <div
      id="services-filter-bar"
      className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        {/* Search input */}
        <div className="relative md:col-span-4">
          <Search className="w-4 h-4 text-[#8b9e95] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="services-search-input"
            type="text"
            value={filters.searchTerm}
            onChange={(e) => onFilterChange({ searchTerm: e.target.value })}
            placeholder="Search code, name, department..."
            className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-[#c2e7db] rounded-lg placeholder:text-[#8b9e95] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] transition-colors"
          />
          {filters.searchTerm && (
            <button
              id="services-clear-search-btn"
              onClick={() => onFilterChange({ searchTerm: '' })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#8b9e95] hover:text-[#111827] cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Provider Type */}
        <div className="md:col-span-2">
          <select
            aria-label="Provider"
            value={filters.providerType ?? 'INTERNAL'}
            onChange={(e) =>
              onFilterChange({
                providerType: e.target.value as 'INTERNAL' | 'OUTSOURCED',
                departmentId: 'All',
              })
            }
            className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
          >
            <option value="INTERNAL">Internal Services</option>
            <option value="OUTSOURCED">Outsourced Services</option>
          </select>
        </div>

        {/* Department Filter */}
        <div className="md:col-span-2">
          <select
            id="services-department-filter"
            aria-label="Filter by department"
            value={filters.departmentId}
            onChange={(e) => onFilterChange({ departmentId: e.target.value })}
            className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
          >
            <option value="All">All Departments</option>
            {departments
              .filter(
                (d) =>
                  !d.pharmacyRelated &&
                  (d.fulfillmentOwnership === 'Outsourced' ? 'OUTSOURCED' : 'INTERNAL') ===
                    (filters.providerType ?? 'INTERNAL')
              )
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code}) {d.status === 'Inactive' ? '(Inactive)' : ''}
                </option>
              ))}
          </select>
        </div>

        {/* Category */}
        <div className="md:col-span-2">
          <select
            id="services-category-filter"
            aria-label="Filter by category"
            value={filters.category}
            onChange={(e) => onFilterChange({ category: e.target.value as any })}
            className="w-full text-xs py-2 px-3 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
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
        <div className="md:col-span-1">
          <select
            id="services-panel-filter"
            aria-label="Filter by panel eligibility"
            value={filters.panelEligible}
            onChange={(e) => onFilterChange({ panelEligible: e.target.value as any })}
            className="w-full text-xs py-2 px-2 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
          >
            <option value="All">Panel: All</option>
            <option value="Yes">Panel Yes</option>
            <option value="No">Panel No</option>
          </select>
        </div>

        {/* Status / Reset */}
        <div className="md:col-span-1 flex items-center gap-1.5 justify-end">
          <button
            id="services-reset-filters-btn"
            type="button"
            onClick={onResetFilters}
            className="w-full inline-flex items-center justify-center p-2 rounded-lg border border-[#e2eae5] text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition-colors shadow-2xs cursor-pointer"
            title="Reset all filters"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter summary status bar */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-[#52665e]">
        <div className="flex items-center gap-2">
          <span>
            Showing <strong className="text-[#111827] font-semibold">{totalResults}</strong> billable{' '}
            {totalResults === 1 ? 'service' : 'services'} matching criteria
          </span>
          {isFiltered && (
            <span className="text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded text-[11px] font-semibold border border-[#c2e7db]">
              Filters Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            id="services-status-filter"
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => onFilterChange({ status: e.target.value as any })}
            className="text-[11px] py-1 px-2.5 bg-white border border-[#c2e7db] rounded-lg text-[#111827] font-medium focus:outline-none focus:ring-1 focus:ring-[#08775A] cursor-pointer"
          >
            <option value="Active">Active Services</option>
            <option value="Inactive">Inactive Services</option>
            <option value="All">All Statuses</option>
          </select>
        </div>
      </div>
    </div>
  );
};
