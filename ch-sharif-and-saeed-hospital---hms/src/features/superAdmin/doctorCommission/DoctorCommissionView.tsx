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
  adjustCommission,
} from '../../../services/commissionService';
import { fetchStaffUsers } from '../../../services/staffUserService';
import { fetchServices } from '../../../services/serviceRatesService';
import { CommissionRunsPanel } from './CommissionRunsPanel';
import { FinancialAdjustmentModal } from '../payroll/FinancialAdjustmentModal';
import { PreferredPaymentAccount } from '../payroll/PreferredPaymentAccount';
import { getHospitalCurrentDate, formatDateISO } from '../../../utils/dateConstants';
import { Modal } from '../../../components/common/Modal';
import { TextInput, NumberInput, Select } from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

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
  const [staff, setStaff] = useState<Awaited<ReturnType<typeof fetchStaffUsers>>>([]);
  const [services, setServices] = useState<Awaited<ReturnType<typeof fetchServices>>>([]);
  const [adjusting, setAdjusting] = useState<CommissionAccrual | null>(null);
  const [accrualError, setAccrualError] = useState('');
  const [ledgerVersion, setLedgerVersion] = useState(0);

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
    setAccrualError('');
    try {
      setAccruals(await fetchCommissionAccruals());
      setLedgerVersion(v => v + 1);
    } catch {
      setAccrualError('Unable to load commission payments. Please retry.');
    } finally {
      setIsLoadingAccruals(false);
    }
  };

  useEffect(() => {
    loadAccruals();
    let active = true;
    Promise.all([fetchStaffUsers(), fetchServices()]).then(([s, v]) => { if (active) { setStaff(s); setServices(v); } })
      .catch(() => { if (active) setAccrualError('Unable to load doctor/service choices. Refresh to retry.'); });
    return () => { active = false; };
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

  const doctors = useMemo(() => staff.filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE'), [staff]);

  // staff.md §4/§7 — a commission rate can only be set for a service the
  // doctor is actually assigned to (Doctor Assignments, Staff Add/Edit).
  // Department membership alone never creates a commission-eligible service.
  const selectedDoctor = useMemo(() => doctors.find((d) => d.id === formValues.staffId), [doctors, formValues.staffId]);
  const doctorAssignedServices = useMemo(() => {
    if (!selectedDoctor) return [];
    const allActive = services.filter((s) => s.status === 'Active');
    return allActive.filter((s) => selectedDoctor.assignedServiceIds?.includes(s.id));
  }, [selectedDoctor, services]);

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

  const totalAccrued = accruals.reduce((sum, a) => sum + a.commissionAmount, 0);
  const totalPaid = accruals.reduce((sum, a) => sum + a.paidTotal, 0);
  const totalRemainingAccruals = accruals.reduce((sum, a) => sum + a.remaining, 0);

  const kpis: KpiItem[] = useMemo(() => {
    return [
      {
        category: 'TARIFF GOVERNANCE',
        title: 'Active Rules',
        value: rules.length,
        icon: Coins,
        subtitle: 'Configured doctor fee shares',
        tone: 'default',
      },
      {
        category: 'ELIGIBLE CLINICIANS',
        title: 'Active Doctors',
        value: doctors.length,
        icon: ShieldCheck,
        subtitle: 'Available for clinical assignments',
        tone: 'info',
      },
      {
        category: 'EARNED REVENUE',
        title: 'Accrued Commission',
        value: formatPKR(totalAccrued),
        icon: Banknote,
        subtitle: 'Billed patient share',
        tone: 'warning',
      },
      {
        category: 'PAYOUT SETTLEMENT',
        title: 'Settled Payouts',
        value: formatPKR(totalPaid),
        icon: CheckCircle2,
        subtitle: `Remaining: ${formatPKR(totalRemainingAccruals)}`,
        tone: 'success',
      },
    ];
  }, [rules.length, doctors.length, totalAccrued, totalPaid, totalRemainingAccruals]);

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
    <div className="space-y-4">
      {/* Section 4.1 Card Page Header Block */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">Doctor Commission Engine</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                  Rule-Engine Active
                </span>
              </div>
              <p className="text-xs text-[#52665e] mt-0.5 max-w-2xl">
                Fixed &amp; percentage commission rules per doctor/service, Gross/Net calculations, and independent Commission Tax
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAdd}
            disabled={doctors.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
            title={doctors.length === 0 ? 'No active doctors found in Staff Users' : undefined}
          >
            <Plus className="h-4 w-4" />
            <span>Add Commission Rule</span>
          </button>
        </div>
      </div>

      {/* Section 4.2 & Section 9 HospitalKpiHeader */}
      <HospitalKpiHeader columns="grid-cols-2 sm:grid-cols-4" items={kpis} />

      {/* Section 4.4 Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs flex items-center gap-2">
        <span className="text-xs font-semibold text-[#52665e]">Doctor Filter:</span>
        <select
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          className="text-xs px-3 py-1.5 border border-[#c2e7db] rounded-lg bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
        >
          <option value="All">All Doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </select>
      </div>

      {/* Section 4.5 Data Table (Commission Rules) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#c2e7db]" />
            <span className="font-semibold text-xs tracking-wide">Doctor Commission Rule Matrix</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {filteredRules.length} Rules
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Doctor</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Service Scope</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Rule Rate</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Basis</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Commission Tax</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Effective From</th>
                <th className="py-2.5 px-4">Effective To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-slate-700">
              {filteredRules.map((r, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={r.id}
                    className={`transition-colors border-b border-[#e2eae5] ${
                      isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#e7f6f1]/40`}
                  >
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-[#123e2b] border-r border-[#e2eae5]">{r.doctorName}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">{r.serviceName || <span className="text-[#52665e] italic">All Assigned Services (default)</span>}</td>
                    <td className="py-2.5 px-4 font-mono font-bold text-[#08775A] border-r border-[#e2eae5]">
                      {r.ruleType === 'PERCENTAGE' ? `${r.rate}%` : formatPKR(r.rate)}
                    </td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5] font-semibold">{r.basis === 'GROSS' ? 'Gross' : 'Net (Post-Discount)'}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                      {r.commissionTaxMethod ? (
                        <span className="text-amber-700 font-mono font-bold">
                          {r.commissionTaxMethod === 'PERCENTAGE' ? `${r.commissionTaxValue}%` : formatPKR(r.commissionTaxValue || 0)}
                        </span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono border-r border-[#e2eae5]">{r.effectiveFrom}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {r.effectiveTo || <span className="text-[#08775A] font-semibold font-sans">Active / Current</span>}
                    </td>
                  </tr>
                );
              })}

              {filteredRules.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#52665e]">
                    <Coins className="h-8 w-8 text-[#52665e]/40 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-[#123e2b] block">No commission rules configured yet.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CommissionRunsPanel
        doctors={doctors.map((d) => ({ id: d.id, name: d.fullName }))}
        services={services.map((s) => ({ id: s.id, name: s.name }))}
        ledgerVersion={ledgerVersion}
        onChanged={loadAccruals}
      />

      {/* Section 4.5 Data Table (Commission Accruals & Payouts) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-[#c2e7db]" />
            <span className="font-semibold text-xs tracking-wide">Commission Accruals &amp; Disbursements Ledger</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {accruals.filter((a) => doctorFilter === 'All' || a.staffId === doctorFilter).length} Accruals
            </span>
          </div>
        </div>

        {accrualError && (
          <div role="alert" className="p-3 text-rose-700 text-xs bg-rose-50 border-b border-rose-200">
            {accrualError} <button onClick={loadAccruals} className="font-semibold underline ml-1 cursor-pointer">Retry</button>
          </div>
        )}

        {isLoadingAccruals ? (
          <div className="flex items-center justify-center py-10 text-[#52665e] gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-[#08775A]" /> Loading accruals…
          </div>
        ) : accruals.length === 0 ? (
          <div className="py-10 text-center text-[#52665e] text-xs">
            No commission has accrued yet — accruals are generated automatically when a billed invoice matches configured rules.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                  <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Doctor</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Service</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Accrual Breakdown</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2eae5] text-slate-700">
                {accruals
                  .filter((a) => doctorFilter === 'All' || a.staffId === doctorFilter)
                  .map((a, idx) => {
                    const isEven = idx % 2 === 0;
                    return (
                      <tr
                        key={a.id}
                        className={`transition-colors border-b border-[#e2eae5] ${
                          isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                        } hover:bg-[#e7f6f1]/40`}
                      >
                        <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-[#123e2b] border-r border-[#e2eae5]">{a.doctorName}</td>
                        <td className="py-2.5 px-4 border-r border-[#e2eae5]">{a.serviceName || '—'}</td>
                        <td className="py-2.5 px-4 font-mono border-r border-[#e2eae5]">
                          <div className="font-bold text-[#123e2b]">{formatPKR(a.commissionAmount)}</div>
                          <div className="text-[10px] text-[#52665e] font-normal mt-0.5">
                            Tax: {formatPKR(a.tax)} · Payable: <strong className="text-[#08775A]">{formatPKR(a.payable)}</strong> · Remaining: <strong className="text-rose-700">{formatPKR(a.remaining)}</strong>
                          </div>
                          {a.paidTotal > 0 && <div className="text-[10px] text-[#08775A]">Disbursed: {formatPKR(a.paidTotal)}</div>}
                          {a.reversedTotal > 0 && <div className="text-[10px] text-rose-600">Reversed: {formatPKR(a.reversedTotal)}</div>}
                          {a.overpaid > 0 && <div className="text-[10px] text-rose-700 font-bold">Overpaid: {formatPKR(a.overpaid)}</div>}
                          {!!a.corrections.length && (
                            <details className="text-[10px] text-[#52665e] mt-0.5">
                              <summary className="cursor-pointer text-[#08775A]">Adjustment history ({a.corrections.length})</summary>
                              {a.corrections.map((c, i) => (
                                <div key={i}>
                                  {formatPKR(Number(c.amount))} · {c.reason} · {c.createdAt.slice(0, 10)}
                                </div>
                              ))}
                            </details>
                          )}
                        </td>
                        <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              a.status === 'PAID'
                                ? 'bg-[#e7f6f1] text-[#08775A] border-[#c2e7db]'
                                : a.status === 'PARTIALLY_PAID'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : a.status === 'APPROVED'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {a.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {a.status === 'ACCRUED' && (
                            <button
                              type="button"
                              onClick={() => handleApproveAccrual(a.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer shadow-2xs transition-colors"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" /> Approve
                            </button>
                          )}
                          {(a.status === 'APPROVED' || a.status === 'PARTIALLY_PAID') && a.remaining > 0 && (
                            <button
                              type="button"
                              onClick={() => openPay(a)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer shadow-2xs transition-colors"
                            >
                              <Banknote className="h-3.5 w-3.5" /> Pay
                            </button>
                          )}
                          {['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(a.status) && (
                            <button
                              className="ml-2 text-xs font-semibold text-[#08775A] hover:underline cursor-pointer"
                              onClick={() => setAdjusting(a)}
                            >
                              Adjust
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adjusting && <FinancialAdjustmentModal title={`Commission correction — ${adjusting.doctorName}`} onClose={() => setAdjusting(null)} onSave={async (amount, reason) => { await adjustCommission(adjusting.id, amount, reason); await loadAccruals(); }} />}

      {payingAccrual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm">Record Commission Payment</h3>
              <p className="text-[11px] text-slate-500">{payingAccrual.doctorName} · {payingAccrual.serviceName || '—'}</p>
            </div>
            <div className="p-5 space-y-3.5">
              <PreferredPaymentAccount staffId={payingAccrual.staffId} purpose="Commission" onMethod={setPayMethod} />
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
