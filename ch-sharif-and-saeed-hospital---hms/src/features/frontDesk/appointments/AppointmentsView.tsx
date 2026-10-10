import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Plus,
  Search,
  RotateCcw,
  AlertCircle,
  Loader2,
  CalendarClock,
  CheckCircle2,
  UserCheck,
  Ban,
  Eye,
  Wallet,
  LogIn,
  Receipt,
  Pencil,
  FileSpreadsheet,
  Download,
  FileText,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { HospitalKpiHeader } from '../../../components/common/HospitalKpiHeader';
import { Select, TextInput } from '../../../components/forms/FormControls';
import { DepartmentService } from '../../../services/departmentService';
import { StaffUserService } from '../../../services/staffUserService';
import { formatDateISO, getHospitalCurrentDate } from '../../../utils/dateConstants';
import { formatPKR } from '../../../utils/formatters';
import { useToast } from '../../../context/ToastContext';
import {
  appointmentsApiService,
  AppointmentRecord,
  AppointmentStatus,
} from '../../../services/frontdeskApiService';
import { BookAppointmentModal } from './BookAppointmentModal';
import { CollectAdvanceModal } from './CollectAdvanceModal';
import { CancelAppointmentModal } from './CancelAppointmentModal';
import { AppointmentDetailModal } from './AppointmentDetailModal';
import { InvoiceDetailModal } from '../billing/InvoiceDetailModal';
import { PanelBadge } from '../../../components/common/PanelBadge';

const STATUS_OPTIONS: { label: string; value: AppointmentStatus }[] = [
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Checked In', value: 'CHECKED_IN' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Rescheduled', value: 'RESCHEDULED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'No Show', value: 'NO_SHOW' },
];

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  CHECKED_IN: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-teal-100 text-teal-700',
  RESCHEDULED: 'bg-amber-100 text-amber-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  NO_SHOW: 'bg-slate-200 text-slate-600',
};

/** Payable amount, best-available at this point in the lifecycle — invoice-derived once Checked-In, estimate before. */
function payableAmount(a: AppointmentRecord): number {
  if (a.invoiceId) {
    return a.payerType === 'Corporate / Panel' ? a.patientShare : a.invoiceTotal;
  }
  return a.estimatedAmount;
}

/**
 * v7.2 §3.3 Front Desk Appointments — real, DB-backed (HMS_V7.2_NEW_REQUIREMENTS.md).
 * Booking, advance collection, reschedule, cancel and Check-In (which creates
 * the real department-tagged `HospitalInvoice`) all round-trip through
 * `appointmentsApiService` → `/api/v1/appointments*`. Zero hard-coded
 * operational data — every row, KPI and dropdown option comes from a live API.
 */
