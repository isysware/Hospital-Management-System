import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet,
  Loader2,
  CheckCircle2,
  ClipboardList,
  History,
  PlayCircle,
  Banknote,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import {
  previewPayrollRun,
  generatePayrollRun,
  listPayrollRuns,
  getPayrollRun,
  approvePayrollRun,
  paySalarySlip,
} from '../../../services/payrollService';
import { fetchDepartments } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import { PayrollFilters, PayrollPeriodType, PayrollPreview, PayrollRun, SalarySlip } from '../../../types/payroll';
import { STAFF_CATEGORIES, SALARY_BASIS_OPTIONS } from '../../../types/staffUser';
import { useToast } from '../../../context/ToastContext';
import { formatPKR } from '../../../utils/formatters';
import { formatDisplayDate } from '../../../utils/dateConstants';
import { Select, TextInput } from '../../../components/forms/FormControls';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 border-slate-200',
  GENERATED: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  PARTIALLY_PAID: 'bg-purple-50 text-purple-700 border-purple-200',
  PAID: 'bg-[#e7f6f1] text-[#0e7d5a] border-[#c2e7db]',
};

const PERIOD_TYPE_OPTIONS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'CUSTOM', label: 'Custom' },
];

const basisLabel = (v: string) => SALARY_BASIS_OPTIONS.find((o) => o.value === v)?.label || v;
const periodLabel = (start: string, end: string) => `${formatDisplayDate(new Date(start))} – ${formatDisplayDate(new Date(end))}`;

