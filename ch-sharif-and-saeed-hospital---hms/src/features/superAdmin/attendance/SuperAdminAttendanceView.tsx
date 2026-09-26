import React, { useState, useEffect, useMemo } from 'react';
import {
  CalendarCheck,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Save,
  Lock,
  History,
  ClipboardCheck,
  Pencil,
} from 'lucide-react';
import {
  fetchRoster,
  bulkMarkAttendance,
  listAttendance,
  approveAttendance,
  correctAttendance,
  fetchAttendanceSummary,
} from '../../../services/attendanceService';
import { fetchDepartments } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummaryRow,
  RosterMarkDraft,
  RosterRow,
} from '../../../types/attendance';
import { STAFF_CATEGORIES } from '../../../types/staffUser';
import { useToast } from '../../../context/ToastContext';
import { formatDisplayDate } from '../../../utils/dateConstants';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toTimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 5);
}

function combineDateTime(date: string, time: string): string | undefined {
  if (!time) return undefined;
  return new Date(`${date}T${time}:00`).toISOString();
}

const STATUS_STYLES: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-[#e7f6f1] text-[#0e7d5a] border-[#c2e7db]',
  HALF_DAY: 'bg-amber-50 text-amber-800 border-amber-200',
  ABSENT: 'bg-red-50 text-red-700 border-red-200',
  PAID_LEAVE: 'bg-blue-50 text-blue-700 border-blue-200',
  UNPAID_LEAVE: 'bg-slate-100 text-slate-700 border-slate-200',
  MISSING_PUNCH: 'bg-purple-50 text-purple-700 border-purple-200',
};

