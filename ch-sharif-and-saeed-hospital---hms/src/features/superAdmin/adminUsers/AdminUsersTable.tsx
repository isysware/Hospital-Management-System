import React, { useState } from 'react';
import {
  Eye,
  Edit2,
  Key,
  Power,
  Trash2,
  Shield,
  UserCheck,
  Lock,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileDown,
  Printer,
} from 'lucide-react';
import { AdminUser, AdminUserStatus } from '../../../types/adminUser';
import { AdminUserService } from '../../../services/adminUserService';
import { User } from '../../../types';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface AdminUsersTableProps {
  users: AdminUser[];
  currentUser: User | null;
  onViewDetails: (user: AdminUser) => void;
  onEdit: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  onChangeStatus: (user: AdminUser, newStatus: AdminUserStatus) => void;
  onDelete: (user: AdminUser) => void;
  onRefresh: () => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

export const AdminUsersTable: React.FC<AdminUsersTableProps> = ({
  users,
  currentUser,
  onViewDetails,
  onEdit,
  onResetPassword,
  onChangeStatus,
  onDelete,
  onRefresh,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [guardAlertMessage, setGuardAlertMessage] = useState<string | null>(null);

  const isActorSuperAdmin = AdminUserService.isActorSuperAdmin(currentUser);

  // Pagination Math
  const totalRecords = users.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const paginatedUsers = users.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handleProtectedActionAttempt = (target: AdminUser, actionName: string) => {
    if ((target.role === 'SUPER_ADMIN' || target.role === 'ADMIN') && !isActorSuperAdmin) {
      setGuardAlertMessage(
        target.role === 'SUPER_ADMIN'
          ? 'This Super Admin account is protected and cannot be modified by an Admin user.'
          : 'Only a Super Admin can manage Admin accounts.'
      );
      return;
    }

    const isSelf =
      (currentUser?.id && target.id === currentUser.id) ||
      (currentUser?.username &&
        target.username.toLowerCase() === currentUser.username.toLowerCase());

    if (isSelf && (actionName === 'deactivate' || actionName === 'delete')) {
      setGuardAlertMessage('You cannot disable your currently active account.');
      return;
    }
  };

  return (
    <div
      id="admin-users-table-container"
      className="bg-white rounded-xl border border-[#e2eae5] overflow-hidden shadow-2xs flex flex-col"
    >
      {/* Dark Emerald Header Strip (design.md §4.5) */}
      <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-bold text-white tracking-wide">
            Administrative Accounts Directory
          </h2>
          <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
            {totalRecords} {totalRecords === 1 ? 'Administrator' : 'Administrators'}
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
              title="Print Directory"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </button>
          )}
          <button
            id="admin-table-refresh-btn"
            type="button"
            onClick={onRefresh}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-header row */}
      <div className="bg-[#f6faf8] border-b border-[#e2eae5] px-4 py-2 flex items-center justify-between text-xs text-[#52665e]">
        <div>
          Showing <span className="font-semibold text-[#111827]">{startIndex + 1}</span>–
          <span className="font-semibold text-[#111827]">{endIndex}</span> of{' '}
          <span className="font-semibold text-[#111827]">{totalRecords}</span> administrative accounts
        </div>
        <div className="text-[11px] text-[#52665e]">
          Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
          <span className="font-bold text-[#111827]">{totalPages}</span>
        </div>
      </div>

      {/* Guard Warning Alert */}
      {guardAlertMessage && (
        <div className="m-3 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-2 text-xs text-rose-800 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{guardAlertMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setGuardAlertMessage(null)}
            className="text-rose-500 hover:text-rose-700 font-bold text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table Data */}
      <div className="overflow-x-auto min-h-[300px]">
        {paginatedUsers.length === 0 ? (
          <div className="py-16 text-center text-[#8b9e95] space-y-2">
            <Shield className="h-10 w-10 mx-auto text-[#8b9e95]/40 stroke-1" />
            <div className="text-xs font-semibold text-[#111827]">
              No matching administrative users found
            </div>
            <div className="text-[11px] text-[#52665e]">
              Try adjusting your search criteria or role / status filters.
            </div>
          </div>
        ) : (
          <table id="admin-users-table" className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold text-[11px] uppercase tracking-wider select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 w-12">#</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">User ID</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Administrator</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Username</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Email</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Phone</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Role</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 text-center">Status</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Last Login</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Created Date</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-xs">
              {paginatedUsers.map((u, idx) => {
                const isSuperAdmin = u.role === 'SUPER_ADMIN';
                const canModify = AdminUserService.canActorModifyTarget(currentUser, u).allowed;
                const isSelf =
                  (currentUser?.id && u.id === currentUser.id) ||
                  (currentUser?.username &&
                    u.username.toLowerCase() === currentUser.username.toLowerCase());
                const globalIndex = startIndex + idx + 1;

                return (
                  <tr
                    key={u.id}
                    id={`admin-row-${u.id}`}
                    className={`${
                      idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                  >
                    {/* Index Sequence */}
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                      {globalIndex}
                    </td>

                    {/* User ID */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      <span className="font-mono font-bold text-xs text-[#08775A] bg-[#effaf5] px-2.5 py-0.5 rounded-md border border-[#c2e7db]">
                        {u.employeeCode || `ADM-${u.id.slice(0, 8).toUpperCase()}`}
                      </span>
                    </td>

                    {/* Admin Name */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">
                          {u.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div className="font-bold text-[#111827] flex items-center gap-1.5 whitespace-nowrap">
                          <span>{u.fullName}</span>
                          {isSuperAdmin && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]"
                              title="Super Admin Account - Institutional Root"
                            >
                              <Lock className="h-2.5 w-2.5" />
                              Protected Root
                            </span>
                          )}
                          {isSelf && (
                            <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                              You
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Username */}
                    <td className="py-2.5 px-3.5 font-mono text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                      @{u.username}
                    </td>

                    {/* Email */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5] text-[#111827] font-medium">
                      {u.email || '—'}
                    </td>

                    {/* Phone */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5] text-[#52665e] font-mono text-xs">
                      {u.phone || '—'}
                    </td>

                    {/* Role */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          isSuperAdmin
                            ? 'bg-[#effaf5] text-[#08775A] border border-[#c2e7db]'
                            : 'bg-slate-100 text-[#111827] border border-slate-200'
                        }`}
                      >
                        {isSuperAdmin ? (
                          <Shield className="h-3 w-3 text-[#08775A]" />
                        ) : (
                          <UserCheck className="h-3 w-3 text-slate-600" />
                        )}
                        {isSuperAdmin ? 'Super Admin' : 'Admin'}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5] text-center">
                      <StatusBadge status={u.status === 'ACTIVE' ? 'Active' : u.status === 'SUSPENDED' ? 'Cancelled' : 'Inactive'} size="sm" />
                    </td>

                    {/* Last Login */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5] font-mono text-[11px]">
                      {u.lastLoginAt || 'Never'}
                    </td>

                    {/* Created Date */}
                    <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap text-[11px] border-r border-[#e2eae5] font-mono">
                      {u.createdAt}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {/* 1. View Details */}
                        <button
                          type="button"
                          onClick={() => onViewDetails(u)}
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                          title="View Administrative Profile"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>

                        {/* 2. Edit */}
                        {canModify ? (
                          <button
                            type="button"
                            onClick={() => onEdit(u)}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                            title="Edit Account Details"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-300 cursor-not-allowed opacity-60"
                            title="Protected Super Admin Account"
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </span>
                        )}

                        {/* 3. Reset Password */}
                        {canModify ? (
                          <button
                            type="button"
                            onClick={() => onResetPassword(u)}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                            title="Reset Temporary Password"
                          >
                            <Key className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-300 cursor-not-allowed opacity-60"
                            title="Protected Super Admin Account"
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </span>
                        )}

                        {/* 4. Status Controls */}
                        {canModify ? (
                          u.status === 'ACTIVE' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isSelf) {
                                    handleProtectedActionAttempt(u, 'deactivate');
                                    return;
                                  }
                                  onChangeStatus(u, 'INACTIVE');
                                }}
                                className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                                  isSelf
                                    ? 'text-slate-300 cursor-not-allowed opacity-60'
                                    : 'text-[#52665e] hover:text-amber-700 hover:bg-amber-50'
                                }`}
                                title={
                                  isSelf
                                    ? 'Cannot disable your own active account'
                                    : 'Deactivate Account'
                                }
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onChangeStatus(u, 'ACTIVE')}
                              className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                              title="Reactivate Account"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                          )
                        ) : null}

                        {/* 5. Delete */}
                        {canModify && !isSelf && (
                          <button
                            type="button"
                            onClick={() => onDelete(u)}
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Delete Admin Account"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <span className="ml-2">
            Showing <span className="font-semibold text-[#111827]">{startIndex + 1}</span>–
            <span className="font-semibold text-[#111827]">{endIndex}</span> of{' '}
            <span className="font-semibold text-[#111827]">{totalRecords}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            id="admin-table-prev-page-btn"
            type="button"
            disabled={currentPage === 1}
            onClick={() => handlePageChange(currentPage - 1)}
            className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            <span>Previous</span>
          </button>
          <span className="px-2 font-mono text-[11px] font-semibold text-[#111827]">
            {currentPage} / {totalPages}
          </span>
          <button
            id="admin-table-next-page-btn"
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
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