// Same bordered-grid look as the reporting tables (GenericReportView).
const TH = 'py-3 px-4 border-r border-slate-300 last:border-r-0 whitespace-nowrap';
const TD = 'py-3 px-4 border-r border-slate-200 last:border-r-0 whitespace-nowrap text-slate-800';
const TD_NUM = 'py-3 px-3 text-center border-r border-slate-200 text-slate-500 text-xs bg-slate-50/60 w-14';
const AMT = 'text-right tabular-nums font-semibold';
const ROW = 'hover:bg-slate-50/90 transition-colors border-b border-slate-200 last:border-b-0';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT}`}>
    {status.replace('_', ' ')}
  </span>
);

/** Green title banner + bordered table, the same pattern as the Front Desk reports. */
const TableSection: React.FC<{
  icon: React.ElementType;
  title: string;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  head: React.ReactNode;
  foot?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, title, note, actions, head, foot, children }) => (
  <div className="space-y-3">
    <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-4 py-2.5 rounded-lg flex items-center justify-between gap-3 shadow-xs">
      <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide">
        <div className="h-6 w-6 rounded bg-white/15 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span>{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {note && <span className="text-xs text-emerald-100 font-medium bg-white/10 px-2.5 py-0.5 rounded-md">{note}</span>}
        {actions}
      </div>
    </div>
    <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="bg-[#f1f5f9] border-b border-slate-300 text-slate-800 text-xs font-bold uppercase tracking-wider">
              <th className={`${TH} w-14 text-center`}>#</th>
              {head}
            </tr>
          </thead>
          <tbody className="text-slate-700">{children}</tbody>
          {foot && (
            <tfoot>
              <tr className="bg-[#f1f5f9] border-t-2 border-slate-300 font-bold text-slate-900">{foot}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  </div>
);

const EmptyRow: React.FC<{ colSpan: number; children: React.ReactNode }> = ({ colSpan, children }) => (
  <tr>
    <td colSpan={colSpan} className="py-12 text-center text-slate-400">
      {children}
    </td>
  </tr>
);

const TotalLabel = () => (
  <td className="py-3 px-3 text-center border-r border-slate-300 text-[11px] uppercase tracking-wider text-slate-600">Total</td>
);

const SkippedList: React.FC<{ skipped: { staffId: string; fullName: string; employeeId?: string; reason: string }[] }> = ({ skipped }) =>
  skipped.length === 0 ? null : (
    <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-200 flex items-center gap-2 text-sm font-bold text-amber-800">
        <AlertTriangle className="h-4 w-4" /> Skipped Staff ({skipped.length})
      </div>
      <table className="w-full text-left text-sm">
        <tbody>
          {skipped.map((s) => (
            <tr key={s.staffId} className="border-b border-amber-100 last:border-b-0">
              <td className="py-2 px-4 font-semibold text-amber-900 whitespace-nowrap">
                {s.fullName} {s.employeeId && <span className="font-normal text-amber-700">({s.employeeId})</span>}
              </td>
              <td className="py-2 px-4 text-amber-800 w-full">{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

export const SuperAdminPayrollView: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useState<'generate' | 'runs'>('generate');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => {});
  }, []);

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
      active ? 'bg-[#08775A] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-4 animate-in fade-in duration-150 font-montserrat">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-[#e7f6f1] text-[#08775A] flex items-center justify-center">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Salary Payroll</h1>
            <p className="text-xs text-slate-500 mt-0.5">Attendance-driven payroll from each staff member's Salary Profile and approved attendance.</p>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button onClick={() => { setTab('generate'); setSelectedRunId(null); }} className={tabClass(tab === 'generate')}>
            <PlayCircle className="h-3.5 w-3.5" /> Generate Run
          </button>
          <button onClick={() => setTab('runs')} className={tabClass(tab === 'runs')}>
            <History className="h-3.5 w-3.5" /> Runs &amp; Payments
          </button>
        </div>
      </div>

      {tab === 'generate' ? (
        <GenerateTab departments={departments} toast={toast} onGenerated={(id) => { setSelectedRunId(id); setTab('runs'); }} />
      ) : (
        <RunsTab toast={toast} selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId} />
      )}
    </div>
  );
};

const GenerateTab: React.FC<{ departments: Department[]; toast: ReturnType<typeof useToast>; onGenerated: (id: string) => void }> = ({ departments, toast, onGenerated }) => {
  const [periodType, setPeriodType] = useState<PayrollPeriodType>('MONTHLY');
  const [periodStart, setPeriodStart] = useState(firstOfMonthISO());
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [departmentId, setDepartmentId] = useState('');
  const [category, setCategory] = useState('');
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const filters: PayrollFilters = useMemo(() => ({
    periodType,
    periodStart,
    periodEnd,
    departmentId: departmentId || undefined,
    category: category || undefined,
  }), [periodType, periodStart, periodEnd, departmentId, category]);

  const handlePreview = async () => {
    setIsPreviewing(true);
    setPreview(null);
    try {
      setPreview(await previewPayrollRun(filters));
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to preview payroll.', 'Preview Error');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleGenerate = async () => {
    if (!preview || preview.eligible.length === 0) {
      toast.error('Run a preview first — nothing eligible to generate.', 'Nothing to Generate');
      return;
    }
    setIsGenerating(true);
    try {
      const run = await generatePayrollRun(filters);
      toast.success(`Payroll run generated for ${run.staffCount} staff member${run.staffCount === 1 ? '' : 's'}.`, 'Run Generated');
      onGenerated(run.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to generate payroll run.', 'Generate Error');
    } finally {
      setIsGenerating(false);
    }
  };

  const sum = (key: 'periodBaseAmount' | 'attendanceDeductions' | 'allowances' | 'grossAmount' | 'tax' | 'otherDeductions' | 'netAmount') =>
    (preview?.eligible ?? []).reduce((s, r) => s + Number(r[key]), 0);

  return (
    <div className="space-y-4">
      {/* Filter bar — one landscape row on wide screens (5 equal filters + buttons), wraps on smaller ones */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] items-end gap-3">
        <div className="min-w-0">
          <Select label="Period Type" options={PERIOD_TYPE_OPTIONS} value={periodType} onChange={(e) => setPeriodType(e.target.value as PayrollPeriodType)} />
        </div>
        <div className="min-w-0">
          <TextInput label="From" lang="en-GB" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="min-w-0">
          <TextInput label="To" lang="en-GB" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div className="min-w-0">
          <Select
            label="Department"
            options={[{ value: '', label: 'All Departments' }, ...departments.filter((d) => d.status === 'Active').map((d) => ({ value: d.id, label: d.name }))]}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          />
        </div>
        <div className="min-w-0">
          <Select
            label="Category"
            options={[{ value: '', label: 'All Categories' }, ...STAFF_CATEGORIES.map((c) => ({ value: c, label: c }))]}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <div className="col-span-2 md:col-span-3 xl:col-span-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handlePreview}
            disabled={isPreviewing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#08775A] bg-[#e7f6f1] hover:bg-[#d0efe5] border border-[#c2e7db] rounded-lg cursor-pointer disabled:opacity-50"
          >
            {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
            Preview
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!preview || preview.eligible.length === 0 || isGenerating}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Generate Payroll Run
          </button>
        </div>
      </div>

      {isPreviewing ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-400 shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Calculating payroll…</span>
        </div>
      ) : !preview ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
          Choose a period and press <span className="font-semibold text-slate-600">Preview</span> to see each staff member's salary before generating.
        </div>
      ) : (
        <>
          <TableSection
            icon={ClipboardList}
            title="Payroll Preview"
            note={`${preview.staffCount} eligible · ${preview.skipped.length} skipped`}
            head={
              <>
                <th className={TH}>Staff</th>
                <th className={TH}>Emp ID</th>
                <th className={TH}>Salary Type</th>
                <th className={`${TH} text-center`}>Sched. Days</th>
                <th className={`${TH} text-center`}>Present Days</th>
                <th className={`${TH} text-right`}>Base Salary</th>
                <th className={`${TH} text-right`}>Attendance Ded.</th>
                <th className={`${TH} text-right`}>Allowance</th>
                <th className={`${TH} text-right`}>Gross</th>
                <th className={`${TH} text-right`}>Tax</th>
                <th className={`${TH} text-right`}>Other Ded.</th>
                <th className={`${TH} text-right`}>Net Payable</th>
              </>
            }
            foot={
              preview.eligible.length > 0 ? (
                <>
                  <TotalLabel />
                  <td className={TD} colSpan={5} />
                  <td className={`${TD} ${AMT}`}>{formatPKR(sum('periodBaseAmount'))}</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(sum('attendanceDeductions'))})</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(sum('allowances'))}</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(sum('grossAmount'))}</td>
                  <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(sum('tax'))})</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(sum('otherDeductions'))})</td>
                  <td className={`${TD} ${AMT} text-[15px] text-[#08775A]`}>{formatPKR(Number(preview.totalAmount))}</td>
                </>
              ) : undefined
            }
          >
            {preview.eligible.length === 0 ? (
              <EmptyRow colSpan={13}>No eligible staff for this period.</EmptyRow>
            ) : (
              preview.eligible.map((r, i) => (
                <tr key={r.staffId} className={ROW}>
                  <td className={TD_NUM}>{i + 1}</td>
                  <td className={`${TD} font-semibold text-slate-900`}>{r.fullName}</td>
                  <td className={`${TD} font-semibold text-[#08775A]`}>{r.employeeId}</td>
                  <td className={TD}>{basisLabel(r.salaryBasis)}</td>
                  <td className={`${TD} text-center tabular-nums`}>{r.scheduledPayableDays}</td>
                  <td className={`${TD} text-center tabular-nums`}>{r.attendanceEquivalentDays}</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.periodBaseAmount))}</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(r.attendanceDeductions))})</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.allowances))}</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.grossAmount))}</td>
                  <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(Number(r.tax))})</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(r.otherDeductions))})</td>
                  <td className={`${TD} ${AMT} font-bold text-[15px] text-[#08775A]`}>{formatPKR(Number(r.netAmount))}</td>
                </tr>
              ))
            )}
          </TableSection>

          <SkippedList skipped={preview.skipped} />
        </>
      )}
    </div>
  );
};

