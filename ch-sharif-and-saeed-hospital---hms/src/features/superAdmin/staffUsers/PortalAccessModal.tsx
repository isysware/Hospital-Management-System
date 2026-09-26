import React, { useState, useEffect } from 'react';
import { X, KeyRound, Eye, EyeOff, Wand2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { StaffUser, StaffPortalKey, STAFF_PORTALS } from '../../../types/staffUser';
import { StaffUserService } from '../../../services/staffUserService';
import { useToast } from '../../../context/ToastContext';

interface PortalAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffUser | null;
  onGranted: () => void;
  onRevoked: () => void;
}

/**
 * staff.md §5 — the separate "Portal Access" workflow. Deliberately its own
 * screen/modal, never part of the Add/Edit Staff form. Reuses the existing
 * `/portal-users` API that already backs Admin Users.
 */
export const PortalAccessModal: React.FC<PortalAccessModalProps> = ({ isOpen, onClose, staff, onGranted, onRevoked }) => {
  const toast = useToast();
  const [assignedPortal, setAssignedPortal] = useState<StaffPortalKey | ''>('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (!isOpen || !staff) return;
    setAssignedPortal('');
    setUsername(
      staff.fullName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join('.'),
    );
    setPassword('');
    setError(null);
    setConfirmRevoke(false);
  }, [isOpen, staff]);

  if (!isOpen || !staff) return null;

  const hasAccess = staff.accessType === 'PORTAL_USER';

  const handleGeneratePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let generated = '';
    for (let i = 0; i < 8; i++) generated += chars.charAt(Math.floor(Math.random() * chars.length));
    generated += Math.floor(Math.random() * 90 + 10);
    setPassword(generated);
  };

  const handleGrant = async () => {
    setError(null);
    if (!assignedPortal) {
      setError('Select a portal.');
      toast.error('Select a portal.', 'Validation Error');
      return;
    }
    if (!username.trim()) {
      setError('Username is required.');
      toast.error('Username is required.', 'Validation Error');
      return;
    }
    const passCheck = StaffUserService.isValidPassword(password);
    if (!passCheck.valid) {
      const msg = passCheck.message || 'Invalid password.';
      setError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    if (StaffUserService.isUsernameDuplicate(username, staff.id)) {
      setError('This username is already taken.');
      toast.error('This username is already taken.', 'Validation Error');
      return;
    }

    setSubmitting(true);
    const res = await StaffUserService.grantPortalAccess(staff.id, { assignedPortal, username, password });
    setSubmitting(false);
    if (!res.success) {
      const msg = res.error || 'Failed to grant portal access.';
      setError(msg);
      toast.error(msg, 'Access Error');
      return;
    }
    toast.success(`Portal access granted for ${staff.fullName}.`, 'Access Granted');
    onGranted();
  };

  const handleRevoke = async () => {
    setSubmitting(true);
    const res = await StaffUserService.revokePortalAccess(staff.id);
    setSubmitting(false);
    if (!res.success) {
      const msg = res.error || 'Failed to revoke portal access.';
      setError(msg);
      toast.error(msg, 'Revoke Error');
      return;
    }
    toast.success(`Portal access revoked for ${staff.fullName}.`, 'Access Revoked');
    onRevoked();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-[#e2eae5] overflow-hidden">
        <div className="px-6 py-4 bg-[#f6f8f7] border-b border-[#e2eae5] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#e7f6f1] text-[#129b70] flex items-center justify-center">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#111827] text-base">Portal Access</h3>
              <p className="text-xs text-[#52665e]">{staff.fullName} ({staff.employeeCode})</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#8b9e95] hover:text-[#111827] hover:bg-[#e2eae5] cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}

          {hasAccess ? (
            confirmRevoke ? (
              <div className="space-y-4">
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Revoke Portal Access?</span>
                    {staff.fullName} will lose HMS login access immediately. Their Staff record stays intact.
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(false)}
                    className="px-3 py-1.5 text-xs font-medium text-[#52665e] hover:bg-gray-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleRevoke}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    Confirm Revoke
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 bg-[#effaf5] border border-[#c2e7db] rounded-xl text-xs text-[#08775A] flex items-start gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-bold block">Access Granted</span>
                    <div>Portal: <strong>{STAFF_PORTALS.find((p) => p.key === staff.assignedPortal)?.label || staff.assignedPortal}</strong></div>
                    <div>Username: <strong className="font-mono">{staff.username}</strong></div>
                    <div>Status: <strong>{staff.status}</strong></div>
                  </div>
                </div>
                <p className="text-[11px] text-[#8b9e95]">
                  Password reset and status changes are handled from the staff list's own actions.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(true)}
                    className="px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg cursor-pointer"
                  >
                    Revoke Access
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#52665e] mb-1">
                  Portal <span className="text-red-500">*</span>
                </label>
                <select
                  value={assignedPortal}
                  onChange={(e) => setAssignedPortal(e.target.value as StaffPortalKey | '')}
                  className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                >
                  <option value="">Select Portal</option>
                  {STAFF_PORTALS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#52665e] mb-1">
                  Username <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-[#52665e]">
                    Temporary Password <span className="text-red-500">*</span>
                  </label>
                  <button type="button" onClick={handleGeneratePassword} className="text-[10px] font-semibold text-[#08775A] hover:underline flex items-center gap-1 cursor-pointer">
                    <Wand2 className="h-3 w-3" /> Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 chars, 1 letter, 1 number"
                    className="w-full pl-3 pr-8 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b9e95] hover:text-[#111827] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-[10px] text-[#8b9e95] mt-1">Staff must change this on first login.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#e2eae5]">
                <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-[#52665e] hover:bg-gray-100 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleGrant}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Grant Access
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
