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
  RotateCw,
} from 'lucide-react';
import {
  previewPayrollRun,
  generatePayrollRun,
  listPayrollRuns,
  getPayrollRun,
  approvePayrollRun,
  paySalarySlip,
  adjustSalarySlip,
} from '../../../services/payrollService';
import { FinancialAdjustmentModal } from './FinancialAdjustmentModal';
import { PreferredPaymentAccount } from './PreferredPaymentAccount';
import { fetchStaffUsers } from '../../../services/staffUserService';
import { fetchDepartments } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import { PayrollFilters, PayrollPeriodType, PayrollPreview, PayrollRun, SalarySlip } from '../../../types/payroll';
import { STAFF_CATEGORIES, SALARY_BASIS_OPTIONS } from '../../../types/staffUser';
import { useToast } from '../../../context/ToastContext';
import { formatPKR } from '../../../utils/formatters';
import { formatDisplayDate } from '../../../utils/dateConstants';
import { Select, TextInput } from '../../../components/forms/FormControls';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

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
  PAID: 'bg-[#e7f6f1] text-[#08775A] border-[#c2e7db]',
};

const PERIOD_TYPE_OPTIONS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'CUSTOM', label: 'Custom' },
];

const basisLabel = (v: string) => SALARY_BASIS_OPTIONS.find((o) => o.value === v)?.label || v;
const periodLabel = (start: string, end: string) => `${formatDisplayDate(new Date(start))} – ${formatDisplayDate(new Date(end))}`;

// Table layout helpers
const TH = 'py-2.5 px-3.5 border-r border-[#c2e7db]/60 last:border-r-0 whitespace-nowrap text-[11px] font-bold text-[#08775A] uppercase tracking-wider';
const TD = 'py-2.5 px-3.5 border-r border-[#e2eae5] last:border-r-0 whitespace-nowrap text-xs text-slate-700';
const TD_NUM = 'py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20 w-12';
const AMT = 'text-right font-mono font-bold tabular-nums';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT}`}>
    {status.replace('_', ' ')}
  </span>
);

/** Section 4.5 Data Table Wrapper with Dark Emerald Header Strip */
const TableSection: React.FC<{
  icon: React.ElementType;
  title: string;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  head: React.ReactNode;
  foot?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, title, note, actions, head, foot, children }) => (
  <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden flex flex-col">
    {/* Dark Emerald Header Strip */}
    <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#c2e7db]" />
        <span className="font-semibold text-xs tracking-wide">{title}</span>
        {note && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">{note}</span>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
      </div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-[#effaf5] border-b border-[#c2e7db] select-none sticky top-0 z-10">
            <th className={`${TH} w-12 text-center`}>#</th>
            {head}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e2eae5] text-slate-700">{children}</tbody>
        {foot && (
          <tfoot>
            <tr className="bg-[#fbfdfc] border-t-2 border-[#c2e7db] font-bold text-[#123e2b]">{foot}</tr>
          </tfoot>
        )}
      </table>
    </div>
  </div>
);

const EmptyRow: React.FC<{ colSpan: number; children: React.ReactNode }> = ({ colSpan, children }) => (
  <tr>
    <td colSpan={colSpan} className="py-12 text-center text-[#52665e] text-xs">
      {children}
    </td>
  </tr>
);

const TotalLabel = () => (
  <td className="py-2.5 px-3 text-center border-r border-[#c2e7db] text-[11px] font-bold uppercase tracking-wider text-[#08775A] bg-[#effaf5]/30">Total</td>
);

const SkippedList: React.FC<{ skipped: { staffId: string; fullName: string; employeeId?: string; reason: string }[] }> = ({ skipped }) =>
  skipped.length === 0 ? null : (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden shadow-2xs">
      <div className="px-4 py-2.5 border-b border-amber-200 flex items-center gap-2 text-xs font-bold text-amber-800">
        <AlertTriangle className="h-4 w-4" /> Skipped Staff Profile Check ({skipped.length})
      </div>
      <table className="w-full text-left text-xs">
        <tbody>
          {skipped.map((s) => (
            <tr key={s.staffId} className="border-b border-amber-100 last:border-b-0">
              <td className="py-2 px-4 font-semibold text-amber-900 whitespace-nowrap">
                {s.fullName} {s.employeeId && <span className="font-normal text-amber-700 font-mono">({s.employeeId})</span>}
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

  return (
    <div className="space-y-4">
      {/* Section 4.1 Card Page Header Block */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">Salary Payroll Engine</h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                Financial Cycle Active
              </span>
            </div>
            <p className="text-xs text-[#52665e] mt-0.5">
              Attendance-driven payroll calculated from staff salary profiles and approved duty attendances
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="inline-flex rounded-xl border border-[#c2e7db] bg-[#effaf5]/50 p-1">
          <button
            onClick={() => {
              setTab('generate');
              setSelectedRunId(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
              tab === 'generate'
                ? 'bg-white text-[#08775A] shadow-2xs border border-[#c2e7db]'
                : 'text-[#52665e] hover:text-[#123e2b]'
            }`}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            <span>Generate Run</span>
          </button>
          <button
            onClick={() => setTab('runs')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
              tab === 'runs'
                ? 'bg-white text-[#08775A] shadow-2xs border border-[#c2e7db]'
                : 'text-[#52665e] hover:text-[#123e2b]'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Runs &amp; Disbursements</span>
          </button>
        </div>
      </div>

      {tab === 'generate' ? (
        <GenerateTab
          departments={departments}
          toast={toast}
          onGenerated={(id) => {
            setSelectedRunId(id);
            setTab('runs');
          }}
        />
      ) : (
        <RunsTab toast={toast} selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId} />
      )}
    </div>
  );
};

