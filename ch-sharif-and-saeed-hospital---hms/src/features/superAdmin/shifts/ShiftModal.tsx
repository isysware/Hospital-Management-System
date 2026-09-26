import React, { useState, useEffect, useMemo } from 'react';
import { X, Clock, Moon, Sun, AlertCircle, Info, Calendar } from 'lucide-react';
import {
  Shift,
  ShiftFormData,
  ShiftType,
  ShiftStatus,
  Weekday,
  WEEKDAYS,
} from '../../../types/shift';
import { Department } from '../../../types/department';
import {
  calculateShiftTiming,
  formatMinutesToHours,
  ShiftService,
} from '../../../services/shiftService';

interface ShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ShiftFormData) => void;
  initialShift?: Shift | null;
  isDuplicate?: boolean;
  departments: Department[];
}

export const ShiftModal: React.FC<ShiftModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialShift,
  isDuplicate = false,
  departments,
}) => {
  const isEditing = Boolean(initialShift && !isDuplicate);

  // Default Form State with neutral policy defaults
  const defaultState: ShiftFormData = {
    code: '',
    name: '',
    departmentId: '',
    shiftType: 'MORNING',
    startTime: '08:00',
    endTime: '16:00',
    breakMinutes: 0,
    defaultArrivalGraceMinutes: 0,
    defaultEarlyExitToleranceMinutes: 0,
    defaultWeeklyOffDays: [],
    status: 'ACTIVE',
    notes: '',
  };

  const [formData, setFormData] = useState<ShiftFormData>(defaultState);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset or populate form when modal opens or initialShift changes
  useEffect(() => {
    if (isOpen) {
      if (initialShift) {
        if (isDuplicate) {
          // DUPLICATE MODE:
          // Prefill all settings, but blank the Shift Code (optional — a new
          // unique code is auto-generated unless the user enters one) and suggest name - Copy
          setFormData({
            code: '', // Left blank; auto-generated on save unless the user types a new one
            name: `${initialShift.name} - Copy`,
            departmentId: initialShift.departmentId,
            shiftType: initialShift.shiftType,
            startTime: initialShift.startTime,
            endTime: initialShift.endTime,
            breakMinutes: initialShift.breakMinutes,
            defaultArrivalGraceMinutes: initialShift.defaultArrivalGraceMinutes,
            defaultEarlyExitToleranceMinutes: initialShift.defaultEarlyExitToleranceMinutes,
            defaultWeeklyOffDays: [...(initialShift.defaultWeeklyOffDays || [])],
            status: 'ACTIVE',
            notes: initialShift.notes || '',
          });
        } else {
          // EDIT MODE:
          setFormData({
            code: initialShift.code,
            name: initialShift.name,
            departmentId: initialShift.departmentId,
            shiftType: initialShift.shiftType,
            startTime: initialShift.startTime,
            endTime: initialShift.endTime,
            breakMinutes: initialShift.breakMinutes,
            defaultArrivalGraceMinutes: initialShift.defaultArrivalGraceMinutes,
            defaultEarlyExitToleranceMinutes: initialShift.defaultEarlyExitToleranceMinutes,
            defaultWeeklyOffDays: [...(initialShift.defaultWeeklyOffDays || [])],
            status: initialShift.status,
            notes: initialShift.notes || '',
          });
        }
      } else {
        // ADD NEW MODE:
        const firstActiveDept = departments.find((d) => d.status === 'Active') || departments[0];
        setFormData({
          ...defaultState,
          departmentId: firstActiveDept ? firstActiveDept.id : '',
        });
      }
      setErrors({});
    }
  }, [isOpen, initialShift, isDuplicate, departments]);

  // Live Timing Calculation
  const timingCalc = useMemo(() => {
    return calculateShiftTiming(
      formData.startTime,
      formData.endTime,
      formData.breakMinutes
    );
  }, [formData.startTime, formData.endTime, formData.breakMinutes]);

  if (!isOpen) return null;

  // Available departments for selection:
  // For new/duplicate: only active departments.
  // For edit: if current department is inactive, include it with "(Inactive)" tag.
  const selectableDepartments = departments.filter((d) => {
    if (d.status === 'Active') return true;
    if (isEditing && d.id === initialShift?.departmentId) return true;
    return false;
  });

  const handleWeekdayToggle = (day: Weekday) => {
    const exists = formData.defaultWeeklyOffDays.includes(day);
    if (exists) {
      setFormData({
        ...formData,
        defaultWeeklyOffDays: formData.defaultWeeklyOffDays.filter((d) => d !== day),
      });
    } else {
      setFormData({
        ...formData,
        defaultWeeklyOffDays: [...formData.defaultWeeklyOffDays, day],
      });
    }
  };

  const handleClearWeeklyOff = () => {
    setFormData({
      ...formData,
      defaultWeeklyOffDays: [],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Frontend validation via ShiftService
    const validation = ShiftService.validateShift(
      formData,
      isEditing ? initialShift?.id : undefined
    );

    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#08775A]" />
              {isDuplicate
                ? 'Duplicate Shift Template'
                : isEditing
                ? 'Edit Duty Shift'
                : 'Add New Duty Shift'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isDuplicate
                ? 'Creates an independent new shift record based on an existing schedule.'
                : isEditing
                ? `Updating shift configuration for ${formData.code || initialShift?.code}`
                : 'Configure reusable duty hours, attendance grace, and weekly off schedule.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6 text-xs">
          {/* SECTION A: Basic Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                A. Basic Information
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Shift Code */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Shift Code
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => {
                    setFormData({ ...formData, code: e.target.value.toUpperCase() });
                    if (errors.code) setErrors({ ...errors, code: '' });
                  }}
                  placeholder="e.g. SHF-MOR-01 (optional — auto-generated if blank)"
                  className={`w-full px-3 py-1.5 font-mono text-xs uppercase bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.code
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
                {errors.code ? (
                  <p className="text-[11px] text-rose-500 mt-1">{errors.code}</p>
                ) : (
                  <p className="text-[10.5px] text-slate-400 mt-0.5">
                    Unique uppercase code — leave blank to auto-generate
                  </p>
                )}
              </div>

              {/* Shift Name */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Shift Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    if (errors.name) setErrors({ ...errors, name: '' });
                  }}
                  placeholder="e.g. Morning Clinical Duty"
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.name
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
                {errors.name ? (
                  <p className="text-[11px] text-rose-500 mt-1">{errors.name}</p>
                ) : (
                  <p className="text-[10.5px] text-slate-400 mt-0.5">
                    Descriptive name for shift assignment
                  </p>
                )}
              </div>

              {/* Canonical Department */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Department <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.departmentId}
                  onChange={(e) => {
                    setFormData({ ...formData, departmentId: e.target.value });
                    if (errors.departmentId) setErrors({ ...errors, departmentId: '' });
                  }}
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.departmentId
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                >
                  <option value="">-- Select Department --</option>
                  {selectableDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.status === 'Inactive' ? '(Inactive)' : ''}
                    </option>
                  ))}
                </select>
                {errors.departmentId ? (
                  <p className="text-[11px] text-rose-500 mt-1">{errors.departmentId}</p>
                ) : (
                  <p className="text-[10.5px] text-slate-400 mt-0.5">
                    Hospital department owning this shift
                  </p>
                )}
              </div>

              {/* Shift Type */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Shift Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.shiftType}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      shiftType: e.target.value as ShiftType,
                    });
                    if (errors.shiftType) setErrors({ ...errors, shiftType: '' });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors"
                >
                  <option value="MORNING">Morning Shift</option>
                  <option value="EVENING">Evening Shift</option>
                  <option value="NIGHT">Night Shift</option>
                  <option value="CUSTOM">Custom Shift</option>
                </select>
                {errors.shiftType && (
                  <p className="text-[11px] text-rose-500 mt-1">{errors.shiftType}</p>
                )}
              </div>
            </div>
          </div>

          {/* SECTION B: Working Hours */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                B. Working Hours & Duration
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {/* Start Time */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Start Time (24h) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => {
                    setFormData({ ...formData, startTime: e.target.value });
                    if (errors.time) setErrors({ ...errors, time: '' });
                  }}
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.time
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
              </div>

              {/* End Time */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  End Time (24h) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => {
                    setFormData({ ...formData, endTime: e.target.value });
                    if (errors.time) setErrors({ ...errors, time: '' });
                  }}
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.time
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
              </div>

              {/* Break Duration */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Break Duration (mins)
                </label>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min="0"
                  step="5"
                  value={formData.breakMinutes}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      breakMinutes: parseInt(e.target.value, 10) || 0,
                    });
                    if (errors.breakMinutes) setErrors({ ...errors, breakMinutes: '' });
                  }}
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.breakMinutes
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
              </div>
            </div>

            {/* Error Message for Time */}
            {errors.time && (
              <div className="flex items-center gap-1.5 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md p-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{errors.time}</span>
              </div>
            )}
            {errors.breakMinutes && (
              <div className="flex items-center gap-1.5 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md p-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{errors.breakMinutes}</span>
              </div>
            )}

            {/* Live Calculation Preview Banner */}
            {timingCalc.valid && (
              <div className="bg-[#effaf5] border border-[#c2e7db] rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-800">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#08775A] tracking-wider block">
                    Gross Duration
                  </span>
                  <span className="font-bold text-slate-900 text-xs">
                    {formatMinutesToHours(timingCalc.grossDurationMinutes)}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    ({timingCalc.grossDurationMinutes} mins)
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-[#08775A] tracking-wider block">
                    Break Allocated
                  </span>
                  <span className="font-bold text-slate-900 text-xs">
                    {timingCalc.breakMinutes} mins
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-[#08775A] tracking-wider block">
                    Net Working Hours
                  </span>
                  <span className="font-bold text-[#08775A] text-xs">
                    {formatMinutesToHours(timingCalc.netWorkingMinutes)}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    ({timingCalc.netWorkingMinutes} mins)
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-[#08775A] tracking-wider block">
                    Shift Cycle
                  </span>
                  {timingCalc.isOvernight ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 mt-0.5">
                      <Moon className="h-2.5 w-2.5" />
                      +1 Day / Overnight
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 mt-0.5">
                      <Sun className="h-2.5 w-2.5" />
                      Same-Day Shift
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* SECTION C: Attendance Timing Defaults */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                C. Attendance Timing Defaults
              </span>
            </div>

            <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2 text-[11px] text-amber-800">
              <Info className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <span>
                <strong>Scheduling Defaults Only:</strong> Default timing values —
                individual Staff policy may override later upon contract or profile configuration.
                Monetary deduction rates are strictly managed within Staff profiles.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Default Arrival Grace */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Default Arrival Grace (minutes)
                </label>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min="0"
                  step="1"
                  value={formData.defaultArrivalGraceMinutes}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      defaultArrivalGraceMinutes: parseInt(e.target.value, 10) || 0,
                    });
                    if (errors.defaultArrivalGraceMinutes) {
                      setErrors({ ...errors, defaultArrivalGraceMinutes: '' });
                    }
                  }}
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.defaultArrivalGraceMinutes
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
                {errors.defaultArrivalGraceMinutes ? (
                  <p className="text-[11px] text-rose-500 mt-1">
                    {errors.defaultArrivalGraceMinutes}
                  </p>
                ) : (
                  <p className="text-[10.5px] text-slate-400 mt-0.5">
                    Minutes allowed past shift start before late mark
                  </p>
                )}
              </div>

              {/* Default Early Exit Tolerance */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Default Early Exit Tolerance (minutes)
                </label>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min="0"
                  step="1"
                  value={formData.defaultEarlyExitToleranceMinutes}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      defaultEarlyExitToleranceMinutes: parseInt(e.target.value, 10) || 0,
                    });
                    if (errors.defaultEarlyExitToleranceMinutes) {
                      setErrors({ ...errors, defaultEarlyExitToleranceMinutes: '' });
                    }
                  }}
                  className={`w-full px-3 py-1.5 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 transition-colors ${
                    errors.defaultEarlyExitToleranceMinutes
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-300 focus:border-[#08775A] focus:ring-[#08775A]'
                  }`}
                />
                {errors.defaultEarlyExitToleranceMinutes ? (
                  <p className="text-[11px] text-rose-500 mt-1">
                    {errors.defaultEarlyExitToleranceMinutes}
                  </p>
                ) : (
                  <p className="text-[10.5px] text-slate-400 mt-0.5">
                    Minutes allowed before shift end without early departure penalty
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* SECTION D: Weekly Schedule */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                D. Default Weekly Off Days
              </span>
              <button
                type="button"
                onClick={handleClearWeeklyOff}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              >
                Clear (24/7 Rotational / No Default Off)
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const isSelected = formData.defaultWeeklyOffDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleWeekdayToggle(day)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#08775A] text-white border-[#08775A] shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] text-slate-400">
              Selected off days serve as standard roster baseline. 24/7 hospital duties may leave this empty.
            </p>
          </div>

          {/* SECTION E: Notes & Status */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                E. Notes & Operational Status
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Operational Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="e.g. Critical care shift covering emergency ward roster..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] transition-colors resize-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Shift Status
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      value="ACTIVE"
                      checked={formData.status === 'ACTIVE'}
                      onChange={() => setFormData({ ...formData, status: 'ACTIVE' })}
                      className="text-[#08775A] focus:ring-[#08775A]"
                    />
                    <span className="text-xs font-semibold text-emerald-700">Active</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer ml-3">
                    <input
                      type="radio"
                      name="status"
                      value="INACTIVE"
                      checked={formData.status === 'INACTIVE'}
                      onChange={() => setFormData({ ...formData, status: 'INACTIVE' })}
                      className="text-slate-600 focus:ring-slate-500"
                    />
                    <span className="text-xs font-semibold text-slate-600">Inactive</span>
                  </label>
                </div>
                <p className="text-[10.5px] text-slate-400 mt-1.5">
                  Only active shifts can be assigned to new staff members
                </p>
              </div>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              {isDuplicate ? 'Save Duplicated Shift' : isEditing ? 'Update Shift' : 'Create Duty Shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
