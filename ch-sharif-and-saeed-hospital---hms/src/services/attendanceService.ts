import apiClient from './apiClient';
import { AttendanceRecord, AttendanceSummaryRow, RosterRow } from '../types/attendance';

/**
 * Attendance — manual marking today, device-sync ready tomorrow
 * (`AttendanceRecord.source`). Every call round-trips through
 * `/api/v1/attendance*`; no local cache, no mock fallback.
 */

export async function fetchRoster(date: string, departmentId?: string, category?: string): Promise<RosterRow[]> {
  const res = await apiClient.get<{ data: RosterRow[] }>('/attendance/roster', {
    params: { date, departmentId: departmentId || undefined, category: category || undefined },
  });
  return res.data.data;
}

export interface MarkAttendanceInput {
  staffId: string;
  attendanceDate: string;
  status: string;
  actualIn?: string;
  actualOut?: string;
  notes?: string;
}

export async function markAttendance(input: MarkAttendanceInput): Promise<AttendanceRecord> {
  const res = await apiClient.post<{ data: AttendanceRecord }>('/attendance/mark', input);
  return res.data.data;
}

export interface BulkMarkAttendanceRecord {
  staffId: string;
  status: string;
  actualIn?: string;
  actualOut?: string;
  notes?: string;
}

export async function bulkMarkAttendance(
  attendanceDate: string,
  records: BulkMarkAttendanceRecord[],
): Promise<{ marked: number; skipped: string[] }> {
  const res = await apiClient.post<{ data: { marked: number; skipped: string[] } }>('/attendance/bulk-mark', {
    attendanceDate,
    records,
  });
  return res.data.data;
}

export interface ListAttendanceParams {
  staffId?: string;
  departmentId?: string;
  status?: string;
  isApproved?: boolean;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export async function listAttendance(params: ListAttendanceParams): Promise<{ rows: AttendanceRecord[]; totalItems: number; totalPages: number }> {
  const res = await apiClient.get<{ data: AttendanceRecord[]; meta: { pagination: { totalItems: number; totalPages: number } } }>('/attendance', {
    params,
  });
  return { rows: res.data.data, totalItems: res.data.meta.pagination.totalItems, totalPages: res.data.meta.pagination.totalPages };
}

export async function fetchAttendanceSummary(startDate: string, endDate: string, staffId?: string, departmentId?: string): Promise<AttendanceSummaryRow[]> {
  const res = await apiClient.get<{ data: AttendanceSummaryRow[] }>('/attendance/summary', {
    params: { startDate, endDate, staffId: staffId || undefined, departmentId: departmentId || undefined },
  });
  return res.data.data;
}

export async function fetchAttendanceById(id: string): Promise<AttendanceRecord & { corrections: any[] }> {
  const res = await apiClient.get<{ data: AttendanceRecord & { corrections: any[] } }>(`/attendance/${id}`);
  return res.data.data;
}

export async function approveAttendance(id: string): Promise<AttendanceRecord> {
  const res = await apiClient.post<{ data: AttendanceRecord }>(`/attendance/${id}/approve`, {});
  return res.data.data;
}

export async function correctAttendance(
  id: string,
  body: { status?: string; actualIn?: string; actualOut?: string; notes?: string; reason: string },
): Promise<AttendanceRecord> {
  const res = await apiClient.post<{ data: AttendanceRecord }>(`/attendance/${id}/correct`, body);
  return res.data.data;
}
