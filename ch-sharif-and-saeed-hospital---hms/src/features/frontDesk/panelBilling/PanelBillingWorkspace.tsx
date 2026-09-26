import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Eye, FileText, History, Loader2, AlertCircle, RefreshCw, RotateCcw, ShieldCheck, TrendingUp, Wallet } from 'lucide-react';
import { Select, TextInput } from '../../../components/forms/FormControls';
import { formatPKR, formatDateDDMMYYYY } from '../../../utils/formatters';
import { useAuth } from '../../../context/AuthContext';
import { fetchCorporatePanels, CorporatePanel } from '../../../services/panelService';
import {
  fetchPanelStatement,
  fetchPanelRemittances,
  fetchPanelLedger,
  PanelStatement,
  PanelStatementInvoiceRow,
  PanelRemittanceRecord,
  PanelLedger,
} from '../../../services/panelBillingService';
import { downloadTablePDF, downloadTableExcel, downloadTableCSV, printTable, ExportColumn } from '../../../services/tableExportService';
import { ExportButtonGroup } from '../../superAdmin/financeControl/ExportButtonGroup';
import { InvoiceDetailModal } from '../billing/InvoiceDetailModal';
import { PanelVerificationPanel } from './PanelVerificationPanel';
import { RecordPanelRemittanceModal } from './RecordPanelRemittanceModal';

type Tab = 'invoices' | 'ledger' | 'remittances' | 'contract';
type StatusFilter = 'all' | 'company_due' | 'patient_due' | 'settled';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All Invoices' },
  { value: 'company_due', label: 'Company Payment Due' },
  { value: 'patient_due', label: 'Patient Share Due' },
  { value: 'settled', label: 'Fully Settled' },
];

const SOURCE_LABEL: Record<string, string> = { WALK_IN: 'Walk-In', APPOINTMENT: 'Appointment', ADMISSION: 'Admission' };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', BANK_TRANSFER: 'Bank Transfer', CHEQUE: 'Cheque', ONLINE: 'Online' };

// Same bordered-grid look as the reporting tables.
const TH = 'py-3 px-3.5 border-r border-slate-300 last:border-r-0 whitespace-nowrap';
const TD = 'py-2.5 px-3.5 border-r border-slate-200 last:border-r-0 whitespace-nowrap text-slate-800';
const TD_NUM = 'py-2.5 px-3 text-center border-r border-slate-200 text-slate-500 text-xs bg-slate-50/60 w-12';
const AMT = 'text-right tabular-nums';
const ROW = 'hover:bg-slate-50/90 transition-colors border-b border-slate-200 last:border-b-0';

const isoDay = (iso: string) => (iso ? iso.slice(0, 10) : '');

