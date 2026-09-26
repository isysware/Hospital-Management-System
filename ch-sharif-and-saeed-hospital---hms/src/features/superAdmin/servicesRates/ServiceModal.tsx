import React, { useState, useEffect, useMemo } from 'react';
import { X, AlertCircle, Stethoscope, ExternalLink } from 'lucide-react';
import { HospitalService, ServiceFormValues } from '../../../types/serviceRates';
import { Department } from '../../../types/department';
import { ServiceRatesService, VALID_BILLING_UNITS } from '../../../services/serviceRatesService';
import { fetchDepartments } from '../../../services/departmentService';
import { useToast } from '../../../context/ToastContext';

export type ServiceStreamType = 'HOSPITAL' | 'OUTSOURCED';

interface ServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: ServiceFormValues) => void;
  service?: HospitalService | null;
  departments: Department[];
}

export const ServiceModal: React.FC<ServiceModalProps> = ({ isOpen, onClose, onSave, service }) => {
  const toast = useToast();
  const isEditing = !!service;
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [selectedStream, setSelectedStream] = useState<ServiceStreamType>('HOSPITAL');
  const [formValues, setFormValues] = useState<ServiceFormValues>({
    code: '', name: '', description: '', departmentId: '', standardRate: 0,
    billingUnit: 'Per Consultation', panelEligible: true,
    manualRateOverrideAllowed: false, discountAllowed: true,
    encounterType: 'NONE', isDefaultEncounterService: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setDepartmentsLoading(true);
    setDepartmentError(null);
    setAllDepartments([]);
    setErrors({});
    setCodeError(null);
    setSelectedStream(service?.serviceStream === 'LAB' ? 'OUTSOURCED' : 'HOSPITAL');
    setFormValues({
      code: service?.code ?? '', name: service?.name ?? '',
      description: service?.description ?? '', departmentId: service?.departmentId ?? '',
      standardRate: service?.standardRate ?? 0,
      billingUnit: service?.billingUnit ?? 'Per Consultation',
      panelEligible: service?.panelEligible ?? true,
      manualRateOverrideAllowed: service?.manualRateOverrideAllowed ?? false,
      discountAllowed: service?.discountAllowed ?? true,
      encounterType: service?.encounterType ?? 'NONE',
      isDefaultEncounterService: service?.isDefaultEncounterService ?? false,
    });
    fetchDepartments().then((list) => {
      if (cancelled) return;
      setAllDepartments(list);
      const department = list.find((d) => d.id === service?.departmentId);
      setSelectedStream(department
        ? department.fulfillmentOwnership === 'Outsourced' ? 'OUTSOURCED' : 'HOSPITAL'
        : service?.serviceStream === 'LAB' ? 'OUTSOURCED' : 'HOSPITAL');
    }).catch(() => {
      if (!cancelled) setDepartmentError('Unable to load departments. Close and reopen the modal to retry.');
    }).finally(() => {
      if (!cancelled) setDepartmentsLoading(false);
    });
    return () => { cancelled = true; };
  }, [service, isOpen]);

  const availableDepartments = useMemo(() => allDepartments.filter((d) =>
    selectedStream === 'OUTSOURCED'
      ? d.status === 'Active' && d.fulfillmentOwnership === 'Outsourced'
      : d.fulfillmentOwnership === 'Internal' &&
        (d.status === 'Active' || d.id === service?.departmentId)
  ), [allDepartments, selectedStream, service?.departmentId]);

  const handleStreamChange = (newStream: ServiceStreamType) => {
    if (newStream === selectedStream) return;
    setSelectedStream(newStream);
    setFormValues((prev) => ({ ...prev, departmentId: '' }));
    setErrors({});
  };

  if (!isOpen) return null;

  const handleCodeChange = (val: string) => {
    const upper = val.toUpperCase().replace(/\s+/g, '-');
    setFormValues((prev) => ({ ...prev, code: upper }));

    // Code is optional — left blank, the backend auto-generates a unique one.
    if (!upper) {
      setCodeError(null);
      return;
    }

    const check = ServiceRatesService.validateServiceCode(upper, service?.id);
    if (!check.isValid) {
      setCodeError(check.message || 'Invalid code.');
    } else {
      setCodeError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};

    if (formValues.code.trim()) {
      const check = ServiceRatesService.validateServiceCode(formValues.code, service?.id);
      if (!check.isValid) {
        newErrors.code = check.message || 'Duplicate or invalid code.';
      }
    }

    if (!formValues.name.trim()) {
      newErrors.name = 'Service name is required.';
    }

    if (formValues.departmentId && (departmentsLoading || departmentError || !availableDepartments.some((d) => d.id === formValues.departmentId))) {
      newErrors.departmentId = 'Select an available department.';
    }

    if (formValues.standardRate < 0 || !Number.isFinite(formValues.standardRate)) {
      newErrors.standardRate = 'Rate cannot be negative.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstError = Object.values(newErrors)[0];
      toast.error(firstError, 'Validation Error');
      return;
    }

    onSave({
      ...formValues,
      // LAB remains the existing outsourced storage stream for billing compatibility.
      serviceStream: selectedStream === 'HOSPITAL' ? 'HOSPITAL'
        : formValues.departmentId && service?.departmentId === formValues.departmentId ? (service.serviceStream ?? 'LAB') : 'LAB',
    });
  };

  return (
    <div
      id="service-modal-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto"
    >
      <div
        id="service-modal-content"
        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden mt-8 mb-12 sm:mt-12 sm:mb-16 flex flex-col max-h-[calc(100vh-5rem)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/80 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              {isEditing ? 'Edit Charge Master Service' : 'Add New Billable Service'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure hospital tariff, clinical classification, and panel coverage rules
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden grow">
          <div className="p-6 space-y-5 overflow-y-auto grow">
            {/* Service Classification */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Service Stream / Classification <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* 1. Hospital Services */}
                <button
                  id="stream-select-hospital"
                  type="button"
                  disabled={departmentsLoading || !!departmentError}
                  onClick={() => handleStreamChange('HOSPITAL')}
                  className={`relative flex flex-col items-start p-2.5 text-left rounded-xl border transition-all ${
                    selectedStream === 'HOSPITAL'
                      ? 'border-[#08775A] bg-[#effaf5] shadow-xs ring-1 ring-[#08775A]'
                      : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                      <Stethoscope
                        className={`w-3.5 h-3.5 ${
                          selectedStream === 'HOSPITAL' ? 'text-[#08775A]' : 'text-slate-500'
                        }`}
                      />
                      <span>Hospital</span>
                    </div>
                    <div
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        selectedStream === 'HOSPITAL'
                          ? 'border-[#08775A] bg-[#08775A]'
                          : 'border-slate-300'
                      }`}
                    >
                      {selectedStream === 'HOSPITAL' && (
                        <div className="w-1 h-1 rounded-full bg-white" />
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    In-house care, ER, OBS, nursing
                  </p>
                </button>

                {/* 2. Outsourced Services */}
                <button
                  id="stream-select-outsourced"
                  type="button"
                  disabled={departmentsLoading || !!departmentError}
                  onClick={() => handleStreamChange('OUTSOURCED')}
                  className={`relative flex flex-col items-start p-2.5 text-left rounded-xl border transition-all ${
                    selectedStream === 'OUTSOURCED'
                      ? 'border-indigo-600 bg-indigo-50/60 shadow-xs ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                      <ExternalLink
                        className={`w-3.5 h-3.5 ${
                          selectedStream === 'OUTSOURCED' ? 'text-indigo-600' : 'text-slate-500'
                        }`}
                      />
                      <span>Outsourced</span>
                    </div>
                    <div
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        selectedStream === 'OUTSOURCED'
                          ? 'border-indigo-600 bg-indigo-600'
                          : 'border-slate-300'
                      }`}
                    >
                      {selectedStream === 'OUTSOURCED' && (
                        <div className="w-1 h-1 rounded-full bg-white" />
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    Services provided by outsourced departments
                  </p>
                </button>

              </div>
            </div>

            <>
              {/* Charge Master Service Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Service Code */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Service Code
                  </label>
                  <input
                    id="service-form-code"
                    type="text"
                    value={formValues.code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    placeholder="e.g. SRV-OPD-001 (optional — auto-generated if blank)"
                    className={`w-full px-3 py-2 text-xs font-mono font-medium rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                      codeError || errors.code
                        ? 'border-rose-300 focus:ring-rose-200 focus:border-rose-500'
                        : 'border-slate-200 focus:ring-[#08775A]/20 focus:border-[#08775A]'
                    }`}
                  />
                  {(codeError || errors.code) && (
                    <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {codeError || errors.code}
                    </p>
                  )}
                </div>

                {/* Service Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Service Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="service-form-name"
                    type="text"
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Enter service name"
                    className={`w-full px-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                      errors.name
                        ? 'border-rose-300 focus:ring-rose-200 focus:border-rose-500'
                        : 'border-slate-200 focus:ring-[#08775A]/20 focus:border-[#08775A]'
                    }`}
                  />
                  {errors.name && (
                    <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.name}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Department */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {selectedStream === 'OUTSOURCED' ? 'Outsourced Department' : 'Department'} (Optional)
                  </label>
                  <select
                    id="service-form-dept"
                    disabled={departmentsLoading || !!departmentError}
                    value={availableDepartments.some((d) => d.id === formValues.departmentId) ? formValues.departmentId : ''}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, departmentId: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                  >
                    <option value="">{departmentsLoading ? 'Loading departments...' : 'No department'}</option>
                    {availableDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.status === 'Inactive' ? '(Inactive)' : ''}
                      </option>
                    ))}
                  </select>
                  {(departmentError || errors.departmentId) && (
                    <p className="text-[11px] text-rose-600 mt-1">{departmentError || errors.departmentId}</p>
                  )}
                  {!departmentsLoading && !departmentError && availableDepartments.length === 0 && (
                    <p className="text-[11px] text-slate-500 mt-1">No active departments available for this classification.</p>
                  )}
                </div>

              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description / Clinical Specification (Optional)
                </label>
                <textarea
                  id="service-form-description"
                  rows={2}
                  value={formValues.description}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Clinical indications, equipment used, or billing instructions..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Standard Rate */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Standard Rate (PKR) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      PKR
                    </span>
                    <input
                      id="service-form-rate"
                      type="number"
                      onWheel={(e) => e.currentTarget.blur()}
                      min="0"
                      step="any"
                      placeholder="0"
                      value={formValues.standardRate === 0 ? '' : formValues.standardRate}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setFormValues((prev) => ({
                          ...prev,
                          standardRate: raw === '' ? 0 : (parseFloat(raw) || 0),
                        }));
                      }}
                      className="w-full pl-12 pr-3 py-2 text-xs font-bold text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                    />
                  </div>
                  {errors.standardRate && (
                    <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.standardRate}
                    </p>
                  )}
                </div>

                {/* Billing Unit */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Billing Unit <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="service-form-unit"
                    value={formValues.billingUnit}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        billingUnit: e.target.value as any,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                  >
                    {VALID_BILLING_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toggles Panel */}
              <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 space-y-3">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Billing & Panel Policies
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      id="service-toggle-panel"
                      type="checkbox"
                      checked={formValues.panelEligible}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, panelEligible: e.target.checked }))
                      }
                      className="mt-0.5 rounded text-[#08775A] focus:ring-[#08775A]"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Panel Eligible
                      </span>
                      <span className="text-[11px] text-slate-500 block leading-tight">
                        Applies corporate tariff
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      id="service-toggle-discount"
                      type="checkbox"
                      checked={formValues.discountAllowed}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, discountAllowed: e.target.checked }))
                      }
                      className="mt-0.5 rounded text-[#08775A] focus:ring-[#08775A]"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Discount Allowed
                      </span>
                      <span className="text-[11px] text-slate-500 block leading-tight">
                        Cashier concessions
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      id="service-toggle-override"
                      type="checkbox"
                      checked={formValues.manualRateOverrideAllowed}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          manualRateOverrideAllowed: e.target.checked,
                        }))
                      }
                      className="mt-0.5 rounded text-[#08775A] focus:ring-[#08775A]"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Rate Override
                      </span>
                      <span className="text-[11px] text-slate-500 block leading-tight">
                        Manual cashier edit
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Encounter Type Mapping (Only for Hospital Services) */}
              {selectedStream === 'HOSPITAL' && (
                <div className="bg-emerald-50/50 p-3.5 rounded-xl border border-emerald-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">
                        Front Desk Intake Mapping (V7.2)
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Link this service to automatic fee charging at Front Desk walk-in intake.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Encounter Type Link
                      </label>
                      <select
                        id="service-form-encounter-type"
                        value={formValues.encounterType || 'NONE'}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            encounterType: e.target.value as any,
                            isDefaultEncounterService:
                              e.target.value === 'NONE' ? false : prev.isDefaultEncounterService,
                          }))
                        }
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                      >
                        <option value="NONE">None (Regular Billable Service)</option>
                        <option value="OPD">OPD Consultation</option>
                        <option value="OBSERVATION">Observation Stay</option>
                        <option value="EMERGENCY">Emergency Care</option>
                      </select>
                    </div>

                    {formValues.encounterType && formValues.encounterType !== 'NONE' && (
                      <div className="pt-3 sm:pt-4">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formValues.isDefaultEncounterService || false}
                            onChange={(e) =>
                              setFormValues((prev) => ({
                                ...prev,
                                isDefaultEncounterService: e.target.checked,
                              }))
                            }
                            className="mt-0.5 rounded text-[#08775A] focus:ring-[#08775A]"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-800 block">
                              Default {formValues.encounterType} Service
                            </span>
                            <span className="text-[11px] text-slate-500 block leading-tight">
                              Auto-charged at Front Desk walk-in intake
                            </span>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </>

          {/* Audit Trail for Editing */}
          {isEditing && service && (
            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex flex-wrap justify-between gap-2">
              <span>
                Created by: {service.createdBy} • {service.createdAt}
              </span>
              <span>
                Updated by: {service.updatedBy} • {service.updatedAt}
              </span>
            </div>
          )}

          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 bg-slate-50/70 shrink-0">
            <button
              id="service-modal-cancel-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              id="service-modal-submit-btn"
              type="submit"
              disabled={departmentsLoading || !!departmentError}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors"
            >
              {isEditing ? 'Update Service' : 'Save Service Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
