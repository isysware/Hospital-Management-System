import React, { useState, useEffect, useMemo } from 'react';
import { Truck, Plus, Search, Edit2, Power, Loader2, AlertTriangle, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import {
  OutsourcedProvider,
  OutsourcedProviderFormValues,
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  fetchOutsourcedProviders,
  OutsourcedProviderService,
} from '../../../services/outsourcedProviderService';
import { Modal } from '../../../components/common/Modal';
import { ConfirmModal } from '../../../components/common/ConfirmModal';
import { TextInput, NumberInput, Textarea, MultiSelect, Toggle } from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';

const EMPTY_FORM: OutsourcedProviderFormValues = {
  code: '',
  name: '',
  representativeName: '',
  representativeDesignation: '',
  phone: '',
  email: '',
  address: '',
  paymentTermsNotes: '',
  settlementCycle: '',
  allowedPaymentMethods: [],
  bankName: '',
  bankAccountTitle: '',
  bankAccountNumber: '',
  chequePayeeName: '',
  withholdingTaxPercent: '',
  isActive: true,
};

const PAYMENT_METHOD_OPTIONS: { label: string; value: PaymentMethod }[] = (
  Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]
).map((v) => ({ label: PAYMENT_METHOD_LABELS[v], value: v }));

/**
 * v7.2 Outsourced Provider Master (HMS_V7.2_NEW_REQUIREMENTS.md §2.1) —
 * external Lab/Neurology/etc. providers a Department can link to when its
 * fulfillment ownership is Outsourced. Backed by
 * `/api/v1/setup/outsourced-providers`, real DB, no mock data.
 */
