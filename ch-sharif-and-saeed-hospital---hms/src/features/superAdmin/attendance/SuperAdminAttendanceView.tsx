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
  Clock,
  UserCheck,
  UserX,
  AlertTriangle,
  RotateCw,
} from 'lucide-react';
import {
  fetchRoster,
  bulkMarkAttendance,
  markAttendance,
  deleteAttendance,
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
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

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

const STATUS_STYLES: Record<string, string> = {
  PRESENT: 'bg-[#e7f6f1] text-[#08775A] border-[#c2e7db]',
  HALF_DAY: 'bg-amber-50 text-amber-800 border-amber-200',
  ABSENT: 'bg-red-50 text-red-700 border-red-200',
  PAID_LEAVE: 'bg-blue-50 text-blue-700 border-blue-200',
  UNPAID_LEAVE: 'bg-slate-100 text-slate-700 border-slate-200',
  MISSING_PUNCH: 'bg-purple-50 text-purple-700 border-purple-200',
  '': 'bg-slate-50 text-slate-500 border-dashed border-slate-300',
};

export const SuperAdminAttendanceView: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useState<'mark' | 'history'>('mark');
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {/* Section 4.1 Card Page Header Block */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#e7f6f1] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">Staff Attendance</h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                Daily Roster Sync
              </span>
            </div>
            <p className="text-xs text-[#52665e] mt-0.5">
              Comprehensive hospital biometric check-in, shift rosters, and payroll-ready approval workflows
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="inline-flex rounded-xl border border-[#c2e7db] bg-[#effaf5]/50 p-1">
          <button
            onClick={() => setTab('mark')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
              tab === 'mark'
                ? 'bg-white text-[#08775A] shadow-2xs border border-[#c2e7db]'
                : 'text-[#52665e] hover:text-[#123e2b]'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span>Mark Attendance</span>
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
              tab === 'history'
                ? 'bg-white text-[#08775A] shadow-2xs border border-[#c2e7db]'
                : 'text-[#52665e] hover:text-[#123e2b]'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>History &amp; Approval</span>
          </button>
        </div>
      </div>

      {tab === 'mark' ? (
        <MarkAttendanceTab departments={departments} toast={toast} />
      ) : (
        <AttendanceHistoryTab departments={departments} toast={toast} />
      )}
    </div>
  );
};

const MarkAttendanceTab: React.FC<{ departments: Department[]; toast: ReturnType<typeof useToast> }> = ({
  departments,
  toast,
}) => {
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
        // By default, do NOT force 'PRESENT'. Only populate if attendance was actually saved in DB!
        nextDrafts[r.staff.id] = {
          status: r.attendance?.status ?? '',
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
    toast.info('All editable staff marked as Present in draft. Click "Save Attendance" to persist to database.');
  };

  const resetAllToUnmarked = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      roster.forEach((r) => {
        if (r.attendance?.isApproved) return;
        next[r.staff.id] = {
          ...next[r.staff.id],
          status: '',
          actualIn: '',
          actualOut: '',
        };
      });
      return next;
    });
    toast.info('All editable staff reset to Unmarked in draft.');
  };

  const editableRows = roster.filter((r) => !r.attendance?.isApproved);

  const kpis: KpiItem[] = useMemo(() => {
    const presentCount = Object.values(drafts).filter((d) => d.status === 'PRESENT').length;
    const absentCount = Object.values(drafts).filter((d) => d.status === 'ABSENT').length;
    const halfDayCount = Object.values(drafts).filter((d) => d.status === 'HALF_DAY').length;
    const leaveCount = Object.values(drafts).filter((d) => d.status === 'PAID_LEAVE' || d.status === 'UNPAID_LEAVE').length;
    const unmarkedCount = Object.values(drafts).filter((d) => !d.status).length;
    const recordedInDb = roster.filter((r) => !!r.attendance).length;

    return [
      {
        category: 'SCHEDULED ROSTER',
        title: 'Total On Duty',
        value: roster.length,
        icon: Clock,
        subtitle: `${recordedInDb} of ${roster.length} saved in database`,
        tone: 'default',
      },
      {
        category: 'ATTENDANCE CONFIRMED',
        title: 'Present Staff',
        value: presentCount,
        icon: UserCheck,
        subtitle: presentCount === 0 ? 'No staff marked present yet' : `${presentCount} confirmed on duty`,
        tone: presentCount > 0 ? 'success' : 'default',
      },
      {
        category: 'ABSENTEEISM & LEAVES',
        title: 'Absent / On Leave',
        value: absentCount + halfDayCount + leaveCount,
        icon: UserX,
        subtitle: `${absentCount} absent · ${halfDayCount} half · ${leaveCount} leave`,
        tone: absentCount > 0 ? 'danger' : 'default',
      },
      {
        category: 'PENDING ACTION',
        title: 'Unmarked Staff',
        value: unmarkedCount,
        icon: AlertTriangle,
        subtitle: unmarkedCount > 0 ? `${unmarkedCount} awaiting attendance mark` : 'All staff attendance recorded',
        tone: unmarkedCount > 0 ? 'warning' : 'success',
      },
    ];
  }, [drafts, roster]);

  const handleSaveAll = async () => {
    if (editableRows.length === 0) {
      toast.error('Nothing to save — every row for this date is already approved.', 'Nothing to Save');
      return;
    }

    const recordsToSave: { staffId: string; status: AttendanceStatus; actualIn?: string; actualOut?: string; notes?: string }[] = [];
    const idsToDelete: string[] = [];

    editableRows.forEach((r) => {
      const d = drafts[r.staff.id];
      if (d && d.status) {
        recordsToSave.push({
          staffId: r.staff.id,
          status: d.status,
          actualIn: combineDateTime(date, d.actualIn),
          actualOut: combineDateTime(date, d.actualOut),
          notes: d.notes || undefined,
        });
      } else if (r.attendance && !r.attendance.isApproved) {
        // Staff was previously saved in DB, but is now set to unmarked
        idsToDelete.push(r.attendance.id);
      }
    });

    if (recordsToSave.length === 0 && idsToDelete.length === 0) {
      toast.warning('No attendance has been selected. Mark at least one staff member first or click "Mark All Present".', 'Nothing to Save');
      return;
    }

    setIsSaving(true);
    try {
      let saved = 0;
      if (recordsToSave.length > 0) {
        const res = await bulkMarkAttendance(date, recordsToSave);
        saved = res.marked;
      }
      if (idsToDelete.length > 0) {
        for (const id of idsToDelete) {
          try {
            await deleteAttendance(id);
          } catch {
            // ignore
          }
        }
      }
      toast.success(
        `Attendance updated: ${saved} saved to database${idsToDelete.length > 0 ? `, ${idsToDelete.length} unapproved record(s) removed` : ''}.`,
        'Attendance Saved'
      );
      await loadRoster();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to save attendance.', 'Save Error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSingleRow = async (staffId: string) => {
    const draft = drafts[staffId];
    if (!draft || !draft.status) {
      toast.warning('Please select an attendance status first.', 'Status Required');
      return;
    }
    setIsSaving(true);
    try {
      await markAttendance({
        staffId,
        attendanceDate: date,
        status: draft.status,
        actualIn: combineDateTime(date, draft.actualIn),
        actualOut: combineDateTime(date, draft.actualOut),
        notes: draft.notes || undefined,
      });
      toast.success('Attendance recorded for this staff member.', 'Saved');
      await loadRoster();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to record attendance.', 'Save Error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnmarkSingleRow = async (staffId: string, attendanceId?: string) => {
    if (attendanceId) {
      setIsSaving(true);
      try {
        await deleteAttendance(attendanceId);
        toast.success('Attendance record removed; reset to unmarked.', 'Unmarked');
        await loadRoster();
      } catch (err: any) {
        toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to remove attendance record.', 'Unmark Error');
      } finally {
        setIsSaving(false);
      }
    } else {
      setDraft(staffId, { status: '', actualIn: '', actualOut: '', notes: '' });
      toast.info('Status reset to unmarked.');
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary */}
      <HospitalKpiHeader items={kpis} columns="grid-cols-2 lg:grid-cols-4" />

      {/* Section 4.4 Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-4 shadow-2xs flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-[#52665e] mb-1">Date</label>
          <input
            lang="en-GB"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 border border-[#c2e7db] rounded-lg text-xs bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] font-mono"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#52665e] mb-1">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="px-3 py-1.5 border border-[#c2e7db] rounded-lg text-xs bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] text-slate-700"
          >
            <option value="">All Departments</option>
            {departments
              .filter((d) => d.status === 'Active')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#52665e] mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-1.5 border border-[#c2e7db] rounded-lg text-xs bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] text-slate-700"
          >
            <option value="">All Categories</option>
            {STAFF_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={markAllPresent}
          disabled={isLoading || editableRows.length === 0}
          className="px-3.5 py-2 text-xs font-semibold text-[#08775A] bg-[#e7f6f1] hover:bg-[#d0efe5] border border-[#c2e7db] rounded-lg cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
          title="Mark all unapproved staff as Present in draft"
        >
          Mark All Present
        </button>
        <button
          type="button"
          onClick={resetAllToUnmarked}
          disabled={isLoading || editableRows.length === 0}
          className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
          title="Reset all editable staff to Unmarked"
        >
          Reset Unmarked
        </button>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={isLoading || isSaving || editableRows.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-2xs cursor-pointer disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Attendance
        </button>
      </div>

      {/* Section 4.5 Data Table */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-[#c2e7db]" />
            <span className="font-semibold text-xs tracking-wide">Daily Duty Roster Marking</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {roster.length} Staff
            </span>
          </div>
          <button
            onClick={loadRoster}
            className="p-1 hover:bg-white/10 rounded text-[#effaf5] hover:text-white transition-colors"
            title="Reload Roster"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#52665e] gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
            <span>Loading roster from database…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-rose-700 font-medium">{loadError}</p>
            <button
              type="button"
              onClick={loadRoster}
              className="px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : roster.length === 0 ? (
          <div className="py-16 text-center text-[#52665e] text-sm">No active staff match these filters for this date.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                  <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Staff Member</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Department</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Attendance Status</th>
                  <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Check In</th>
                  <th className="py-2.5 px-3 border-r border-[#c2e7db]/60">Check Out</th>
                  <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60">DB Status</th>
                  <th className="py-2.5 px-3 text-center w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2eae5] text-slate-700">
                {roster.map((r, idx) => {
                  const draft = drafts[r.staff.id];
                  const locked = !!r.attendance?.isApproved;
                  const isEven = idx % 2 === 0;
                  const isSavedInDb = !!r.attendance;
                  const isDraftModified =
                    draft &&
                    (draft.status !== (r.attendance?.status || '') ||
                      draft.actualIn !== toTimeInput(r.attendance?.actualIn ?? null) ||
                      draft.actualOut !== toTimeInput(r.attendance?.actualOut ?? null));

                  return (
                    <tr
                      key={r.staff.id}
                      className={`transition-colors ${
                        isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                      } hover:bg-[#e7f6f1]/40 border-b border-[#e2eae5] ${locked ? 'bg-slate-50/50' : ''}`}
                    >
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                        <div className="font-semibold text-[#123e2b]">{r.staff.fullName}</div>
                        <div className="text-[10px] text-[#52665e] font-mono">
                          {r.staff.employeeId} · {r.staff.category}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-[#52665e] border-r border-[#e2eae5]">
                        {r.staff.department?.name || '—'}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                        {locked ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              STATUS_STYLES[draft?.status || ''] || STATUS_STYLES.PRESENT
                            }`}
                          >
                            <Lock className="h-3 w-3" />{' '}
                            {draft?.status ? ATTENDANCE_STATUS_LABELS[draft.status] : 'Approved'}
                          </span>
                        ) : (
                          <select
                            value={draft?.status || ''}
                            onChange={(e) => setDraft(r.staff.id, { status: e.target.value as AttendanceStatus | '' })}
                            className={`px-2.5 py-1.5 border rounded-lg text-xs font-semibold focus:outline-hidden transition-colors cursor-pointer ${
                              draft?.status
                                ? STATUS_STYLES[draft.status]
                                : 'bg-slate-50 text-slate-500 border-dashed border-slate-300 hover:border-slate-400 font-normal'
                            }`}
                          >
                            <option value="" className="text-slate-500 bg-white font-normal">
                              — Not Marked —
                            </option>
                            {ATTENDANCE_STATUSES.map((s) => (
                              <option key={s} value={s} className="text-slate-800 bg-white font-medium">
                                {ATTENDANCE_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e2eae5]">
                        <input
                          type="time"
                          disabled={locked}
                          value={draft?.actualIn || ''}
                          onChange={(e) => setDraft(r.staff.id, { actualIn: e.target.value })}
                          className="w-full px-2 py-1 border border-[#c2e7db] rounded-lg text-xs bg-white disabled:bg-slate-100 disabled:text-slate-400 font-mono"
                        />
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e2eae5]">
                        <input
                          type="time"
                          disabled={locked}
                          value={draft?.actualOut || ''}
                          onChange={(e) => setDraft(r.staff.id, { actualOut: e.target.value })}
                          className="w-full px-2 py-1 border border-[#c2e7db] rounded-lg text-xs bg-white disabled:bg-slate-100 disabled:text-slate-400 font-mono"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5]">
                        {locked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            <Lock className="h-2.5 w-2.5" /> Approved
                          </span>
                        ) : isSavedInDb && !isDraftModified ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Saved
                          </span>
                        ) : draft?.status ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            Unsaved
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-normal text-slate-400 bg-slate-50 border border-slate-200">
                            Unmarked
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {locked ? (
                          <span className="text-[10px] text-slate-400 font-mono">Locked</span>
                        ) : (
                          <div className="inline-flex items-center justify-center gap-1">
                            {draft?.status && isDraftModified && (
                              <button
                                type="button"
                                onClick={() => handleSaveSingleRow(r.staff.id)}
                                disabled={isSaving}
                                className="p-1 text-[#08775A] hover:bg-[#e7f6f1] rounded border border-[#c2e7db] text-[10px] font-semibold cursor-pointer disabled:opacity-50 transition-colors"
                                title="Save this staff member's attendance to DB"
                              >
                                <Save className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {(isSavedInDb || draft?.status) && (
                              <button
                                type="button"
                                onClick={() => handleUnmarkSingleRow(r.staff.id, r.attendance?.id)}
                                disabled={isSaving}
                                className="p-1 text-rose-600 hover:bg-rose-50 rounded border border-rose-200 text-[10px] font-semibold cursor-pointer disabled:opacity-50 transition-colors"
                                title={
                                  isSavedInDb
                                    ? 'Delete attendance record from DB (reset to Unmarked)'
                                    : 'Clear draft selection'
                                }
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {!draft?.status && !isSavedInDb && (
                              <span className="text-[11px] text-slate-300">—</span>
                            )}
                          </div>
                        )}
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

const AttendanceHistoryTab: React.FC<{ departments: Department[]; toast: ReturnType<typeof useToast> }> = ({
  departments,
  toast,
}) => {
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
  const approvedRows = rows.filter((r) => r.isApproved);

  const kpis: KpiItem[] = useMemo(() => {
    const approvalRate = rows.length > 0 ? Math.round((approvedRows.length / rows.length) * 100) : 0;
    return [
      {
        category: 'TOTAL LOGGED',
        title: 'Attendance Records',
        value: rows.length,
        icon: CalendarCheck,
        subtitle: `${startDate} to ${endDate}`,
        tone: 'default',
      },
      {
        category: 'PAYROLL READY',
        title: 'Approved Records',
        value: approvedRows.length,
        icon: CheckCircle2,
        subtitle: `${approvalRate}% approved`,
        tone: 'success',
      },
      {
        category: 'PENDING AUDIT',
        title: 'Pending Approvals',
        value: pendingRows.length,
        icon: AlertTriangle,
        subtitle: 'Required for payroll cycle',
        tone: pendingRows.length > 0 ? 'warning' : 'default',
      },
      {
        category: 'COMPLIANCE RATE',
        title: 'Approval Index',
        value: `${approvalRate}%`,
        icon: Clock,
        subtitle: 'Ready for salary computation',
        tone: 'info',
      },
    ];
  }, [rows.length, approvedRows.length, pendingRows.length, startDate, endDate]);

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
      {/* KPI Header */}
      <HospitalKpiHeader items={kpis} columns="grid-cols-2 lg:grid-cols-4" />

      {/* Section 4.4 Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-4 shadow-2xs flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-[#52665e] mb-1">From</label>
          <input
            lang="en-GB"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-1.5 border border-[#c2e7db] rounded-lg text-xs bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] font-mono"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#52665e] mb-1">To</label>
          <input
            lang="en-GB"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-1.5 border border-[#c2e7db] rounded-lg text-xs bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] font-mono"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#52665e] mb-1">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="px-3 py-1.5 border border-[#c2e7db] rounded-lg text-xs bg-[#fbfdfc] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] text-slate-700"
          >
            <option value="">All Departments</option>
            {departments
              .filter((d) => d.status === 'Active')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleApproveAllPending}
          disabled={isBulkApproving || pendingRows.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-2xs cursor-pointer disabled:opacity-50 transition-colors"
          title={
            pendingRows.length === 0
              ? 'Nothing pending in this range'
              : 'Payroll only reads approved attendance — approve everything pending in this range at once'
          }
        >
          {isBulkApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Approve All Pending{pendingRows.length > 0 ? ` (${pendingRows.length})` : ''}
        </button>
      </div>

      {pendingRows.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>{pendingRows.length}</strong> attendance record{pendingRows.length === 1 ? ' is' : 's are'} marked but
            not yet approved. Payroll runs strictly evaluate approved attendance records.
          </span>
        </div>
      )}

      {/* Section 4.5 Data Table */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#c2e7db]" />
            <span className="font-semibold text-xs tracking-wide">Historical Attendance Audit Register</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              {rows.length} Records
            </span>
          </div>
          <button
            onClick={load}
            className="p-1 hover:bg-white/10 rounded text-[#effaf5] hover:text-white transition-colors"
            title="Reload Records"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#52665e] gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
            <span>Loading history from database…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-rose-700 font-medium">{loadError}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-[#52665e] text-sm">No attendance records in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                  <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Date</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Staff Member</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Status</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Marked By</th>
                  <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Approval Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2eae5] text-slate-700">
                {rows.map((r, idx) => {
                  const isEven = idx % 2 === 0;
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors ${
                        isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                      } hover:bg-[#e7f6f1]/40 border-b border-[#e2eae5]`}
                    >
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap font-mono text-[11px] text-[#123e2b] border-r border-[#e2eae5]">
                        {formatDisplayDate(new Date(r.attendanceDate))}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                        <div className="font-semibold text-[#123e2b]">{r.staff.fullName}</div>
                        <div className="text-[10px] text-[#52665e] font-mono">{r.staff.employeeId}</div>
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5]">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            STATUS_STYLES[r.status]
                          }`}
                        >
                          {ATTENDANCE_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-[#52665e] border-r border-[#e2eae5]">
                        {r.markedByUser?.username || '—'}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5]">
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
                            className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer shadow-2xs transition-colors"
                          >
                            Approve
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openCorrect(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer transition-colors"
                          >
                            <Pencil className="h-3 w-3" /> Correct
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {correctingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-[#e2eae5] overflow-hidden">
            <div className="px-5 py-3.5 bg-[#effaf5] border-b border-[#c2e7db]">
              <h3 className="font-bold text-[#123e2b] text-sm">Correct Approved Attendance</h3>
              <p className="text-[11px] text-[#52665e]">
                Every correction is recorded into the audit trail with mandatory reasoning.
              </p>
            </div>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#52665e] mb-1">New Status</label>
                <select
                  value={correctStatus}
                  onChange={(e) => setCorrectStatus(e.target.value as AttendanceStatus)}
                  className="w-full px-3 py-2 border border-[#c2e7db] rounded-lg text-xs bg-white focus:ring-1 focus:ring-[#08775A]"
                >
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ATTENDANCE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#52665e] mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-[#c2e7db] rounded-lg text-xs bg-white focus:ring-1 focus:ring-[#08775A]"
                  placeholder="Explain reason for manual correction..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#e2eae5]">
                <button
                  type="button"
                  onClick={() => setCorrectingId(null)}
                  className="px-3 py-1.5 text-xs font-medium text-[#52665e] hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={submitCorrect}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
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
