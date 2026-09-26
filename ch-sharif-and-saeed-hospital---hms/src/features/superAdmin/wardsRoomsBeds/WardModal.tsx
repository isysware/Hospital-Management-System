import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Ward, WardFormValues } from '../../../types/wardsRoomsBeds';
import { Department, HospitalFloor } from '../../../types/department';
import { StaffUser } from '../../../types/staffUser';
import {
  WardsRoomsBedsService,
  VALID_WARD_TYPES,
  VALID_GENDER_POLICIES,
} from '../../../services/wardsRoomsBedsService';
import { useToast } from '../../../context/ToastContext';

interface WardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: WardFormValues) => void;
  ward?: Ward | null;
  departments: Department[];
  staffUsers?: StaffUser[];
  floors?: HospitalFloor[];
}

export const WardModal: React.FC<WardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  ward,
  departments,
  staffUsers = [],
  floors = [],
}) => {
  const toast = useToast();
  const isEditing = !!ward;

  const [formValues, setFormValues] = useState<WardFormValues>({
    code: '',
    name: '',
    departmentId: departments[0]?.id || '',
    wardType: 'General',
    floor: floors[0]?.name || '1st Floor',
    location: '',
    genderPolicy: 'Not Applicable',
    headStaffId: '',
    fixedPrice: '',
    status: 'Active',
  });

  const [codeError, setCodeError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (ward) {
      setFormValues({
        code: ward.code,
        name: ward.name,
        departmentId: ward.departmentId,
        wardType: ward.wardType,
        floor: ward.floor || (floors[0]?.name ?? '1st Floor'),
        location: ward.location || '',
        genderPolicy: ward.genderPolicy || 'Not Applicable',
        headStaffId: ward.headStaffId || '',
        fixedPrice: ward.fixedPrice != null ? ward.fixedPrice : '',
        status: ward.status,
      });
      setCodeError(null);
      setErrors({});
    } else {
      setFormValues({
        code: '',
        name: '',
        departmentId: departments.find((d) => d.status === 'Active')?.id || departments[0]?.id || '',
        wardType: 'General',
        floor: floors[0]?.name || 'Ground Floor',
        location: '',
        genderPolicy: 'Not Applicable',
        headStaffId: '',
        fixedPrice: '',
        status: 'Active',
      });
      setCodeError(null);
      setErrors({});
    }
  }, [ward, isOpen, departments, floors]);

  if (!isOpen) return null;

  const handleCodeChange = (val: string) => {
    const upper = val.toUpperCase().replace(/\s+/g, '-');
    setFormValues((prev) => ({ ...prev, code: upper }));

    // Code is optional — left blank, the backend auto-generates a unique one.
    if (!upper) {
      setCodeError(null);
      return;
    }
    const check = WardsRoomsBedsService.validateWardCode(upper, ward?.id);
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
      const check = WardsRoomsBedsService.validateWardCode(formValues.code, ward?.id);
      if (!check.isValid) {
        newErrors.code = check.message || 'Duplicate or invalid code.';
      }
    }

    if (!formValues.name.trim()) {
      newErrors.name = 'Ward name is required.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstError = Object.values(newErrors)[0];
      toast.error(firstError, 'Validation Error');
      return;
    }

    const effectiveDeptId =
      formValues.departmentId ||
      departments.find((d) => d.status === 'Active')?.id ||
      departments[0]?.id ||
      '';

    onSave({
      ...formValues,
      departmentId: effectiveDeptId,
      headStaffId: formValues.headStaffId || undefined,
      fixedPrice:
        formValues.fixedPrice !== '' && formValues.fixedPrice !== undefined
          ? Number(formValues.fixedPrice)
          : undefined,
      status: 'Active',
    });
  };

  return (
    <div
      id="ward-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div
        id="ward-modal-content"
        className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/60">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              {isEditing ? 'Edit Inpatient Ward' : 'Add New Inpatient Ward'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure ward floor location, in-charge and one-time fixed pricing
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Row 1: Code and Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Ward Code */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ward Code
              </label>
              <input
                id="ward-form-code"
                type="text"
                value={formValues.code}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="e.g. WRD-MED-01 (optional)"
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

            {/* Ward Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ward Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="ward-form-name"
                type="text"
                value={formValues.name}
                onChange={(e) =>
                  setFormValues((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g. Male Medical Ward"
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

          {/* Row 2: Ward Type and Head / In-charge */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Ward Type */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ward Type <span className="text-rose-500">*</span>
              </label>
              <select
                id="ward-form-type"
                value={formValues.wardType}
                onChange={(e) =>
                  setFormValues((prev) => ({ ...prev, wardType: e.target.value as any }))
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
              >
                {VALID_WARD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Head / In-charge (Optional) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Head / In-charge <span className="text-slate-400 font-normal text-[11px]">(Optional)</span>
              </label>
              <select
                id="ward-form-head"
                value={formValues.headStaffId || ''}
                onChange={(e) =>
                  setFormValues((prev) => ({ ...prev, headStaffId: e.target.value }))
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
              >
                <option value="">Not Assigned (None)</option>
                {staffUsers
                  ?.filter((s) => s.status === 'ACTIVE')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.designation || s.staffCategory})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Row 3: Gender Policy and Floor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Gender Policy */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Gender Policy
              </label>
              <select
                id="ward-form-gender"
                value={formValues.genderPolicy}
                onChange={(e) =>
                  setFormValues((prev) => ({
                    ...prev,
                    genderPolicy: e.target.value as any,
                  }))
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
              >
                {VALID_GENDER_POLICIES.map((g) => (
                  <option key={g} value={g}>
                    {g === 'Not Applicable' ? 'Not Applicable (Co-ed / All)' : g}
                  </option>
                ))}
              </select>
            </div>

            {/* Floor */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Floor
              </label>
              {floors && floors.length > 0 ? (
                <select
                  id="ward-form-floor-select"
                  value={formValues.floor}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, floor: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                >
                  {floors.map((fl) => (
                    <option key={fl.id} value={fl.name}>
                      {fl.name} {fl.building ? `(${fl.building})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="ward-form-floor"
                  type="text"
                  value={formValues.floor}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, floor: e.target.value }))
                  }
                  placeholder="e.g. 2nd Floor"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
                />
              )}
            </div>
          </div>

          {/* Row 5: Optional One-Time Fixed Ward Fee (PKR) */}
          <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Fixed Ward Fee / Pricing (PKR){' '}
                <span className="text-slate-400 font-normal text-[11px]">(Optional)</span>
              </label>
              <span className="text-[10px] text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                One-Time Fixed (Not per-day)
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs font-bold text-slate-400 font-mono">
                PKR
              </span>
              <input
                id="ward-form-fixed-price"
                type="number"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                step="1"
                value={formValues.fixedPrice ?? ''}
                onChange={(e) =>
                  setFormValues((prev) => ({ ...prev, fixedPrice: e.target.value }))
                }
                placeholder="0 (Free / No ward charge)"
                className="w-full pl-12 pr-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Optional one-time admission charge for this ward. If 0 or blank, nothing is billed. Daily stay charges apply on the Room/Bed.
            </p>
          </div>

          {/* Audit trail if editing */}
          {isEditing && ward && (
            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex flex-wrap justify-between gap-2">
              <span>Created by: {ward.createdBy} • {ward.createdAt}</span>
              <span>Updated by: {ward.updatedBy} • {ward.updatedAt}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
            <button
              id="ward-modal-cancel-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="ward-modal-submit-btn"
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              {isEditing ? 'Update Ward' : 'Save Ward'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