export const AppointmentsView: React.FC = () => {
  const toast = useToast();
  const departments = useMemo(() => DepartmentService.getDepartments().filter((d) => d.status === 'Active'), []);
  const doctors = useMemo(
    () => StaffUserService.getStaffUsers().filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE'),
    [],
  );

  const [dateFilter, setDateFilter] = useState(formatDateISO(getHospitalCurrentDate()));
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('');
  const [searchTerm, setSearchTerm] = useState('');

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isBookOpen, setIsBookOpen] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<AppointmentRecord | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRecord | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentRecord | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [invoiceModalId, setInvoiceModalId] = useState<string | null>(null);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await appointmentsApiService.getAppointments({
        date: dateFilter || undefined,
        departmentId: departmentFilter || undefined,
        doctorStaffId: doctorFilter || undefined,
        status: statusFilter || undefined,
        search: searchTerm.trim() || undefined,
      });
      setAppointments(rows);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load appointments.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, departmentFilter, doctorFilter, statusFilter]);

  // Search is debounced-by-hand via a simple timeout so every keystroke doesn't refetch.
  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const resetFilters = () => {
    setDateFilter(formatDateISO(getHospitalCurrentDate()));
    setDepartmentFilter('');
    setDoctorFilter('');
    setStatusFilter('');
    setSearchTerm('');
  };

  const kpis = useMemo(() => {
    return {
      total: appointments.length,
      confirmed: appointments.filter((a) => a.status === 'CONFIRMED' || a.status === 'RESCHEDULED').length,
      checkedIn: appointments.filter((a) => a.status === 'CHECKED_IN').length,
      cancelled: appointments.filter((a) => a.status === 'CANCELLED').length,
    };
  }, [appointments]);

  // Pharmacy-style pagination & export states
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedAppointments = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return appointments.slice(start, start + pageSize);
  }, [appointments, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, departmentFilter, doctorFilter, statusFilter, searchTerm]);

  const handleExportCsv = () => {
    if (appointments.length === 0) return;
    const headers = ['#', 'Slot Time', 'Slot Date', 'Patient Name', 'Phone', 'Payer', 'Doctor', 'Department', 'Service', 'Payable', 'Advance Paid', 'Remaining', 'Status'];
    const rows = appointments.map((a, idx) => [
      idx + 1,
      `"${a.slotTime}"`,
      `"${a.slotDate}"`,
      `"${a.patientName}"`,
      `"${a.patientPhone}"`,
      `"${a.payerType === 'Corporate / Panel' ? a.panelName || 'Panel' : 'Self Pay'}"`,
      `"${a.doctorName}"`,
      `"${a.departmentName}"`,
      `"${a.serviceName}"`,
      payableAmount(a),
      a.advancePaid,
      Math.max(0, payableAmount(a) - a.advancePaid),
      `"${a.status}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `appointments_${dateFilter || 'today'}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    if (appointments.length === 0) return;
    const headers = ['#', 'Slot Time', 'Slot Date', 'Patient Name', 'Phone', 'Payer', 'Doctor', 'Department', 'Service', 'Payable', 'Advance Paid', 'Remaining', 'Status'];
    const rowsHtml = appointments.map((a, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${a.slotTime}</td>
        <td>${a.slotDate}</td>
        <td>${a.patientName}</td>
        <td>${a.patientPhone}</td>
        <td>${a.payerType === 'Corporate / Panel' ? a.panelName || 'Panel' : 'Self Pay'}</td>
        <td>${a.doctorName}</td>
        <td>${a.departmentName}</td>
        <td>${a.serviceName}</td>
        <td>${payableAmount(a)}</td>
        <td>${a.advancePaid}</td>
        <td>${Math.max(0, payableAmount(a) - a.advancePaid)}</td>
        <td>${a.status}</td>
      </tr>
    `).join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"/></head>
      <body>
        <h2>Patient Appointments Registry</h2>
        <table border="1">
          <tr style="background:#0e5944;color:#ffffff;font-weight:bold;">
            ${headers.map(h => `<th>${h}</th>`).join('')}
          </tr>
          ${rowsHtml}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `appointments_${dateFilter || 'today'}.xls`;
    link.click();
  };

  const handleCheckIn = async (a: AppointmentRecord) => {
    setCheckingInId(a.id);
    try {
      const encType: 'OPD' | 'OBSERVATION' | 'EMERGENCY' = a.notes?.includes('[EMERGENCY]')
        ? 'EMERGENCY'
        : a.notes?.includes('[OBSERVATION]')
        ? 'OBSERVATION'
        : 'OPD';
      const result = await appointmentsApiService.checkInAppointment(a.id, { encounterType: encType });
      const tokenMsg = result.queueNumber ? ` Token: ${result.queueNumber} —` : '';
      toast.success(`${a.patientName} checked in —${tokenMsg} invoice created.`);
      await load();
      if (result.invoiceId) setInvoiceModalId(result.invoiceId);
    } catch (err: any) {
      toast.error(err?.message || 'Check-in failed.');
    } finally {
      setCheckingInId(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#effaf5] text-[#08775A] flex items-center justify-center">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Appointments</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage scheduled patient visits, advances, check-in and appointment status.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsBookOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs"
        >
          <Plus className="h-3.5 w-3.5" /> Book Appointment
        </button>
      </div>

      {/* KPI Header Cards */}
      <HospitalKpiHeader
        cards={[
          {
            title: "Total Appointments",
            value: kpis.total,
            subtitle: "Scheduled / logged today",
            icon: CalendarClock,
            accentColor: "#08775A",
            category: "DAILY VOLUME",
          },
          {
            title: "Confirmed / Scheduled",
            value: kpis.confirmed,
            subtitle: "Awaiting patient arrival",
            icon: CheckCircle2,
            accentColor: "#0284c7",
            category: "UPCOMING",
          },
          {
            title: "Checked In",
            value: kpis.checkedIn,
            subtitle: "In clinic / invoice issued",
            icon: UserCheck,
            accentColor: "#16a34a",
            category: "PRESENT",
          },
          {
            title: "Cancelled / No Show",
            value: kpis.cancelled,
            subtitle: "Slot released or void",
            icon: Ban,
            accentColor: "#dc2626",
            category: "DROPPED",
          },
        ]}
      />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <TextInput label="Date" lang="en-GB" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          <Select
            label="Department"
            placeholder="All Departments"
            options={departments.map((d) => ({ label: d.name, value: d.id }))}
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          />
          <Select
            label="Doctor"
            placeholder="All Doctors"
            options={doctors.map((d) => ({ label: d.fullName, value: d.id }))}
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
          />
          <Select
            label="Status"
            placeholder="All Statuses"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | '')}
          />
          <TextInput
            label="Search"
            icon={<Search className="h-3.5 w-3.5" />}
            placeholder="Patient name, phone, MRN…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
          <span className="text-[11px] text-slate-500">
            {isLoading ? 'Loading…' : `Showing ${appointments.length} record${appointments.length === 1 ? '' : 's'}`}
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
          >
            <RotateCcw className="h-3 w-3" /> Reset Filters
          </button>
        </div>
      </div>

      {/* Table Container in Pharmacy Design */}
      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden font-sans">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-300" />
            <span className="font-bold text-sm tracking-wide">Appointments Directory</span>
            <span className="text-[11px] font-semibold text-emerald-200/90 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/30">
              {appointments.length} record{appointments.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handleExportExcel}
              className="bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Export to Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Export to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Print Table"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Search in results toolbar */}
        <div className="px-3.5 py-2 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="text-slate-600 font-medium">records per page</span>
          </div>

          <div className="text-slate-500 font-medium">
            Showing {appointments.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, appointments.length)} of {appointments.length} entries
          </div>
        </div>

        {loadError ? (
          <div className="p-8 flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-6 w-6 text-rose-500" />
            <p className="text-xs text-rose-700 font-medium">{loadError}</p>
            <button
              type="button"
              onClick={load}
              className="mt-1 text-xs font-semibold text-[#08775A] hover:underline"
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading appointments…</span>
          </div>
        ) : appointments.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">No appointments found for the selected filters.</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] min-h-[300px]">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none">
                <tr>
                  <th className="py-3 px-3.5 text-center border-r border-slate-200 w-12 whitespace-nowrap">#</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Slot Time</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Patient</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Payer</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Doctor</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Department</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Service</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap text-right">Payable</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap text-right">Advance Paid</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap text-right">Remaining</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap text-center">Status</th>
                  <th className="py-3 px-4 whitespace-nowrap text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {paginatedAppointments.map((a, idx) => {
                  const payable = payableAmount(a);
                  const remaining = Math.max(0, payable - a.advancePaid);
                  const eligibleForActions = a.status === 'CONFIRMED' || a.status === 'RESCHEDULED';
                  const rowNumber = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap font-mono">
                        {rowNumber}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{a.slotTime}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{a.slotDate}</div>
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{a.patientName}</span>
                          {a.queueNumber && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {a.queueNumber}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {a.patientMrNumber && (
                            <span className="text-[10px] font-mono font-semibold text-[#08775A]">
                              {a.patientMrNumber}
                            </span>
                          )}
                          {a.payerType === 'Corporate / Panel' ? (
                            <PanelBadge />
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">Self-Pay</span>
                          )}
                          <span className="text-[10px] text-slate-400 font-mono">{a.patientPhone}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-slate-600">
                        {a.payerType === 'Corporate / Panel' ? a.panelName || '—' : 'Self Pay'}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-slate-700 font-medium">{a.doctorName}</td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-slate-600">{a.departmentName}</td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-slate-600">{a.serviceName}</td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap font-bold text-slate-800 text-right tabular-nums">{formatPKR(payable)}</td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-emerald-700 font-bold text-right tabular-nums">{formatPKR(a.advancePaid)}</td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap font-bold text-amber-700 text-right tabular-nums">{formatPKR(remaining)}</td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1">
                          {eligibleForActions && (
                            <>
                              <button
                                type="button"
                                title="Check In"
                                disabled={checkingInId === a.id}
                                onClick={() => handleCheckIn(a)}
                                className="p-1.5 rounded-md text-[#08775A] hover:bg-[#effaf5] disabled:opacity-50 transition-colors"
                              >
                                {checkingInId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                title="Collect Advance"
                                onClick={() => setAdvanceTarget(a)}
                                className="p-1.5 rounded-md text-amber-700 hover:bg-amber-50 transition-colors"
                              >
                                <Wallet className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Reschedule"
                                onClick={() => setRescheduleTarget(a)}
                                className="p-1.5 rounded-md text-blue-700 hover:bg-blue-50 transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Cancel"
                                onClick={() => setCancelTarget(a)}
                                className="p-1.5 rounded-md text-rose-700 hover:bg-rose-50 transition-colors"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {a.status === 'CHECKED_IN' && a.invoiceId && (
                            <button
                              type="button"
                              title="Open Invoice / Billing"
                              onClick={() => setInvoiceModalId(a.invoiceId!)}
                              className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-50 transition-colors"
                            >
                              <Receipt className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="View Details"
                            onClick={() => setDetailId(a.id)}
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pharmacy Pagination Footer */}
        {appointments.length > 0 && (
          <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, appointments.length)} of {appointments.length} entries
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.ceil(appointments.length / pageSize) }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === Math.ceil(appointments.length / pageSize) || Math.abs(p - currentPage) <= 1)
                  .map((p, idx, arr) => (
                    <React.Fragment key={p}>
                      {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-slate-400">…</span>}
                      <button
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        className={`w-7 h-7 rounded text-xs font-semibold cursor-pointer ${
                          currentPage === p
                            ? 'bg-[#08775A] text-white shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  ))}
              </div>
              <button
                type="button"
                disabled={currentPage === Math.ceil(appointments.length / pageSize) || appointments.length === 0}
                onClick={() => setCurrentPage((p) => Math.min(Math.ceil(appointments.length / pageSize), p + 1))}
                className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {isBookOpen && (
        <BookAppointmentModal
          onClose={() => setIsBookOpen(false)}
          onBooked={() => {
            setIsBookOpen(false);
            load();
          }}
        />
      )}

      {advanceTarget && (
        <CollectAdvanceModal
          appointment={advanceTarget}
          onClose={() => setAdvanceTarget(null)}
          onCollected={() => {
            setAdvanceTarget(null);
            load();
          }}
        />
      )}

      {cancelTarget && (
        <CancelAppointmentModal
          appointment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setCancelTarget(null);
            load();
          }}
        />
      )}

      {rescheduleTarget && (
        <BookAppointmentModal
          rescheduleAppointment={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onBooked={() => {
            setRescheduleTarget(null);
            load();
          }}
        />
      )}

      {detailId && <AppointmentDetailModal appointmentId={detailId} onClose={() => setDetailId(null)} />}

      {invoiceModalId && (
        <InvoiceDetailModal invoiceId={invoiceModalId} onClose={() => setInvoiceModalId(null)} onChanged={load} />
      )}
    </div>
  );
};
