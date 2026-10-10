import { PanelCoverageRulesModal } from './PanelCoverageRulesModal';
import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../../../context/ToastContext';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Power,
  Percent,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Phone,
  Wallet,
  FileText,
} from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import {
  CorporatePanel,
  CorporatePanelFormValues,
  fetchCorporatePanels,
  fetchPanelCategories,
  createCorporatePanel,
  updateCorporatePanel,
  deleteCorporatePanel,
  toggleCorporatePanelStatus,
} from '../../../services/panelService';
import { Modal } from '../../../components/common/Modal';
import { ConfirmModal } from '../../../components/common/ConfirmModal';
import { TextInput, NumberInput, Textarea, Select } from '../../../components/forms/FormControls';
import { HospitalKpiHeader } from '../../../components/common/HospitalKpiHeader';
import { generateNextCode } from '../../../utils/codeGenerator';


const BILLING_TERMS_OPTIONS = [
  { label: 'Monthly Invoicing (Standard)', value: 'Monthly' },
  { label: 'Net 15 Days', value: 'Net 15 Days' },
  { label: 'Net 30 Days', value: 'Net 30 Days' },
  { label: 'Net 45 Days', value: 'Net 45 Days' },
  { label: 'Net 60 Days', value: 'Net 60 Days' },
  { label: 'Quarterly Invoicing', value: 'Quarterly' },
  { label: 'Per Encounter / Immediate Settlement', value: 'Per Encounter' },
];

const EMPTY_FORM: CorporatePanelFormValues = {
  code: '',
  organizationName: '',
  category: '',
  legalBillingName: '',
  contactPhone: '',
  contactEmail: '',
  billingTerms: 'Monthly',
  memberIdLabel: 'Employee / Policy ID',
  memberIdRequired: false,
  membershipValidityRequired: false,
  authorizationRequired: false,
  discountAgreement: '',
  contact: '',
  address: '',
  notes: '',
  creditLimit: 0,
  isActive: true,
};

