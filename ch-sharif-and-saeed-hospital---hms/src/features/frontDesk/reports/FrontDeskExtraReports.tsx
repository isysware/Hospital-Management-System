import React, { useState } from 'react';
import { ClipboardList, FileSpreadsheet, Wallet, AlertCircle, Tag, Building2, CreditCard, Eye, Loader2, Landmark, Printer, Users, FileText } from 'lucide-react';
import { GenericReportView } from '../../../components/reports/GenericReportView';
import { Modal } from '../../../components/common/Modal';
import { TextInput } from '../../../components/forms/FormControls';
import { formatPKR } from '../../../utils/formatters';
import { InvoiceDetailModal } from '../billing/InvoiceDetailModal';
import {
  fetchEncounterRegister,
  fetchInvoiceRegister,
  fetchCollectionReport,
  fetchOutstandingInvoices,
  fetchFinancialExceptions,
  fetchDepartmentRevenue,
  fetchAdmissionPaymentCollections,
  fetchInvoiceLedger,
  fetchPanelPayerReport,
  fetchReceiptExceptionLog,
  fetchCashierPerformance,
  fetchFrontDeskFilterOptions,
  EncounterRow,
  InvoiceRow,
  CollectionRow,
  OutstandingRow,
  FinancialExceptionRow,
  DepartmentRevenueRow,
  AdmissionPaymentCollectionRow,
  LedgerEntry,
  PanelPayerRow,
  ReceiptExceptionRow,
  CashierPerformanceRow,
  FrontDeskFilterOptions,
} from '../../../services/frontdeskReportsService';
import { useReportFilters, useFilterOptions, FilterSelect, opts } from '../../../components/reports/reportFilters';

const EMPTY_OPTIONS: FrontDeskFilterOptions = { departments: [], doctors: [], cashiers: [], panels: [] };
const useFdOptions = () => useFilterOptions(fetchFrontDeskFilterOptions, EMPTY_OPTIONS);

const PAYMENT_STATUS = opts(['UNPAID', 'Unpaid'], ['PARTIALLY_PAID', 'Partially Paid'], ['PAID', 'Paid'], ['VOID', 'Void']);
const PAYER_TYPE = opts(['SELF_PAY', 'Self-Pay'], ['PANEL', 'Panel']);
const PAYMENT_METHOD = opts(['CASH', 'Cash'], ['CARD', 'Card / POS'], ['BANK', 'Bank Transfer'], ['ONLINE', 'Online']);

