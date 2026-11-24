import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Plus,
  Search,
  Edit2,
  Power,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Building2,
  User,
  UserCheck,
  Phone,
  Mail,
  Clock,
  Coins,
  Landmark,
  CreditCard,
  FileText,
  Briefcase,
  Hash,
  MapPin,
  Percent,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
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
import {
  TextInput,
  NumberInput,
  Textarea,
  MultiSelect,
  Toggle,
  PhoneInput,
  Select,
} from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';
import { generateNextCode } from '../../../utils/codeGenerator';

const EMPTY_FORM: OutsourcedProviderFormValues = {
  code: '',
  name: '',
  representativeName: '',
  representativeDesignation: '',
  phone: '',
  email: '',
  address: '',
  paymentTermsNotes: '',
  settlementCycle: 'Monthly',
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
  const [deleteTarget, setDeleteTarget] = useState<OutsourcedProvider | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAdditionalDetails, setShowAdditionalDetails] = useState(false);

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

  const settlementCycleOptions = useMemo(() => {
    const base = [
      { label: 'Monthly', value: 'Monthly' },
      { label: 'Weekly', value: 'Weekly' },
      { label: 'Bi-Weekly', value: 'Bi-Weekly' },
      { label: 'Daily', value: 'Daily' },
      { label: 'On-Demand', value: 'On-Demand' },
    ];
    if (
      formValues.settlementCycle &&
      !base.some((b) => b.value.toLowerCase() === formValues.settlementCycle.toLowerCase())
    ) {
      return [{ label: formValues.settlementCycle, value: formValues.settlementCycle }, ...base];
    }
    return base;
  }, [formValues.settlementCycle]);

  const handleOpenAdd = () => {
    setEditingProvider(null);
    setShowAdditionalDetails(false);
    const autoCode = generateNextCode(
      providers.map((p) => p.code),
      'PRV'
    );
    setFormValues({ ...EMPTY_FORM, code: autoCode, settlementCycle: 'Monthly' });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (provider: OutsourcedProvider) => {
    setEditingProvider(provider);
    const hasAdditional = Boolean(
      provider.representativeDesignation ||
      provider.email ||
      provider.address ||
      provider.withholdingTaxPercent != null ||
      provider.paymentTermsNotes ||
      provider.bankName ||
      provider.bankAccountTitle ||
      provider.bankAccountNumber ||
      provider.chequePayeeName
    );
    setShowAdditionalDetails(hasAdditional);
    setFormValues({
      code: provider.code,
      name: provider.name,
      representativeName: provider.representativeName,
      representativeDesignation: provider.representativeDesignation,
      phone: provider.phone,
      email: provider.email,
      address: provider.address,
      paymentTermsNotes: provider.paymentTermsNotes,
      settlementCycle: provider.settlementCycle || 'Monthly',
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

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await OutsourcedProviderService.deleteProvider(deleteTarget.id);
      toast.success(`Outsourced department "${deleteTarget.name}" deleted successfully.`);
      setDeleteTarget(null);
      await loadProviders();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to delete provider.');
    } finally {
      setIsDeleting(false);
    }
  };

  const kpis: KpiItem[] = useMemo(() => {
    const totalProviders = providers.length;
    const activeProviders = providers.filter((p) => p.isActive).length;
    const totalLinkedDepts = providers.reduce((sum, p) => sum + p.linkedDepartmentCount, 0);
    const totalSettlements = providers.reduce((sum, p) => sum + p.settlementCount, 0);
    return [
      {
        category: 'OUTSOURCED SERVICES',
        title: 'Total Providers',
        value: totalProviders,
        icon: Truck,
        subtitle: 'External labs & diagnostics',
        tone: 'default',
      },
      {
        category: 'FULFILLMENT STATUS',
        title: 'Active Providers',
        value: activeProviders,
        icon: CheckCircle2,
        subtitle: 'Active contract partners',
        tone: 'success',
      },
      {
        category: 'CLINICAL SCOPE',
        title: 'Linked Departments',
        value: totalLinkedDepts,
        icon: Building2,
        subtitle: 'Departments with outsourced tests',
        tone: 'info',
      },
      {
        category: 'FINANCIAL SETTLEMENTS',
        title: 'Logged Settlements',
        value: totalSettlements,
        icon: AlertTriangle,
        subtitle: 'Settlements processed',
        tone: 'warning',
      },
    ];
  }, [providers]);

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
    <div className="space-y-4">
      {/* Section 4.1 Card Page Header Block */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">Outsourced Departments</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                  External Facilities &amp; Labs
                </span>
              </div>
              <p className="text-xs text-[#52665e] mt-0.5">
                Outsourced diagnostic labs, imaging centers, and specialized external departments linked to hospital billing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add Outsourced Department</span>
          </button>
        </div>
      </div>

      {/* Section 4.2 & Section 9 HospitalKpiHeader */}
      <HospitalKpiHeader columns="grid-cols-2 sm:grid-cols-4" items={kpis} />

      {/* Section 4.4 Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#52665e]" />
          <input
            type="text"
            placeholder="Search providers by code, name, or representative..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-8.5 pr-3 py-1.5 border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] bg-[#fbfdfc] focus:bg-white transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <span className="text-xs font-semibold text-[#52665e]">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs px-3 py-1.5 border border-[#c2e7db] rounded-lg bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Section 4.5 Data Table */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#c2e7db]" />
            <span className="font-semibold text-xs tracking-wide">Outsourced Departments Registry</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {filteredProviders.length} Departments
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Code</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Department Name</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Representative</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Settlement Cycle</th>
                <th className="py-2.5 px-4 text-center border-r border-[#c2e7db]/60">Linked Depts</th>
                <th className="py-2.5 px-4 text-center border-r border-[#c2e7db]/60">Settlements</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-slate-700">
              {filteredProviders.map((p, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={p.id}
                    className={`transition-colors border-b border-[#e2eae5] ${isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                      } hover:bg-[#e7f6f1]/40`}
                  >
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-bold text-[#123e2b] border-r border-[#e2eae5]">{p.code}</td>
                    <td className="py-2.5 px-4 font-bold text-[#111827] border-r border-[#e2eae5]">{p.name}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">{p.representativeName || '—'}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">{p.settlementCycle || '—'}</td>
                    <td className="py-2.5 px-4 text-center font-mono font-bold text-[#08775A] border-r border-[#e2eae5]">{p.linkedDepartmentCount}</td>
                    <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800 border-r border-[#e2eae5]">{p.settlementCount}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${p.isActive
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
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
                          className="p-1 hover:bg-[#effaf5] rounded-md text-[#52665e] hover:text-[#08775A] cursor-pointer transition-colors"
                          title="Edit Provider"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {p.isActive && (
                          <button
                            type="button"
                            onClick={() => setStatusTarget(p)}
                            className="p-1 rounded-md transition-colors text-slate-400 hover:bg-amber-50 hover:text-amber-700 cursor-pointer"
                            title="Deactivate Provider"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(p)}
                          className="p-1 rounded-md transition-colors text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                          title="Delete Outsourced Department"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredProviders.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#52665e]">
                    <Truck className="h-8 w-8 text-[#52665e]/40 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-[#123e2b] block">No outsourced providers match your search criteria.</span>
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
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#08775A] text-white shadow-xs shrink-0">
              <Truck className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
                {editingProvider ? 'Edit Outsourced Department' : 'Register Outsourced Department'}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 font-normal mt-0.5">
                {editingProvider
                  ? `Update partner details, settlement rules, and bank details for ${editingProvider.code}`
                  : 'Quickly register an external diagnostic, imaging, or outsourced department'}
              </p>
            </div>
          </div>
        }
        maxWidth="xl"
        footer={
          <div className="flex items-center justify-end gap-2.5 w-full">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="outsourced-provider-form"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSaving ? 'Saving…' : editingProvider ? 'Update Department' : 'Register Department'}
            </button>
          </div>
        }
      >
        <form id="outsourced-provider-form" onSubmit={handleSave} className="space-y-4 pt-1">
          {formError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* Core Simplified Fields: 2 columns on desktop, 1 column on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <TextInput
              label="Department / Partner Code"
              value={formValues.code}
              disabled
              readOnly
              hint="Auto-generated unique code"
              icon={<Hash className="h-4 w-4 text-slate-400" />}
            />
            <TextInput
              label="Outsourced Department Name"
              placeholder="e.g. Chughtai Lab, Islamabad Diagnostic"
              value={formValues.name}
              onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
              required
              autoFocus={!editingProvider}
              icon={<Building2 className="h-4 w-4 text-slate-400" />}
            />
            <TextInput
              label="Representative / Contact Name"
              placeholder="e.g. Dr. Muhammad Tariq / Asif Mehmood"
              value={formValues.representativeName}
              onChange={(e) => setFormValues({ ...formValues, representativeName: e.target.value })}
              icon={<User className="h-4 w-4 text-slate-400" />}
            />
            <PhoneInput
              label="Phone Number"
              placeholder="0300-1234567"
              value={formValues.phone}
              onChange={(e) => setFormValues({ ...formValues, phone: e.target.value })}
              onValueChange={(val) => setFormValues((prev) => ({ ...prev, phone: val }))}
            />
            <Select
              label="Settlement Cycle"
              value={formValues.settlementCycle || 'Monthly'}
              onChange={(e) => setFormValues({ ...formValues, settlementCycle: e.target.value })}
              options={settlementCycleOptions}
            />
            <MultiSelect
              label="Allowed Payment Methods"
              placeholder="Select allowed payment modes..."
              options={PAYMENT_METHOD_OPTIONS}
              value={formValues.allowedPaymentMethods}
              onChange={(vals) => setFormValues({ ...formValues, allowedPaymentMethods: vals as PaymentMethod[] })}
            />
          </div>

          {/* Edit Mode Only: Status Toggle */}
          {editingProvider && (
            <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/80">
              <Toggle
                label="Provider Active"
                hint="Inactive providers cannot be newly linked to a department or selected for requisitions."
                checked={formValues.isActive}
                onChange={(checked) => setFormValues({ ...formValues, isActive: checked })}
              />
            </div>
          )}

          {/* Edit Mode Only: Additional Details Collapsible Section */}
          {editingProvider && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
              <button
                type="button"
                onClick={() => setShowAdditionalDetails((prev) => !prev)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-bold text-slate-700 hover:bg-slate-100/70 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-[#08775A]">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Additional Details (Banking, Tax &amp; Focal Person)</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-500">
                  <span className="text-[11px] font-normal">{showAdditionalDetails ? 'Hide Details' : 'Show Details'}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showAdditionalDetails ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {showAdditionalDetails && (
                <div className="p-4 pt-3 border-t border-slate-200 space-y-4 bg-white">
                  {/* Contact & Designation */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <TextInput
                      label="Representative Designation"
                      placeholder="e.g. Liaison Manager, Lab Incharge, Director"
                      value={formValues.representativeDesignation}
                      onChange={(e) => setFormValues({ ...formValues, representativeDesignation: e.target.value })}
                      icon={<Briefcase className="h-4 w-4 text-slate-400" />}
                    />
                    <TextInput
                      label="Email"
                      type="email"
                      placeholder="e.g. partner.accounts@chughtailab.com"
                      value={formValues.email}
                      onChange={(e) => setFormValues({ ...formValues, email: e.target.value })}
                      icon={<Mail className="h-4 w-4 text-slate-400" />}
                    />
                  </div>

                  <Textarea
                    label="Address"
                    placeholder="e.g. Plot 12, Main Boulevard, Gulberg III, Lahore, Pakistan"
                    rows={2}
                    value={formValues.address}
                    onChange={(e) => setFormValues({ ...formValues, address: e.target.value })}
                  />

                  {/* Withholding Tax & Terms */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <NumberInput
                      label="Withholding Tax %"
                      placeholder="e.g. 10 or 15"
                      min={0}
                      max={100}
                      step={0.5}
                      value={formValues.withholdingTaxPercent}
                      onChange={(e) => setFormValues({ ...formValues, withholdingTaxPercent: e.target.value === '' ? '' : Number(e.target.value) })}
                    />
                  </div>

                  <Textarea
                    label="Payment Terms / Notes"
                    placeholder="e.g. Net 15 days upon submission and verification of consolidated monthly requisition bills"
                    rows={2}
                    value={formValues.paymentTermsNotes}
                    onChange={(e) => setFormValues({ ...formValues, paymentTermsNotes: e.target.value })}
                  />

                  {/* Bank & Cheque Details */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-2.5">
                      <Landmark className="h-3.5 w-3.5 text-[#08775A]" />
                      <span>Bank &amp; Cheque Details</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <TextInput
                        label="Bank Name"
                        placeholder="e.g. Meezan Bank, HBL, Bank Alfalah"
                        value={formValues.bankName}
                        onChange={(e) => setFormValues({ ...formValues, bankName: e.target.value })}
                        icon={<Landmark className="h-4 w-4 text-slate-400" />}
                      />
                      <TextInput
                        label="Account Title"
                        placeholder="e.g. Chughtai Healthcare (Pvt) Ltd"
                        value={formValues.bankAccountTitle}
                        onChange={(e) => setFormValues({ ...formValues, bankAccountTitle: e.target.value })}
                        icon={<FileText className="h-4 w-4 text-slate-400" />}
                      />
                      <TextInput
                        label="Account Number / IBAN"
                        placeholder="e.g. PK36MEZN0001234567890123"
                        value={formValues.bankAccountNumber}
                        onChange={(e) => setFormValues({ ...formValues, bankAccountNumber: e.target.value })}
                        icon={<CreditCard className="h-4 w-4 text-slate-400" />}
                      />
                      <TextInput
                        label="Cheque Payee Name"
                        placeholder="e.g. Chughtai Healthcare (Pvt) Ltd"
                        value={formValues.chequePayeeName}
                        onChange={(e) => setFormValues({ ...formValues, chequePayeeName: e.target.value })}
                        icon={<CheckCircle2 className="h-4 w-4 text-slate-400" />}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
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

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Outsourced Department?"
        message={`Are you sure you want to permanently delete "${deleteTarget?.name}" (${deleteTarget?.code})? This will also remove its corresponding department and unbilled service rates. This action cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting…' : 'Delete Department'}
        variant="danger"
      />
    </div>
  );
};