const GenerateTab: React.FC<{
  departments: Department[];
  toast: ReturnType<typeof useToast>;
  onGenerated: (id: string) => void;
}> = ({ departments, toast, onGenerated }) => {
  const [periodType, setPeriodType] = useState<PayrollPeriodType>('MONTHLY');
  const [periodStart, setPeriodStart] = useState(firstOfMonthISO());
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [departmentId, setDepartmentId] = useState('');
  const [category, setCategory] = useState('');
  const [staffId, setStaffId] = useState('');
  const [staff, setStaff] = useState<Awaited<ReturnType<typeof fetchStaffUsers>>>([]);
  useEffect(() => {
    fetchStaffUsers()
      .then(setStaff)
      .catch(() => toast.error('Unable to load staff directory.'));
  }, []);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const filters: PayrollFilters = useMemo(
    () => ({
      periodType,
      periodStart,
      periodEnd,
      departmentId: departmentId || undefined,
      category: category || undefined,
      staffId: staffId || undefined,
    }),
    [periodType, periodStart, periodEnd, departmentId, category, staffId]
  );

  useEffect(() => {
    setPreview(null);
  }, [filters]);

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
      toast.success(
        `Payroll run generated for ${run.staffCount} staff member${run.staffCount === 1 ? '' : 's'}.`,
        'Run Generated'
      );
      onGenerated(run.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to generate payroll run.', 'Generate Error');
    } finally {
      setIsGenerating(false);
    }
  };

  const sum = (
    key:
      | 'periodBaseAmount'
      | 'attendanceDeductions'
      | 'allowances'
      | 'grossAmount'
      | 'tax'
      | 'otherDeductions'
      | 'netAmount'
  ) => (preview?.eligible ?? []).reduce((s, r) => s + Number(r[key]), 0);

  const kpis: KpiItem[] = useMemo(() => {
    if (!preview) {
      return [
        {
          category: 'PAYROLL CYCLE',
          title: 'Period Scope',
          value: periodType,
          icon: ClipboardList,
          subtitle: `${periodStart} to ${periodEnd}`,
          tone: 'default',
        },
        {
          category: 'ELIGIBILITY POOL',
          title: 'Total Active Staff',
          value: staff.length,
          icon: Wallet,
          subtitle: 'Staff with salary profile',
          tone: 'info',
        },
        {
          category: 'STATUS',
          title: 'Run Status',
          value: 'Draft / Uncomputed',
          icon: PlayCircle,
          subtitle: 'Click Preview to compute',
          tone: 'warning',
        },
        {
          category: 'NET ESTIMATE',
          title: 'Payable Amount',
          value: 'PKR 0',
          icon: Banknote,
          subtitle: 'Awaiting calculation',
          tone: 'default',
        },
      ];
    }

    return [
      {
        category: 'CALCULATION AUDIT',
        title: 'Eligible Staff',
        value: preview.staffCount,
        icon: ClipboardList,
        subtitle: `${preview.skipped.length} skipped`,
        tone: 'default',
      },
      {
        category: 'EARNINGS ACCRUAL',
        title: 'Gross Base Pay',
        value: formatPKR(sum('periodBaseAmount')),
        icon: Wallet,
        subtitle: 'Before attendance deductions',
        tone: 'info',
      },
      {
        category: 'STATUTORY & LEAVE DEDUCTIONS',
        title: 'Total Deductions',
        value: formatPKR(sum('attendanceDeductions') + sum('tax') + sum('otherDeductions')),
        icon: AlertTriangle,
        subtitle: 'Attendance, taxes & other',
        tone: 'warning',
      },
      {
        category: 'FINAL DISBURSEMENT',
        title: 'Net Payable Sum',
        value: formatPKR(Number(preview.totalAmount)),
        icon: Banknote,
        subtitle: 'Total payroll disbursement',
        tone: 'success',
      },
    ];
  }, [preview, periodType, periodStart, periodEnd, staff.length]);

  return (
    <div className="space-y-4">
      {/* KPI Header */}
      <HospitalKpiHeader items={kpis} columns="grid-cols-2 lg:grid-cols-4" />

      {/* Filter Toolbar Section 4.4 */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-4 shadow-2xs grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto] items-end gap-3">
        <div className="min-w-0">
          <Select
            label="Staff / Doctor"
            value={staffId}
            options={[{ value: '', label: 'All staff' }, ...staff.map((s) => ({ value: s.id, label: s.fullName }))]}
            onChange={(e) => setStaffId(e.target.value)}
          />
        </div>
        <div className="min-w-0">
          <Select
            label="Period Type"
            options={PERIOD_TYPE_OPTIONS}
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as PayrollPeriodType)}
          />
        </div>
        <div className="min-w-0">
          <TextInput
            label="From"
            lang="en-GB"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </div>
        <div className="min-w-0">
          <TextInput
            label="To"
            lang="en-GB"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </div>
        <div className="min-w-0">
          <Select
            label="Department"
            options={[
              { value: '', label: 'All Departments' },
              ...departments.filter((d) => d.status === 'Active').map((d) => ({ value: d.id, label: d.name })),
            ]}
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#08775A] bg-[#e7f6f1] hover:bg-[#d0efe5] border border-[#c2e7db] rounded-lg cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
          >
            {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
            Preview
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!preview || preview.eligible.length === 0 || isGenerating}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-2xs cursor-pointer disabled:opacity-50 transition-colors"
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Generate Run
          </button>
        </div>
      </div>

      {isPreviewing ? (
        <div className="bg-white rounded-xl border border-[#e2eae5] p-12 flex items-center justify-center gap-2 text-[#52665e] shadow-2xs">
          <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
          <span className="text-xs font-medium">Computing attendance deduction formulas and allowances…</span>
        </div>
      ) : !preview ? (
        <div className="bg-white rounded-xl border border-dashed border-[#c2e7db] p-12 text-center text-xs text-[#52665e] shadow-2xs">
          Select date parameters and click <span className="font-bold text-[#123e2b]">Preview</span> to view salary computation before generating the official run.
        </div>
      ) : (
        <>
          <TableSection
            icon={ClipboardList}
            title="Payroll Computation Preview"
            note={`${preview.staffCount} eligible · ${preview.skipped.length} skipped`}
            head={
              <>
                <th className={TH}>Staff Member</th>
                <th className={TH}>Emp ID</th>
                <th className={TH}>Salary Type</th>
                <th className={`${TH} text-center`}>Sched. Days</th>
                <th className={`${TH} text-center`}>Present Days</th>
                <th className={`${TH} text-right`}>Daily Rate</th>
                <th className={`${TH} text-right`}>Period Base</th>
                <th className={`${TH} text-right`}>Att. Ded.</th>
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
                  <td className={`${TD} ${AMT} text-sm text-[#08775A]`}>{formatPKR(Number(preview.totalAmount))}</td>
                </>
              ) : undefined
            }
          >
            {preview.eligible.length === 0 ? (
              <EmptyRow colSpan={14}>No eligible staff members found for this period.</EmptyRow>
            ) : (
              preview.eligible.map((r, i) => {
                const isEven = i % 2 === 0;
                return (
                  <tr key={r.staffId} className={`transition-colors ${isEven ? 'bg-white' : 'bg-[#fbfdfc]'} hover:bg-[#e7f6f1]/40 border-b border-[#e2eae5]`}>
                    <td className={TD_NUM}>{i + 1}</td>
                    <td className={`${TD} font-semibold text-[#123e2b]`}>{r.fullName}</td>
                    <td className={`${TD} font-mono font-bold text-[#08775A]`}>{r.employeeId}</td>
                    <td className={TD}>
                      {basisLabel(r.salaryBasis)}
                      {r.salaryBasis.startsWith('MONTHLY') && r.monthlyBaseAmount != null && (
                        <div className="text-[10px] text-[#52665e] font-mono">
                          {formatPKR(Number(r.monthlyBaseAmount))}/mo (÷ {r.monthlyScheduledDays} days)
                        </div>
                      )}
                    </td>
                    <td className={`${TD} text-center font-mono`}>{r.scheduledPayableDays}</td>
                    <td className={`${TD} text-center font-mono font-semibold text-[#08775A]`}>{r.attendanceEquivalentDays}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.dailyRate))}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.periodBaseAmount))}</td>
                    <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(r.attendanceDeductions))})</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.allowances))}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(r.grossAmount))}</td>
                    <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(Number(r.tax))})</td>
                    <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(r.otherDeductions))})</td>
                    <td className={`${TD} ${AMT} text-sm text-[#08775A]`}>{formatPKR(Number(r.netAmount))}</td>
                  </tr>
                );
              })
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
  const [adjustingSlip, setAdjustingSlip] = useState<SalarySlip | null>(null);
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
      toast.success('Payroll run approved — salary slips are now payable.');
      setDetail(await getPayrollRun(detail.id));
      await loadRuns();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to approve run.', 'Approve Error');
    }
  };

  const payableOf = (slip: SalarySlip) => Number(slip.balance?.payable ?? slip.generatedAmount);
  const paidOf = (slip: SalarySlip) => slip.payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const openPay = (slip: SalarySlip) => {
    setPayingSlip(slip);
    setPayAmount(payableOf(slip) - paidOf(slip));
    setPayMethod('BANK');
    setPayReference('');
  };

  const submitPay = async () => {
    if (!payingSlip || payAmount === '' || Number(payAmount) <= 0) return;
    setIsSubmitting(true);
    try {
      await paySalarySlip(payingSlip.id, {
        amount: Number(payAmount),
        method: payMethod,
        reference: payReference || undefined,
      });
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
        net: t.net + payableOf(s),
        paid: t.paid + paid,
      };
    },
    { base: 0, ded: 0, allow: 0, tax: 0, other: 0, net: 0, paid: 0 }
  );

  const kpis: KpiItem[] = useMemo(() => {
    const approvedRuns = runs.filter((r) => (r.status as string) === 'APPROVED' || (r.status as string) === 'PAID' || (r.status as string) === 'PARTIALLY_PAID').length;
    return [
      {
        category: 'FINANCIAL RUNS',
        title: 'Total Generated',
        value: runs.length,
        icon: History,
        subtitle: 'All periods logged',
        tone: 'default',
      },
      {
        category: 'TOTAL OUTLAY',
        title: 'Gross Net Disbursed',
        value: formatPKR(runsTotal),
        icon: Banknote,
        subtitle: 'Cumulative payroll cycles',
        tone: 'success',
      },
      {
        category: 'APPROVAL COMPLIANCE',
        title: 'Approved Runs',
        value: approvedRuns,
        icon: CheckCircle2,
        subtitle: `${runs.length - approvedRuns} pending approval`,
        tone: 'info',
      },
      {
        category: 'ACTIVE SELECTION',
        title: 'Selected Run Detail',
        value: detail ? `${detail.staffCount} Slips` : 'None Selected',
        icon: Wallet,
        subtitle: detail ? periodLabel(detail.periodStart, detail.periodEnd) : 'Click run to inspect',
        tone: detail ? 'warning' : 'default',
      },
    ];
  }, [runs, runsTotal, detail]);

  return (
    <div className="space-y-4">
      {/* KPI Header */}
      <HospitalKpiHeader items={kpis} columns="grid-cols-2 lg:grid-cols-4" />

      {/* Runs list */}
      {loadError ? (
        <div className="bg-white rounded-xl border border-rose-200 p-6 text-center text-xs text-rose-700 shadow-2xs">
          {loadError}{' '}
          <button type="button" onClick={loadRuns} className="font-semibold text-[#08775A] hover:underline cursor-pointer">
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-xl border border-[#e2eae5] p-12 flex items-center justify-center gap-2 text-[#52665e] shadow-2xs">
          <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
          <span className="text-xs">Loading payroll runs from database…</span>
        </div>
      ) : (
        <TableSection
          icon={History}
          title="Historical Payroll Runs"
          note={`${runs.length} run${runs.length === 1 ? '' : 's'}`}
          actions={
            <button
              onClick={loadRuns}
              className="p-1 hover:bg-white/10 rounded text-[#effaf5] hover:text-white transition-colors cursor-pointer"
              title="Refresh"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          }
          head={
            <>
              <th className={TH}>Period</th>
              <th className={TH}>Type</th>
              <th className={TH}>Department / Category</th>
              <th className={`${TH} text-center`}>Staff Count</th>
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
                <td className={TD} colSpan={5} />
                <td className={`${TD} ${AMT} text-sm text-[#08775A]`}>{formatPKR(runsTotal)}</td>
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
              const isEven = i % 2 === 0;
              return (
                <tr
                  key={r.id}
                  className={`transition-colors cursor-pointer border-b border-[#e2eae5] ${
                    active ? 'bg-[#effaf5]' : isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                  } hover:bg-[#e7f6f1]/40`}
                  onClick={() => setSelectedRunId(r.id)}
                >
                  <td className={TD_NUM}>{i + 1}</td>
                  <td className={`${TD} font-semibold font-mono text-[#123e2b]`}>{periodLabel(r.periodStart, r.periodEnd)}</td>
                  <td className={TD}>{r.periodType}</td>
                  <td className={`${TD} text-[#52665e]`}>{[r.department?.name, r.category].filter(Boolean).join(' · ') || 'All Departments'}</td>
                  <td className={`${TD} text-center font-mono font-bold text-[#08775A]`}>{r.staffCount}</td>
                  <td className={`${TD} text-[#52665e]`}>{r.generatedByUser?.username || 'System'}</td>
                  <td className={TD}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className={`${TD} ${AMT} text-sm text-[#123e2b]`}>{formatPKR(Number(r.totalAmount))}</td>
                  <td className={`${TD} text-center`}>
                    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${active ? 'text-[#08775A]' : 'text-[#52665e]'}`}>
                      {active ? 'Viewing' : 'Inspect'} <ChevronRight className="h-3.5 w-3.5" />
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
            title={`Salary Slips Registry — ${periodLabel(detail.periodStart, detail.periodEnd)}`}
            note={`${detail.periodType} · ${detail.lines.length} Slips`}
            actions={
              detail.status === 'GENERATED' ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-[#08775A] bg-white hover:bg-[#effaf5] rounded-md cursor-pointer transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve Run
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-[#c2e7db]" /> Approved Run
                </span>
              )
            }
            head={
              <>
                <th className={TH}>Staff Member</th>
                <th className={TH}>Emp ID</th>
                <th className={`${TH} text-right`}>Base Salary</th>
                <th className={`${TH} text-right`}>Att. Ded.</th>
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
                  <td className={TD} colSpan={1} />
                  <td className={`${TD} ${AMT}`}>{formatPKR(slipTotals.base)}</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(slipTotals.ded)})</td>
                  <td className={`${TD} ${AMT}`}>{formatPKR(slipTotals.allow)}</td>
                  <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(slipTotals.tax)})</td>
                  <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(slipTotals.other)})</td>
                  <td className={`${TD} ${AMT} text-sm text-[#08775A]`}>{formatPKR(slipTotals.net)}</td>
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
                const balance = payableOf(slip) - paid;
                const canPay = slip.status === 'APPROVED' || slip.status === 'PARTIALLY_PAID';
                const isEven = i % 2 === 0;
                return (
                  <tr key={slip.id} className={`transition-colors border-b border-[#e2eae5] ${isEven ? 'bg-white' : 'bg-[#fbfdfc]'} hover:bg-[#e7f6f1]/40`}>
                    <td className={TD_NUM}>{i + 1}</td>
                    <td className={`${TD} font-semibold text-[#123e2b]`}>
                      {slip.staff.fullName}
                      {!!slip.correctionEntries?.length && (
                        <details className="text-[10px] font-normal text-[#52665e] mt-0.5">
                          <summary className="cursor-pointer text-[#08775A]">
                            Adjustments: {formatPKR(Number(slip.balance?.adjustments ?? 0))}
                          </summary>
                          {slip.correctionEntries.map((c) => (
                            <div key={c.id}>
                              {formatPKR(Number(c.amount))} · {c.reason} · {c.createdAt.slice(0, 10)}
                            </div>
                          ))}
                        </details>
                      )}
                      {Number(slip.balance?.overpaid ?? 0) > 0 && (
                        <div className="text-[10px] text-rose-700 font-bold">
                          Recoverable: {formatPKR(Number(slip.balance?.overpaid))}
                        </div>
                      )}
                    </td>
                    <td className={`${TD} font-mono font-bold text-[#08775A]`}>{slip.staff.employeeId}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(slip.baseAmount))}</td>
                    <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(slip.attendanceDeductions))})</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(Number(slip.allowances))}</td>
                    <td className={`${TD} ${AMT} text-amber-700`}>({formatPKR(Number(slip.componentBreakdown?.tax ?? 0))})</td>
                    <td className={`${TD} ${AMT} text-rose-700`}>({formatPKR(Number(slip.otherDeductions))})</td>
                    <td className={`${TD} ${AMT} text-sm text-[#08775A]`}>{formatPKR(payableOf(slip))}</td>
                    <td className={`${TD} ${AMT}`}>{formatPKR(paid)}</td>
                    <td className={`${TD} ${AMT} ${balance > 0 ? 'text-rose-700' : 'text-[#52665e]'}`}>{formatPKR(balance)}</td>
                    <td className={TD}>
                      <StatusBadge status={slip.status} />
                    </td>
                    <td className={`${TD} text-center`}>
                      {['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(slip.status) && (
                        <button
                          onClick={() => setAdjustingSlip(slip)}
                          className="mr-2 text-xs font-semibold text-[#08775A] hover:underline cursor-pointer"
                        >
                          Adjust
                        </button>
                      )}
                      {canPay ? (
                        <button
                          type="button"
                          onClick={() => openPay(slip)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer transition-colors shadow-2xs"
                        >
                          <Banknote className="h-3.5 w-3.5" /> Pay
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">{slip.status === 'PAID' ? 'Settled' : 'Approve run first'}</span>
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

      {adjustingSlip && (
        <FinancialAdjustmentModal
          title={`Salary correction · ${adjustingSlip.staff.fullName}`}
          onClose={() => setAdjustingSlip(null)}
          onSave={async (amount, reason) => {
            await adjustSalarySlip(adjustingSlip.id, amount, reason);
            if (selectedRunId) setDetail(await getPayrollRun(selectedRunId));
            await loadRuns();
          }}
        />
      )}

      {payingSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-[#e2eae5] overflow-hidden">
            <div className="bg-[#0e5944] text-white px-5 py-3">
              <h3 className="font-bold text-sm">Record Salary Payment</h3>
              <p className="text-xs text-[#effaf5]">
                {payingSlip.staff.fullName} ({payingSlip.staff.employeeId})
              </p>
            </div>
            <table className="w-full text-xs border-b border-[#e2eae5]">
              <tbody>
                <tr className="border-b border-[#e2eae5]">
                  <td className="py-2 px-5 text-[#52665e]">Net Payable</td>
                  <td className="py-2 px-5 text-right font-mono font-bold text-[#123e2b]">
                    {formatPKR(payableOf(payingSlip))}
                  </td>
                </tr>
                <tr className="border-b border-[#e2eae5]">
                  <td className="py-2 px-5 text-[#52665e]">Already Paid</td>
                  <td className="py-2 px-5 text-right font-mono font-bold text-[#123e2b]">
                    {formatPKR(paidOf(payingSlip))}
                  </td>
                </tr>
                <tr className="bg-[#effaf5]/50">
                  <td className="py-2 px-5 font-bold text-[#123e2b]">Balance Outstanding</td>
                  <td className="py-2 px-5 text-right font-mono font-bold text-rose-700">
                    {formatPKR(payableOf(payingSlip) - paidOf(payingSlip))}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="p-5 space-y-3.5">
              <PreferredPaymentAccount staffId={payingSlip.staffId} purpose="Salary" onMethod={setPayMethod} />
              <TextInput
                label="Amount (PKR)"
                type="number"
                min={0}
                onWheel={(e) => e.currentTarget.blur()}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <Select
                label="Payment Method"
                options={[
                  { value: 'BANK', label: 'Bank Transfer' },
                  { value: 'CASH', label: 'Cash Disbursement' },
                  { value: 'CARD', label: 'Debit / Corporate Card' },
                  { value: 'ONLINE', label: 'Online Gateway' },
                ]}
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              />
              <TextInput
                label="Reference / Cheque No. (Optional)"
                type="text"
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
              />
              <div className="flex justify-end gap-2 pt-3 border-t border-[#e2eae5]">
                <button
                  type="button"
                  onClick={() => setPayingSlip(null)}
                  className="px-3.5 py-2 text-xs font-medium text-[#52665e] border border-[#c2e7db] hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={submitPay}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
                >
                  {isSubmitting ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
