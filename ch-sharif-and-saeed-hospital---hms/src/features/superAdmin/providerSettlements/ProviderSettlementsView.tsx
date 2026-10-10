import React, { useState, useEffect, useMemo } from 'react';
import { Landmark, Plus, Loader2, AlertTriangle, CheckCircle2, AlertCircle, FileCheck2 } from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import {
  ProviderSettlement,
  ProviderSettlementFormValues,
  fetchProviderSettlements,
  createProviderSettlement,
} from '../../../services/providerSettlementService';
import { OutsourcedProvider, fetchOutsourcedProviders, PAYMENT_METHOD_LABELS, PaymentMethod } from '../../../services/outsourcedProviderService';
import { fetchDepartments } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import { Modal } from '../../../components/common/Modal';
import { TextInput, NumberInput, Select, Textarea } from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

const EMPTY_FORM: ProviderSettlementFormValues = {
  outsourcedProviderId: '',
  departmentId: '',
  periodLabel: '',
  eligibleRealizedAmount: 0,
  settlementAmount: 0,
  status: 'PARTIAL',
  paymentMethod: 'BANK_TRANSFER',
  paymentReference: '',
  representativeName: '',
  representativeDesignation: '',
  remarks: '',
};

/**
 * v7.2 Provider Settlements ledger/voucher (HMS_V7.2_NEW_REQUIREMENTS.md
 * §2.8), also standing in for the "Department Payables" nav item — both
 * describe the same ledger from different angles. `eligibleRealizedAmount`
 * is recorded by the settling user for now (see the service-file comment
 * for why: the Front Desk department sub-invoice split, §2.2, that would
 * compute it automatically is future/out-of-phase work). The server always
 * computes `alreadySettledAmount` and rejects a settlement that would
 * exceed what remains eligible — never trusted from the client.
 */
