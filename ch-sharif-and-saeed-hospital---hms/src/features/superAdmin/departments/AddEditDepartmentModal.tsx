import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Search,
  User,
  Info,
} from 'lucide-react';
import {
  Department,
  DepartmentFormValues,
  DepartmentHeadOption,
  DepartmentType,
  HospitalFloor,
} from '../../../types/department';
import { VALID_DEPARTMENT_TYPES } from '../../../services/departmentService';
import { getActiveOutsourcedProviders } from '../../../services/outsourcedProviderService';
import { FloorService } from '../../../services/floorService';
import { useToast } from '../../../context/ToastContext';

interface AddEditDepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: DepartmentFormValues) => void;
  departmentToEdit?: Department | null;
  existingDepartments: Department[];
  headOptions: DepartmentHeadOption[];
  floors?: HospitalFloor[];
}

export const AddEditDepartmentModal: React.FC<AddEditDepartmentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  departmentToEdit,
  existingDepartments,
  headOptions,
  floors,
}) => {
  const toast = useToast();
  const isEditMode = !!departmentToEdit;

  const [availableFloors, setAvailableFloors] = useState<HospitalFloor[]>(floors || []);

  useEffect(() => {
    if (floors && floors.length > 0) {
      setAvailableFloors(floors);
    } else if (isOpen) {
      FloorService.fetchFloors().then(setAvailableFloors).catch(() => {});
    }
  }, [floors, isOpen]);

  const [formData, setFormData] = useState<DepartmentFormValues>({
    code: '',
    name: '',
    type: 'Clinical',
    description: '',
    headUserId: '',
    headName: 'Not Assigned',
    floor: '',
    location: '',
    fixedPrice: null,
    opdEnabled: true,
    observationEnabled: false,
    emergencyEnabled: false,
    admissionEnabled: true,
    pharmacyRelated: false,
    fulfillmentOwnership: 'Internal',
    outsourcedProviderId: '',
    status: 'Active',
  });

  const outsourcedProviders = useMemo(() => getActiveOutsourcedProviders(), [isOpen]);
  const [headSearch, setHeadSearch] = useState('');
  const [isHeadDropdownOpen, setIsHeadDropdownOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (departmentToEdit) {
      setFormData({
        code: departmentToEdit.code,
        name: departmentToEdit.name,
        type: departmentToEdit.type,
        description: departmentToEdit.description || '',
        headUserId: departmentToEdit.headUserId || '',
        headName: departmentToEdit.headName || 'Not Assigned',
        floor: departmentToEdit.floor || departmentToEdit.location || '',
        location: departmentToEdit.floor || departmentToEdit.location || '',
        fixedPrice: departmentToEdit.fixedPrice != null ? departmentToEdit.fixedPrice : null,
        opdEnabled: departmentToEdit.opdEnabled,
        observationEnabled: departmentToEdit.observationEnabled,
        emergencyEnabled: departmentToEdit.emergencyEnabled,
        admissionEnabled: departmentToEdit.admissionEnabled,
        pharmacyRelated: departmentToEdit.pharmacyRelated,
        fulfillmentOwnership: departmentToEdit.fulfillmentOwnership || 'Internal',
        outsourcedProviderId: departmentToEdit.outsourcedProviderId || '',
        status: departmentToEdit.status,
      });
    } else {
      setFormData({
        code: '',
        name: '',
        type: 'Clinical',
        description: '',
        headUserId: '',
        headName: 'Not Assigned',
        floor: '',
        location: '',
        fixedPrice: null,
        opdEnabled: true,
        observationEnabled: false,
        emergencyEnabled: false,
        admissionEnabled: true,
        pharmacyRelated: false,
        fulfillmentOwnership: 'Internal',
        outsourcedProviderId: '',
        status: 'Active',
      });
    }
    setErrors({});
    setHeadSearch('');
    setIsHeadDropdownOpen(false);
  }, [departmentToEdit, isOpen]);

  const filteredHeads = useMemo(() => {
    if (!headSearch.trim()) return headOptions;
    const q = headSearch.toLowerCase();
    return headOptions.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.designation.toLowerCase().includes(q) ||
        h.department.toLowerCase().includes(q) ||
        h.userId.toLowerCase().includes(q)
    );
  }, [headOptions, headSearch]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Code is optional — left blank, the backend auto-generates a unique one.
    const trimmedCode = formData.code.trim().toUpperCase();
    if (trimmedCode) {
      const codeRegex = /^[A-Z0-9-]+$/;
      if (!codeRegex.test(trimmedCode)) {
        newErrors.code = 'Department Code must contain only uppercase letters, numbers, and hyphens (e.g. DEP-MED).';
      } else {
        const isDuplicate = existingDepartments.some((d) => {
          if (isEditMode && departmentToEdit && d.id === departmentToEdit.id) {
            return false;
          }
          return d.code.toUpperCase() === trimmedCode;
        });
        if (isDuplicate) {
          newErrors.code = `Department Code "${trimmedCode}" is already in use. Codes must be unique.`;
        }
      }
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Department Name is required.';
    }

    if (!formData.type) {
      newErrors.type = 'Department Type is required.';
    }

    if (formData.fulfillmentOwnership === 'Outsourced' && !formData.outsourcedProviderId) {
      newErrors.outsourcedProviderId = 'An Outsourced department must be linked to an Outsourced Provider.';
    }

    setErrors(newErrors);
    const errKeys = Object.keys(newErrors);
    if (errKeys.length > 0) {
      toast.error(newErrors[errKeys[0]], 'Validation Error');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      ...formData,
      code: formData.code.trim().toUpperCase(),
      name: formData.name.trim(),
      floor: formData.floor?.trim() || undefined,
      location: formData.floor?.trim() || undefined,
      fixedPrice: formData.fixedPrice != null && !isNaN(Number(formData.fixedPrice)) ? Number(formData.fixedPrice) : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#effaf5] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#08775A] text-white shadow-xs">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isEditMode ? 'Edit Hospital Department' : 'Add New Department'}
              </h3>
              <p className="text-xs text-slate-500">
                {isEditMode
                  ? `Update configuration and capabilities for ${departmentToEdit.code}`
                  : 'Register a primary hospital clinical or administrative department'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[calc(85vh-130px)] overflow-y-auto">
          {/* Edit Mode Code Warning */}
          {isEditMode && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-amber-900 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Important System Warning</span>
                <span>Changing the department code may affect linked records in the final system. Proceed with caution.</span>
              </div>
            </div>
          )}

          {/* Section 1: Basic Identifiers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Department Code
              </label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => {
                  setFormData({ ...formData, code: e.target.value.toUpperCase() });
                  if (errors.code) setErrors({ ...errors, code: '' });
                }}
                placeholder="e.g. DEP-MED (optional — leave blank to auto-generate)"
                className={`w-full rounded-lg border px-3 py-2 text-xs font-mono font-bold uppercase transition-colors focus:outline-hidden focus:ring-2 ${
                  errors.code
                    ? 'border-rose-300 bg-rose-50/30 text-rose-900 focus:ring-rose-200'
                    : 'border-slate-300 bg-white text-slate-900 focus:border-[#08775A] focus:ring-[#08775A]/20'
                }`}
              />
              {errors.code ? (
                <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.code}</p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-400">Unique uppercase code — leave blank to auto-generate</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Department Name <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (errors.name) setErrors({ ...errors, name: '' });
                }}
                placeholder="e.g. General Medicine"
                className={`w-full rounded-lg border px-3 py-2 text-xs transition-colors focus:outline-hidden focus:ring-2 ${
                  errors.name
                    ? 'border-rose-300 bg-rose-50/30 text-rose-900 focus:ring-rose-200'
                    : 'border-slate-300 bg-white text-slate-900 focus:border-[#08775A] focus:ring-[#08775A]/20'
                }`}
              />
              {errors.name && <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.name}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Department Type <span className="text-rose-600">*</span>
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as DepartmentType })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
            >
              {VALID_DEPARTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* v7.2 Department Billing Config (HMS_V7.2_NEW_REQUIREMENTS.md §2.1) */}
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#08775A] mb-3">
              Fulfillment Ownership
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fulfillment Mode
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                    <input
                      type="radio"
                      name="fulfillmentOwnership"
                      value="Internal"
                      checked={formData.fulfillmentOwnership === 'Internal'}
                      onChange={() => setFormData({ ...formData, fulfillmentOwnership: 'Internal', outsourcedProviderId: '' })}
                      className="h-4 w-4 text-[#08775A] focus:ring-[#08775A]"
                    />
                    <span>Internal</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                    <input
                      type="radio"
                      name="fulfillmentOwnership"
                      value="Outsourced"
                      checked={formData.fulfillmentOwnership === 'Outsourced'}
                      onChange={() => setFormData({ ...formData, fulfillmentOwnership: 'Outsourced' })}
                      className="h-4 w-4 text-[#08775A] focus:ring-[#08775A]"
                    />
                    <span>Outsourced</span>
                  </label>
                </div>
              </div>

              {formData.fulfillmentOwnership === 'Outsourced' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Outsourced Provider <span className="text-rose-600">*</span>
                  </label>
                  <select
                    value={formData.outsourcedProviderId}
                    onChange={(e) => {
                      setFormData({ ...formData, outsourcedProviderId: e.target.value });
                      if (errors.outsourcedProviderId) setErrors({ ...errors, outsourcedProviderId: '' });
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-xs transition-colors focus:outline-hidden focus:ring-2 ${
                      errors.outsourcedProviderId
                        ? 'border-rose-300 bg-rose-50/30 text-rose-900 focus:ring-rose-200'
                        : 'border-slate-300 bg-white text-slate-900 focus:border-[#08775A] focus:ring-[#08775A]/20'
                    }`}
                  >
                    <option value="">— Select Provider —</option>
                    {outsourcedProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                  {errors.outsourcedProviderId ? (
                    <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.outsourcedProviderId}</p>
                  ) : outsourcedProviders.length === 0 ? (
                    <p className="mt-1 text-[10px] text-amber-600">No active providers yet — add one under Outsourced Providers first.</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Description / Scope
            </label>
            <textarea
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Clinical or operational mandate of this hospital department..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
            />
          </div>

          {/* Section 2: Head & Contact */}
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#08775A] mb-3">
              Department Leadership &amp; Physical Location
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Searchable Head Selector */}
              <div className="relative">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Head / In-charge
                </label>
                <div
                  onClick={() => setIsHeadDropdownOpen(!isHeadDropdownOpen)}
                  className="flex items-center justify-between w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs cursor-pointer hover:border-slate-400 transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className={formData.headName === 'Not Assigned' ? 'text-slate-400 italic' : 'font-medium text-slate-800'}>
                      {formData.headName}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#08775A] font-semibold uppercase">Change</span>
                </div>

                {isHeadDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl border border-slate-200 bg-white p-2 shadow-xl animate-in fade-in duration-100">
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={headSearch}
                        onChange={(e) => setHeadSearch(e.target.value)}
                        placeholder="Search doctor or staff head..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 rounded-lg border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
                        autoFocus
                      />
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            headUserId: '',
                            headName: 'Not Assigned',
                          });
                          setIsHeadDropdownOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 flex items-center justify-between text-slate-500 italic"
                      >
                        <span>— Not Assigned</span>
                        {formData.headName === 'Not Assigned' && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-[#08775A]" />
                        )}
                      </button>

                      {filteredHeads.map((h) => (
                        <button
                          key={h.userId}
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              headUserId: h.userId,
                              headName: h.name,
                            });
                            setIsHeadDropdownOpen(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-[#effaf5] flex items-center justify-between group transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-slate-900 group-hover:text-[#08775A]">
                              {h.name}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {h.designation} • {h.department}
                            </div>
                          </div>
                          {formData.headUserId === h.userId && (
                            <CheckCircle2 className="h-4 w-4 text-[#08775A]" />
                          )}
                        </button>
                      ))}

                      {filteredHeads.length === 0 && (
                        <p className="p-3 text-center text-xs text-slate-400">No matching doctors or staff found.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Location / Floor Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Location / Floor
                </label>
                <select
                  value={formData.floor || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      floor: e.target.value,
                      location: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
                >
                  <option value="">— Select Hospital Floor —</option>
                  {availableFloors.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name} {f.building ? `(${f.building})` : ''}
                    </option>
                  ))}
                </select>
                {availableFloors.length === 0 ? (
                  <p className="mt-1 text-[10px] text-amber-600">
                    No floors found in database. Configure floors in Department Overview.
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-slate-400">
                    Select the hospital building floor for this department
                  </p>
                )}
              </div>
            </div>

            {/* Optional Fixed Pricing (Not per day) */}
            <div className="mt-4 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  Fixed Pricing / Consultation Fee (PKR)
                </label>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  Optional • Fixed Price (Not per-day)
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs font-bold text-slate-400">PKR</span>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min="0"
                  step="any"
                  value={formData.fixedPrice ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      fixedPrice: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                  placeholder="e.g. 1500 (leave blank if standard rates or free)"
                  className="w-full rounded-lg border border-slate-300 bg-white pl-12 pr-3 py-2 text-xs font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Optional department standard consultation fee or flat service charge. This is a one-time fixed rate, not a recurring per-day charge.
              </p>
            </div>
          </div>

          {/* Form Actions */}
          <div className="border-t border-slate-200 pt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#08775A] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0e7d5a] transition-colors shadow-sm"
            >
              {isEditMode ? 'Update Department' : 'Save Department'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