export const SuperAdminAttendanceView: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useState<'mark' | 'history'>('mark');
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-[#e7f6f1] text-[#129b70] flex items-center justify-center">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Staff Attendance</h1>
            <p className="text-xs text-slate-500">Manual marking today — the same records take device sync tomorrow without a redesign.</p>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            onClick={() => setTab('mark')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${tab === 'mark' ? 'bg-white text-[#08775A] shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <ClipboardCheck className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            Mark Attendance
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${tab === 'history' ? 'bg-white text-[#08775A] shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <History className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            History &amp; Approval
          </button>
        </div>
      </div>

      {tab === 'mark' ? <MarkAttendanceTab departments={departments} toast={toast} /> : <AttendanceHistoryTab departments={departments} toast={toast} />}
    </div>
  );
};

const MarkAttendanceTab: React.FC<{ departments: Department[]; toast: ReturnType<typeof useToast> }> = ({ departments, toast }) => {
  const [date, setDate] = useState(todayISO());
  const [departmentId, setDepartmentId] = useState('');
  const [category, setCategory] = useState('');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RosterMarkDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [summary, setSummary] = useState<AttendanceSummaryRow[]>([]);

  const loadRoster = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchRoster(date, departmentId || undefined, category || undefined);
      setRoster(rows);
      const nextDrafts: Record<string, RosterMarkDraft> = {};
      rows.forEach((r) => {
        nextDrafts[r.staff.id] = {
          status: r.attendance?.status ?? 'PRESENT',
          actualIn: toTimeInput(r.attendance?.actualIn ?? null),
          actualOut: toTimeInput(r.attendance?.actualOut ?? null),
          notes: r.attendance?.notes ?? '',
        };
      });
      setDrafts(nextDrafts);
      const summaryRows = await fetchAttendanceSummary(date, date, undefined, departmentId || undefined);
      setSummary(summaryRows);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load attendance roster.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, departmentId, category]);

  const setDraft = (staffId: string, patch: Partial<RosterMarkDraft>) => {
    setDrafts((prev) => ({ ...prev, [staffId]: { ...prev[staffId], ...patch } }));
  };

  const markAllPresent = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      roster.forEach((r) => {
        if (r.attendance?.isApproved) return;
        next[r.staff.id] = { ...next[r.staff.id], status: 'PRESENT' };
      });
      return next;
    });
  };

  const editableRows = roster.filter((r) => !r.attendance?.isApproved);
  const totals = useMemo(() => {
    const counts: Partial<Record<AttendanceStatus, number>> = {};
    Object.values(drafts).forEach((d) => {
      counts[d.status] = (counts[d.status] ?? 0) + 1;
    });
    return counts;
  }, [drafts]);

  const handleSaveAll = async () => {
    if (editableRows.length === 0) {
      toast.error('Nothing to save — every row for this date is already approved.', 'Nothing to Save');
      return;
    }
    setIsSaving(true);
    try {
      const records = editableRows.map((r) => {
        const d = drafts[r.staff.id];
        return {
          staffId: r.staff.id,
          status: d.status,
          actualIn: combineDateTime(date, d.actualIn),
          actualOut: combineDateTime(date, d.actualOut),
          notes: d.notes || undefined,
        };
      });
      const res = await bulkMarkAttendance(date, records);
      toast.success(`Attendance saved for ${res.marked} staff member${res.marked === 1 ? '' : 's'}.`, 'Attendance Saved');
      await loadRoster();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to save attendance.', 'Save Error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Date</label>
          <input
            lang="en-GB"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#149E75]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#149E75]"
          >
            <option value="">All Departments</option>
            {departments.filter((d) => d.status === 'Active').map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#149E75]"
          >
            <option value="">All Categories</option>
            {STAFF_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={markAllPresent}
          disabled={isLoading || editableRows.length === 0}
          className="px-3.5 py-2 text-xs font-semibold text-[#08775A] bg-[#e7f6f1] hover:bg-[#d0efe5] border border-[#c2e7db] rounded-lg cursor-pointer disabled:opacity-50"
        >
          Mark All Present
        </button>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={isLoading || isSaving || editableRows.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#149E75] hover:bg-[#08775A] rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Attendance
        </button>
      </div>

      {Object.keys(totals).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(totals) as [AttendanceStatus, number][]).map(([status, count]) => (
            <span key={status} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${STATUS_STYLES[status]}`}>
              {ATTENDANCE_STATUS_LABELS[status]}: {count}
            </span>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading roster…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-rose-700 font-medium">{loadError}</p>
            <button type="button" onClick={loadRoster} className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg cursor-pointer">
              Retry
            </button>
          </div>
        ) : roster.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">No active staff match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Staff</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Check In</th>
                  <th className="py-2.5 px-4">Check Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {roster.map((r) => {
                  const draft = drafts[r.staff.id];
                  const locked = !!r.attendance?.isApproved;
                  return (
                    <tr key={r.staff.id} className={`hover:bg-slate-50/80 ${locked ? 'bg-slate-50/50' : ''}`}>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{r.staff.fullName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{r.staff.employeeId} · {r.staff.category}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{r.staff.department?.name || '—'}</td>
                      <td className="py-2.5 px-4">
                        {locked ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_STYLES[draft.status]}`}>
                            <Lock className="h-3 w-3" /> {ATTENDANCE_STATUS_LABELS[draft.status]}
                          </span>
                        ) : (
                          <select
                            value={draft?.status || 'PRESENT'}
                            onChange={(e) => setDraft(r.staff.id, { status: e.target.value as AttendanceStatus })}
                            className={`px-2 py-1 border rounded-md text-[11px] font-semibold focus:outline-none ${STATUS_STYLES[draft?.status || 'PRESENT']}`}
                          >
                            {ATTENDANCE_STATUSES.map((s) => (
                              <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="time"
                          disabled={locked}
                          value={draft?.actualIn || ''}
                          onChange={(e) => setDraft(r.staff.id, { actualIn: e.target.value })}
                          className="px-2 py-1 border border-slate-200 rounded-md text-[11px] bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="time"
                          disabled={locked}
                          value={draft?.actualOut || ''}
                          onChange={(e) => setDraft(r.staff.id, { actualOut: e.target.value })}
                          className="px-2 py-1 border border-slate-200 rounded-md text-[11px] bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const AttendanceHistoryTab: React.FC<{ departments: Department[]; toast: ReturnType<typeof useToast> }> = ({ departments, toast }) => {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(todayISO());
  const [departmentId, setDepartmentId] = useState('');
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctStatus, setCorrectStatus] = useState<AttendanceStatus>('PRESENT');
  const [correctReason, setCorrectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await listAttendance({ startDate, endDate, departmentId: departmentId || undefined, pageSize: 100 });
      setRows(res.rows);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load attendance history.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, departmentId]);

  const handleApprove = async (id: string) => {
    try {
      await approveAttendance(id);
      toast.success('Attendance record approved.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to approve.', 'Approve Error');
    }
  };

  const pendingRows = rows.filter((r) => !r.isApproved);

  // Payroll only ever reads APPROVED attendance (staff.md §11/§19) — marking
  // a day is not enough by itself. This closes the gap where days were
  // genuinely marked but silently never fed into a payroll run because no
  // one had approved them yet, one click for the whole filtered range
  // instead of clicking Approve on every single row.
  const handleApproveAllPending = async () => {
    if (pendingRows.length === 0) return;
    setIsBulkApproving(true);
    let approved = 0;
    let failed = 0;
    for (const row of pendingRows) {
      try {
        await approveAttendance(row.id);
        approved += 1;
      } catch {
        failed += 1;
      }
    }
    setIsBulkApproving(false);
    if (approved > 0) toast.success(`Approved ${approved} attendance record${approved === 1 ? '' : 's'}.`);
    if (failed > 0) toast.error(`${failed} record${failed === 1 ? '' : 's'} could not be approved.`, 'Partial Failure');
    await load();
  };

  const openCorrect = (row: AttendanceRecord) => {
    setCorrectingId(row.id);
    setCorrectStatus(row.status);
    setCorrectReason('');
  };

  const submitCorrect = async () => {
    if (!correctingId) return;
    if (!correctReason.trim()) {
      toast.error('A reason is required to correct an approved record.', 'Validation Error');
      return;
    }
    setIsSubmitting(true);
    try {
      await correctAttendance(correctingId, { status: correctStatus, reason: correctReason.trim() });
      toast.success('Attendance corrected.');
      setCorrectingId(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to correct.', 'Correction Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">From</label>
          <input lang="en-GB" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">To</label>
          <input lang="en-GB" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Department</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white">
            <option value="">All Departments</option>
            {departments.filter((d) => d.status === 'Active').map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleApproveAllPending}
          disabled={isBulkApproving || pendingRows.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#149E75] hover:bg-[#08775A] rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
          title={pendingRows.length === 0 ? 'Nothing pending in this range' : 'Payroll only reads approved attendance — approve everything pending in this range at once'}
        >
          {isBulkApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Approve All Pending{pendingRows.length > 0 ? ` (${pendingRows.length})` : ''}
        </button>
      </div>

      {pendingRows.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
          <strong>{pendingRows.length}</strong> attendance record{pendingRows.length === 1 ? ' is' : 's are'} marked but not yet approved — Payroll Run only counts approved attendance, so these days won't be paid until approved.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading history…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-rose-700 font-medium">{loadError}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">No attendance records in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Staff</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Marked By</th>
                  <th className="py-2.5 px-4">Approval</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 whitespace-nowrap">{formatDisplayDate(new Date(r.attendanceDate))}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{r.staff.fullName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{r.staff.employeeId}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_STYLES[r.status]}`}>
                        {ATTENDANCE_STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">{r.markedByUser?.username || '—'}</td>
                    <td className="py-2.5 px-4">
                      {r.isApproved ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#08775A]">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-700 font-semibold">Pending</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      {!r.isApproved ? (
                        <button
                          type="button"
                          onClick={() => handleApprove(r.id)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#149E75] hover:bg-[#08775A] rounded-md cursor-pointer"
                        >
                          Approve
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCorrect(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" /> Correct
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {correctingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm">Correct Approved Attendance</h3>
              <p className="text-[11px] text-slate-500">Every correction is logged with a reason — nothing is silently overwritten.</p>
            </div>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">New Status</label>
                <select
                  value={correctStatus}
                  onChange={(e) => setCorrectStatus(e.target.value as AttendanceStatus)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                >
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                  placeholder="Why is this being corrected?"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setCorrectingId(null)} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={submitCorrect}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving…' : 'Save Correction'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
