export type AttendanceStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'PAID_LEAVE' | 'UNPAID_LEAVE' | 'MISSING_PUNCH';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'UNPAID_LEAVE'];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half Day',
  ABSENT: 'Absent',
  PAID_LEAVE: 'Paid Leave',
  UNPAID_LEAVE: 'Unpaid Leave',
  MISSING_PUNCH: 'Missing Punch',
};

// staff.md §11 — payable-equivalent-day weight per status, mirrors the backend exactly.
export const PAYABLE_EQUIVALENT: Record<AttendanceStatus, number> = {
  PRESENT: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
  PAID_LEAVE: 1,
  UNPAID_LEAVE: 0,
  MISSING_PUNCH: 0,
};

export interface AttendanceStaffSummary {
  id: string;
  employeeId: string;
  fullName: string;
  category: string;
  designation: string | null;
  department: { id: string; name: string } | null;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  attendanceDate: string;
  actualIn: string | null;
  actualOut: string | null;
  workedMinutes: number;
  status: AttendanceStatus;
  source: 'MANUAL' | 'DEVICE' | 'IMPORTED';
  notes: string | null;
  isApproved: boolean;
  approvedAt: string | null;
  approvedBy: { id: string; username: string } | null;
  markedByUser: { id: string; username: string } | null;
  staff: AttendanceStaffSummary;
}

export interface AttendanceCorrectionLog {
  id: string;
  originalValue: Record<string, unknown>;
  correctedValue: Record<string, unknown>;
  reason: string;
  changedAt: string;
}

export interface RosterRow {
  staff: AttendanceStaffSummary;
  attendance: AttendanceRecord | null;
}

export interface AttendanceSummaryRow {
  staffId: string;
  fullName: string;
  employeeId: string;
  counts: Partial<Record<AttendanceStatus, number>>;
  payableEquivalentDays: number;
}

export interface RosterMarkDraft {
  status: AttendanceStatus;
  actualIn: string;
  actualOut: string;
  notes: string;
}