/** reporting.md §2 #2 — OPD / Observation / Emergency encounters. */
export const EncounterRegisterView: React.FC = () => {
  const options = useFdOptions();
  const { filters, bind, reset } = useReportFilters({ encounterType: '', departmentId: '', doctorStaffId: '', status: '' });
  return (
    <GenericReportView<EncounterRow>
      title="Encounter Register"
      subtitle="OPD, Observation and Emergency encounters with department, doctor and status."
      icon={ClipboardList}
      filenamePrefix="Encounter_Register"
      fetchReport={(range) => fetchEncounterRegister(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Encounter Service" options={opts(['OPD', 'OPD'], ['OBSERVATION', 'Observation'], ['EMERGENCY', 'Emergency'])} {...bind('encounterType')} />
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Doctor" options={options.doctors} {...bind('doctorStaffId')} />
          <FilterSelect label="Status" options={PAYMENT_STATUS} {...bind('status')} />
        </>
      }
      rowKey={(r, i) => `${r.invoiceNumber}-${i}`}
      columns={[
        { header: 'Encounter #', cell: (r) => r.invoiceNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Service', cell: (r) => r.encounterType || r.visitType },
        { header: 'Payer', cell: (r) => r.payer },
        { header: 'Department', cell: (r) => r.department || '—' },
        { header: 'Doctor', cell: (r) => r.doctor || '—' },
        { header: 'Date/Time', cell: (r) => r.occurredAt },
        { header: 'Status', cell: (r) => r.status },
        { header: 'Created By', cell: (r) => r.createdBy || '—' },
      ]}
    />
  );
};

/** Reporting Guide v7.5 §3.3 — primary billing register across all Hospital-side invoices. Each row drills into its §3.5 Patient/Invoice Ledger. */
export const InvoiceRegisterView: React.FC = () => {
  const options = useFdOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', status: '', payerType: '' });
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<{ id: string; number: string } | null>(null);
  const [ledger, setLedger] = useState<{ invoiceNumber: string; patient: string; entries: LedgerEntry[] } | null>(null);
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const openLedger = async (id: string, number: string) => {
    setLedgerTarget({ id, number });
    setIsLedgerLoading(true);
    try {
      setLedger(await fetchInvoiceLedger(id));
    } catch {
      setLedger(null);
    } finally {
      setIsLedgerLoading(false);
    }
  };

  return (
    <>
      <GenericReportView<InvoiceRow>
        key={refreshKey}
        title="Invoice Register"
        subtitle="Every Hospital-side invoice — visit billing and Admission Hospital bills."
        icon={FileSpreadsheet}
        filenamePrefix="Invoice_Register"
        fetchReport={(range) => fetchInvoiceRegister(range, filters)}
        onResetExtraFilters={reset}
        extraFilters={
          <>
            <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
            <FilterSelect label="Payment Status" options={PAYMENT_STATUS} {...bind('status')} />
            <FilterSelect label="Panel / Self-Pay" options={PAYER_TYPE} {...bind('payerType')} />
          </>
        }
        rowKey={(r) => r.invoiceNumber}
        columns={[
          { header: 'Invoice #', cell: (r) => r.invoiceNumber },
          { header: 'Date', cell: (r) => r.createdAt },
          { header: 'Patient', cell: (r) => r.patient },
          { header: 'Source', cell: (r) => r.sourceType },
          { header: 'Department', cell: (r) => r.department || '—' },
          { header: 'Gross', align: 'right', cell: (r) => formatPKR(r.gross), excelValue: (r) => r.gross },
          { header: 'Discount', align: 'right', cell: (r) => formatPKR(r.discount), excelValue: (r) => r.discount },
          { header: 'Net', align: 'right', cell: (r) => formatPKR(r.net), excelValue: (r) => r.net },
          { header: 'Paid', align: 'right', cell: (r) => formatPKR(r.paid), excelValue: (r) => r.paid },
          { header: 'Balance', align: 'right', cell: (r) => formatPKR(r.balance), excelValue: (r) => r.balance },
          { header: 'Status', cell: (r) => r.status },
          { header: 'Created By', cell: (r) => r.createdBy || '—' },
          { header: 'Actions', cell: () => 'View' },
        ]}
        renderCell={(col, row) => {
          if (col.header === 'Actions' || col.header === 'Ledger') {
            return (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceId(row.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded text-xs font-semibold shadow-2xs transition-colors"
                  title="Open and view invoice bill details, line items, and receipts"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>View</span>
                </button>
                <button
                  type="button"
                  onClick={() => openLedger(row.id, row.invoiceNumber)}
                  className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium transition-colors"
                  title="View debit/credit ledger log"
                >
                  <FileText className="h-3 w-3 text-slate-500" />
                  <span>Ledger</span>
                </button>
              </div>
            );
          }
          if (col.header === 'Invoice #') {
            return (
              <button
                type="button"
                onClick={() => setSelectedInvoiceId(row.id)}
                className="font-bold text-[#08775A] hover:underline hover:text-[#065f46] transition-colors cursor-pointer text-left"
                title="Click to open invoice bill"
              >
                {row.invoiceNumber}
              </button>
            );
          }
          if (col.header === 'Status') {
            const st = (row.status || '').toUpperCase();
            if (st === 'PAID') {
              return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  PAID
                </span>
              );
            }
            if (st === 'PARTIALLY_PAID') {
              return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  PARTIALLY PAID
                </span>
              );
            }
            if (st === 'UNPAID') {
              return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                  UNPAID
                </span>
              );
            }
            return <span className="text-xs font-medium text-slate-600">{row.status}</span>;
          }
          return col.cell(row);
        }}
      />

      <Modal
        isOpen={!!ledgerTarget}
        onClose={() => {
          setLedgerTarget(null);
          setLedger(null);
        }}
        title={ledgerTarget ? `Invoice Ledger — ${ledgerTarget.number}` : ''}
        subtitle="Append/reversal-based transaction log — charges, payments and running balance."
        maxWidth="2xl"
      >
        {isLedgerLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-xs">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : ledger ? (
          <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-2 px-3 font-semibold">Date</th>
                  <th className="py-2 px-3 font-semibold">Reference</th>
                  <th className="py-2 px-3 font-semibold">Type</th>
                  <th className="py-2 px-3 font-semibold">Description</th>
                  <th className="py-2 px-3 font-semibold text-right">Debit</th>
                  <th className="py-2 px-3 font-semibold text-right">Credit</th>
                  <th className="py-2 px-3 font-semibold text-right">Balance</th>
                  <th className="py-2 px-3 font-semibold">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.entries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      No entries yet.
                    </td>
                  </tr>
                ) : (
                  ledger.entries.map((e, i) => (
                    <tr key={i}>
                      <td className="py-2 px-3 text-slate-500">{e.occurredAt}</td>
                      <td className="py-2 px-3 font-mono text-emerald-800">{e.reference}</td>
                      <td className="py-2 px-3">{e.type}</td>
                      <td className="py-2 px-3">{e.description}</td>
                      <td className="py-2 px-3 text-right font-mono">{e.debit > 0 ? formatPKR(e.debit) : '—'}</td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-700">{e.credit > 0 ? formatPKR(e.credit) : '—'}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{formatPKR(e.runningBalance)}</td>
                      <td className="py-2 px-3">{e.performedBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-rose-600">Failed to load ledger.</div>
        )}
      </Modal>

      {/* Full Hospital Invoice Modal with services, rates, receipts, payments & print */}
      {selectedInvoiceId && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onChanged={() => {
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
};


/** reporting.md §2 #4 — every receipt with method and collector. */
export const CollectionReportViewPage: React.FC = () => {
  const options = useFdOptions();
  const { filters, bind, reset } = useReportFilters({ method: '', receiptStatus: '', collectedById: '' });
  return (
    <GenericReportView<CollectionRow>
      title="Collection & Receipt Report"
      subtitle="Every payment receipt, including Admission partial payments. Card/Online show here but are never counted as physical cash."
      icon={Wallet}
      filenamePrefix="Collection_Report"
      fetchReport={(range) => fetchCollectionReport(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Payment Method" options={PAYMENT_METHOD} {...bind('method')} />
          <FilterSelect label="Receipt Status" options={opts(['ACTIVE', 'Active'], ['REVERSED', 'Reversed / Voided'])} {...bind('receiptStatus')} />
          <FilterSelect label="Cashier" options={options.cashiers} {...bind('collectedById')} />
        </>
      }
      rowKey={(r) => r.receiptNumber}
      columns={[
        { header: 'Receipt #', cell: (r) => r.receiptNumber },
        { header: 'Invoice / Admission #', cell: (r) => r.reference },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Amount', align: 'right', cell: (r) => formatPKR(r.amount), excelValue: (r) => r.amount },
        { header: 'Method', cell: (r) => r.method },
        { header: 'Date/Time', cell: (r) => r.occurredAt },
        { header: 'Collected By', cell: (r) => r.collectedBy },
        { header: 'Status', cell: (r) => (r.status === 'REVERSED' ? 'Reversed' : 'Active') },
      ]}
    />
  );
};

/** reporting.md §2 #5 — open receivables (unpaid + partially paid). */
export const OutstandingInvoicesView: React.FC = () => {
  const options = useFdOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', status: '', payerType: '' });
  return (
    <GenericReportView<OutstandingRow>
      title="Outstanding / Partial Invoices"
      subtitle="Unpaid and partially paid invoices for follow-up."
      icon={AlertCircle}
      filenamePrefix="Outstanding_Invoices"
      fetchReport={(range) => fetchOutstandingInvoices(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Status" options={opts(['UNPAID', 'Unpaid'], ['PARTIALLY_PAID', 'Partially Paid'])} {...bind('status')} />
          <FilterSelect label="Panel / Self-Pay" options={PAYER_TYPE} {...bind('payerType')} />
        </>
      }
      rowKey={(r) => r.invoiceNumber}
      columns={[
        { header: 'Invoice #', cell: (r) => r.invoiceNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Payer', cell: (r) => r.payer },
        { header: 'Department', cell: (r) => r.department || '—' },
        { header: 'Net', align: 'right', cell: (r) => formatPKR(r.net), excelValue: (r) => r.net },
        { header: 'Paid', align: 'right', cell: (r) => formatPKR(r.paid), excelValue: (r) => r.paid },
        { header: 'Outstanding', align: 'right', cell: (r) => formatPKR(r.outstanding), excelValue: (r) => r.outstanding },
        { header: 'Last Payment', cell: (r) => r.lastPaymentAt || '—' },
        { header: 'Status', cell: (r) => (r.status === 'PARTIALLY_PAID' ? 'Partially Paid' : 'Unpaid') },
      ]}
    />
  );
};

const EXCEPTION_BADGE: Record<FinancialExceptionRow['type'], string> = {
  DISCOUNT: 'bg-amber-100 text-amber-800 border-amber-300',
  REFUND: 'bg-rose-100 text-rose-800 border-rose-300',
  VOID: 'bg-slate-200 text-slate-800 border-slate-300',
};

/** reporting.md §2 #7 — ONE combined Discounts / Refunds / Voids report with a Type filter (replaces the separate Discount and Refund/Void reports). */
export const FinancialExceptionsReportView: React.FC = () => {
  const options = useFdOptions();
  const { filters, bind, reset } = useReportFilters({ type: '', performedById: '' });
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  return (
    <>
      <GenericReportView<FinancialExceptionRow>
        title="Discounts / Refunds / Voids"
        subtitle="Every discount, refund and voided/reversed receipt in one place. Use Type to narrow it down."
        icon={Tag}
        filenamePrefix="Discounts_Refunds_Voids"
        fetchReport={(range) => fetchFinancialExceptions(range, filters)}
        onResetExtraFilters={reset}
        extraFilters={
          <>
            <FilterSelect label="Type" options={opts(['DISCOUNT', 'Discount'], ['REFUND', 'Refund'], ['VOID', 'Void / Reversal'])} {...bind('type')} />
            <FilterSelect label="Performed By" options={options.cashiers} {...bind('performedById')} />
          </>
        }
        rowKey={(r, i) => `${r.type}-${r.reference}-${i}`}
        columns={[
          { header: 'Type', cell: (r) => r.type },
          { header: 'Date/Time', cell: (r) => r.occurredAt },
          { header: 'Reference', cell: (r) => r.reference },
          { header: 'Invoice #', cell: (r) => r.invoiceNumber || '—' },
          { header: 'Patient / Panel', cell: (r) => r.patient || '—' },
          { header: 'Amount', align: 'right', cell: (r) => formatPKR(r.amount), excelValue: (r) => r.amount },
          { header: 'Reason', cell: (r) => r.reason || '—' },
          { header: 'Performed By', cell: (r) => r.performedBy },
          { header: 'Action', cell: () => '' },
        ]}
        renderCell={(col, row) => {
          if (col.header === 'Type') {
            return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${EXCEPTION_BADGE[row.type]}`}>{row.type}</span>;
          }
          if (col.header === 'Action') {
            return row.invoiceId ? (
              <button
                type="button"
                onClick={() => setSelectedInvoiceId(row.invoiceId)}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded text-xs font-semibold shadow-2xs transition-colors"
                title="View the invoice"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>View</span>
              </button>
            ) : (
              <span className="text-slate-400 text-xs">—</span>
            );
          }
          return col.cell(row);
        }}
      />

      {selectedInvoiceId && <InvoiceDetailModal invoiceId={selectedInvoiceId} onClose={() => setSelectedInvoiceId(null)} onChanged={() => {}} />}
    </>
  );
};

/** Reporting Guide v7.5 §4.4 — billing/collections by department and service. */
export const DepartmentRevenueReportView: React.FC = () => (
  <GenericReportView<DepartmentRevenueRow>
    title="Department / Service Revenue Report"
    subtitle="Billing and collections by department and service."
    icon={Building2}
    filenamePrefix="Department_Revenue"
    fetchReport={fetchDepartmentRevenue}
    rowKey={(r, i) => `${r.department}-${r.service}-${i}`}
    columns={[
      { header: 'Department', cell: (r) => r.department },
      { header: 'Service', cell: (r) => r.service },
      { header: 'Qty', align: 'right', cell: (r) => String(r.qty), excelValue: (r) => r.qty },
      { header: 'Gross', align: 'right', cell: (r) => formatPKR(r.gross), excelValue: (r) => r.gross },
      { header: 'Discount', align: 'right', cell: (r) => formatPKR(r.discount), excelValue: (r) => r.discount },
      { header: 'Net', align: 'right', cell: (r) => formatPKR(r.net), excelValue: (r) => r.net },
    ]}
  />
);


/** reporting.md §2 #6 — Hospital payments Front Desk collected against Admission payment requests. */
export const AdmissionPaymentCollectionsView: React.FC = () => {
  const options = useFdOptions();
  const { filters, bind, reset } = useReportFilters({ admissionNumber: '', departmentId: '', method: '', status: '' });
  return (
    <GenericReportView<AdmissionPaymentCollectionRow>
      title="Admission Payment Collections"
      subtitle="Hospital payments collected against Admission payment requests, with the Hospital due still remaining."
      icon={CreditCard}
      filenamePrefix="Admission_Payment_Collections"
      fetchReport={(range) => fetchAdmissionPaymentCollections(range, filters)}
      onResetExtraFilters={reset}
      noTotalColumns={['Hospital Due', 'Remaining Due']}
      extraFilters={
        <>
          <div className="w-40">
            <TextInput label="Admission No" placeholder="e.g. ADM-00012" {...bind('admissionNumber')} />
          </div>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Payment Method" options={PAYMENT_METHOD} {...bind('method')} />
          <FilterSelect
            label="Status"
            options={opts(['PENDING', 'Pending'], ['PARTIALLY_FULFILLED', 'Partially Paid'], ['FULFILLED', 'Paid'], ['CANCELLED', 'Cancelled'])}
            {...bind('status')}
          />
        </>
      }
      rowKey={(r, i) => `${r.admissionNumber}-${r.receiptNo || i}`}
      columns={[
        { header: 'Admission #', cell: (r) => r.admissionNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Department', cell: (r) => r.department || '—' },
        { header: 'Hospital Due', align: 'right', cell: (r) => formatPKR(r.requestedAmount), excelValue: (r) => r.requestedAmount },
        { header: 'Receipt #', cell: (r) => r.receiptNo || '—' },
        { header: 'Collected', align: 'right', cell: (r) => formatPKR(r.collectedAmount), excelValue: (r) => r.collectedAmount },
        { header: 'Method', cell: (r) => r.method || '—' },
        { header: 'Remaining Due', align: 'right', cell: (r) => formatPKR(r.remainingDue), excelValue: (r) => r.remainingDue },
        { header: 'Collected By', cell: (r) => r.collectedBy || '—' },
        { header: 'Status', cell: (r) => r.status },
      ]}
    />
  );
};

/** Reporting Guide v7.5 §9 menu — "Panel / Payer Reporting": billing/collections grouped by payer (Corporate Panel or Self-Pay). */
export const PanelPayerReportView: React.FC = () => (
  <GenericReportView<PanelPayerRow>
    title="Panel / Payer Reporting"
    subtitle="Billing and collections grouped by payer — each Corporate Panel plus Self-Pay."
    icon={Landmark}
    filenamePrefix="Panel_Payer_Report"
    fetchReport={fetchPanelPayerReport}
    rowKey={(r) => r.payer}
    columns={[
      { header: 'Payer', cell: (r) => r.payer },
      { header: 'Invoices', align: 'right', cell: (r) => String(r.invoiceCount), excelValue: (r) => r.invoiceCount },
      { header: 'Gross', align: 'right', cell: (r) => formatPKR(r.gross), excelValue: (r) => r.gross },
      { header: 'Discount', align: 'right', cell: (r) => formatPKR(r.discount), excelValue: (r) => r.discount },
      { header: 'Net', align: 'right', cell: (r) => formatPKR(r.net), excelValue: (r) => r.net },
      { header: 'Paid', align: 'right', cell: (r) => formatPKR(r.paid), excelValue: (r) => r.paid },
      { header: 'Outstanding', align: 'right', cell: (r) => formatPKR(r.outstanding), excelValue: (r) => r.outstanding },
    ]}
  />
);

/** Reporting Guide v7.5 §9 menu — "Receipt Reprint / Exception Log". Tracks whether a receipt was printed and any voided receipts — the schema has no per-reprint counter, so this stays honestly scoped to what's actually recorded. */
export const ReceiptExceptionLogView: React.FC = () => (
  <GenericReportView<ReceiptExceptionRow>
    title="Receipt Reprint / Exception Log"
    subtitle="Receipts that were printed, plus any voided receipts."
    icon={Printer}
    filenamePrefix="Receipt_Exception_Log"
    fetchReport={fetchReceiptExceptionLog}
    rowKey={(r) => r.receiptNumber}
    columns={[
      { header: 'Receipt #', cell: (r) => r.receiptNumber },
      { header: 'Invoice #', cell: (r) => r.invoiceNumber || '—' },
      { header: 'Amount', align: 'right', cell: (r) => formatPKR(r.amount), excelValue: (r) => r.amount },
      { header: 'Printed', cell: (r) => (r.printed ? 'Yes' : 'No') },
      { header: 'Voided', cell: (r) => (r.voided ? 'Yes' : 'No') },
      { header: 'Collected By', cell: (r) => r.collectedBy },
      { header: 'Date/Time', cell: (r) => r.occurredAt },
    ]}
  />
);

/** Reporting Guide v7.5 §9 menu — "User/Cashier Performance": per-cashier collection totals and activity. */
export const CashierPerformanceReportView: React.FC = () => (
  <GenericReportView<CashierPerformanceRow>
    title="User / Cashier Performance"
    subtitle="Per-cashier collection totals and transaction activity for the period."
    icon={Users}
    filenamePrefix="Cashier_Performance"
    fetchReport={fetchCashierPerformance}
    rowKey={(r) => r.cashier}
    columns={[
      { header: 'Cashier', cell: (r) => r.cashier },
      { header: 'Receipts', align: 'right', cell: (r) => String(r.receiptCount), excelValue: (r) => r.receiptCount },
      { header: 'Total Collected', align: 'right', cell: (r) => formatPKR(r.totalCollected), excelValue: (r) => r.totalCollected },
      { header: 'Average Transaction', align: 'right', cell: (r) => formatPKR(r.averageTransaction), excelValue: (r) => r.averageTransaction },
    ]}
  />
);
