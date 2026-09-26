import React, { useState } from 'react';
import {
  X,
  KeyRound,
  Eye,
  EyeOff,
  Wand2,
  Copy,
  Check,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { StaffUser } from '../../../types/staffUser';
import { StaffUserService } from '../../../services/staffUserService';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

interface StaffUserResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffUser | null;
  onSuccess: (newPassword: string) => void;
}

export const StaffUserResetPasswordModal: React.FC<StaffUserResetPasswordModalProps> = ({
  isOpen,
  onClose,
  staff,
  onSuccess,
}) => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requireChange, setRequireChange] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedPassword, setCompletedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !staff) return null;

  const handleGeneratePassword = () => {
    // Generate secure password: 10 chars with letters, numbers, symbol
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let generated = 'Hms';
    for (let i = 0; i < 7; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    generated += Math.floor(Math.random() * 90 + 10); // add 2 numbers
    setNewPassword(generated);
    setConfirmPassword(generated);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newPassword) {
      setError('Please enter a new password.');
      toast.error('Please enter a new password.', 'Validation Error');
      return;
    }

    const check = StaffUserService.isValidPassword(newPassword);
    if (!check.valid) {
      const msg = check.message || 'Password does not meet requirements.';
      setError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      toast.error('Passwords do not match.', 'Validation Error');
      return;
    }

    const res = await StaffUserService.resetStaffPassword(
      staff.id,
      newPassword,
      requireChange,
      currentUser
    );
    if (!res.success) {
      const msg = res.error || 'Failed to reset password.';
      setError(msg);
      toast.error(msg, 'Reset Failed');
      return;
    }

    setCompletedPassword(newPassword);
    onSuccess(newPassword);
  };

  const handleCopy = () => {
    if (completedPassword) {
      navigator.clipboard.writeText(completedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-[#e2eae5] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-[#f6f8f7] border-b border-[#e2eae5] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#111827] text-sm">Reset Portal Password</h3>
              <p className="text-xs text-[#52665e]">{staff.fullName} ({staff.employeeCode})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8b9e95] hover:text-[#111827] hover:bg-[#e2eae5] transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {completedPassword ? (
            <div className="space-y-4">
              <div className="p-4 bg-[#e7f6f1] border border-[#c2e7db] rounded-xl flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-[#0e7d5a] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-xs text-[#0e7d5a]">Password Reset Successfully</h4>
                  <p className="text-[11px] text-[#52665e] mt-0.5 leading-relaxed">
                    The portal password for <strong>{staff.username}</strong> has been updated. Provide
                    the temporary password below to the staff member.
                  </p>
                </div>
              </div>

              <div className="bg-[#f6f8f7] border border-[#e2eae5] rounded-xl p-3.5 space-y-2">
                <div className="text-[11px] text-[#52665e] font-semibold uppercase tracking-wider">
                  Temporary Credential Card
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[#8b9e95] text-[10px] block">Username:</span>
                    <span className="font-mono font-bold text-[#111827]">{staff.username}</span>
                  </div>
                  <div>
                    <span className="text-[#8b9e95] text-[10px] block">Portal:</span>
                    <span className="font-bold uppercase text-[#0e7d5a]">
                      {staff.assignedPortal}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#e2eae5]">
                  <span className="text-[#8b9e95] text-[10px] block">New Password:</span>
                  <div className="flex items-center justify-between mt-1 bg-white px-3 py-2 rounded-lg border border-[#e2eae5]">
                    <span className="font-mono font-bold text-sm text-[#111827]">
                      {completedPassword}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex items-center gap-1 text-xs text-[#0e7d5a] font-semibold hover:text-[#129b70] cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 text-xs font-semibold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-[#f6f8f7] p-3 rounded-lg border border-[#e2eae5] text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[#8b9e95] text-[10px] block uppercase">Username</span>
                    <span className="font-mono font-bold text-[#111827]">{staff.username}</span>
                  </div>
                  <div>
                    <span className="text-[#8b9e95] text-[10px] block uppercase">Assigned Portal</span>
                    <span className="font-bold uppercase text-[#0e7d5a]">
                      {staff.assignedPortal} Portal
                    </span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Password Fields */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-[#52665e]">
                    New Temporary Password <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="flex items-center gap-1 text-[11px] text-[#0e7d5a] font-semibold hover:text-[#129b70] cursor-pointer"
                  >
                    <Wand2 className="h-3 w-3" />
                    <span>Auto Generate</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 chars, 1 letter, 1 number"
                    className="w-full pl-3 pr-8 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b9e95] hover:text-[#111827] cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#52665e] mb-1">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                  />
                </div>
              </div>

              {/* Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={requireChange}
                  onChange={(e) => setRequireChange(e.target.checked)}
                  className="rounded text-[#129b70] focus:ring-[#129b70] h-4 w-4"
                />
                <span className="text-xs text-[#52665e] font-medium">
                  Require password change on next login
                </span>
              </label>

              {/* Actions */}
              <div className="pt-3 border-t border-[#e2eae5] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-semibold text-[#52665e] hover:bg-[#e2eae5] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm cursor-pointer"
                >
                  Confirm Password Reset
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
