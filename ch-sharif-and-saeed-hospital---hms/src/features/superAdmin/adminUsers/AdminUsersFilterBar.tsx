import React from 'react';
import { Search, RotateCcw, Filter, X, RefreshCw } from 'lucide-react';
import { AdminUserFilterState, AdminUserRole, AdminUserStatus } from '../../../types/adminUser';

interface AdminUsersFilterBarProps {
  filters: AdminUserFilterState;
  onFilterChange: (filters: AdminUserFilterState) => void;
  onReset: () => void;
  totalCount: number;
  filteredCount: number;
}

export const AdminUsersFilterBar: React.FC<AdminUsersFilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  totalCount,
  filteredCount,
}) => {
  const isFiltered =
    filters.searchTerm.trim() !== '' ||
    filters.role !== 'ALL' ||
    filters.status !== 'ALL';

  return (
    <div
      id="admin-users-filter-bar"
      className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        {/* Search input */}
        <div className="relative md:col-span-6">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8b9e95]" />
          <input
            id="admin-users-search-input"
            type="text"
            placeholder="Search by name, username, email, phone, or ID..."
            value={filters.searchTerm}
            onChange={(e) =>
              onFilterChange({ ...filters, searchTerm: e.target.value })
            }
            className="w-full text-xs pl-9 pr-8 py-2 border border-[#c2e7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] bg-white text-[#111827] placeholder:text-[#8b9e95] transition-colors"
          />
          {filters.searchTerm && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...filters, searchTerm: '' })}
              className="absolute right-2.5 top-2.5 text-[#8b9e95] hover:text-[#111827] p-0.5 rounded cursor-pointer"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Role Filter */}
        <div className="md:col-span-3">
          <select
            id="admin-users-role-filter"
            value={filters.role}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                role: e.target.value as 'ALL' | AdminUserRole,
              })
            }
            className="w-full text-xs px-3 py-2 border border-[#c2e7db] rounded-lg bg-white text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
          >
            <option value="ALL">All Roles</option>
            <option value="SUPER_ADMIN">Super Administrator</option>
            <option value="ADMIN">Hospital Administrator</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="md:col-span-2">
          <select
            id="admin-users-status-filter"
            value={filters.status}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                status: e.target.value as 'ALL' | AdminUserStatus,
              })
            }
            className="w-full text-xs px-3 py-2 border border-[#c2e7db] rounded-lg bg-white text-[#111827] font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Accounts</option>
            <option value="INACTIVE">Inactive Accounts</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>

        {/* Reset Filter Button */}
        <div className="md:col-span-1 flex items-center justify-end">
          {isFiltered ? (
            <button
              type="button"
              onClick={onReset}
              className="w-full p-2 rounded-lg border border-[#e2eae5] text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
              title="Reset all filters"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          ) : (
            <div className="w-full" />
          )}
        </div>
      </div>

      {/* Summary status row */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-[#52665e]">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[#8b9e95]" />
          <span>
            Showing <strong className="text-[#111827] font-semibold">{filteredCount}</strong> of{' '}
            {totalCount} administrator accounts
          </span>
        </div>
        {isFiltered && (
          <span className="text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded text-[11px] font-semibold border border-[#c2e7db]">
            Filters Active
          </span>
        )}
      </div>
    </div>
  );
};
