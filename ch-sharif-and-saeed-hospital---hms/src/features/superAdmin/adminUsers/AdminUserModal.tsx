import React, { useState, useEffect } from 'react';
import {
  X,
  Shield,
  UserCheck,
  Eye,
  EyeOff,
  AlertTriangle,
  Lock,
  CheckCircle2,
  Key,
} from 'lucide-react';
import { AdminUser, AdminUserFormValues, AdminUserRole, AdminUserStatus } from '../../../types/adminUser';
import { AdminUserService } from '../../../services/adminUserService';
import { User } from '../../../types';
import { useToast } from '../../../context/ToastContext';

interface AdminUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: AdminUserFormValues, editId?: string) => void;
  editingUser?: AdminUser | null;
  currentUser: User | null;
  totalActiveSuperAdmins: number;
}

export const AdminUserModal: React.FC<AdminUserModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingUser,
  currentUser,
  totalActiveSuperAdmins,
}) => {
  const toast = useToast();
  const isActorSuperAdmin = AdminUserService.isActorSuperAdmin(currentUser);
  const isEditing = !!editingUser;

  const [form, setForm] = useState<AdminUserFormValues>({
    fullName: '',
    employeeCode: '',
    username: '',
    email: '',
    phone: '',
    role: 'ADMIN',
    status: 'ACTIVE',
    password: '',
    confirmPassword: '',
    requirePasswordChangeOnLogin: true,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirmingRoleChange, setIsConfirmingRoleChange] = useState(false);

  useEffect(() => {
    if (editingUser) {
      setForm({
        fullName: editingUser.fullName,
        employeeCode: editingUser.employeeCode || '',
        username: editingUser.username,
        email: editingUser.email,
        phone: editingUser.phone || '',
        role: editingUser.role,
        status: editingUser.status,
        requirePasswordChangeOnLogin: !!editingUser.requirePasswordChangeOnLogin,
      });
      setIsConfirmingRoleChange(false);
      setErrorMessage(null);
    } else {
      setForm({
        fullName: '',
        employeeCode: '',
        username: '',
        email: '',
        phone: '',
        role: 'ADMIN', // default is always Admin
        status: 'ACTIVE',
        password: '',
        confirmPassword: '',
        requirePasswordChangeOnLogin: true,
      });
      setIsConfirmingRoleChange(false);
      setErrorMessage(null);
    }
  }, [editingUser, isOpen]);

  if (!isOpen) return null;

  // Security Check: an Admin actor may never create a new Admin-tier account,
  // nor edit an existing Admin or Super Admin account — only a Super Admin can
  // (mirrors the backend's `assertActorMayManageRole` in `portalUser.service.ts`).
  if (!isActorSuperAdmin && (!isEditing || editingUser?.role === 'SUPER_ADMIN' || editingUser?.role === 'ADMIN')) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-xl border border-slate-200">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
            <Lock className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">
            Protected Account
          </h3>
          <p className="text-xs text-slate-600 mb-6">
            {isEditing
              ? 'This account is protected and cannot be modified by an Admin user.'
              : 'Only a Super Admin can provision Admin or Super Admin accounts. Use Staff Users to add operational staff.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleRoleSelect = (selectedRole: AdminUserRole) => {
    // If not super admin, guard against selecting SUPER_ADMIN
    if (selectedRole === 'SUPER_ADMIN' && !isActorSuperAdmin) {
      setErrorMessage('Admin users are not authorized to create Super Admin accounts.');
      return;
    }

    // If editing and changing role of a super admin to admin, trigger confirmation
    if (isEditing && editingUser?.role === 'SUPER_ADMIN' && selectedRole === 'ADMIN') {
      if (totalActiveSuperAdmins <= 1 && editingUser.status === 'ACTIVE') {
        setErrorMessage('At least one active Super Admin account must remain in the system.');
        return;
      }
      setIsConfirmingRoleChange(true);
    } else {
      setIsConfirmingRoleChange(false);
    }

    setForm((prev) => ({ ...prev, role: selectedRole }));
    setErrorMessage(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    try {
      // 1. Full name validation
      if (!form.fullName.trim()) {
        throw new Error('Full Name is required.');
      }

      // 2. Username validation
      const userCheck = AdminUserService.validateUsername(
        form.username,
        editingUser?.id
      );
      if (!userCheck.isValid) throw new Error(userCheck.message);

      // 3. Email validation
      const emailCheck = AdminUserService.validateEmail(
        form.email,
        editingUser?.id
      );
      if (!emailCheck.isValid) throw new Error(emailCheck.message);

      // 4. Employee code validation
      if (form.employeeCode) {
        const codeCheck = AdminUserService.validateEmployeeCode(
          form.employeeCode,
          editingUser?.id
        );
        if (!codeCheck.isValid) throw new Error(codeCheck.message);
      }

      // 5. Password validation on Create
      if (!isEditing) {
        const pwdCheck = AdminUserService.validatePassword(form.password || '');
        if (!pwdCheck.isValid) throw new Error(pwdCheck.message);

        if (form.password !== form.confirmPassword) {
          throw new Error('Password and Confirm Password must match.');
        }
      }

      // 6. Security guard: Admin cannot create or promote to Super Admin
      if (form.role === 'SUPER_ADMIN' && !isActorSuperAdmin) {
        throw new Error('This Super Admin account is protected and cannot be created by an Admin user.');
      }

      // 7. Last superadmin check
      if (
        isEditing &&
        editingUser?.role === 'SUPER_ADMIN' &&
        form.role !== 'SUPER_ADMIN' &&
        totalActiveSuperAdmins <= 1 &&
        editingUser.status === 'ACTIVE'
      ) {
        throw new Error('At least one active Super Admin account must remain in the system.');
      }

      onSave(form, editingUser?.id);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
        toast.error(err.message, 'Validation Error');
      } else {
        const msg = 'An unexpected error occurred.';
        setErrorMessage(msg);
        toast.error(msg, 'Validation Error');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div
        id="admin-user-modal"
        className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden my-6 transition-all"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#08775A]/20 text-[#2dd4bf]">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                {isEditing ? 'Edit Administrative Account' : 'Provision New Admin User'}
              </h2>
              <p className="text-[11px] text-slate-300">
                {isEditing
                  ? `Modifying credentials and security status for ${editingUser?.fullName}`
                  : 'Establish administrative credentials and governance roles'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <span className="font-bold">Validation Error:</span> {errorMessage}
              </div>
            </div>
          )}

          {/* Role Confirmation Alert if downgrading super admin */}
          {isConfirmingRoleChange && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                <span>Change Administrative Role?</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Downgrading this account from <strong>Super Admin</strong> to <strong>Admin</strong> will remove root governance and full system security privileges.
              </p>
            </div>
          )}

          {/* Role Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Administrative Role <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option 1: Standard Admin */}
              <button
                type="button"
                onClick={() => handleRoleSelect('ADMIN')}
                className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                  form.role === 'ADMIN'
                    ? 'border-[#08775A] bg-[#effaf5] ring-2 ring-[#08775A]/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div
                  className={`p-1.5 rounded-md ${
                    form.role === 'ADMIN'
                      ? 'bg-[#08775A] text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <UserCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1">
                    Hospital Administrator
                  </div>
                  <div className="text-[10.5px] text-slate-500 leading-tight mt-0.5">
                    Standard operations across departments, wards, rates, and records.
                  </div>
                </div>
              </button>

              {/* Option 2: Super Admin (ONLY VISIBLE/SELECTABLE IF ACTOR IS SUPER ADMIN) */}
              {isActorSuperAdmin ? (
                <button
                  type="button"
                  onClick={() => handleRoleSelect('SUPER_ADMIN')}
                  className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                    form.role === 'SUPER_ADMIN'
                      ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-md ${
                      form.role === 'SUPER_ADMIN'
                        ? 'bg-[#08775A] text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-1">
                      Super Administrator
                      <Lock className="h-3 w-3 text-[#08775A]" />
                    </div>
                    <div className="text-[10.5px] text-slate-500 leading-tight mt-0.5">
                      Executive governance, root security, and audit management.
                    </div>
                  </div>
                </button>
              ) : (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 text-left flex items-start gap-2.5 opacity-60 cursor-not-allowed">
                  <div className="p-1.5 rounded-md bg-slate-200 text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-600 flex items-center gap-1">
                      Super Administrator
                      <span className="text-[9.5px] px-1 py-0.2 bg-slate-200 rounded font-semibold text-slate-600">
                        Restricted
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Only an active Super Admin may assign this security tier.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Full Name & Employee Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="admin-form-fullname"
                type="text"
                placeholder="e.g. Dr. Farhana Yasmeen"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Employee / Admin Code
              </label>
              <input
                id="admin-form-employeecode"
                type="text"
                placeholder="e.g. EMP-ADM-06 (Auto if blank)"
                value={form.employeeCode}
                onChange={(e) =>
                  setForm({ ...form, employeeCode: e.target.value.toUpperCase() })
                }
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white font-mono"
              />
            </div>
          </div>

          {/* Username & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Username <span className="text-rose-500">*</span>
              </label>
              <input
                id="admin-form-username"
                type="text"
                placeholder="e.g. farhana.yasmeen"
                value={form.username}
                onChange={(e) =>
                  setForm({ ...form, username: e.target.value.toLowerCase() })
                }
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address <span className="text-rose-500">*</span>
              </label>
              <input
                id="admin-form-email"
                type="email"
                placeholder="e.g. farhana.yasmeen@sharif-saeed.hospital"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white"
                required
              />
            </div>
          </div>

          {/* Phone & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Contact Phone
              </label>
              <input
                id="admin-form-phone"
                type="text"
                placeholder="e.g. +92 321 9876543"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account Status <span className="text-rose-500">*</span>
              </label>
              <select
                id="admin-form-status"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as AdminUserStatus,
                  })
                }
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white text-slate-800 font-medium"
              >
                <option value="ACTIVE">Active (Can Login & Administer)</option>
                <option value="INACTIVE">Inactive (Login Disabled)</option>
                <option value="SUSPENDED">Suspended (Access Revoked)</option>
              </select>
            </div>
          </div>

          {/* Password fields (Only on Add new user) */}
          {!isEditing && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Key className="h-3.5 w-3.5 text-[#08775A]" />
                <span>Initial Account Password</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Must be at least 8 characters and include at least one letter and one number.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Temporary Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="admin-form-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min 8 characters"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    className="w-full text-xs px-3 py-2 pr-8 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-7 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <div className="relative">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Confirm Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="admin-form-confirmpassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Re-enter password"
                    value={form.confirmPassword}
                    onChange={(e) =>
                      setForm({ ...form, confirmPassword: e.target.value })
                    }
                    className="w-full text-xs px-3 py-2 pr-8 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-white font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-7 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.requirePasswordChangeOnLogin}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        requirePasswordChangeOnLogin: e.target.checked,
                      })
                    }
                    className="rounded border-slate-300 text-[#08775A] focus:ring-[#149E75]"
                  />
                  <span>Require user to change password upon first sign-in</span>
                </label>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              id="admin-form-cancel-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              id="admin-form-submit-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065e46] rounded-xl shadow-xs transition-colors"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{isEditing ? 'Save Changes' : 'Provision Admin User'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
