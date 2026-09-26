import React, { useState } from 'react';
import {
  Eye,
  Edit2,
  KeyRound,
  ShieldPlus,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  ArrowUpDown,
  UserCheck,
  Stethoscope,
  Wallet,
} from 'lucide-react';
import { StaffUser } from '../../../types/staffUser';
import { StaffUserService } from '../../../services/staffUserService';

interface StaffUsersTableProps {
  staffList: StaffUser[];
  onView: (staff: StaffUser) => void;
  onEdit: (staff: StaffUser) => void;
  onResetPassword: (staff: StaffUser) => void;
  onClinicalAuth: (staff: StaffUser) => void;
  onSalaryProfile: (staff: StaffUser) => void;
  onPortalAccess: (staff: StaffUser) => void;
  onOpenStatusModal: (staff: StaffUser, targetStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') => void;
  onDelete: (staff: StaffUser) => void;
}

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
}) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [sortField, setSortField] = useState<keyof StaffUser>('id');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Sorting
  const sortedList = [...staffList].sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  const handleSort = (field: keyof StaffUser) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedList.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedList = sortedList.slice(startIndex, startIndex + pageSize);

  const getStatusBadge = (status: StaffUser['status']) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#e7f6f1] text-[#0e7d5a] border border-[#c2e7db]">
            <CheckCircle className="h-3 w-3 text-[#129b70]" />
            Active
          </span>
        );
      case 'INACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            <XCircle className="h-3 w-3 text-gray-500" />
            Inactive
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="h-3 w-3 text-amber-600" />
            Suspended
          </span>
        );
    }
  };

  const getPortalBadge = (user: StaffUser) => {
    if (user.accessType === 'STAFF_RECORD_ONLY') {
      if (StaffUserService.isPortalEligible(user.staffCategory)) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="h-3 w-3 text-amber-600" />
            Portal Access Required
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
          <UserCheck className="h-3 w-3 text-slate-500" />
          Staff Record Only
        </span>
      );
    }

    switch (user.assignedPortal) {
      case 'front-desk':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
            Front Desk & Billing
          </span>
        );
      case 'admission':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            Admission
          </span>
        );
      case 'inventory':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
            Inventory
          </span>
        );
      default:
        return <span className="text-xs text-[#8b9e95]">—</span>;
    }
  };

  return (
    <div className="bg-white border border-[#e2eae5] rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="overflow-x-auto min-h-[380px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#f6f8f7] border-b border-[#e2eae5] text-[#52665e] font-semibold select-none">
              <th
                onClick={() => handleSort('id')}
                className="py-3 px-3.5 cursor-pointer hover:text-[#111827] transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Staff ID</span>
                  <ArrowUpDown className="h-3 w-3 text-[#8b9e95]" />
                </div>
              </th>
              <th
                onClick={() => handleSort('fullName')}
                className="py-3 px-3.5 cursor-pointer hover:text-[#111827] transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>Staff Name</span>
                  <ArrowUpDown className="h-3 w-3 text-[#8b9e95]" />
                </div>
              </th>
              <th
                onClick={() => handleSort('cnic')}
                className="py-3 px-3 cursor-pointer hover:text-[#111827] transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  <span>CNIC</span>
                  <ArrowUpDown className="h-3 w-3 text-[#8b9e95]" />
                </div>
              </th>
              <th className="py-3 px-3 whitespace-nowrap">Designation</th>
              <th className="py-3 px-3 whitespace-nowrap">Department</th>
              <th className="py-3 px-3 whitespace-nowrap">Portal / Access</th>
              <th className="py-3 px-3 whitespace-nowrap">Username</th>
              <th className="py-3 px-3 text-center whitespace-nowrap">Status</th>
              <th className="py-3 px-3 whitespace-nowrap">Last Login</th>
              <th className="py-3 px-3 whitespace-nowrap">Updated By</th>
              <th className="py-3 px-3 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e2eae5] text-[#111827]">
            {paginatedList.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-[#8b9e95]">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <ShieldAlert className="h-8 w-8 text-[#8b9e95]" />
                    <span className="font-medium text-sm text-[#52665e]">No staff records found</span>
                    <span className="text-xs text-[#8b9e95]">Try adjusting your search or filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedList.map((staff) => {
                const isPortalUser = staff.accessType === 'PORTAL_USER';

                return (
                  <tr
                    key={staff.id}
                    className="hover:bg-[#fbfcfb] transition-colors group"
                  >
                    {/* 1. Employee Code */}
                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span className="font-mono text-[11px] font-bold text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded border border-[#c2e7db]">
                        {staff.employeeCode || `STF-${staff.id.slice(0, 8).toUpperCase()}`}
                      </span>
                    </td>

                    {/* 2. Staff Name */}
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-[#111827]">{staff.fullName}</div>
                      <div className="text-[11px] text-[#8b9e95]">{staff.phone}</div>
                    </td>

                    {/* 3. CNIC */}
                    <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                      {staff.cnic || '—'}
                    </td>

                    {/* 4. Designation */}
                    <td className="py-3 px-3">
                      <div className="font-medium text-[#111827]">{staff.designation}</div>
                      <div className="text-[10px] text-[#8b9e95]">{staff.staffCategory}</div>
                    </td>

                    {/* 5. Department */}
                    <td className="py-3 px-3 text-[#52665e] max-w-[150px] truncate" title={staff.departmentName}>
                      {staff.departmentName}
                    </td>

                    {/* 6. Portal / Access */}
                    <td className="py-3 px-3 whitespace-nowrap">{getPortalBadge(staff)}</td>

                    {/* 7. Username */}
                    <td className="py-3 px-3 font-mono text-[11px] text-[#111827] whitespace-nowrap">
                      {isPortalUser && staff.username ? staff.username : '—'}
                    </td>

                    {/* 9. Status */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      {getStatusBadge(staff.status)}
                    </td>

                    {/* 10. Last Login */}
                    <td className="py-3 px-3 text-[11px] text-[#8b9e95] whitespace-nowrap">
                      {staff.lastLoginAt || 'Never'}
                    </td>

                    {/* 11. Updated By */}
                    <td className="py-3 px-3 text-[11px] text-[#52665e] max-w-[140px] truncate" title={staff.updatedBy}>
                      {staff.updatedBy}
                    </td>

                    {/* 12. Actions */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {/* View */}
                        <button
                          onClick={() => onView(staff)}
                          className="p-1.5 rounded-md text-[#52665e] hover:text-[#0e7d5a] hover:bg-[#e7f6f1] transition-colors cursor-pointer"
                          title="View Staff Profile & Governance"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>

                        {/* Edit */}
                        <button
                          onClick={() => onEdit(staff)}
                          className="p-1.5 rounded-md text-[#52665e] hover:text-[#129b70] hover:bg-[#e7f6f1] transition-colors cursor-pointer"
                          title="Edit Staff Record"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>

                        {/* Reset Password (Portal User only) */}
                        {isPortalUser && (
                          <button
                            onClick={() => onResetPassword(staff)}
                            className="p-1.5 rounded-md text-[#52665e] hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                            title="Reset Portal Password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Portal Access — separate workflow from Staff Master (staff.md §5) */}
                        <button
                          onClick={() => onPortalAccess(staff)}
                          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                            isPortalUser ? 'text-[#08775A] hover:bg-[#e7f6f1]' : 'text-[#52665e] hover:text-[#129b70] hover:bg-[#e7f6f1]'
                          }`}
                          title={isPortalUser ? 'Manage Portal Access' : 'Grant Portal Access'}
                        >
                          <ShieldPlus className="h-3.5 w-3.5" />
                        </button>

                        {/* v7.2 Clinical Discharge Authorization (doctors only) */}
                        {staff.staffCategory === 'Doctor' && (
                          <button
                            onClick={() => onClinicalAuth(staff)}
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${staff.clinicalAuthActive
                                ? 'text-[#08775A] hover:bg-[#e7f6f1]'
                                : 'text-[#52665e] hover:text-[#08775A] hover:bg-[#e7f6f1]'
                              }`}
                            title={
                              staff.clinicalAuthUsername
                                ? `Clinical Discharge Authorization — ${staff.clinicalAuthActive ? 'Active' : 'Inactive'}`
                                : 'Set Up Clinical Discharge Authorization'
                            }
                          >
                            <Stethoscope className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* v7.2 Salary Profile */}
                        <button
                          onClick={() => onSalaryProfile(staff)}
                          className="p-1.5 rounded-md text-[#52665e] hover:text-teal-700 hover:bg-teal-50 transition-colors cursor-pointer"
                          title="Salary Profile"
                        >
                          <Wallet className="h-3.5 w-3.5" />
                        </button>

                        {/* Status Toggles */}
                        {staff.status === 'ACTIVE' ? (
                          <>
                            <button
                              onClick={() => onOpenStatusModal(staff, 'INACTIVE')}
                              className="p-1.5 rounded-md text-[#52665e] hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                              title="Deactivate Account"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => onOpenStatusModal(staff, 'SUSPENDED')}
                              className="p-1.5 rounded-md text-[#52665e] hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title="Suspend Account"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => onOpenStatusModal(staff, 'ACTIVE')}
                            className="p-1.5 rounded-md text-[#52665e] hover:text-[#0e7d5a] hover:bg-[#e7f6f1] transition-colors cursor-pointer"
                            title="Reactivate Account"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => onDelete(staff)}
                          className="p-1.5 rounded-md text-[#52665e] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          title="Delete Staff Record (Checks Activity)"
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

      {/* Pagination Footer */}
      <div className="py-3 px-4 bg-[#f6f8f7] border-t border-[#e2eae5] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#52665e]">
        <div className="flex items-center gap-3">
          <span>
            Showing <strong className="text-[#111827]">{sortedList.length === 0 ? 0 : startIndex + 1}</strong> to{' '}
            <strong className="text-[#111827]">
              {Math.min(startIndex + pageSize, sortedList.length)}
            </strong>{' '}
            of <strong className="text-[#111827]">{sortedList.length}</strong> staff entries
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-[#8b9e95]">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="py-1 px-2 bg-white border border-[#e2eae5] rounded-md text-xs text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#129b70]"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-md border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#f6f8f7] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 py-1 font-semibold text-[#111827]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-md border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#f6f8f7] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
