import React, { useEffect, useState } from 'react';
import { formatPKR } from '../../../utils/formatters';
import {
  X,
  User,
  Briefcase,
  KeyRound,
  History,
  Activity,
  Printer,
  Edit2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';
import { StaffUser } from '../../../types/staffUser';
import { StaffUserService } from '../../../services/staffUserService';

interface StaffUserDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffUser | null;
  onEdit: (staff: StaffUser) => void;
  onPrintDossier: (staff: StaffUser) => void;
}

export const StaffUserDetailModal: React.FC<StaffUserDetailModalProps> = ({
  isOpen,
  onClose,
  staff,
  onEdit,
  onPrintDossier,
}) => {
  const [commission, setCommission] = useState<Record<string, string> | null>(null);
  const [financeError, setFinanceError] = useState('');
  useEffect(() => {
    let active = true;
    setCommission(null); setFinanceError('');
    if (isOpen && staff?.id) StaffUserService.fetchFullProfile(staff.id)
      .then(profile => { if (active) setCommission(profile.commission ?? null); })
      .catch(() => { if (active) setFinanceError('Unable to load commission balances.'); });
    return () => { active = false; };
  }, [isOpen, staff?.id]);
  if (!isOpen || !staff) return null;

  const auditHistory = StaffUserService.getAuditLogs().filter(
    (l) => l.staffUserId === staff.id
  );
  const isPortalUser = staff.accessType === 'PORTAL_USER';

  const getStatusBadge = (status: StaffUser['status']) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#e7f6f1] text-[#0e7d5a] border border-[#c2e7db]">
            <CheckCircle className="h-3.5 w-3.5 text-[#129b70]" />
            Active
          </span>
        );
      case 'INACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            <XCircle className="h-3.5 w-3.5 text-gray-500" />
            Inactive
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            Suspended
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-[#e2eae5] flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-[#f6f8f7] border-b border-[#e2eae5] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#e7f6f1] text-[#129b70] flex items-center justify-center font-bold text-sm">
              {staff.fullName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-[#111827] text-base">{staff.fullName}</h3>
                {getStatusBadge(staff.status)}
              </div>
              <p className="text-xs text-[#52665e] font-mono">
                {staff.employeeCode} • {staff.designation}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8b9e95] hover:text-[#111827] hover:bg-[#e2eae5] transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-[#111827]">
          <section aria-label="Commission balances" className="space-y-2">
            <h4 className="font-bold">Collection-Based Doctor Commission</h4>
            {financeError && <p role="alert" className="text-rose-700">{financeError}</p>}
            {commission ? <dl className="grid grid-cols-2 gap-3">
              {Object.entries({ generated: 'Commission Generated', paid: 'Commission Paid', outstanding: 'Commission Outstanding', recoverable: 'Recoverable Overpayment' }).map(([key, label]) =>
                <div key={key}><dt className="text-slate-500">{label}</dt><dd className="font-semibold">{formatPKR(Number(commission[key] ?? 0))}</dd></div>)}
            </dl> : !financeError && <p>Loading commission balances?</p>}
          </section>
          {/* Section 1: Personal Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-[#e2eae5]">
              <User className="h-4 w-4 text-[#129b70]" />
              <h4 className="font-bold uppercase tracking-wider text-[#52665e] text-[11px]">
                Personal Information
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-[#f6f8f7] p-3.5 rounded-xl border border-[#e2eae5]/70">
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Full Name</span>
                <span className="font-semibold text-sm">{staff.fullName}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Father / Guardian</span>
                <span className="font-medium">{staff.fatherGuardianName || '—'}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">CNIC</span>
                <span className="font-mono font-medium">{staff.cnic || '—'}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Primary Phone</span>
                <span className="font-medium">{staff.phone}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Alternate Phone</span>
                <span className="font-medium">{staff.alternatePhone || '—'}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Gender</span>
                <span className="font-medium">{staff.gender || '—'}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Email</span>
                <span className="font-medium">{staff.email || '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-[#8b9e95] block text-[10px] uppercase">Residential Address</span>
                <span className="font-medium">{staff.address || '—'}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Employment Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-[#e2eae5]">
              <Briefcase className="h-4 w-4 text-[#129b70]" />
              <h4 className="font-bold uppercase tracking-wider text-[#52665e] text-[11px]">
                Employment & Department
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-[#f6f8f7] p-3.5 rounded-xl border border-[#e2eae5]/70">
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Employee Code</span>
                <span className="font-mono font-bold text-[#0e7d5a]">{staff.employeeCode}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Designation</span>
                <span className="font-semibold">{staff.designation}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Department</span>
                <span className="font-medium text-[#111827]">{staff.departmentName}</span>
              </div>
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Staff Category</span>
                <span className="font-medium">{staff.staffCategory}</span>
              </div>
              {staff.qualification && (
                <div>
                  <span className="text-[#8b9e95] block text-[10px] uppercase">Qualification</span>
                  <span className="font-medium">{staff.qualification}</span>
                </div>
              )}
              {staff.pmdcNumber && (
                <div>
                  <span className="text-[#8b9e95] block text-[10px] uppercase">PMDC / License #</span>
                  <span className="font-mono font-bold text-[#08775A]">{staff.pmdcNumber}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: System Access */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-[#e2eae5]">
              <KeyRound className="h-4 w-4 text-[#129b70]" />
              <h4 className="font-bold uppercase tracking-wider text-[#52665e] text-[11px]">
                Workstation Entitlements & Credentials
              </h4>
            </div>
            <div className="bg-[#f6f8f7] p-3.5 rounded-xl border border-[#e2eae5]/70 space-y-2.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[#8b9e95] block text-[10px] uppercase">Access Type</span>
                  <span className="font-semibold">
                    {isPortalUser ? 'Portal User (Sign-in Enabled)' : 'Staff Record Only'}
                  </span>
                </div>
                <div>
                  <span className="text-[#8b9e95] block text-[10px] uppercase">Staff Role</span>
                  <span className="font-bold text-[#0e7d5a]">
                    {staff.staffRole || staff.staffCategory || 'Staff'}
                  </span>
                </div>
                {isPortalUser && (
                  <div className="col-span-2">
                    <span className="text-[#8b9e95] block text-[10px] uppercase">Assigned Portal</span>
                    <span className="font-bold uppercase text-[#0e7d5a]">
                      {staff.assignedPortal} Portal
                    </span>
                  </div>
                )}
              </div>

              {isPortalUser ? (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#e2eae5]">
                  <div>
                    <span className="text-[#8b9e95] block text-[10px] uppercase">Staff Role</span>
                    <span className="font-medium">{staff.staffRole || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[#8b9e95] block text-[10px] uppercase">Username</span>
                    <span className="font-mono font-medium">{staff.username}</span>
                  </div>
                  <div>
                    <span className="text-[#8b9e95] block text-[10px] uppercase">Last Login</span>
                    <span className="font-medium">{staff.lastLoginAt || 'Never'}</span>
                  </div>
                  <div>
                    <span className="text-[#8b9e95] block text-[10px] uppercase">
                      Password Change Required
                    </span>
                    <span className="font-medium">
                      {staff.requirePasswordChange ? 'Yes (Pending First Login)' : 'No'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 bg-slate-100 rounded-lg text-[#52665e] flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-slate-500 shrink-0" />
                  <span>This employee is listed in the staff directory without workstation portal login credentials.</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Activity Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-[#e2eae5]">
              <Activity className="h-4 w-4 text-[#129b70]" />
              <h4 className="font-bold uppercase tracking-wider text-[#52665e] text-[11px]">
                Hospital Activity Summary
              </h4>
            </div>
            <div className="bg-[#f6f8f7] p-3.5 rounded-xl border border-[#e2eae5]/70 flex items-center justify-between">
              <div>
                <span className="text-[#8b9e95] block text-[10px] uppercase">Recorded Transactions</span>
                <span className="text-base font-bold text-[#111827]">
                  {staff.linkedActivityCount} activities recorded
                </span>
                <p className="text-[11px] text-[#52665e] mt-0.5">
                  Includes patient registrations, billing receipts, bed admissions, and inventory records.
                </p>
              </div>
              <div className="text-right">
                {staff.linkedActivityCount > 0 ? (
                  <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-md font-semibold text-[11px]">
                    Delete Protected
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-semibold text-[11px]">
                    Removable
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section 5: Audit Trail */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-[#e2eae5]">
              <History className="h-4 w-4 text-[#129b70]" />
              <h4 className="font-bold uppercase tracking-wider text-[#52665e] text-[11px]">
                Governance & Audit Trail
              </h4>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3 bg-[#f6f8f7] p-3 rounded-lg border border-[#e2eae5]/70 text-[11px]">
                <div>
                  <span className="text-[#8b9e95] block text-[10px] uppercase">Created</span>
                  <span className="font-medium text-[#111827]">{staff.createdAt}</span>
                  <span className="text-[#52665e] block text-[10px]">by {staff.createdBy}</span>
                </div>
                <div>
                  <span className="text-[#8b9e95] block text-[10px] uppercase">Last Updated</span>
                  <span className="font-medium text-[#111827]">{staff.updatedAt}</span>
                  <span className="text-[#52665e] block text-[10px]">by {staff.updatedBy}</span>
                </div>
              </div>

              {/* Audit history list */}
              {auditHistory.length > 0 && (
                <div className="border border-[#e2eae5] rounded-xl overflow-hidden mt-3">
                  <div className="bg-[#f6f8f7] px-3 py-2 font-semibold text-[11px] text-[#52665e] border-b border-[#e2eae5]">
                    Recent Administrative Events ({auditHistory.length})
                  </div>
                  <div className="divide-y divide-[#e2eae5]/60 max-h-40 overflow-y-auto">
                    {auditHistory.map((log) => (
                      <div key={log.id} className="p-2.5 hover:bg-[#fbfcfb] text-[11px]">
                        <div className="flex items-center justify-between font-medium">
                          <span className="text-[#0e7d5a] font-semibold">{log.action}</span>
                          <span className="text-[#8b9e95] text-[10px]">{log.timestamp}</span>
                        </div>
                        <p className="text-[#52665e] mt-0.5">{log.details}</p>
                        <p className="text-[10px] text-[#8b9e95] mt-0.5">
                          Actor: {log.actorName} ({log.actorRole})
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-[#f6f8f7] border-t border-[#e2eae5] flex items-center justify-between gap-3">
          <button
            onClick={() => onPrintDossier(staff)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#52665e] hover:text-[#111827] bg-white border border-[#e2eae5] hover:bg-[#f6f8f7] rounded-lg transition-colors cursor-pointer shadow-xs"
          >
            <Printer className="h-4 w-4 text-[#129b70]" />
            <span>Print Staff Dossier</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onEdit(staff);
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <Edit2 className="h-3.5 w-3.5" />
              <span>Edit Record</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#52665e] hover:bg-[#e2eae5] rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