export const SuperAdminOutsourcedProvidersView: React.FC = () => {
  const toast = useToast();
  const [providers, setProviders] = useState<OutsourcedProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<OutsourcedProvider | null>(null);
  const [formValues, setFormValues] = useState<OutsourcedProviderFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [statusTarget, setStatusTarget] = useState<OutsourcedProvider | null>(null);

  const loadProviders = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setProviders(await fetchOutsourcedProviders());
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load outsourced providers.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q) && !p.representativeName.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (statusFilter === 'Active' && !p.isActive) return false;
      if (statusFilter === 'Inactive' && p.isActive) return false;
      return true;
    });
  }, [providers, searchTerm, statusFilter]);

  const handleOpenAdd = () => {
    setEditingProvider(null);
    setFormValues(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (provider: OutsourcedProvider) => {
    setEditingProvider(provider);
    setFormValues({
      code: provider.code,
      name: provider.name,
      representativeName: provider.representativeName,
      representativeDesignation: provider.representativeDesignation,
      phone: provider.phone,
      email: provider.email,
      address: provider.address,
      paymentTermsNotes: provider.paymentTermsNotes,
      settlementCycle: provider.settlementCycle,
      allowedPaymentMethods: provider.allowedPaymentMethods,
      bankName: provider.bankName,
      bankAccountTitle: provider.bankAccountTitle,
      bankAccountNumber: provider.bankAccountNumber,
      chequePayeeName: provider.chequePayeeName,
      withholdingTaxPercent: provider.withholdingTaxPercent ?? '',
      isActive: provider.isActive,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValues.name.trim()) {
      const msg = 'Provider name is required.';
      setFormError(msg);
      toast.error(msg, 'Validation Error');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (editingProvider) {
        await OutsourcedProviderService.updateProvider(editingProvider.id, formValues);
        toast.success(`Provider "${formValues.name}" updated successfully.`);
      } else {
        await OutsourcedProviderService.createProvider(formValues);
        toast.success(`Provider "${formValues.name}" registered successfully.`);
      }
      setIsFormOpen(false);
      await loadProviders();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to save provider.';
      setFormError(msg);
      toast.error(msg, 'Save Error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!statusTarget) return;
    try {
      await OutsourcedProviderService.deactivateProvider(statusTarget.id);
      toast.success(`Provider "${statusTarget.name}" deactivated.`);
      setStatusTarget(null);
      await loadProviders();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to deactivate provider.');
      setStatusTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading outsourced providers…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          type="button"
          onClick={loadProviders}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900">Outsourced Providers</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
              v7.2 Department Outsourcing
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            External Lab / Neurology / diagnostic providers a Department can be linked to when its fulfillment mode is Outsourced.
            Settlement against realized collections is tracked under Provider Settlements.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#149E75] hover:bg-[#08775A] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Outsourced Provider</span>
        </button>
      </div>

      {/* Search & Filter */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search providers by name, code or representative..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-8.5 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-slate-50/50"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <span className="text-[11px] font-semibold text-slate-500">Filter:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-[#149E75]"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-2.5 px-4">Code</th>
                <th className="py-2.5 px-4">Provider Name</th>
                <th className="py-2.5 px-4">Representative</th>
                <th className="py-2.5 px-4">Settlement Cycle</th>
                <th className="py-2.5 px-4 text-center">Linked Departments</th>
                <th className="py-2.5 px-4 text-center">Settlements</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredProviders.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{p.code}</td>
                  <td className="py-2.5 px-4 font-bold text-slate-900">{p.name}</td>
                  <td className="py-2.5 px-4">{p.representativeName || '—'}</td>
                  <td className="py-2.5 px-4">{p.settlementCycle || '—'}</td>
                  <td className="py-2.5 px-4 text-center font-semibold">{p.linkedDepartmentCount}</td>
                  <td className="py-2.5 px-4 text-center font-semibold">{p.settlementCount}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        p.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(p)}
                        className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                        title="Edit Provider"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      {p.isActive && (
                        <button
                          type="button"
                          onClick={() => setStatusTarget(p)}
                          className="p-1 rounded transition-colors text-slate-400 hover:bg-amber-50 hover:text-amber-700"
                          title="Deactivate Provider"
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filteredProviders.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Truck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-slate-700 block">No outsourced providers match your search criteria.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingProvider ? 'Edit Outsourced Provider' : 'Register Outsourced Provider'}
        maxWidth="2xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">{formError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              label="Provider Code"
              placeholder="e.g. PRV-LAB01 (optional — auto-generated if blank)"
              value={formValues.code}
              onChange={(e) => setFormValues({ ...formValues, code: e.target.value })}
            />
            <TextInput
              label="Provider Name"
              value={formValues.name}
              onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
              required
            />
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              label="Phone"
              value={formValues.phone}
              onChange={(e) => setFormValues({ ...formValues, phone: e.target.value })}
            />
            <TextInput
              label="Email"
              type="email"
              value={formValues.email}
              onChange={(e) => setFormValues({ ...formValues, email: e.target.value })}
            />
          </div>
          <Textarea
            label="Address"
            rows={2}
            value={formValues.address}
            onChange={(e) => setFormValues({ ...formValues, address: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              label="Settlement Cycle"
              placeholder="e.g. Weekly / Monthly / On-Demand"
              value={formValues.settlementCycle}
              onChange={(e) => setFormValues({ ...formValues, settlementCycle: e.target.value })}
            />
            <NumberInput
              label="Withholding Tax %"
              min={0}
              max={100}
              step={0.5}
              value={formValues.withholdingTaxPercent}
              onChange={(e) => setFormValues({ ...formValues, withholdingTaxPercent: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </div>
          <MultiSelect
            label="Allowed Payment Methods"
            options={PAYMENT_METHOD_OPTIONS}
            value={formValues.allowedPaymentMethods}
            onChange={(vals) => setFormValues({ ...formValues, allowedPaymentMethods: vals as PaymentMethod[] })}
          />
          <Textarea
            label="Payment Terms / Notes"
            rows={2}
            value={formValues.paymentTermsNotes}
            onChange={(e) => setFormValues({ ...formValues, paymentTermsNotes: e.target.value })}
          />
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#08775A] mb-3">Bank / Cheque Details (optional)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextInput
                label="Bank Name"
                value={formValues.bankName}
                onChange={(e) => setFormValues({ ...formValues, bankName: e.target.value })}
              />
              <TextInput
                label="Account Title"
                value={formValues.bankAccountTitle}
                onChange={(e) => setFormValues({ ...formValues, bankAccountTitle: e.target.value })}
              />
              <TextInput
                label="Account Number / IBAN"
                value={formValues.bankAccountNumber}
                onChange={(e) => setFormValues({ ...formValues, bankAccountNumber: e.target.value })}
              />
              <TextInput
                label="Cheque Payee Name"
                value={formValues.chequePayeeName}
                onChange={(e) => setFormValues({ ...formValues, chequePayeeName: e.target.value })}
              />
            </div>
          </div>
          <Toggle
            label="Provider Active"
            hint="Inactive providers cannot be newly linked to a department."
            checked={formValues.isActive}
            onChange={(checked) => setFormValues({ ...formValues, isActive: checked })}
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
              {isSaving ? 'Saving…' : editingProvider ? 'Update Provider' : 'Save Provider'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={handleConfirmDeactivate}
        title="Deactivate Outsourced Provider?"
        message={`"${statusTarget?.name}" will no longer be selectable for new department links or settlements. Existing links and settlement history are kept.`}
        confirmLabel="Deactivate"
        variant="warning"
      />
    </div>
  );
};
