import React, { useState, useEffect } from 'react';
import { ShieldAlert, Loader2, AlertTriangle, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import {
  HighCostMedicinePolicy,
  CombinedLogic,
  ThresholdBasis,
  COMBINED_LOGIC_LABELS,
  fetchHighCostMedicinePolicy,
  updateHighCostMedicinePolicy,
} from '../../../services/highCostMedicinePolicyService';
import { NumberInput, Select, Toggle } from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';

/**
 * v7.2 High-Cost Medicine Authorization Policy (HMS_V7.2_NEW_REQUIREMENTS.md
 * §2.6) — singleton config, backed by `/api/v1/setup/high-cost-medicine-policy`.
 * Threshold is always management-configured here, never hard-coded in
 * application logic — Admission/Pharmacy will read this policy to decide
 * whether a medicine request needs attendant/management authorization
 * (that consuming gate is Admission Portal scope, not built in this phase —
 * see HMS_V7.2_NEW_REQUIREMENTS.md §3.4).
 */
export const HighCostMedicinePolicyView: React.FC = () => {
  const toast = useToast();
  const [policy, setPolicy] = useState<HighCostMedicinePolicy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPolicy(await fetchHighCostMedicinePolicy());
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load the High-Cost Medicine policy.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    if (!policy) return;
    setIsSaving(true);
    try {
      const updated = await updateHighCostMedicinePolicy({
        enabled: policy.enabled,
        thresholdAmount: policy.thresholdAmount,
        thresholdBasis: policy.thresholdBasis,
        attendantConfirmationRequired: policy.attendantConfirmationRequired,
        managementApprovalRequired: policy.managementApprovalRequired,
        combinedLogic: policy.combinedLogic,
        panelPreauthRequired: policy.panelPreauthRequired,
      });
      setPolicy(updated);
      toast.success('High-Cost Medicine policy saved.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save policy.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading High-Cost Medicine policy…</span>
      </div>
    );
  }

  if (loadError || !policy) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button type="button" onClick={load} className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150 max-w-3xl">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">High-Cost Medicine Authorization Policy</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Configurable inpatient medicine cost-control policy for Self-Pay and Panel patients (v7.2).
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-5">
        <Toggle
          label="High-Cost Medicine Authorization Enabled"
          hint="When off, no medicine request is ever blocked by this policy."
          checked={policy.enabled}
          onChange={(checked) => setPolicy({ ...policy, enabled: checked })}
        />

        <div className={`space-y-5 ${policy.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumberInput
              label="Threshold Amount (PKR)"
              hint="Management-configured — no hard-coded hospital value."
              min={0}
              step={500}
              value={policy.thresholdAmount}
              onChange={(e) => setPolicy({ ...policy, thresholdAmount: Number(e.target.value) || 0 })}
            />
            <Select
              label="Threshold Basis"
              options={[
                { label: 'Line Total (recommended)', value: 'LINE_TOTAL' },
                { label: 'Per Unit', value: 'PER_UNIT' },
              ]}
              value={policy.thresholdBasis}
              onChange={(e) => setPolicy({ ...policy, thresholdBasis: e.target.value as ThresholdBasis })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200">
            <Toggle
              label="Attendant Confirmation Required"
              checked={policy.attendantConfirmationRequired}
              onChange={(checked) => setPolicy({ ...policy, attendantConfirmationRequired: checked })}
            />
            <Toggle
              label="Admin / Super Admin Approval Required"
              checked={policy.managementApprovalRequired}
              onChange={(checked) => setPolicy({ ...policy, managementApprovalRequired: checked })}
            />
          </div>

          <Select
            label="Combined Authorization Logic"
            hint="How Attendant Confirmation and Management Approval combine when both toggles above are on."
            options={(Object.keys(COMBINED_LOGIC_LABELS) as CombinedLogic[]).map((v) => ({ label: COMBINED_LOGIC_LABELS[v], value: v }))}
            value={policy.combinedLogic}
            onChange={(e) => setPolicy({ ...policy, combinedLogic: e.target.value as CombinedLogic })}
          />

          <Toggle
            label="Panel Preauthorization Add-On"
            hint="When on, a Panel patient's own contract preauthorization reference is additionally required — hospital policy is never bypassed by panel coverage."
            checked={policy.panelPreauthRequired}
            onChange={(checked) => setPolicy({ ...policy, panelPreauthRequired: checked })}
          />
        </div>

        <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg flex items-start gap-2.5 text-xs text-blue-900">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
          <span>
            No user may manually type an approver name to bypass this policy — where management authorization is required, the
            Admin/Super Admin's actual credentials must be validated at the point of request (enforced by the Admission Portal's
            authorization popup, once built).
          </span>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200 text-[11px] text-slate-400">
          <span>Last updated by {policy.updatedBy}</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60"
          >
            {isSaving ? 'Saving…' : 'Save Policy'}
          </button>
        </div>
      </div>
    </div>
  );
};