const RunsTab: React.FC<{
  toast: ReturnType<typeof useToast>;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
}> = ({ toast, selectedRunId, setSelectedRunId }) => {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollRun | null>(null);
  const [payingSlip, setPayingSlip] = useState<SalarySlip | null>(null);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMethod, setPayMethod] = useState('BANK');
  const [payReference, setPayReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadRuns = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setRuns(await listPayrollRuns());
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load payroll runs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    getPayrollRun(selectedRunId).then(setDetail).catch(() => {});
  }, [selectedRunId]);

  const handleApprove = async () => {
    if (!detail) return;
    try {
      await approvePayrollRun(detail.id);
      toast.success('Payroll run approved — slips are now payable.');
      setDetail(await getPayrollRun(detail.id));
      await loadRuns();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to approve run.', 'Approve Error');
    }
  };

  const paidOf = (slip: SalarySlip) => slip.payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const openPay = (slip: SalarySlip) => {
    setPayingSlip(slip);
    setPayAmount(Number(slip.generatedAmount) - paidOf(slip));
    setPayMethod('BANK');
    setPayReference('');
  };

  const submitPay = async () => {
    if (!payingSlip || payAmount === '' || Number(payAmount) <= 0) return;
    setIsSubmitting(true);
    try {
      await paySalarySlip(payingSlip.id, { amount: Number(payAmount), method: payMethod, reference: payReference || undefined });
      toast.success(`Payment recorded for ${payingSlip.staff.fullName}.`);
      setPayingSlip(null);
      if (detail) setDetail(await getPayrollRun(detail.id));
      await loadRuns();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to record payment.', 'Payment Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const runsTotal = runs.reduce((s, r) => s + Number(r.totalAmount), 0);
  const slipTotals = (detail?.lines ?? []).reduce(
    (t, s) => {
      const paid = paidOf(s);
      return {
        base: t.base + Number(s.baseAmount),
        ded: t.ded + Number(s.attendanceDeductions),
        allow: t.allow + Number(s.allowances),
        tax: t.tax + Number(s.componentBreakdown?.tax ?? 0),
        other: t.other + Number(s.otherDeductions),
        net: t.net + Number(s.generatedAmount),
        paid: t.paid + paid,
      };
    },
    { base: 0, ded: 0, allow: 0, tax: 0, other: 0, net: 0, paid: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Runs list */}
      {loadError ? (
        <div className="bg-white rounded-xl border border-rose-200 p-6 text-center text-xs text-rose-700 shadow-xs">
          {loadError}{' '}
          <button type="button" onClick={loadRuns} className="font-semibold text-[#08775A] hover:underline">Retry</button>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-400 shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading payroll runs…</span>
        </div>
      ) : (
        <TableSection
          icon={History}
          title="Payroll Runs"
          note={`${runs.length} run${runs.length === 1 ? '' : 's'}`}
          head={
            <>
              <th className={TH}>Period</th>
              <th className={TH}>Type</th>
              <th className={TH}>Department / Category</th>
              <th className={`${TH} text-center`}>Staff</th>
              <th className={TH}>Generated By</th>
              <th className={TH}>Status</th>
              <th className={`${TH} text-right`}>Total Net</th>
              <th className={`${TH} text-center`}>Action</th>
            </>
          }
          foot={
            runs.length > 0 ? (
              <>
                <TotalLabel />
                <td className={TD} colSpan={6} />
                <td className={`${TD} ${AMT} text-[15px]`}>{formatPKR(runsTotal)}</td>
                <td className={TD} />
              </>
            ) : undefined
          }
        >
          {runs.length === 0 ? (
            <EmptyRow colSpan={9}>No payroll runs generated yet.</EmptyRow>
          ) : (
            runs.map((r, i) => {
              const active = selectedRunId === r.id;
              return (
                <tr key={r.id} className={`${ROW} cursor-pointer ${active ? 'bg-[#effaf5]' : ''}`} onClick={() => setSelectedRunId(r.id)}>
                  <td className={TD_NUM}>{i + 1}</td>
                  <td className={`${TD} font-semibold text-slate-900`}>{periodLabel(r.periodStart, r.periodEnd)}</td>
                  <td className={TD}>{r.periodType}</td>
                  <td className={`${TD} text-slate-500`}>{[r.department?.name, r.category].filter(Boolean).join(' · ') || 'All'}</td>
                  <td className={`${TD} text-center tabular-nums`}>{r.staffCount}</td>
                  <td className={`${TD} text-slate-500`}>{r.generatedByUser?.username || 'System'}</td>
                  <td className={TD}><StatusBadge status={r.status} /></td>
                  <td className={`${TD} ${AMT} font-bold`}>{formatPKR(Number(r.totalAmount))}</td>
                  <td className={`${TD} text-center`}>
                    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${active ? 'text-[#08775A]' : 'text-slate-500'}`}>
                      {active ? 'Viewing' : 'View'} <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </TableSection>
      )}

      {/* Selected run's salary slips */}
      {detail && (
        <>
          <TableSection
            icon={Banknote}
            title={`Salary Slips — ${periodLabel(detail.periodStart, detail.periodEnd)}`}
            note={`${detail.periodType} · by ${detail.generatedByUser?.username || 'System'}`}
            actions={
              detail.status === 'GENERATED' ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-[#08775A] bg-white hover:bg-emerald-50 rounded-md cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve Run
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4" /> Approved
                </span>
              )
            }
            head={
              <>
                <th className={TH}>Staff</th>
                <th className={TH}>Emp ID</th>
                <th className={`${TH} text-right`}>Base Salary</th>
                <th className={`${TH} text-right`}>Attendance Ded.</th>
                <th className={`${TH} text-right`}>Allowance</th>
                <th className={`${TH} text-right`}>Tax</th>
                <th className={`${TH} text-right`}>Other Ded.</th>
                <th className={`${TH} text-right`}>Net Payable</th>
                <th className={`${TH} text-right`}>Paid</th>
                <th className={`${TH} text-right`}>Balance</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-center`}>Action</th>
              </>
            }
            foot={
              detail.lines.length > 0 ? (
                <>
                  <TotalLabel />
                  <td className={TD} colSpan={2} />
                  <td className={`${TD} ${AMT}`}>{formatPKR(slipTotals.base)}</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(slipTotals.ded)})</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(slipTotals.allow)}</td>
                  <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(slipTotals.tax)})</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(slipTotals.other)})</td>
                  <td className={`${TD} ${AMT} text-[15px] text-[#08775A]`}>{formatPKR(slipTotals.net)}</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(slipTotals.paid)}</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>{formatPKR(slipTotals.net - slipTotals.paid)}</td>
                  <td className={TD} colSpan={2} />
                </>
              ) : undefined
            }
          >
            {detail.lines.length === 0 ? (
              <EmptyRow colSpan={13}>No salary slips in this run.</EmptyRow>
            ) : (
              detail.lines.map((slip, i) => {
                const paid = paidOf(slip);
                const balance = Number(slip.generatedAmount) - paid;
                const canPay = slip.status === 'APPROVED' || slip.status === 'PARTIALLY_PAID';
                return (
                  <tr key={slip.id} className={ROW}>
                    <td className={TD_NUM}>{i + 1}</td>
                    <td className={`${TD} font-semibold text-slate-900`}>{slip.staff.fullName}</td>
                    <td className={`${TD} font-semibold text-[#08775A]`}>{slip.staff.employeeId}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(slip.baseAmount))}</td>
                    <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(slip.attendanceDeductions))})</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(slip.allowances))}</td>
                    <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(Number(slip.componentBreakdown?.tax ?? 0))})</td>
                    <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(slip.otherDeductions))})</td>
                    <td className={`${TD} ${AMT} font-bold text-[15px] text-[#08775A]`}>{formatPKR(Number(slip.generatedAmount))}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(paid)}</td>
                    <td className={`${TD} ${AMT} ${balance > 0 ? 'text-rose-700' : 'text-slate-400'}`}>{formatPKR(balance)}</td>
                    <td className={TD}><StatusBadge status={slip.status} /></td>
                    <td className={`${TD} text-center`}>
                      {canPay ? (
                        <button
                          type="button"
                          onClick={() => openPay(slip)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-md cursor-pointer"
                        >
                          <Banknote className="h-3.5 w-3.5" /> Pay
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">{slip.status === 'PAID' ? 'Paid' : 'Approve first'}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </TableSection>

          <SkippedList skipped={detail.skippedStaff} />
        </>
      )}

      {payingSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden font-montserrat">
            <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-5 py-3">
              <h3 className="font-bold text-sm">Record Salary Payment</h3>
              <p className="text-xs text-emerald-100">{payingSlip.staff.fullName} ({payingSlip.staff.employeeId})</p>
            </div>
            <table className="w-full text-sm border-b border-slate-200">
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-2 px-5 text-slate-500">Net Payable</td>
                  <td className="py-2 px-5 text-right font-semibold tabular-nums">{formatPKR(Number(payingSlip.generatedAmount))}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-2 px-5 text-slate-500">Already Paid</td>
                  <td className="py-2 px-5 text-right font-semibold tabular-nums">{formatPKR(paidOf(payingSlip))}</td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="py-2 px-5 font-bold text-slate-800">Balance</td>
                  <td className="py-2 px-5 text-right font-bold tabular-nums text-rose-700">
                    {formatPKR(Number(payingSlip.generatedAmount) - paidOf(payingSlip))}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="p-5 space-y-3.5">
              <TextInput
                label="Amount (PKR)"
                type="number"
                min={0}
                onWheel={(e) => e.currentTarget.blur()}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <Select
                label="Method"
                options={[
                  { value: 'CASH', label: 'Cash' },
                  { value: 'CARD', label: 'Card' },
                  { value: 'BANK', label: 'Bank Transfer' },
                  { value: 'ONLINE', label: 'Online' },
                ]}
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              />
              <TextInput label="Reference (optional)" type="text" value={payReference} onChange={(e) => setPayReference(e.target.value)} />
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setPayingSlip(null)} className="px-3.5 py-2 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="button" disabled={isSubmitting} onClick={submitPay} className="px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