export const SuperAdminCorporatePanelsView: React.FC = () => {
  const [categories, setCategories] = useState<{ name: string; isActive: boolean }[]>([]);
  const [panels, setPanels] = useState<CorporatePanel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<CorporatePanel | null>(null);
  const [formValues, setFormValues] = useState<CorporatePanelFormValues>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [statusTarget, setStatusTarget] = useState<CorporatePanel | null>(null);
  const [discountPanel, setDiscountPanel] = useState<CorporatePanel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CorporatePanel | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const toastService = useToast();
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    type === 'success' ? toastService.success(message) : toastService.error(message);
  };

  const loadPanels = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [list, categoryList] = await Promise.all([fetchCorporatePanels(), fetchPanelCategories()]);
      setCategories(categoryList);
      setPanels(list);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load corporate panels from the server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPanels();
  }, []);

  const filteredPanels = useMemo(() => {
    return panels.filter((p) => {
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        if (!p.code.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      return true;
    });
  }, [panels, searchTerm, statusFilter]);

  const kpis = useMemo(() => {
    const totalPanels = panels.length;
    const activePanels = panels.filter((p) => p.status === 'Active').length;
    const totalCreditLimit = panels.reduce((sum, p) => sum + p.creditLimit, 0);
    const totalActivePatients = panels.reduce((sum, p) => sum + p.activePatientsCount, 0);
    return { totalPanels, activePanels, totalCreditLimit, totalActivePatients };
  }, [panels]);

  const billingOptions = useMemo(() => {
    const currentVal = formValues.billingTerms?.trim();
    if (currentVal && !BILLING_TERMS_OPTIONS.some((o) => o.value.toLowerCase() === currentVal.toLowerCase())) {
      return [{ label: currentVal, value: currentVal }, ...BILLING_TERMS_OPTIONS];
    }
    return BILLING_TERMS_OPTIONS;
  }, [formValues.billingTerms]);

  const handleOpenAdd = () => {
    setEditingPanel(null);
    const autoCode = generateNextCode(
      panels.map((p) => p.code),
      'PNL'
    );
    setFormValues({ ...EMPTY_FORM, code: autoCode });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (panel: CorporatePanel) => {
    setEditingPanel(panel);
    setFormValues({
      code: panel.code,
      organizationName: panel.name,
      category: panel.category,
      memberIdLabel: panel.memberIdLabel || 'Employee / Policy ID',
      memberIdRequired: panel.memberIdRequired ?? false,
      membershipValidityRequired: panel.membershipValidityRequired ?? false,
      authorizationRequired: panel.authorizationRequired ?? false,
      legalBillingName: panel.legalBillingName || '',
      contactPhone: panel.contactPhone || '',
      contactEmail: panel.contactEmail || '',
      billingTerms: panel.billingTerms || 'Monthly',
      discountAgreement: panel.discountAgreement || '',
      contact: panel.contact || '',
      address: panel.address || '',
      notes: panel.notes || '',
      creditLimit: panel.creditLimit,
      isActive: panel.status === 'Active',
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValues.organizationName.trim()) {
      const msg = 'Organization / Panel name is required.';
      setFormError(msg);
      toastService.error(msg, 'Validation Error');
      return;
    }
    if (!formValues.category) {
      const msg = 'Select a configured panel category.';
      setFormError(msg);
      toastService.error(msg, 'Validation Error');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (editingPanel) {
        await updateCorporatePanel(editingPanel.id, formValues);
        showToast(`Panel "${formValues.organizationName}" updated successfully.`);
      } else {
        await createCorporatePanel(formValues);
        showToast(`Panel "${formValues.organizationName}" registered successfully.`);
      }
      setIsFormOpen(false);
      await loadPanels();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save corporate panel.';
      setFormError(msg);
      toastService.error(msg, 'Save Error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!statusTarget) return;
    const nextActive = statusTarget.status !== 'Active';
    try {
      await toggleCorporatePanelStatus(statusTarget.id, nextActive);
      showToast(`Panel "${statusTarget.name}" is now ${nextActive ? 'Active' : 'Inactive'}.`);
      setStatusTarget(null);
      await loadPanels();
    } catch (err: any) {
      showToast(err?.message || 'Failed to update panel status.', 'error');
      setStatusTarget(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteCorporatePanel(deleteTarget.id);
      showToast(`Corporate panel "${deleteTarget.name}" deleted successfully.`);
      setDeleteTarget(null);
      await loadPanels();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to delete corporate panel.';
      showToast(msg, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading corporate panels…</span>
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
          onClick={loadPanels}
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
                <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">Corporate Panels</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                  Contract Tariffs Active
                </span>
              </div>
              <p className="text-xs text-[#52665e] mt-0.5">
                Manage corporate agreements, health insurance policies, credit ceilings, coverage rules and contract tariffs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add Corporate Panel</span>
          </button>
        </div>
      </div>

      {/* Section 4.2 & Section 9 HospitalKpiHeader */}
      <HospitalKpiHeader
        columns="grid-cols-2 sm:grid-cols-4"
        items={[
          {
            category: 'CONTRACT DIRECTORY',
            title: 'Total Panels',
            value: kpis.totalPanels,
            icon: Building2,
            subtitle: 'Configured corporate agreements',
            tone: 'default',
          },
          {
            category: 'AUTHORIZED COVER',
            title: 'Active Panels',
            value: kpis.activePanels,
            icon: CheckCircle2,
            subtitle: 'Available for patient registry',
            tone: 'success',
          },
          {
            category: 'CREDIT CEILING',
            title: 'Total Credit Limit',
            value: formatPKR(kpis.totalCreditLimit),
            icon: Wallet,
            subtitle: 'Cumulative institutional credit',
            tone: 'info',
          },
          {
            category: 'PATIENT MEMBERSHIP',
            title: 'Covered Patients',
            value: kpis.totalActivePatients,
            icon: Phone,
            subtitle: 'Patients linked to active panels',
            tone: 'warning',
          },
        ]}
      />

      {/* Section 4.4 Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#52665e]" />
          <input
            type="text"
            placeholder="Search panels by code or organization name..."
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
            <span className="font-semibold text-xs tracking-wide">Corporate Panels Registry</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {filteredPanels.length} Panels
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Panel Code</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Organization / Panel Name</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Category</th>
                <th className="py-2.5 px-4 text-right border-r border-[#c2e7db]/60">Credit Ceiling</th>
                <th className="py-2.5 px-4 text-center border-r border-[#c2e7db]/60">Active Patients</th>
                <th className="py-2.5 px-4 text-center border-r border-[#c2e7db]/60">Coverage Rules</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-slate-700">
              {filteredPanels.map((panel, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={panel.id}
                    className={`transition-colors border-b border-[#e2eae5] ${
                      isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#e7f6f1]/40`}
                  >
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-bold text-[#123e2b] border-r border-[#e2eae5]">{panel.code}</td>
                    <td className="py-2.5 px-4 font-bold text-[#111827] border-r border-[#e2eae5]">{panel.name}</td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                        {panel.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-[#123e2b] border-r border-[#e2eae5]">{formatPKR(panel.creditLimit)}</td>
                    <td className="py-2.5 px-4 text-center font-mono font-bold text-[#08775A] border-r border-[#e2eae5]">{panel.activePatientsCount}</td>
                    <td className="py-2.5 px-4 text-center border-r border-[#e2eae5]">
                      <button
                        type="button"
                        onClick={() => setDiscountPanel(panel)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#effaf5] hover:bg-[#d0efe5] text-[#08775A] border border-[#c2e7db] font-semibold text-[10px] cursor-pointer transition-colors"
                      >
                        <Percent className="h-3 w-3" />
                        {panel.discountRules.length} Rule{panel.discountRules.length === 1 ? '' : 's'}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          panel.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {panel.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(panel)}
                          className="p-1 hover:bg-[#effaf5] rounded-md text-[#52665e] hover:text-[#08775A] cursor-pointer transition-colors"
                          title="Edit Panel"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusTarget(panel)}
                          className={`p-1 rounded-md transition-colors cursor-pointer ${
                            panel.status === 'Active'
                              ? 'text-slate-400 hover:bg-amber-50 hover:text-amber-700'
                              : 'text-[#08775A] hover:bg-[#effaf5]'
                          }`}
                          title={panel.status === 'Active' ? 'Deactivate Panel' : 'Activate Panel'}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(panel)}
                          className="p-1 hover:bg-rose-50 rounded-md text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                          title="Delete Panel"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredPanels.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#52665e]">
                    <Building2 className="h-8 w-8 text-[#52665e]/40 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-[#123e2b] block">No corporate panels match your search criteria.</span>
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
        title={editingPanel ? 'Edit Corporate Panel' : 'Register Corporate Panel'}
        subtitle={
          editingPanel
            ? `Update institutional contract profile and validation rules for ${editingPanel.name}`
            : 'Register a new institutional insurance or corporate panel partner'
        }
        maxWidth="3xl"
        closeOnBackdropClick={false}
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-500">
              <span className="text-rose-500 font-bold">*</span> Indicates required fields
            </span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="corporate-panel-modal-form"
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-5 py-2 bg-[#149E75] hover:bg-[#08775A] disabled:opacity-60 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {isSaving ? 'Saving…' : editingPanel ? 'Save Changes' : 'Register Corporate Panel'}
              </button>
            </div>
          </div>
        }
      >
        <form id="corporate-panel-modal-form" onSubmit={handleSave} className="space-y-5 py-1">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* Section 1: Organization & Identity */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3.5">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Building2 className="h-4 w-4 text-[#08775A]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Organization & Identification
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <TextInput
                label="Organization / Panel Name"
                placeholder="e.g. State Life Insurance, Askari General"
                value={formValues.organizationName}
                onChange={(e) => setFormValues({ ...formValues, organizationName: e.target.value })}
                required
              />
              <Select
                label="Panel Category"
                value={formValues.category}
                onChange={(e) => setFormValues({ ...formValues, category: e.target.value })}
                options={[
                  { label: 'Select category', value: '' },
                  ...categories.map((c) => ({ label: c.name, value: c.name })),
                ]}
                required
              />
              <TextInput
                label="Panel Code"
                placeholder="Auto-generated (e.g. PNL-0001)"
                value={formValues.code}
                onChange={(e) => setFormValues({ ...formValues, code: e.target.value })}
                hint="Auto-generated sequential code — editable if needed"
              />
              <TextInput
                label="Member Identity Field Label"
                placeholder="e.g. Employee ID / Policy No. / Card No."
                value={formValues.memberIdLabel ?? ''}
                onChange={(e) => setFormValues({ ...formValues, memberIdLabel: e.target.value })}
                hint="Label shown on front desk registration (e.g. Employee ID)"
              />
            </div>
          </div>

          {/* Section 2: Contact & Liaison */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3.5">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Phone className="h-4 w-4 text-[#08775A]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Focal Person & Contact Details
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <TextInput
                label="Focal Person / Liaison"
                placeholder="e.g. Mr. Tariq Mehmood (Manager Claims)"
                value={formValues.contact}
                onChange={(e) => setFormValues({ ...formValues, contact: e.target.value })}
              />
              <TextInput
                label="Contact Phone"
                placeholder="e.g. +92 300 1234567 / 051-9876543"
                value={formValues.contactPhone ?? ''}
                onChange={(e) => setFormValues({ ...formValues, contactPhone: e.target.value })}
              />
              <div className="md:col-span-2">
                <TextInput
                  label="Office / Postal Address"
                  placeholder="Head office / zonal branch address"
                  value={formValues.address}
                  onChange={(e) => setFormValues({ ...formValues, address: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Financial, Credit & Agreement Terms */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3.5">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Wallet className="h-4 w-4 text-[#08775A]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Financial, Credit & Agreement Terms
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <NumberInput
                label="Credit Limit (PKR)"
                placeholder="0"
                value={formValues.creditLimit}
                onChange={(e) => setFormValues({ ...formValues, creditLimit: Number(e.target.value) || 0 })}
                min={0}
                hint="Maximum outstanding claim balance allowed"
              />
              <Select
                label="Billing Terms"
                value={formValues.billingTerms || 'Monthly'}
                onChange={(e) => setFormValues({ ...formValues, billingTerms: e.target.value })}
                options={billingOptions}
                hint="Claim settlement schedule agreed in MoU / contract"
              />
              <div className="md:col-span-2">
                <TextInput
                  label="Discount Agreement Summary"
                  placeholder="e.g. 15% Institutional Concession, Special OPD Tariff"
                  value={formValues.discountAgreement}
                  onChange={(e) => setFormValues({ ...formValues, discountAgreement: e.target.value })}
                  hint="Brief summary of contract terms (detailed rules configured via Rules button)"
                />
              </div>
              <div className="md:col-span-2">
                <Textarea
                  label="Internal Contract Notes / Remarks"
                  placeholder="Additional contractual notes, special instructions, or focal point numbers..."
                  value={formValues.notes}
                  onChange={(e) => setFormValues({ ...formValues, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>

      {/* Status Toggle Confirm */}
      <ConfirmModal
        isOpen={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={handleConfirmToggleStatus}
        title={statusTarget?.status === 'Active' ? 'Deactivate Corporate Panel' : 'Activate Corporate Panel'}
        message={
          statusTarget
            ? `Are you sure you want to ${statusTarget.status === 'Active' ? 'deactivate' : 'activate'} "${statusTarget.name}"?`
            : ''
        }
        confirmLabel={statusTarget?.status === 'Active' ? 'Deactivate' : 'Activate'}
        variant={statusTarget?.status === 'Active' ? 'danger' : 'primary'}
      />

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Corporate Panel"
        message={
          deleteTarget
            ? `Are you sure you want to permanently delete "${deleteTarget.name}" (${deleteTarget.code})? This will also remove its configured discount rules. This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete Panel"
        variant="danger"
        isLoading={isDeleting}
      />

      {/* Discount Rules Modal */}
      {discountPanel && (
        <PanelCoverageRulesModal
          panel={discountPanel}
          onClose={() => setDiscountPanel(null)}
          onSaved={async () => {
            setDiscountPanel(null);
            await loadPanels();
          }}
        />
      )}
    </div>
  );
};
