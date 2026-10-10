import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  UserPlus,
  Upload,
  FileDown,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
} from 'lucide-react';
import {
  AdminUser,
  AdminUserFilterState,
  AdminUserFormValues,
  AdminUserStatus,
} from '../../../types/adminUser';
import { AdminUserService, fetchAdminUsers } from '../../../services/adminUserService';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { AdminUsersKPIBar } from './AdminUsersKPIBar';
import { AdminUsersFilterBar } from './AdminUsersFilterBar';
import { AdminUsersTable } from './AdminUsersTable';
import { AdminUserModal } from './AdminUserModal';
import { AdminUserDetailModal } from './AdminUserDetailModal';
import { AdminUserResetPasswordModal } from './AdminUserResetPasswordModal';
import { AdminUserStatusModal } from './AdminUserStatusModal';
import { AdminUserDeleteModal } from './AdminUserDeleteModal';
import { AdminUserImportModal } from './AdminUserImportModal';
import { AdminUserExportModal } from './AdminUserExportModal';
import { AdminUserDossierModal } from './AdminUserDossierModal';

export const SuperAdminAdminUsersView: React.FC = () => {
  const { currentUser } = useAuth();

  // Primary Data State
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters State
  const [filters, setFilters] = useState<AdminUserFilterState>({
    searchTerm: '',
    role: 'ALL',
    status: 'ALL',
  });

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [detailUser, setDetailUser] = useState<AdminUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<AdminUser | null>(null);
  const [statusChangeTarget, setStatusChangeTarget] = useState<{
    user: AdminUser;
    nextStatus: AdminUserStatus;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isDossierModalOpen, setIsDossierModalOpen] = useState(false);

  const toastService = useToast();

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    type === 'success' ? toastService.success(message) : toastService.error(message);
  };

  const refreshUsers = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const updated = await fetchAdminUsers();
      setUsers(updated);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load admin users from the server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUsers();
  }, []);

  // Filtered dataset
  const filteredUsers = useMemo(() => {
    return AdminUserService.filterAdminUsers(users, filters);
  }, [users, filters]);

  // Total active super admins
  const totalActiveSuperAdmins = useMemo(() => {
    return users.filter((u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')
      .length;
  }, [users]);

  // Handlers for CRUD
  const handleSaveUser = async (values: AdminUserFormValues, editId?: string) => {
    try {
      if (editId) {
        // Edit existing
        const updated = await AdminUserService.updateAdmin(
          editId,
          values,
          currentUser
        );
        await refreshUsers();
        setEditingUser(null);
        showToast(
          `Administrator account for "${updated.fullName}" updated successfully.`
        );
      } else {
        // Create new
        const created = await AdminUserService.createAdmin(values, currentUser);
        await refreshUsers();
        setIsAddModalOpen(false);
        showToast(
          `Administrator account "${created.fullName}" (@${created.username}) provisioned successfully.`
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        showToast(err.message, 'error');
      } else {
        showToast('Operation failed.', 'error');
      }
    }
  };

  const handleResetPasswordSuccess = async (
    newPass: string,
    requireChange: boolean
  ) => {
    if (!resetPasswordUser) return;
    try {
      await AdminUserService.resetPassword(
        resetPasswordUser.id,
        newPass,
        newPass,
        requireChange,
        currentUser
      );
      await refreshUsers();
      setResetPasswordUser(null);
      showToast(
        `Temporary password for ${resetPasswordUser.fullName} updated successfully.`
      );
    } catch (err: unknown) {
      if (err instanceof Error) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to reset password.', 'error');
      }
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!statusChangeTarget) return;
    try {
      const { user, nextStatus } = statusChangeTarget;
      await AdminUserService.changeStatus(user.id, nextStatus, currentUser);
      await refreshUsers();
      setStatusChangeTarget(null);
      showToast(
        `Status for ${user.fullName} transitioned to ${nextStatus}.`
      );
    } catch (err: unknown) {
      if (err instanceof Error) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to change status.', 'error');
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await AdminUserService.deleteAdmin(deleteTarget.id, currentUser);
      if (!result.success) {
        showToast(result.message || 'Failed to delete user.', 'error');
        setDeleteTarget(null);
        return;
      }
      await refreshUsers();
      setDeleteTarget(null);
      showToast(`Account for ${deleteTarget.fullName} deleted permanently.`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to delete user.', 'error');
      }
    }
  };

  const handleResetFilters = () => {
    setFilters({
      searchTerm: '',
      role: 'ALL',
      status: 'ALL',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading admin users…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          type="button"
          onClick={refreshUsers}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div id="superadmin-admin-users-view" className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Page Header Block (design.md §4.1) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#111827]">
              Admin Users Management
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#129b70]" />
              Role &amp; Root Governance
            </span>
          </div>
          <p className="text-xs text-[#52665e] max-w-2xl leading-relaxed">
            Executive hospital administration, security role assignments, system credentials, and protected institutional accounts.
          </p>
        </div>

        {/* Global Module Actions */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {/* Export Directory */}
          <button
            id="admin-users-export-btn"
            type="button"
            onClick={() => setIsExportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <FileDown className="h-3.5 w-3.5 text-slate-500" />
            <span>Export Options...</span>
          </button>

          {/* Import Admins */}
          <button
            id="admin-users-import-btn"
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-emerald-600" />
            <span>Import Admins</span>
          </button>

          {/* Add Admin User */}
          <button
            id="admin-users-add-btn"
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#129b70] hover:bg-[#0e7d5a] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>Add Admin User</span>
          </button>
        </div>
      </div>

      {/* 2. KPI Summary Bar (design.md §4.2) */}
      <AdminUsersKPIBar users={users} />

      {/* 3. Search & Filter Bar (design.md §4.4) */}
      <AdminUsersFilterBar
        filters={filters}
        onFilterChange={setFilters}
        onReset={handleResetFilters}
        totalCount={users.length}
        filteredCount={filteredUsers.length}
      />

      {/* 4. Master Table (design.md §4.5) */}
      <AdminUsersTable
        users={filteredUsers}
        currentUser={currentUser}
        onViewDetails={(u) => setDetailUser(u)}
        onEdit={(u) => setEditingUser(u)}
        onResetPassword={(u) => setResetPasswordUser(u)}
        onChangeStatus={(u, nextStatus) =>
          setStatusChangeTarget({ user: u, nextStatus })
        }
        onDelete={(u) => setDeleteTarget(u)}
        onRefresh={refreshUsers}
        onExportExcel={() => setIsExportModalOpen(true)}
        onExportPDF={() => setIsDossierModalOpen(true)}
        onPrint={() => window.print()}
      />

      {/* Add / Edit Admin User Modal */}
      {(isAddModalOpen || editingUser) && (
        <AdminUserModal
          isOpen={isAddModalOpen || !!editingUser}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditingUser(null);
          }}
          onSave={handleSaveUser}
          editingUser={editingUser}
          currentUser={currentUser}
          totalActiveSuperAdmins={totalActiveSuperAdmins}
        />
      )}

      {/* Detail Modal */}
      {detailUser && (
        <AdminUserDetailModal
          isOpen={!!detailUser}
          onClose={() => setDetailUser(null)}
          user={detailUser}
          currentUser={currentUser}
          onEdit={(u) => {
            setDetailUser(null);
            setEditingUser(u);
          }}
          onResetPassword={(u) => {
            setDetailUser(null);
            setResetPasswordUser(u);
          }}
          onPrintDossier={(u) => {
            setIsDossierModalOpen(true);
          }}
        />
      )}

      {/* Reset Password Modal */}
      {resetPasswordUser && (
        <AdminUserResetPasswordModal
          isOpen={!!resetPasswordUser}
          onClose={() => setResetPasswordUser(null)}
          user={resetPasswordUser}
          currentUser={currentUser}
          onResetSuccess={handleResetPasswordSuccess}
        />
      )}

      {/* Status Change Modal */}
      {statusChangeTarget && (
        <AdminUserStatusModal
          isOpen={!!statusChangeTarget}
          onClose={() => setStatusChangeTarget(null)}
          user={statusChangeTarget.user}
          newStatus={statusChangeTarget.nextStatus}
          currentUser={currentUser}
          totalActiveSuperAdmins={totalActiveSuperAdmins}
          onConfirm={handleConfirmStatusChange}
        />
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <AdminUserDeleteModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          user={deleteTarget}
          currentUser={currentUser}
          totalActiveSuperAdmins={totalActiveSuperAdmins}
          onConfirmDelete={handleConfirmDelete}
        />
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <AdminUserImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          currentUser={currentUser}
          onImportComplete={refreshUsers}
        />
      )}

      {/* Export Options Modal */}
      {isExportModalOpen && (
        <AdminUserExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          users={filteredUsers}
          filters={filters}
          currentUser={currentUser}
          onOpenDossierPreview={() => setIsDossierModalOpen(true)}
        />
      )}

      {/* Dossier Preview Modal */}
      {isDossierModalOpen && (
        <AdminUserDossierModal
          isOpen={isDossierModalOpen}
          onClose={() => setIsDossierModalOpen(false)}
          users={filteredUsers}
          filters={filters}
          currentUser={currentUser}
          targetUser={detailUser}
        />
      )}
    </div>
  );
};
