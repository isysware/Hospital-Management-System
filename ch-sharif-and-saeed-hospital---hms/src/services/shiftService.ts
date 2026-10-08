import apiClient from './apiClient';
import { Shift, ShiftFilterState, ShiftFormData, ShiftKPIs, ShiftType, Weekday } from '../types/shift';
import { User } from '../types';
import { DepartmentService } from './departmentService';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Live Shift Master service — every read/write round-trips through
 * `/api/v1/setup/shifts*`. Same in-memory-cache pattern as the other
 * rewired Super Admin services — never localStorage.
 */

/**
 * Format 24-hour HH:mm string to 12-hour AM/PM format (e.g., "08:00" -> "08:00 AM", "20:30" -> "08:30 PM")
 */
export function format12HourTime(time24: string): string {
  if (!time24 || !time24.includes(':')) return time24 || '—';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return time24;

  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const padH = String(displayH).padStart(2, '0');
  const padM = String(m).padStart(2, '0');
  return `${padH}:${padM} ${period}`;
}

/**
 * Format minutes into readable hour and minute string (e.g., 480 -> "8h 00m", 450 -> "7h 30m")
 */
export function formatMinutesToHours(minutes: number): string {
  if (isNaN(minutes) || minutes < 0) return '0h 00m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

/**
 * Format minutes into decimal hours (e.g., 480 -> "8.0 hrs", 450 -> "7.5 hrs")
 */
export function formatMinutesToDecimalHours(minutes: number): string {
  if (isNaN(minutes) || minutes < 0) return '0 hrs';
  const hrs = (minutes / 60).toFixed(1);
  return `${hrs.replace(/\.0$/, '')} hrs`;
}

export interface ShiftTimingCalculation {
  valid: boolean;
  error?: string;
  isOvernight: boolean;
  grossDurationMinutes: number;
  breakMinutes: number;
  netWorkingMinutes: number;
}

const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Mathematical calculation of shift duration, overnight derivation, and net working minutes
 */
export function calculateShiftTiming(startTime: string, endTime: string, breakMinutes: number = 0): ShiftTimingCalculation {
  if (!startTime || !endTime) {
    return { valid: false, error: 'Start time and end time are required.', isOvernight: false, grossDurationMinutes: 0, breakMinutes: breakMinutes ?? 0, netWorkingMinutes: 0 };
  }
  if (!TIME_FORMAT_REGEX.test(startTime) || !TIME_FORMAT_REGEX.test(endTime)) {
    return { valid: false, error: 'Invalid time format. Please provide valid HH:mm times (00:00 to 23:59).', isOvernight: false, grossDurationMinutes: 0, breakMinutes: breakMinutes ?? 0, netWorkingMinutes: 0 };
  }
  if (breakMinutes < 0) {
    return { valid: false, error: 'Break duration cannot be negative.', isOvernight: false, grossDurationMinutes: 0, breakMinutes, netWorkingMinutes: 0 };
  }

  const [startH, startM] = startTime.split(':').map((v) => parseInt(v, 10));
  const [endH, endM] = endTime.split(':').map((v) => parseInt(v, 10));
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  if (startTotal === endTotal) {
    return { valid: false, error: 'Start Time and End Time cannot be identical. 24-hour single continuous shifts are invalid.', isOvernight: false, grossDurationMinutes: 0, breakMinutes, netWorkingMinutes: 0 };
  }

  const isOvernight = endTotal <= startTotal;
  const grossDurationMinutes = isOvernight ? 24 * 60 - startTotal + endTotal : endTotal - startTotal;
  const netWorkingMinutes = Math.max(0, grossDurationMinutes - (breakMinutes || 0));

  return { valid: true, isOvernight, grossDurationMinutes, breakMinutes: breakMinutes || 0, netWorkingMinutes };
}

function formatRoleLabel(role?: string | null): string {
  if (!role) return '';
  return role.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

/** Maps a backend Shift row onto the frontend `Shift` shape. */
function toShift(raw: Record<string, any>): Shift {
  const timing = calculateShiftTiming(raw.startTime, raw.endTime, raw.breakMinutes ?? 0);
  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    departmentId: raw.departmentId ?? '',
    departmentName: raw.department?.name || 'HMS (All Departments)',
    shiftType: raw.shiftType as ShiftType,
    startTime: raw.startTime,
    endTime: raw.endTime,
    isOvernight: timing.isOvernight,
    grossDurationMinutes: timing.grossDurationMinutes,
    breakMinutes: raw.breakMinutes ?? 0,
    netWorkingMinutes: timing.netWorkingMinutes,
    defaultArrivalGraceMinutes: raw.defaultArrivalGraceMinutes ?? 0,
    defaultEarlyExitToleranceMinutes: raw.defaultEarlyExitToleranceMinutes ?? 0,
    defaultWeeklyOffDays: (raw.defaultWeeklyOffDays as Weekday[]) || [],
    status: raw.isActive ? 'ACTIVE' : 'INACTIVE',
    notes: raw.notes || '',
    createdByUserId: raw.createdById || '',
    createdByName: raw.createdByUser?.staff?.fullName || raw.createdByUser?.username || 'System',
    createdByRole: formatRoleLabel(raw.createdByUser?.role),
    createdAt: formatTimestamp(raw.createdAt),
    updatedByUserId: raw.updatedById || '',
    updatedByName: raw.updatedByUser?.staff?.fullName || raw.updatedByUser?.username || 'System',
    updatedByRole: formatRoleLabel(raw.updatedByUser?.role),
    updatedAt: formatTimestamp(raw.updatedAt),
    statusChangedByUserId: undefined,
    statusChangedByName: raw.statusChangedBy || undefined,
    statusChangedAt: raw.statusChangedAt ? formatTimestamp(raw.statusChangedAt) : undefined,
  };
}

function toBackendPayload(data: ShiftFormData) {
  return {
    // Left blank, the backend auto-generates a unique code.
    code: data.code.trim() ? data.code.trim().toUpperCase() : undefined,
    name: data.name.trim(),
    departmentId: data.departmentId || null,
    shiftType: data.shiftType,
    startTime: data.startTime,
    endTime: data.endTime,
    breakMinutes: data.breakMinutes,
    defaultArrivalGraceMinutes: data.defaultArrivalGraceMinutes,
    defaultEarlyExitToleranceMinutes: data.defaultEarlyExitToleranceMinutes,
    defaultWeeklyOffDays: data.defaultWeeklyOffDays || [],
    notes: data.notes?.trim() || undefined,
    isActive: data.status === 'ACTIVE',
  };
}

let cachedShifts: Shift[] = [];

export async function fetchShifts(): Promise<Shift[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/setup/shifts');
  cachedShifts = res.data.data.map(toShift);
  return cachedShifts;
}

export async function primeShiftsCache(): Promise<void> {
  try {
    await fetchShifts();
  } catch {
    // Leave cache empty; the Shift Management page itself will surface the real error on its own fetch.
  }
}

export class ShiftService {
  /** Synchronous read of the last real fetch — never localStorage. */
  static loadShifts(): Shift[] {
    return cachedShifts;
  }

  static getShifts(filters?: ShiftFilterState): Shift[] {
    const list = ShiftService.loadShifts();
    if (!filters) return list;

    return list.filter((shift) => {
      if (filters.searchTerm && filters.searchTerm.trim()) {
        const term = filters.searchTerm.trim().toLowerCase();
        if (!shift.code.toLowerCase().includes(term) && !shift.name.toLowerCase().includes(term) && !shift.departmentName.toLowerCase().includes(term)) {
          return false;
        }
      }
      if (filters.departmentId && filters.departmentId !== 'ALL' && shift.departmentId !== filters.departmentId) return false;
      if (filters.shiftType && filters.shiftType !== 'ALL' && shift.shiftType !== filters.shiftType) return false;
      if (filters.schedule && filters.schedule !== 'ALL') {
        if (filters.schedule === 'DAY' && shift.isOvernight) return false;
        if (filters.schedule === 'OVERNIGHT' && !shift.isOvernight) return false;
      }
      if (filters.status && filters.status !== 'ALL' && shift.status !== filters.status) return false;
      return true;
    });
  }

  static getShiftById(id: string): Shift | undefined {
    return ShiftService.loadShifts().find((s) => s.id === id);
  }

  static getKPIs(shifts?: Shift[]): ShiftKPIs {
    const dataset = shifts || ShiftService.loadShifts();
    const totalShifts = dataset.length;
    const activeShifts = dataset.filter((s) => s.status === 'ACTIVE').length;
    const overnightShifts = dataset.filter((s) => s.isOvernight).length;
    const departmentsCovered = new Set(dataset.map((s) => s.departmentId).filter(Boolean)).size;
    return { totalShifts, activeShifts, overnightShifts, departmentsCovered };
  }

  static validateShift(data: ShiftFormData, existingShiftId?: string): { valid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    const shifts = ShiftService.loadShifts();

    // Code is optional — left blank, the backend auto-generates a unique one.
    const cleanCode = (data.code || '').trim().toUpperCase();
    if (cleanCode && shifts.some((s) => s.code.toUpperCase() === cleanCode && s.id !== existingShiftId)) {
      errors.code = `Shift Code "${cleanCode}" already exists. Shift codes must be globally unique.`;
    }

    const cleanName = (data.name || '').trim();
    if (!cleanName) errors.name = 'Shift Name is required.';

    if (data.departmentId) {
      const matchedDept = DepartmentService.getDepartmentById(data.departmentId);
      if (!matchedDept) {
        errors.departmentId = 'Selected department is invalid or does not exist.';
      } else if (!existingShiftId && matchedDept.status !== 'Active') {
        errors.departmentId = `Department "${matchedDept.name}" is Inactive. Only Active departments may be assigned for new shifts.`;
      }
    }

    const validTypes: ShiftType[] = ['MORNING', 'EVENING', 'NIGHT', 'CUSTOM'];
    if (!data.shiftType || !validTypes.includes(data.shiftType)) {
      errors.shiftType = 'Valid Shift Type is required (Morning, Evening, Night, or Custom).';
    }

    const timingCalc = calculateShiftTiming(data.startTime, data.endTime, data.breakMinutes);
    if (!timingCalc.valid) {
      if (timingCalc.error?.includes('Break duration')) {
        errors.breakMinutes = timingCalc.error;
      } else {
        errors.time = timingCalc.error || 'Invalid shift timing.';
      }
    }

    if (cleanName && timingCalc.valid) {
      const duplicateFound = shifts.some(
        (s) =>
          s.id !== existingShiftId &&
          s.departmentId === data.departmentId &&
          s.name.toLowerCase() === cleanName.toLowerCase() &&
          s.shiftType === data.shiftType &&
          s.startTime === data.startTime &&
          s.endTime === data.endTime
      );
      if (duplicateFound) {
        errors.name = `A shift named "${cleanName}" with identical type and timing already exists for this department/HMS scope.`;
      }
    }

    if (data.defaultArrivalGraceMinutes < 0) errors.defaultArrivalGraceMinutes = 'Arrival grace cannot be negative.';
    if (data.defaultEarlyExitToleranceMinutes < 0) errors.defaultEarlyExitToleranceMinutes = 'Early exit tolerance cannot be negative.';

    return { valid: Object.keys(errors).length === 0, errors };
  }

  /** `POST /setup/shifts` */
  static async createShift(data: ShiftFormData, currentUser: User | null): Promise<Shift> {
    if (!currentUser) throw new Error('Authenticated management user required.');
    const validation = ShiftService.validateShift(data);
    if (!validation.valid) throw new Error(Object.values(validation.errors)[0] || 'Validation failed for shift creation.');

    const res = await apiClient.post<{ data: Record<string, any> }>('/setup/shifts', toBackendPayload(data));
    const created = toShift(res.data.data);
    cachedShifts = [created, ...cachedShifts];
    return created;
  }

  /** `PATCH /setup/shifts/:id` */
  static async updateShift(id: string, data: ShiftFormData, currentUser: User | null): Promise<Shift> {
    if (!currentUser) throw new Error('Authenticated management user required.');
    const validation = ShiftService.validateShift(data, id);
    if (!validation.valid) throw new Error(Object.values(validation.errors)[0] || 'Validation failed for shift update.');

    const res = await apiClient.patch<{ data: Record<string, any> }>(`/setup/shifts/${id}`, toBackendPayload(data));
    const updated = toShift(res.data.data);
    cachedShifts = cachedShifts.map((s) => (s.id === id ? updated : s));
    return updated;
  }

  /** `PATCH /setup/shifts/:id` (isActive:true) or `POST /setup/shifts/:id/deactivate` */
  static async toggleShiftStatus(id: string, currentUser: User | null): Promise<Shift> {
    if (!currentUser) throw new Error('Authenticated management user required.');
    const existing = ShiftService.getShiftById(id);
    if (!existing) throw new Error(`Shift record with ID "${id}" was not found.`);

    const res =
      existing.status === 'ACTIVE'
        ? await apiClient.post<{ data: Record<string, any> }>(`/setup/shifts/${id}/deactivate`)
        : await apiClient.patch<{ data: Record<string, any> }>(`/setup/shifts/${id}`, { isActive: true });
    const updated = toShift(res.data.data);
    cachedShifts = cachedShifts.map((s) => (s.id === id ? updated : s));
    return updated;
  }
}
