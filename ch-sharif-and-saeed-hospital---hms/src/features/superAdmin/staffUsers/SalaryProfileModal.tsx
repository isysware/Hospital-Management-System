import React, { useState, useEffect } from 'react';
import { X, Wallet, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { StaffUser, SalaryBasis, SALARY_BASIS_OPTIONS } from '../../../types/staffUser';
import { StaffUserService } from '../../../services/staffUserService';
import { getHospitalCurrentDate, formatDateISO } from '../../../utils/dateConstants';
import { formatPKR } from '../../../utils/formatters';

interface SalaryProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffUser | null;
  onSuccess: () => void;
}

type SalaryTaxMethod = 'PERCENTAGE' | 'FIXED' | '';

/**
 * v7.2 Salary Profile / Salary Tax (HMS_V7.2_NEW_REQUIREMENTS.md §2.7) —
 * independent of Doctor Commission Tax. Saving always creates a new
 * effective-dated profile row server-side (closing out whichever was
 * previously current), never edits history in place.
 */
export const SalaryProfileModal: React.FC<SalaryProfileModalProps> = ({ isOpen, onClose, staff, onSuccess }) => {
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Record<string, any> | null>(null);

  const [salaryBasis, setSalaryBasis] = useState<SalaryBasis>('MONTHLY');
  const [baseAmount, setBaseAmount] = useState<number | ''>('');
  const [salaryTaxMethod, setSalaryTaxMethod] = useState<SalaryTaxMethod>('');
  const [salaryTaxValue, setSalaryTaxValue] = useState<number | ''>('');
  const [fixedAllowance, setFixedAllowance] = useState<number | ''>('');
  const [fixedDeduction, setFixedDeduction] = useState<number | ''>('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => formatDateISO(getHospitalCurrentDate()));

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !staff) return;
    setError(null);
    setEffectiveFrom(formatDateISO(getHospitalCurrentDate()));
    setIsLoadingCurrent(true);
    StaffUserService.fetchFullProfile(staff.id)
      .then((profile) => {
        const current = profile?.salary?.current || null;
        setCurrentProfile(current);
        if (current) {
          setSalaryBasis((current.salaryBasis as SalaryBasis) || 'MONTHLY');
          setBaseAmount(Number(current.baseAmount) || '');
          setSalaryTaxMethod((current.salaryTaxMethod as SalaryTaxMethod) || '');
          setSalaryTaxValue(current.salaryTaxValue != null ? Number(current.salaryTaxValue) : '');
          setFixedAllowance(Number(current.fixedAllowance) || '');
          setFixedDeduction(Number(current.fixedDeduction) || '');
        } else {
          setSalaryBasis('MONTHLY');
          setBaseAmount('');
          setSalaryTaxMethod('');
          setSalaryTaxValue('');
          setFixedAllowance('');
          setFixedDeduction('');
        }
      })
      .catch(() => setCurrentProfile(null))
      .finally(() => setIsLoadingCurrent(false));
  }, [isOpen, staff]);

  if (!isOpen || !staff) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (baseAmount === '' || Number(baseAmount) <= 0) {
      setError('Base salary amount is required.');
      return;
    }
    if (!effectiveFrom) {
      setError('Effective date is required.');
      return;
    }

    setIsSaving(true);
    const res = await StaffUserService.saveSalaryProfile(staff.id, {
      salaryBasis,
      baseAmount: Number(baseAmount),
      salaryTaxMethod,
      salaryTaxValue,
      fixedAllowance: fixedAllowance === '' ? 0 : Number(fixedAllowance),
      fixedDeduction: fixedDeduction === '' ? 0 : Number(fixedDeduction),
      effectiveFrom,
    });
    setIsSaving(false);

    if (!res.success) {
      setError(res.error || 'Failed to save salary profile.');
      return;
    }
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-[#e2eae5] overflow-hidden">
        <div className="px-6 py-4 bg-[#f6f8f7] border-b border-[#e2eae5] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#111827] text-sm">Salary Profile</h3>
              <p className="text-xs text-[#52665e]">{staff.fullName} ({staff.employeeCode})</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#8b9e95] hover:text-[#111827] hover:bg-[#e2eae5] transition-colors cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isLoadingCurrent ? (
            <div className="flex items-center justify-center py-6 text-slate-500 gap-2 text-xs">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading current profile…</span>
            </div>
          ) : (
            <>
              {currentProfile ? (
                <div className="bg-[#f6f8f7] border border-[#e2eae5] rounded-xl p-3 text-[11px] text-[#52665e] flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#08775A] shrink-0" />
                  <span>
                    Current: {formatPKR(Number(currentProfile.baseAmount))} / {String(currentProfile.salaryBasis).startsWith('PER_DAY') ? 'day' : 'month'}
                    {' '}({SALARY_BASIS_OPTIONS.find((o) => o.value === currentProfile.salaryBasis)?.label || currentProfile.salaryBasis})
                    {currentProfile.salaryTaxMethod && (
                      <>
                        {' '}· Tax: {Number(currentProfile.salaryTaxValue)}
                        {currentProfile.salaryTaxMethod === 'PERCENTAGE' ? '%' : ' PKR'}
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800">
                  No salary profile configured yet.
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#52665e] mb-1">Salary Type</label>
                    <select
                      value={salaryBasis}
                      onChange={(e) => setSalaryBasis(e.target.value as SalaryBasis)}
                      className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                    >
                      {SALARY_BASIS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#52665e] mb-1">Base Amount (PKR)</label>
                    <input
                      type="number"
                      onWheel={(e) => e.currentTarget.blur()}
                      min={0}
                      step={500}
                      value={baseAmount}
                      onChange={(e) => setBaseAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#52665e] mb-1">Salary Tax Method</label>
                    <select
                      value={salaryTaxMethod}
                      onChange={(e) => setSalaryTaxMethod(e.target.value as SalaryTaxMethod)}
                      className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                    >
                      <option value="">No Tax</option>
                      <option value="PERCENTAGE">Percentage</option>
                      <option value="FIXED">Fixed Amount</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#52665e] mb-1">
                      Tax Value {salaryTaxMethod === 'PERCENTAGE' ? '(%)' : '(PKR)'}
                    </label>
                    <input
                      type="number"
                      onWheel={(e) => e.currentTarget.blur()}
                      min={0}
                      step={salaryTaxMethod === 'PERCENTAGE' ? 0.5 : 100}
                      disabled={!salaryTaxMethod}
                      value={salaryTaxValue}
                      onChange={(e) => setSalaryTaxValue(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70] disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#52665e] mb-1">Fixed Allowance (PKR)</label>
                    <input
                      type="number"
                      onWheel={(e) => e.currentTarget.blur()}
                      min={0}
                      value={fixedAllowance}
                      onChange={(e) => setFixedAllowance(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#52665e] mb-1">Fixed Deduction (PKR)</label>
                    <input
                      type="number"
                      onWheel={(e) => e.currentTarget.blur()}
                      min={0}
                      value={fixedDeduction}
                      onChange={(e) => setFixedDeduction(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs font-mono text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#52665e] mb-1">Effective From</label>
                  <input
                    lang="en-GB" type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-[#f6f8f7] border border-[#e2eae5] rounded-lg text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                  />
                  <p className="text-[10px] text-[#8b9e95] mt-1">
                    Saving here closes out the current profile (if any) at this date and starts a new one — history is kept, never overwritten.
                  </p>
                </div>

                <p className="text-[10px] text-[#8b9e95] leading-relaxed">
                  Independent of Doctor Commission Tax — salary and commission remain separate ledgers/approvals/payments.
                </p>

                <div className="pt-3 border-t border-[#e2eae5] flex items-center justify-end gap-2">
                  <button type="button" onClick={onClose} className="px-3.5 py-2 text-xs font-semibold text-[#52665e] hover:bg-[#e2eae5] rounded-lg cursor-pointer">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    {isSaving ? 'Saving…' : 'Save Salary Profile'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