function rowStatus(r: PanelStatementInvoiceRow) {
  const companyDue = r.panelReceivableOutstanding > 0;
  const patientDue = r.patientShareOutstanding > 0;
  if (!companyDue && !patientDue) return { label: 'Settled', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (companyDue && patientDue) return { label: 'Both Due', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (companyDue) return { label: 'Company Due', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
  return { label: 'Patient Due', cls: 'bg-purple-50 text-purple-700 border-purple-200' };
}

/** Green title banner + bordered table, the same pattern as the Front Desk reports. */
const TableSection: React.FC<{
  icon: React.ElementType;
  title: string;
  note?: string;
  toolbar?: React.ReactNode;
  head: React.ReactNode;
  foot?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, title, note, toolbar, head, foot, children }) => (
  <div className="space-y-3">
    <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-4 py-2.5 rounded-lg flex items-center justify-between gap-3 shadow-xs">
      <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide">
        <div className="h-6 w-6 rounded bg-white/15 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span>{title}</span>
      </div>
      {note && <span className="text-xs text-emerald-100 font-medium bg-white/10 px-2.5 py-0.5 rounded-md">{note}</span>}
    </div>
    {toolbar}
    <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)]">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="bg-[#f1f5f9] border-b border-slate-300 sticky top-0 z-10 text-slate-800 text-xs font-bold uppercase tracking-wider">
              <th className={`${TH} w-12 text-center`}>#</th>
              {head}
            </tr>
          </thead>
          <tbody className="text-slate-700">{children}</tbody>
          {foot && (
            <tfoot>
              <tr className="bg-[#f1f5f9] border-t-2 border-slate-300 font-bold text-slate-900 sticky bottom-0">{foot}</tr>
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

const TotalLabel = () => <td className="py-3 px-3 text-center border-r border-slate-300 text-[11px] uppercase tracking-wider text-slate-600">Total</td>;

const StateBox: React.FC<{ loading?: boolean; error?: string | null; onRetry?: () => void; message?: string }> = ({ loading, error, onRetry, message }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-10 flex flex-col items-center justify-center gap-2 text-slate-400 shadow-xs text-center">
    {loading ? (
      <>
        <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
        <span className="text-xs">{message ?? 'Loading…'}</span>
      </>
    ) : (
      <>
        <AlertCircle className="h-6 w-6 text-rose-500" />
        <p className="text-xs text-rose-700 font-medium">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="text-xs font-semibold text-[#08775A] hover:underline">
            Retry
          </button>
        )}
      </>
    )}
  </div>
);

interface PanelBillingWorkspaceProps {
  title: string;
  subtitle: string;
}

/**
 * Panel Billing — one workspace for Front Desk and Super Admin/Admin. Every
 * figure comes from the panel statement, where the PATIENT's share and the
 * COMPANY's share are kept apart: patient cash never counts as company
 * payment, and company remittances never reduce what the patient owes.
 */
export const PanelBillingWorkspace: React.FC<PanelBillingWorkspaceProps> = ({ title, subtitle }) => {
  const { currentUser } = useAuth();
  const [panels, setPanels] = useState<CorporatePanel[]>([]);
  const [panelsError, setPanelsError] = useState<string | null>(null);
  const [isPanelsLoading, setIsPanelsLoading] = useState(true);
  const [panelId, setPanelId] = useState('');
  const [tab, setTab] = useState<Tab>('invoices');

  // Filters (applied instantly to the loaded statement)
  const [status, setStatus] = useState<StatusFilter>('all');
  const [department, setDepartment] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  const [statement, setStatement] = useState<PanelStatement | null>(null);
  const [ledger, setLedger] = useState<PanelLedger | null>(null);
  const [remittances, setRemittances] = useState<PanelRemittanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [isRecordOpen, setIsRecordOpen] = useState(false);

  const loadPanels = useCallback(async () => {
    setIsPanelsLoading(true);
    setPanelsError(null);
    try {
      const active = (await fetchCorporatePanels()).filter((p) => p.status === 'Active');
      setPanels(active);
      setPanelId((prev) => (prev && active.some((p) => p.id === prev) ? prev : active[0]?.id ?? ''));
    } catch (err: any) {
      setPanelsError(err?.message || 'Failed to load corporate panels.');
    } finally {
      setIsPanelsLoading(false);
    }
  }, []);

  const loadPanelData = useCallback(async (id: string) => {
    if (!id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [s, l, r] = await Promise.all([fetchPanelStatement(id), fetchPanelLedger(id), fetchPanelRemittances(id)]);
      setStatement(s);
      setLedger(l);
      setRemittances(r);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load panel billing data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPanels();
  }, [loadPanels]);

  useEffect(() => {
    setDepartment('');
    loadPanelData(panelId);
  }, [panelId, loadPanelData]);

  const panel = panels.find((p) => p.id === panelId) ?? null;
  const allRows = statement?.invoices ?? [];
  const departments = useMemo(() => Array.from(new Set(allRows.map((r) => r.departmentName))).sort(), [allRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (status === 'company_due' && r.panelReceivableOutstanding <= 0) return false;
      if (status === 'patient_due' && r.patientShareOutstanding <= 0) return false;
      if (status === 'settled' && (r.panelReceivableOutstanding > 0 || r.patientShareOutstanding > 0)) return false;
      if (department && r.departmentName !== department) return false;
      const day = isoDay(r.createdAt);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (q && ![r.invoiceNumber, r.patientName, r.patientMrNumber, r.panelMemberId ?? ''].some((v) => v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allRows, status, department, fromDate, toDate, search]);

  const sum = (key: keyof PanelStatementInvoiceRow) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
  const totals = {
    total: sum('total'),
    patientShare: sum('patientShare'),
    patientPaid: sum('patientShareCollected'),
    patientDue: sum('patientShareOutstanding'),
    company: sum('panelReceivable'),
    companyPaid: sum('panelReceivableRealized'),
    companyDue: sum('panelReceivableOutstanding'),
  };

  const hasFilters = status !== 'all' || !!department || !!fromDate || !!toDate || !!search.trim();
  const resetFilters = () => {
    setStatus('all');
    setDepartment('');
    setFromDate('');
    setToDate('');
    setSearch('');
  };

  const exportColumns: ExportColumn<PanelStatementInvoiceRow>[] = [
    { header: 'Date', cell: (r) => formatDateDDMMYYYY(r.createdAt) },
    { header: 'Invoice #', cell: (r) => r.invoiceNumber },
    { header: 'Patient', cell: (r) => `${r.patientName} (${r.patientMrNumber})` },
    { header: 'Member ID', cell: (r) => r.panelMemberId || '—' },
    { header: 'Department', cell: (r) => r.departmentName },
    { header: 'Total Bill', align: 'right', cell: (r) => formatPKR(r.total), excelValue: (r) => r.total },
    { header: 'Patient Share', align: 'right', cell: (r) => formatPKR(r.patientShare), excelValue: (r) => r.patientShare },
    { header: 'Patient Paid', align: 'right', cell: (r) => formatPKR(r.patientShareCollected), excelValue: (r) => r.patientShareCollected },
    { header: 'Patient Due', align: 'right', cell: (r) => formatPKR(r.patientShareOutstanding), excelValue: (r) => r.patientShareOutstanding },
    { header: 'Company Share', align: 'right', cell: (r) => formatPKR(r.panelReceivable), excelValue: (r) => r.panelReceivable },
    { header: 'Company Paid', align: 'right', cell: (r) => formatPKR(r.panelReceivableRealized), excelValue: (r) => r.panelReceivableRealized },
    { header: 'Company Due', align: 'right', cell: (r) => formatPKR(r.panelReceivableOutstanding), excelValue: (r) => r.panelReceivableOutstanding },
    { header: 'Status', cell: (r) => rowStatus(r).label },
  ];
  const exportContext = {
    documentTitle: `Panel Invoices — ${panel?.name ?? ''}`,
    documentSubtitle: 'Patient share and company share shown separately',
    filenamePrefix: `Panel_Billing_${panel?.code ?? 'Company'}`,
    columns: exportColumns,
    rows,
    currentUser,
    periodLabel: fromDate || toDate ? `${fromDate || '…'} to ${toDate || '…'}` : 'All dates',
    filters: [
      `Company: ${panel?.name ?? ''}`,
      `Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`,
      `Department: ${department || 'All'}`,
    ],
  };

  const outstandingForRemittance = useMemo(() => allRows.filter((r) => r.panelReceivableOutstanding > 0), [allRows]);
  const ledgerEntries = ledger?.entries ?? [];
  const remittanceTotal = remittances.reduce((s, r) => s + r.amount, 0);

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
      active ? 'bg-[#08775A] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-4 animate-in fade-in duration-150 font-montserrat">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-[#e7f6f1] text-[#08775A] flex items-center justify-center">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadPanelData(panelId)}
            disabled={!panelId || isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {panel && (
            <button
              type="button"
              onClick={() => setIsRecordOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              <Wallet className="h-3.5 w-3.5" /> Record Company Payment
            </button>
          )}
        </div>
      </div>

      {panelsError ? (
        <StateBox error={panelsError} onRetry={loadPanels} />
      ) : isPanelsLoading ? (
        <StateBox loading message="Loading corporate panels…" />
      ) : panels.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          No active corporate panels. Add one from Panel Management → Corporate Panels first.
        </div>
      ) : (
        <>
          {/* Filter bar — one landscape row */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_minmax(0,1.2fr)_auto] items-end gap-3">
            <div className="min-w-0 col-span-2 md:col-span-1">
              <Select label="Corporate Panel" options={panels.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} value={panelId} onChange={(e) => setPanelId(e.target.value)} />
            </div>
            <div className="min-w-0">
              <Select label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} />
            </div>
            <div className="min-w-0">
              <Select label="Department" options={[{ value: '', label: 'All Departments' }, ...departments.map((d) => ({ value: d, label: d }))]} value={department} onChange={(e) => setDepartment(e.target.value)} />
            </div>
            <div className="min-w-0">
              <TextInput label="From" lang="en-GB" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="min-w-0">
              <TextInput label="To" lang="en-GB" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="min-w-0">
              <TextInput label="Search" placeholder="Patient, MR#, Member ID, Invoice#" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={resetFilters}
                disabled={!hasFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium disabled:opacity-40 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>
          </div>

          {loadError ? (
            <StateBox error={loadError} onRetry={() => loadPanelData(panelId)} />
          ) : isLoading && !statement ? (
            <StateBox loading message="Loading panel billing…" />
          ) : (
            <>
              {/* Account summary (follows the filters above) */}
              <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-300 flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Account Summary — {panel?.name}</h2>
                  <span className="text-xs text-slate-500">
                    {rows.length} of {allRows.length} invoice{allRows.length === 1 ? '' : 's'}
                    {panel?.billingTerms ? ` · Terms: ${panel.billingTerms}` : ''}
                    {panel?.creditLimit ? ` · Credit limit: ${formatPKR(panel.creditLimit)}` : ''}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#f1f5f9] border-b border-slate-300 text-xs font-bold uppercase tracking-wider text-slate-700">
                        <th className={TH}>Account</th>
                        <th className={`${TH} text-right`}>Billed</th>
                        <th className={`${TH} text-right`}>Received</th>
                        <th className={`${TH} text-right`}>Outstanding</th>
                        <th className={TH}>Collected Through</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={ROW}>
                        <td className={`${TD} font-semibold`}>Company Share (Receivable)</td>
                        <td className={`${TD} ${AMT} font-semibold`}>{formatPKR(totals.company)}</td>
                        <td className={`${TD} ${AMT} font-semibold text-emerald-700`}>{formatPKR(totals.companyPaid)}</td>
                        <td className={`${TD} ${AMT} font-bold text-[15px] ${totals.companyDue > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatPKR(totals.companyDue)}</td>
                        <td className={`${TD} text-slate-500`}>Company remittances only</td>
                      </tr>
                      <tr className={ROW}>
                        <td className={`${TD} font-semibold`}>Patient Share (Co-Pay)</td>
                        <td className={`${TD} ${AMT} font-semibold`}>{formatPKR(totals.patientShare)}</td>
                        <td className={`${TD} ${AMT} font-semibold text-emerald-700`}>{formatPKR(totals.patientPaid)}</td>
                        <td className={`${TD} ${AMT} font-bold text-[15px] ${totals.patientDue > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatPKR(totals.patientDue)}</td>
                        <td className={`${TD} text-slate-500`}>Front Desk patient receipts</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tabs */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs flex-wrap">
                <button type="button" onClick={() => setTab('invoices')} className={tabClass(tab === 'invoices')}>
                  <FileText className="h-3.5 w-3.5" /> Invoices ({rows.length})
                </button>
                <button type="button" onClick={() => setTab('ledger')} className={tabClass(tab === 'ledger')}>
                  <TrendingUp className="h-3.5 w-3.5" /> Company Ledger
                </button>
                <button type="button" onClick={() => setTab('remittances')} className={tabClass(tab === 'remittances')}>
                  <History className="h-3.5 w-3.5" /> Company Payments ({remittances.length})
                </button>
                <button type="button" onClick={() => setTab('contract')} className={tabClass(tab === 'contract')}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Contract Check
                </button>
              </div>

              {tab === 'invoices' && (
                <TableSection
                  icon={FileText}
                  title={`Panel Invoices — ${panel?.name ?? ''}`}
                  note={`${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
                  toolbar={
                    <div className="flex justify-end">
                      <ExportButtonGroup
                        disabled={rows.length === 0}
                        onExcel={() => downloadTableExcel(exportContext)}
                        onCsv={() => downloadTableCSV(exportContext)}
                        onPdf={() => downloadTablePDF(exportContext)}
                        onPrint={() => printTable(exportContext)}
                      />
                    </div>
                  }
                  head={
                    <>
                      <th className={TH}>Date</th>
                      <th className={TH}>Invoice #</th>
                      <th className={TH}>Patient</th>
                      <th className={TH}>Source / Department</th>
                      <th className={`${TH} text-right`}>Total Bill</th>
                      <th className={`${TH} text-right bg-purple-50/60`}>Patient Share</th>
                      <th className={`${TH} text-right bg-purple-50/60`}>Patient Paid</th>
                      <th className={`${TH} text-right bg-purple-50/60`}>Patient Due</th>
                      <th className={`${TH} text-right bg-amber-50/60`}>Company Share</th>
                      <th className={`${TH} text-right bg-amber-50/60`}>Company Paid</th>
                      <th className={`${TH} text-right bg-amber-50/60`}>Company Due</th>
                      <th className={`${TH} text-center`}>Status</th>
                      <th className={`${TH} text-center`}>Action</th>
                    </>
                  }
                  foot={
                    rows.length > 0 ? (
                      <>
                        <TotalLabel />
                        <td className={TD} colSpan={4} />
                        <td className={`${TD} ${AMT}`}>{formatPKR(totals.total)}</td>
                        <td className={`${TD} ${AMT}`}>{formatPKR(totals.patientShare)}</td>
                        <td className={`${TD} ${AMT} text-emerald-700`}>{formatPKR(totals.patientPaid)}</td>
                        <td className={`${TD} ${AMT} text-rose-700`}>{formatPKR(totals.patientDue)}</td>
                        <td className={`${TD} ${AMT}`}>{formatPKR(totals.company)}</td>
                        <td className={`${TD} ${AMT} text-emerald-700`}>{formatPKR(totals.companyPaid)}</td>
                        <td className={`${TD} ${AMT} text-rose-700`}>{formatPKR(totals.companyDue)}</td>
                        <td className={TD} colSpan={2} />
                      </>
                    ) : undefined
                  }
                >
                  {rows.length === 0 ? (
                    <EmptyRow colSpan={14}>{hasFilters ? 'No invoices match these filters.' : 'No panel invoices for this company yet.'}</EmptyRow>
                  ) : (
                    rows.map((r, i) => {
                      const st = rowStatus(r);
                      return (
                        <tr key={r.hospitalInvoiceId} className={ROW}>
                          <td className={TD_NUM}>{i + 1}</td>
                          <td className={`${TD} text-slate-600`}>{formatDateDDMMYYYY(r.createdAt)}</td>
                          <td className={TD}>
                            <button type="button" onClick={() => setSelectedInvoiceId(r.hospitalInvoiceId)} className="font-semibold text-[#08775A] hover:underline cursor-pointer">
                              {r.invoiceNumber}
                            </button>
                          </td>
                          <td className={TD}>
                            <div className="font-semibold text-slate-900">{r.patientName}</div>
                            <div className="text-[11px] text-slate-500">
                              MR {r.patientMrNumber}
                              {r.panelMemberId ? ` · Member ${r.panelMemberId}` : ''}
                            </div>
                          </td>
                          <td className={TD}>
                            <div>{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</div>
                            <div className="text-[11px] text-slate-500">{r.departmentName}</div>
                          </td>
                          <td className={`${TD} ${AMT} font-semibold`}>{formatPKR(r.total)}</td>
                          <td className={`${TD} ${AMT}`}>{formatPKR(r.patientShare)}</td>
                          <td className={`${TD} ${AMT} text-emerald-700`}>{formatPKR(r.patientShareCollected)}</td>
                          <td className={`${TD} ${AMT} font-semibold ${r.patientShareOutstanding > 0 ? 'text-rose-700' : 'text-slate-400'}`}>{formatPKR(r.patientShareOutstanding)}</td>
                          <td className={`${TD} ${AMT}`}>{formatPKR(r.panelReceivable)}</td>
                          <td className={`${TD} ${AMT} text-emerald-700`}>{formatPKR(r.panelReceivableRealized)}</td>
                          <td className={`${TD} ${AMT} font-semibold ${r.panelReceivableOutstanding > 0 ? 'text-rose-700' : 'text-slate-400'}`}>{formatPKR(r.panelReceivableOutstanding)}</td>
                          <td className={`${TD} text-center`}>
                            <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className={`${TD} text-center`}>
                            <button
                              type="button"
                              onClick={() => setSelectedInvoiceId(r.hospitalInvoiceId)}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded-md text-xs font-semibold cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" /> View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </TableSection>
              )}

              {tab === 'ledger' && (
                <TableSection
                  icon={TrendingUp}
                  title={`Company Ledger — ${panel?.name ?? ''}`}
                  note="Company share only · patient co-pay is not in this balance"
                  head={
                    <>
                      <th className={TH}>Date</th>
                      <th className={TH}>Reference</th>
                      <th className={TH}>Type</th>
                      <th className={TH}>Patient</th>
                      <th className={TH}>Details</th>
                      <th className={`${TH} text-right`}>Charged (Dr)</th>
                      <th className={`${TH} text-right`}>Received (Cr)</th>
                      <th className={`${TH} text-right`}>Balance</th>
                    </>
                  }
                  foot={
                    ledgerEntries.length > 0 && ledger ? (
                      <>
                        <TotalLabel />
                        <td className={TD} colSpan={5} />
                        <td className={`${TD} ${AMT}`}>{formatPKR(ledger.totals.totalDebit)}</td>
                        <td className={`${TD} ${AMT} text-emerald-700`}>{formatPKR(ledger.totals.totalCredit)}</td>
                        <td className={`${TD} ${AMT} text-[15px] ${ledger.totals.closingBalance > 0 ? 'text-rose-700' : ''}`}>{formatPKR(ledger.totals.closingBalance)}</td>
                      </>
                    ) : undefined
                  }
                >
                  {ledgerEntries.length === 0 ? (
                    <EmptyRow colSpan={9}>No company charges or payments yet.</EmptyRow>
                  ) : (
                    ledgerEntries.map((e, i) => (
                      <tr key={`${e.reference}-${i}`} className={ROW}>
                        <td className={TD_NUM}>{i + 1}</td>
                        <td className={`${TD} text-slate-600`}>{formatDateDDMMYYYY(e.date)}</td>
                        <td className={`${TD} font-semibold text-[#08775A]`}>{e.reference}</td>
                        <td className={TD}>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                              e.type === 'CHARGE' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {e.type === 'CHARGE' ? 'Charge' : 'Payment'}
                          </span>
                        </td>
                        <td className={TD}>{e.patientName ?? '—'}</td>
                        <td className={`${TD} text-slate-500`}>{e.description}</td>
                        <td className={`${TD} ${AMT}`}>{e.debit ? formatPKR(e.debit) : '—'}</td>
                        <td className={`${TD} ${AMT} text-emerald-700`}>{e.credit ? formatPKR(e.credit) : '—'}</td>
                        <td className={`${TD} ${AMT} font-semibold`}>{formatPKR(e.runningBalance)}</td>
                      </tr>
                    ))
                  )}
                </TableSection>
              )}

              {tab === 'remittances' && (
                <TableSection
                  icon={History}
                  title={`Company Payments — ${panel?.name ?? ''}`}
                  note={`${remittances.length} payment${remittances.length === 1 ? '' : 's'}`}
                  head={
                    <>
                      <th className={TH}>Received On</th>
                      <th className={TH}>Payment #</th>
                      <th className={TH}>Method</th>
                      <th className={TH}>Reference</th>
                      <th className={TH}>Applied To</th>
                      <th className={TH}>Recorded By</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </>
                  }
                  foot={
                    remittances.length > 0 ? (
                      <>
                        <TotalLabel />
                        <td className={TD} colSpan={6} />
                        <td className={`${TD} ${AMT} text-[15px] text-emerald-700`}>{formatPKR(remittanceTotal)}</td>
                      </>
                    ) : undefined
                  }
                >
                  {remittances.length === 0 ? (
                    <EmptyRow colSpan={8}>No company payments recorded yet.</EmptyRow>
                  ) : (
                    remittances.map((r, i) => (
                      <tr key={r.id} className={ROW}>
                        <td className={TD_NUM}>{i + 1}</td>
                        <td className={`${TD} text-slate-600`}>{formatDateDDMMYYYY(r.receivedAt)}</td>
                        <td className={`${TD} font-semibold text-[#08775A]`}>{r.remittanceNumber}</td>
                        <td className={TD}>{METHOD_LABEL[r.method] ?? r.method}</td>
                        <td className={`${TD} text-slate-500`}>{r.reference || '—'}</td>
                        <td className={`${TD} text-xs text-slate-600 whitespace-normal min-w-56`}>
                          {r.allocations.map((a) => `${a.invoiceNumber} (${formatPKR(a.allocatedAmount)})`).join(', ') || '—'}
                        </td>
                        <td className={`${TD} text-slate-500`}>{r.receivedByName}</td>
                        <td className={`${TD} ${AMT} font-bold text-emerald-700`}>{formatPKR(r.amount)}</td>
                      </tr>
                    ))
                  )}
                </TableSection>
              )}

              {tab === 'contract' && panel && (
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                  <PanelVerificationPanel panel={panel} />
                </div>
              )}
            </>
          )}
        </>
      )}

      {isRecordOpen && panel && (
        <RecordPanelRemittanceModal
          corporatePanelId={panel.id}
          corporatePanelName={panel.name}
          outstandingInvoices={outstandingForRemittance}
          onClose={() => setIsRecordOpen(false)}
          onRecorded={() => {
            setIsRecordOpen(false);
            loadPanelData(panel.id);
          }}
        />
      )}

      {selectedInvoiceId && (
        <InvoiceDetailModal invoiceId={selectedInvoiceId} onClose={() => setSelectedInvoiceId(null)} onChanged={() => loadPanelData(panelId)} />
      )}
    </div>
  );
};