export const ProviderSettlementsView: React.FC = () => {
  const toast = useToast();
  const [settlements, setSettlements] = useState<ProviderSettlement[]>([]);
  const [providers, setProviders] = useState<OutsourcedProvider[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [providerFilter, setProviderFilter] = useState<string>('All');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<ProviderSettlementFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [settlementRows, providerRows, departmentRows] = await Promise.all([
        fetchProviderSettlements(),
        fetchOutsourcedProviders(),
        fetchDepartments(),
      ]);
      setSettlements(settlementRows);
      setProviders(providerRows);
      setDepartments(departmentRows);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load provider settlements.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredSettlements = useMemo(() => {
    if (providerFilter === 'All') return settlements;
    return settlements.filter((s) => s.outsourcedProviderId === providerFilter);
  }, [settlements, providerFilter]);

  const activeProviders = providers.filter((p) => p.isActive);

  const selectedProvider = providers.find((p) => p.id === formValues.outsourcedProviderId);
  const remainingEligible = Math.max(0, formValues.eligibleRealizedAmount - formValues.settlementAmount);

  const handleOpenAdd = () => {
    setFormValues(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValues.outsourcedProviderId) {
      const msg = 'Select an outsourced provider.';
      setFormError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    if (formValues.eligibleRealizedAmount <= 0) {
      const msg = 'Eligible realized amount must be greater than zero.';
      setFormError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    if (formValues.settlementAmount <= 0) {
      const msg = 'Settlement amount must be greater than zero.';
      setFormError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await createProviderSettlement(formValues);
      toast.success('Provider settlement recorded and voucher generated.');
      setIsFormOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to record settlement.';
      setFormError(msg);
      toast.error(msg, 'Settlement Failed');
    } finally {
      setIsSaving(false);
    }
  };

  const kpis: KpiItem[] = useMemo(() => {
    const totalCount = filteredSettlements.length;
    const totalRealized = filteredSettlements.reduce((sum, s) => sum + s.eligibleRealizedAmount, 0);
    const totalSettled = filteredSettlements.reduce((sum, s) => sum + s.settlementAmount, 0);
    const totalRemaining = filteredSettlements.reduce((sum, s) => sum + s.remainingAfter, 0);
    return [
      {
        category: 'SETTLEMENT VOUCHERS',
        title: 'Total Settlements',
        value: totalCount,
        icon: Landmark,
        subtitle: 'Processed payment vouchers',
        tone: 'default',
      },
      {
        category: 'REVENUE BASE',
        title: 'Eligible Realized',
        value: formatPKR(totalRealized),
        icon: FileCheck2,
        subtitle: 'Collected patient funds',
        tone: 'info',
      },
      {
        category: 'FUNDS DISBURSED',
        title: 'Settlement Payout',
        value: formatPKR(totalSettled),
        icon: CheckCircle2,
        subtitle: 'Paid to external providers',
        tone: 'success',
      },
      {
        category: 'OUTSTANDING BALANCE',
        title: 'Remaining Payable',
        value: formatPKR(totalRemaining),
        icon: AlertTriangle,
        subtitle: 'Pending future disbursement',
        tone: totalRemaining > 0 ? 'warning' : 'default',
      },
    ];
  }, [filteredSettlements]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading provider settlements…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button type="button" onClick={loadAll} className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg">
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
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">Department Payables &amp; Provider Settlements</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                  Realized Collections Active
                </span>
              </div>
              <p className="text-xs text-[#52665e] mt-0.5 max-w-2xl">
                Full/Partial settlements against Outsourced Providers, verified against realized patient collections
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAdd}
            disabled={activeProviders.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
            title={activeProviders.length === 0 ? 'Add an Outsourced Provider first' : undefined}
          >
            <Plus className="h-4 w-4" />
            <span>New Settlement</span>
          </button>
        </div>
      </div>

      {/* Section 4.2 & Section 9 HospitalKpiHeader */}
      <HospitalKpiHeader columns="grid-cols-2 sm:grid-cols-4" items={kpis} />

      {/* Section 4.4 Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs flex items-center gap-2">
        <span className="text-xs font-semibold text-[#52665e]">Provider Filter:</span>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="text-xs px-3 py-1.5 border border-[#c2e7db] rounded-lg bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
        >
          <option value="All">All Providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </select>
      </div>

      {/* Section 4.5 Data Table */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[#c2e7db]" />
            <span className="font-semibold text-xs tracking-wide">Provider Settlements Ledger</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {filteredSettlements.length} Vouchers
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Provider</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Department</th>
                <th className="py-2.5 px-4 text-right border-r border-[#c2e7db]/60">Eligible Realized</th>
                <th className="py-2.5 px-4 text-right border-r border-[#c2e7db]/60">Already Settled</th>
                <th className="py-2.5 px-4 text-right border-r border-[#c2e7db]/60">This Settlement</th>
                <th className="py-2.5 px-4 text-right border-r border-[#c2e7db]/60">Remaining</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Status</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Method / Ref</th>
                <th className="py-2.5 px-4">Settled By / At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-slate-700">
              {filteredSettlements.map((s, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={s.id}
                    className={`transition-colors border-b border-[#e2eae5] ${
                      isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#e7f6f1]/40`}
                  >
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-[#123e2b] border-r border-[#e2eae5]">
                      {s.providerName} <span className="text-[#52665e] font-mono font-normal">({s.providerCode})</span>
                    </td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">{s.departmentName || '—'}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-800 border-r border-[#e2eae5]">{formatPKR(s.eligibleRealizedAmount)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-[#52665e] border-r border-[#e2eae5]">{formatPKR(s.alreadySettledAmount)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-[#08775A] border-r border-[#e2eae5]">{formatPKR(s.settlementAmount)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-rose-700 border-r border-[#e2eae5]">{formatPKR(s.remainingAfter)}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          s.status === 'FULL' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {s.status === 'FULL' ? 'Fully Settled' : 'Partially Settled'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                      {PAYMENT_METHOD_LABELS[s.paymentMethod]}
                      {s.paymentReference && <span className="text-[#52665e] font-mono"> · {s.paymentReference}</span>}
                    </td>
                    <td className="py-2.5 px-4 text-[11px] text-[#52665e]">
                      <span className="font-semibold text-slate-800">{s.settledBy}</span>
                      <br />
                      <span className="font-mono">{s.settledAt}</span>
                    </td>
                  </tr>
                );
              })}

              {filteredSettlements.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[#52665e]">
                    <Landmark className="h-8 w-8 text-[#52665e]/40 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-[#123e2b] block">No settlements recorded yet.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} title="Record Provider Settlement" maxWidth="2xl">
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">{formError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Outsourced Provider"
              required
              options={activeProviders.map((p) => ({ label: `${p.name} (${p.code})`, value: p.id }))}
              value={formValues.outsourcedProviderId}
              onChange={(e) => setFormValues({ ...formValues, outsourcedProviderId: e.target.value })}
            />
            <Select
              label="Department (optional)"
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
              value={formValues.departmentId}
              onChange={(e) => setFormValues({ ...formValues, departmentId: e.target.value })}
            />
          </div>
          {selectedProvider && (
            <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              Allowed methods: {selectedProvider.allowedPaymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ') || 'Any'}
              {selectedProvider.settlementCycle && <> · Settlement cycle: {selectedProvider.settlementCycle}</>}
            </div>
          )}
          <TextInput
            label="Period Label (optional)"
            placeholder="e.g. September 2026"
            value={formValues.periodLabel}
            onChange={(e) => setFormValues({ ...formValues, periodLabel: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumberInput
              label="Eligible Realized Amount (PKR)"
              hint="Patient collections + panel remittances realized for this provider/department."
              required
              min={0}
              step={100}
              placeholder="0"
              value={formValues.eligibleRealizedAmount === 0 ? '' : formValues.eligibleRealizedAmount}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setFormValues({ ...formValues, eligibleRealizedAmount: e.target.value === '' ? 0 : Number(e.target.value) || 0 })}
            />
            <NumberInput
              label="Settlement Amount (PKR)"
              required
              min={0}
              step={100}
              placeholder="0"
              value={formValues.settlementAmount === 0 ? '' : formValues.settlementAmount}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setFormValues({ ...formValues, settlementAmount: e.target.value === '' ? 0 : Number(e.target.value) || 0 })}
            />
          </div>
          <div className="text-[11px] text-slate-500">
            Remaining eligible after this settlement (before any prior settlements the server already knows about):{' '}
            <strong className="text-slate-800">{formatPKR(remainingEligible)}</strong>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Settlement Status"
              options={[
                { label: 'Partial Settlement', value: 'PARTIAL' },
                { label: 'Full Settlement', value: 'FULL' },
              ]}
              value={formValues.status}
              onChange={(e) => setFormValues({ ...formValues, status: e.target.value as 'FULL' | 'PARTIAL' })}
            />
            <Select
              label="Payment Method"
              options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((v) => ({ label: PAYMENT_METHOD_LABELS[v], value: v }))}
              value={formValues.paymentMethod}
              onChange={(e) => setFormValues({ ...formValues, paymentMethod: e.target.value as PaymentMethod })}
            />
          </div>
          <TextInput
            label="Payment Reference"
            placeholder="Bank/cheque reference number"
            value={formValues.paymentReference}
            onChange={(e) => setFormValues({ ...formValues, paymentReference: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              label="Representative Name"
              value={formValues.representativeName}
              onChange={(e) => setFormValues({ ...formValues, representativeName: e.target.value })}
            />
            <TextInput
              label="Representative Designation"
              value={formValues.representativeDesignation}
              onChange={(e) => setFormValues({ ...formValues, representativeDesignation: e.target.value })}
            />
          </div>
          <Textarea
            label="Remarks"
            rows={2}
            value={formValues.remarks}
            onChange={(e) => setFormValues({ ...formValues, remarks: e.target.value })}
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
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60"
            >
              <FileCheck2 className="h-3.5 w-3.5" />
              {isSaving ? 'Posting…' : 'Post Settlement & Generate Voucher'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
