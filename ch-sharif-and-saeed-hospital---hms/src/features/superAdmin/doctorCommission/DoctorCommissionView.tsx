import React, { useState, useEffect, useMemo } from 'react';
import { Coins, Plus, Loader2, AlertTriangle, CheckCircle2, AlertCircle, Percent, Banknote, ShieldCheck } from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import {
  CommissionRule,
  CommissionRuleFormValues,
  CommissionRuleType,
  CommissionBasis,
  CommissionTaxMethod,
  CommissionAccrual,
  fetchCommissionRules,
  createCommissionRule,
  fetchCommissionAccruals,
  approveCommissionAccrual,
  payCommissionAccrual,
} from '../../../services/commissionService';
import { StaffUserService } from '../../../services/staffUserService';
import { ServiceRatesService } from '../../../services/serviceRatesService';
import { getHospitalCurrentDate, formatDateISO } from '../../../utils/dateConstants';
import { Modal } from '../../../components/common/Modal';
import { TextInput, NumberInput, Select } from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';

const emptyForm = (): CommissionRuleFormValues => ({
  staffId: '',
  serviceRateId: '',
  ruleType: 'PERCENTAGE',
  rate: '',
  basis: 'NET',
  commissionTaxMethod: '',
  commissionTaxValue: '',
  effectiveFrom: formatDateISO(getHospitalCurrentDate()),
});

/**
 * v7.2 Doctor Commission (HMS_V7.2_NEW_REQUIREMENTS.md §2.7) — the backend
 * `/commission/rules` endpoint already existed pre-v7.2 (Fixed/% rules,
 * Gross/Net basis); this is the first real frontend for it, plus the new
 * Commission Tax fields. Each rule is effective-dated — adding a new one
 * for the same doctor/service does not edit history in place.
 */
