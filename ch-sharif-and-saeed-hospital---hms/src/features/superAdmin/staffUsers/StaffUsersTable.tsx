import React, { useState, useMemo } from 'react';
import {
  Eye,
  Edit2,
  KeyRound,
  ShieldCheck,
  CreditCard,
  UserX,
  UserCheck,
  Trash2,
  ArrowUpDown,
  Lock,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  FileSpreadsheet,
  FileDown,
  Printer,
} from 'lucide-react';
import { StaffUser, StaffStatus } from '../../../types/staffUser';
import { StaffUserService } from '../../../services/staffUserService';
import { formatDateTimeDDMMYYYY } from '../../../utils/formatters';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface StaffUsersTableProps {
  staffList: StaffUser[];
  onView: (staff: StaffUser) => void;
  onEdit: (staff: StaffUser) => void;
  onResetPassword: (staff: StaffUser) => void;
  onClinicalAuth: (staff: StaffUser) => void;
  onSalaryProfile: (staff: StaffUser) => void;
  onPortalAccess: (staff: StaffUser) => void;
  onOpenStatusModal: (staff: StaffUser, targetStatus: StaffStatus) => void;
  onDelete: (staff: StaffUser) => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

type SortField =
  | 'id'
  | 'fullName'
  | 'staffRole'
  | 'designation'
  | 'departmentName'
  | 'status'
  | 'phone'
  | 'cnic';

export const StaffUsersTable: React.FC<StaffUsersTableProps> = ({
  staffList,
  onView,
  onEdit,
  onResetPassword,
  onClinicalAuth,
  onSalaryProfile,
  onPortalAccess,
  onOpenStatusModal,
  onDelete,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedList = useMemo(() => {
    return [...staffList].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortField) {
        case 'id':
          aVal = a.employeeCode || a.id;
          bVal = b.employeeCode || b.id;
          break;
        case 'fullName':
          aVal = a.fullName.toLowerCase();
          bVal = b.fullName.toLowerCase();
          break;
        case 'staffRole':
          aVal = (a.staffRole || '').toLowerCase();
          bVal = (b.staffRole || '').toLowerCase();
          break;
        case 'designation':
          aVal = (a.designation || '').toLowerCase();
          bVal = (b.designation || '').toLowerCase();
          break;
        case 'departmentName':
          aVal = (a.departmentName || '').toLowerCase();
          bVal = (b.departmentName || '').toLowerCase();
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        case 'phone':
          aVal = a.phone || '';
          bVal = b.phone || '';
          break;
        case 'cnic':
          aVal = a.cnic || '';
          bVal = b.cnic || '';
          break;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [staffList, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedList.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedList = sortedList.slice(startIndex, startIndex + pageSize);

  const getPortalBadge = (user: StaffUser) => {
    if (user.accessType === 'STAFF_RECORD_ONLY') {
      if (StaffUserService.isPortalEligible(user.staffCategory)) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Access Required
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#f6faf8] text-[#52665e] border border-[#e2eae5]">
          <UserCheck className="h-3 w-3 text-[#8b9e95]" />
          Directory Only
        </span>
      );
    }

    switch (user.assignedPortal) {
      case 'front-desk':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Front Desk &amp; Billing
          </span>
        );
      case 'admission':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            Admission
          </span>
        );
      case 'inventory':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            Inventory
          </span>
        );
      default:
        return <span className="text-xs text-[#8b9e95]">—</span>;
    }
  };

  const getRoleBadge = (user: StaffUser) => {
    const roleText =
      user.staffRole ||
      (user.assignedPortal ? user.assignedPortal.replace(/-/g, ' ').toUpperCase() : '') ||
      user.designation ||
      user.staffCategory ||
      'Staff';

    const rLower = roleText.toLowerCase();
    if (rLower.includes('doctor') || rLower.includes('surgeon') || rLower.includes('consultant')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] whitespace-nowrap">
          {roleText}
        </span>
      );
    }
    if (rLower.includes('admin') || rLower.includes('super')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 whitespace-nowrap">
          {roleText}
        </span>
      );
    }
    if (rLower.includes('billing') || rLower.includes('front desk') || rLower.includes('reception')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
          {roleText}
        </span>
      );
    }
    if (rLower.includes('admission') || rLower.includes('ward')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
          {roleText}
        </span>
      );
    }
    if (rLower.includes('inventory') || rLower.includes('store') || rLower.includes('pharmacy')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
          {roleText}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#f6faf8] text-[#111827] border border-[#e2eae5] whitespace-nowrap">
        {roleText}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-[#e2eae5] overflow-hidden shadow-2xs flex flex-col">
      {/* Dark Emerald Header Strip (design.md §4.5) */}
      <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-bold text-white tracking-wide">
            Hospital Staff &amp; Workforce Directory
          </h2>
          <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
            {staffList.length} {staffList.length === 1 ? 'Staff' : 'Staff Records'}
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
              title="Print Staff"
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
          Showing <span className="font-semibold text-[#111827]">{startIndex + 1}</span>–
          <span className="font-semibold text-[#111827]">{Math.min(startIndex + pageSize, staffList.length)}</span> of{' '}
          <span className="font-semibold text-[#111827]">{staffList.length}</span> staff members
        </div>
        <div className="text-[11px] text-[#52665e]">
          Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
          <span className="font-bold text-[#111827]">{totalPages}</span>
        </div>
      </div>

      {/* Table Element */}
      <div className="overflow-x-auto min-h-[350px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold uppercase text-[11px] tracking-wider select-none sticky top-0 z-10">
              <th className="w-12 py-2.5 px-3 text-center border-r border-[#c2e7db]/70 font-bold">
                #
              </th>
              <th
                onClick={() => handleSort('id')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Staff ID</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort('fullName')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Staff Name</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort('staffRole')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Role</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort('phone')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Contact</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort('cnic')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>CNIC</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort('designation')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Designation</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort('departmentName')}
                className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 cursor-pointer hover:bg-[#c2e7db]/30 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Department</span>
                  <ArrowUpDown className="h-3 w-3 text-[#08775A]/60" />
                </div>
              </th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Portal / Access</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Username</th>
              <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 whitespace-nowrap">Status</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Last Login</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Updated By</th>
              <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e2eae5] text-[#111827]">
            {paginatedList.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-[#8b9e95]">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <ShieldAlert className="h-8 w-8 text-[#8b9e95]/40" />
                    <span className="font-semibold text-xs text-[#111827]">No staff records found</span>
                    <span className="text-[11px] text-[#52665e]">Try adjusting your search query or filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedList.map((staff, idx) => {
                const isPortalUser = staff.accessType === 'PORTAL_USER';
                const globalIndex = startIndex + idx + 1;

                return (
                  <tr
                    key={staff.id}
                    className={`${
                      idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                  >
                    {/* Index Sequence */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                      {globalIndex}
                    </td>

                    {/* Staff ID */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                      <span className="font-mono text-[11px] font-bold text-[#08775A] bg-[#effaf5] px-2.5 py-0.5 rounded border border-[#c2e7db]">
                        {staff.employeeCode || `STF-${staff.id.slice(0, 8).toUpperCase()}`}
                      </span>
                    </td>

                    {/* Staff Name */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap font-semibold text-[#111827]">
                      {staff.fullName}
                    </td>

                    {/* Role */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                      {getRoleBadge(staff)}
                    </td>

                    {/* Contact */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] font-mono text-xs text-[#52665e] whitespace-nowrap">
                      {staff.phone || '—'}
                    </td>

                    {/* CNIC */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] font-mono text-xs text-[#52665e] whitespace-nowrap">
                      {staff.cnic || '—'}
                    </td>

                    {/* Designation */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap font-medium text-[#111827]">
                      {staff.designation || staff.staffCategory || '—'}
                    </td>

                    {/* Department */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap text-[#52665e]">
                      {staff.departmentName ||
                        (staff.departmentNames && staff.departmentNames.length > 0
                          ? staff.departmentNames.join(', ')
                          : '—')}
                    </td>

                    {/* Portal / Access */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                      {getPortalBadge(staff)}
                    </td>

                    {/* Username */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] font-mono text-xs text-[#111827] whitespace-nowrap">
                      {isPortalUser && staff.username ? `@${staff.username}` : '—'}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] whitespace-nowrap">
                      <StatusBadge status={staff.status === 'ACTIVE' ? 'Active' : staff.status === 'SUSPENDED' ? 'Cancelled' : 'Inactive'} size="sm" />
                    </td>

                    {/* Last Login */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] text-[11px] text-[#52665e] font-mono whitespace-nowrap">
                      {staff.lastLoginAt ? formatDateTimeDDMMYYYY(staff.lastLoginAt) : 'Never'}
                    </td>

                    {/* Updated By */}
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] text-xs text-[#52665e] max-w-[150px] truncate whitespace-nowrap" title={staff.updatedBy}>
                      {staff.updatedBy || '—'}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        {/* View */}
                        <button
                          onClick={() => onView(staff)}
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                          title="View Staff Profile &amp; Governance"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>

                        {/* Edit */}
                        <button
                          onClick={() => onEdit(staff)}
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                          title="Edit Staff Member Details"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>

                        {/* Reset Password (Only if portal user) */}
                        {isPortalUser && (
                          <button
                            onClick={() => onResetPassword(staff)}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                            title="Reset Portal Password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Clinical Privileges (Doctors/Surgeons) */}
                        {staff.staffCategory === 'Doctor' && (
                          <button
                            onClick={() => onClinicalAuth(staff)}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                            title="Clinical Privileges &amp; Commission"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Salary Profile */}
                        <button
                          onClick={() => onSalaryProfile(staff)}
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                          title="Salary &amp; Compensation Profile"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                        </button>

                        {/* Portal Access Toggle */}
                        <button
                          onClick={() => onPortalAccess(staff)}
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isPortalUser
                              ? 'text-[#52665e] hover:text-purple-700 hover:bg-purple-50'
                              : 'text-sky-600 hover:text-sky-800 hover:bg-sky-50'
                          }`}
                          title={isPortalUser ? 'Manage Portal Login' : 'Grant Portal Access'}
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </button>

                        {/* Status Toggle */}
                        {staff.status === 'ACTIVE' ? (
                          <button
                            onClick={() => onOpenStatusModal(staff, 'INACTIVE')}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-amber-700 hover:bg-amber-50 transition-colors cursor-pointer"
                            title="Deactivate Staff Account"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => onOpenStatusModal(staff, 'ACTIVE')}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                            title="Reactivate Staff Account"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => onDelete(staff)}
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete Staff Member"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
            className="rounded-lg border border-[#c2e7db] bg-white px-2.5 py-1 text-xs text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span className="ml-2">
            Showing <span className="font-semibold text-[#111827]">{startIndex + 1}</span>–
            <span className="font-semibold text-[#111827]">{Math.min(startIndex + pageSize, staffList.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{staffList.length}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
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
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </button>
        </div>
      </div>
    </div>
  );
};