export const DoctorCommissionView: React.FC = () => {
  const toast = useToast();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doctorFilter, setDoctorFilter] = useState<string>('All');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<CommissionRuleFormValues>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [accruals, setAccruals] = useState<CommissionAccrual[]>([]);
  const [isLoadingAccruals, setIsLoadingAccruals] = useState(true);
  const [payingAccrual, setPayingAccrual] = useState<CommissionAccrual | null>(null);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMethod, setPayMethod] = useState('BANK');
  const [payReference, setPayReference] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  const loadAccruals = async () => {
    setIsLoadingAccruals(true);
    try {
      setAccruals(await fetchCommissionAccruals());
    } catch {
      // Surfaced silently here — the rules table above is this screen's primary content.
    } finally {
      setIsLoadingAccruals(false);
    }
  };

  useEffect(() => {
    loadAccruals();
  }, []);

  const handleApproveAccrual = async (id: string) => {
    try {
      await approveCommissionAccrual(id);
      toast.success('Commission accrual approved.');
      await loadAccruals();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to approve.', 'Approve Error');
    }
  };

  const openPay = (accrual: CommissionAccrual) => {
    setPayingAccrual(accrual);
    setPayAmount(accrual.remaining);
    setPayMethod('BANK');
    setPayReference('');
  };

  const submitPay = async () => {
    if (!payingAccrual || payAmount === '' || Number(payAmount) <= 0) return;
    setIsSubmittingPay(true);
    try {
      await payCommissionAccrual(payingAccrual.id, { amount: Number(payAmount), method: payMethod, reference: payReference || undefined });
      toast.success(`Commission payment recorded for ${payingAccrual.doctorName}.`);
      setPayingAccrual(null);
      await loadAccruals();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to record payment.', 'Payment Error');
    } finally {
      setIsSubmittingPay(false);
    }
  };

  const doctors = useMemo(() => StaffUserService.getStaffUsers().filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE'), []);

  // staff.md §4/§7 — a commission rate can only be set for a service the
  // doctor is actually assigned to (Doctor Assignments, Staff Add/Edit).
  // Department membership alone never creates a commission-eligible service.
  const selectedDoctor = useMemo(() => doctors.find((d) => d.id === formValues.staffId), [doctors, formValues.staffId]);
  const doctorAssignedServices = useMemo(() => {
    if (!selectedDoctor) return [];
    const allActive = ServiceRatesService.getServices().filter((s) => s.status === 'Active');
    return allActive.filter((s) => selectedDoctor.assignedServiceIds?.includes(s.id));
  }, [selectedDoctor]);

  const loadRules = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setRules(await fetchCommissionRules());
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load doctor commission rules.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const filteredRules = useMemo(() => {
    if (doctorFilter === 'All') return rules;
    return rules.filter((r) => r.staffId === doctorFilter);
  }, [rules, doctorFilter]);

  const handleOpenAdd = () => {
    setFormValues(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValues.staffId) {
      const msg = 'Select a doctor.';
      setFormError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    if (formValues.rate === '' || Number(formValues.rate) <= 0) {
      const msg = 'Rate must be greater than zero.';
      setFormError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await createCommissionRule(formValues);
      toast.success('Commission rule saved.');
      setIsFormOpen(false);
      await loadRules();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to save commission rule.';
      setFormError(msg);
      toast.error(msg, 'Save Error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading doctor commission rules…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button type="button" onClick={loadRules} className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900">Doctor Commission</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">v7.2</span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Fixed/% commission rules per doctor (optionally per service), Gross/Net basis, and Commission Tax — a stream fully
            independent of Salary Tax. Doctor-Sponsored Discounts are deducted from commission payable at billing time.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          disabled={doctors.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#149E75] hover:bg-[#08775A] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors shrink-0 disabled:opacity-50"
          title={doctors.length === 0 ? 'No active doctors found in Staff Users' : undefined}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Commission Rule</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500">Doctor:</span>
        <select
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-[#149E75]"
        >
          <option value="All">All Doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-2.5 px-4">Doctor</th>
                <th className="py-2.5 px-4">Service</th>
                <th className="py-2.5 px-4">Rule</th>
                <th className="py-2.5 px-4">Basis</th>
                <th className="py-2.5 px-4">Commission Tax</th>
                <th className="py-2.5 px-4">Effective From</th>
                <th className="py-2.5 px-4">Effective To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredRules.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-bold text-slate-900">{r.doctorName}</td>
                  <td className="py-2.5 px-4">{r.serviceName || <span className="text-slate-400 italic">All Services (default)</span>}</td>
                  <td className="py-2.5 px-4 font-mono font-semibold">
                    {r.ruleType === 'PERCENTAGE' ? `${r.rate}%` : formatPKR(r.rate)}
                  </td>
                  <td className="py-2.5 px-4">{r.basis === 'GROSS' ? 'Gross' : 'Net'}</td>
                  <td className="py-2.5 px-4">
                    {r.commissionTaxMethod ? (
                      <span className="text-amber-700 font-semibold">
                        {r.commissionTaxMethod === 'PERCENTAGE' ? `${r.commissionTaxValue}%` : formatPKR(r.commissionTaxValue || 0)}
                      </span>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">{r.effectiveFrom}</td>
                  <td className="py-2.5 px-4">{r.effectiveTo || <span className="text-emerald-600 font-semibold">Current</span>}</td>
                </tr>
              ))}

              {filteredRules.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <Coins className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-slate-700 block">No commission rules configured yet.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commission Accruals & Payments (staff.md §14/§20) — created automatically at billing time
          from the rules above; never a manual entry. Approve locks it, Pay records a real CommissionPayout. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-[#08775A]" />
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Commission Accruals &amp; Payments</h3>
        </div>
        {isLoadingAccruals ? (
          <div className="flex items-center justify-center py-10 text-slate-500 gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : accruals.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-xs">No commission has accrued yet — it's created automatically when a billed service line matches a rule above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Doctor</th>
                  <th className="py-2.5 px-4">Service</th>
                  <th className="py-2.5 px-4">Accrued</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {accruals.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-bold text-slate-900">{a.doctorName}</td>
                    <td className="py-2.5 px-4">{a.serviceName || '—'}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {formatPKR(a.commissionAmount)}
                      {a.paidTotal > 0 && <div className="text-[10px] text-slate-400 font-normal">Paid: {formatPKR(a.paidTotal)}</div>}
                      {a.reversedTotal > 0 && <div className="text-[10px] text-red-500 font-normal">Reversed: {formatPKR(a.reversedTotal)}</div>}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                        a.status === 'PAID' ? 'bg-[#e7f6f1] text-[#0e7d5a] border-[#c2e7db]'
                        : a.status === 'PARTIALLY_PAID' ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : a.status === 'APPROVED' ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {a.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {a.status === 'ACCRUED' && (
                        <button type="button" onClick={() => handleApproveAccrual(a.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#149E75] hover:bg-[#08775A] rounded-md cursor-pointer">
                          <ShieldCheck className="h-3 w-3" /> Approve
                        </button>
                      )}
                      {(a.status === 'APPROVED' || a.status === 'PARTIALLY_PAID') && a.remaining > 0 && (
                        <button type="button" onClick={() => openPay(a)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#149E75] hover:bg-[#08775A] rounded-md cursor-pointer">
                          <Banknote className="h-3 w-3" /> Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payingAccrual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm">Record Commission Payment</h3>
              <p className="text-[11px] text-slate-500">{payingAccrual.doctorName} · {payingAccrual.serviceName || '—'}</p>
            </div>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (PKR) — remaining {formatPKR(payingAccrual.remaining)}</label>
                <input type="number" onWheel={(e) => e.currentTarget.blur()} min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white">
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK">Bank Transfer</option>
                  <option value="ONLINE">Online</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Reference (optional)</label>
                <input type="text" value={payReference} onChange={(e) => setPayReference(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setPayingAccrual(null)} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
                <button type="button" disabled={isSubmittingPay} onClick={submitPay} className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer disabled:opacity-50">
                  {isSubmittingPay ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} title="Add Doctor Commission Rule" maxWidth="lg">
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">{formError}</div>
          )}
          <Select
            label="Doctor"
            required
            options={doctors.map((d) => ({ label: `${d.fullName} (${d.designation})`, value: d.id }))}
            value={formValues.staffId}
            onChange={(e) => setFormValues({ ...formValues, staffId: e.target.value, serviceRateId: '' })}
          />
          <Select
            label="Service (optional — leave blank for this doctor's default rule)"
            hint={
              !formValues.staffId
                ? 'Select a doctor first.'
                : doctorAssignedServices.length === 0
                ? 'This doctor has no Assigned Services yet — set them from Staff Users → Edit before scoping a rule to a specific service.'
                : "Only this doctor's Assigned Services are shown."
            }
            disabled={!formValues.staffId}
            options={doctorAssignedServices.map((s) => ({ label: s.name, value: s.id }))}
            value={formValues.serviceRateId}
            onChange={(e) => setFormValues({ ...formValues, serviceRateId: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Rule Type"
              options={[
                { label: 'Percentage', value: 'PERCENTAGE' },
                { label: 'Fixed Per Service', value: 'FIXED_PER_SERVICE' },
              ]}
              value={formValues.ruleType}
              onChange={(e) => setFormValues({ ...formValues, ruleType: e.target.value as CommissionRuleType })}
            />
            <NumberInput
              label={formValues.ruleType === 'PERCENTAGE' ? 'Rate (%)' : 'Rate (PKR per service)'}
              required
              min={0}
              step={formValues.ruleType === 'PERCENTAGE' ? 0.5 : 50}
              value={formValues.rate}
              onChange={(e) => setFormValues({ ...formValues, rate: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </div>
          <Select
            label="Commission Basis"
            hint="Gross = before discounts. Net = after discounts."
            options={[
              { label: 'Net (after discount)', value: 'NET' },
              { label: 'Gross', value: 'GROSS' },
            ]}
            value={formValues.basis}
            onChange={(e) => setFormValues({ ...formValues, basis: e.target.value as CommissionBasis })}
          />
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-3 flex items-center gap-1.5">
              <Percent className="h-3.5 w-3.5" /> Commission Tax (optional, independent of Salary Tax)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Tax Method"
                options={[
                  { label: 'No Tax', value: '' },
                  { label: 'Percentage', value: 'PERCENTAGE' },
                  { label: 'Fixed Amount', value: 'FIXED' },
                ]}
                value={formValues.commissionTaxMethod}
                onChange={(e) => setFormValues({ ...formValues, commissionTaxMethod: e.target.value as CommissionTaxMethod })}
              />
              <NumberInput
                label={formValues.commissionTaxMethod === 'PERCENTAGE' ? 'Tax Value (%)' : 'Tax Value (PKR)'}
                disabled={!formValues.commissionTaxMethod}
                min={0}
                step={formValues.commissionTaxMethod === 'PERCENTAGE' ? 0.5 : 100}
                value={formValues.commissionTaxValue}
                onChange={(e) => setFormValues({ ...formValues, commissionTaxValue: e.target.value === '' ? '' : Number(e.target.value) })}
              />
            </div>
          </div>
          <TextInput
            label="Effective From"
            lang="en-GB" type="date"
            required
            value={formValues.effectiveFrom}
            onChange={(e) => setFormValues({ ...formValues, effectiveFrom: e.target.value })}
          />
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save Commission Rule'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
