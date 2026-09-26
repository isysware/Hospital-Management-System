import React, { useEffect, useState } from 'react';
import { LayoutDashboard, ClipboardList, Users, Bed, ArrowLeftRight, Clock, Boxes, AlertCircle, ShieldCheck, Eye, Loader2 } from 'lucide-react';
import { GenericReportView } from '../../components/reports/GenericReportView';
import { Modal } from '../../components/common/Modal';
import { formatPKR } from '../../utils/formatters';
import {
  fetchAdmissionDailySummary,
  fetchAdmissionRegister,
  fetchInpatientCensus,
  fetchBedOccupancy,
  fetchBedTransferHistory,
  fetchLengthOfStay,
  fetchServiceConsumption,
  fetchInpatientOutstanding,
  fetchDischargeClearance,
  fetchRunningHospitalBill,
  AdmissionRegisterRow,
  CensusRow,
  BedOccupancyRow,
  BedTransferRow,
  LengthOfStayRow,
  ServiceConsumptionRow,
  InpatientOutstandingRow,
  DischargeClearanceRow,
  fetchAdmissionFilterOptions,
  AdmissionFilterOptions,
} from '../../services/admissionReportsService';
import { useReportFilters, useFilterOptions, FilterSelect, opts } from '../../components/reports/reportFilters';

/** Reporting Guide v7.5 §5.1 — daily operational snapshot of inpatient activity. */
export const AdmissionDailySummaryView: React.FC = () => (
  <GenericReportView<{ metric: string; value: string }>
    title="Admission Daily Summary"
    subtitle="Daily operational snapshot of inpatient activity and discharge readiness."
    icon={LayoutDashboard}
    filenamePrefix="Admission_Daily_Summary"
    fetchReport={fetchAdmissionDailySummary}
    rowKey={(r) => r.metric}
    columns={[
      { header: 'Metric', cell: (r) => r.metric },
      { header: 'Value', align: 'right', cell: (r) => r.value },
    ]}
  />
);

// ── Shared Admission filter-row sources (reporting.md §3) ────────────────
const EMPTY_ADMISSION_OPTIONS: AdmissionFilterOptions = { departments: [], doctors: [], wards: [] };
export const useAdmissionOptions = () => useFilterOptions(fetchAdmissionFilterOptions, EMPTY_ADMISSION_OPTIONS);

export const ADMISSION_STATUS_OPTS = opts(
  ['PLANNED', 'Planned'],
  ['CONFIRMED', 'Confirmed'],
  ['ACTIVE', 'Active'],
  ['DISCHARGE_PENDING', 'Discharge Pending'],
  ['DISCHARGED', 'Discharged'],
  ['CANCELLED', 'Cancelled'],
);

/** Read-only drill-down: one admission's running Hospital bill (Pharmacy bill is a separate stream). */
export const RunningBillModal: React.FC<{ target: { id: string; number: string } | null; onClose: () => void }> = ({ target, onClose }) => {
  const [bill, setBill] = useState<Awaited<ReturnType<typeof fetchRunningHospitalBill>> | null>(null);
  const [isBillLoading, setIsBillLoading] = useState(false);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setIsBillLoading(true);
    setBill(null);
    fetchRunningHospitalBill(target.id)
      .then((b) => {
        if (alive) setBill(b);
      })
      .catch(() => {
        if (alive) setBill(null);
      })
      .finally(() => {
        if (alive) setIsBillLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [target]);

  return (
      <Modal
        isOpen={!!target}
        onClose={onClose}
        title={target ? `Running Hospital Bill — ${target.number}` : ''}
        subtitle="Hospital-side charges only (Room/Bed, services, procedures, diagnostics) — Pharmacy Bill is a separate stream."
        maxWidth="2xl"
      >
        {isBillLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-xs">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : bill ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 font-medium block">Hospital Subtotal</span>
                <span className="text-sm font-bold text-slate-900 font-mono">{formatPKR(bill.summary.hospitalSubtotal)}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 font-medium block">Discount</span>
                <span className="text-sm font-bold text-rose-700 font-mono">{formatPKR(bill.summary.hospitalDiscount)}</span>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                <span className="text-[10px] text-emerald-700 font-medium block">Payments Received</span>
                <span className="text-sm font-bold text-emerald-800 font-mono">{formatPKR(bill.summary.hospitalPaymentsReceived)}</span>
              </div>
              <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                <span className="text-[10px] text-amber-700 font-medium block">Outstanding</span>
                <span className="text-sm font-bold text-amber-800 font-mono">{formatPKR(bill.summary.hospitalOutstanding)}</span>
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2 px-3 font-semibold">Date</th>
                    <th className="py-2 px-3 font-semibold">Charge Ref</th>
                    <th className="py-2 px-3 font-semibold">Service</th>
                    <th className="py-2 px-3 font-semibold text-right">Qty</th>
                    <th className="py-2 px-3 font-semibold text-right">Net</th>
                    <th className="py-2 px-3 font-semibold text-right">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bill.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        No Hospital charges posted yet.
                      </td>
                    </tr>
                  ) : (
                    bill.rows.map((r: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 px-3 text-slate-500">{r.occurredAt}</td>
                        <td className="py-2 px-3 font-mono text-emerald-800">{r.chargeRef}</td>
                        <td className="py-2 px-3">{r.service}</td>
                        <td className="py-2 px-3 text-right font-mono">{r.qty}</td>
                        <td className="py-2 px-3 text-right font-mono font-semibold">{formatPKR(r.net)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{formatPKR(r.runningBalance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-rose-600">Failed to load running bill.</div>
        )}
      </Modal>
  );
};

/** reporting.md §3 #2 — master admission register. Each row drills into its Running Hospital Bill. */
export const AdmissionRegisterReportView: React.FC = () => {
  const options = useAdmissionOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', doctorStaffId: '', wardId: '', payerType: '', status: '' });
  const [billTarget, setBillTarget] = useState<{ id: string; number: string } | null>(null);
  const openBill = (id: string, number: string) => setBillTarget({ id, number });

  return (
    <>
      <GenericReportView<AdmissionRegisterRow>
        title="Admission Register"
        subtitle="Every admission with payer, department, doctor, ward/bed, admit and discharge times."
        icon={ClipboardList}
        filenamePrefix="Admission_Register"
        fetchReport={(range) => fetchAdmissionRegister(range, filters)}
        onResetExtraFilters={reset}
        extraFilters={
          <>
            <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
            <FilterSelect label="Doctor" options={options.doctors} {...bind('doctorStaffId')} />
            <FilterSelect label="Ward" options={options.wards} {...bind('wardId')} />
            <FilterSelect label="Panel / Self-Pay" options={opts(['SELF_PAY', 'Self-Pay'], ['PANEL', 'Panel'])} {...bind('payerType')} />
            <FilterSelect label="Admission Status" options={ADMISSION_STATUS_OPTS} {...bind('status')} />
          </>
        }
        rowKey={(r, i) => `${r.admissionNumber}-${i}`}
        columns={[
          { header: 'Admission #', cell: (r) => r.admissionNumber },
          { header: 'Patient', cell: (r) => r.patient },
          { header: 'Payer', cell: (r) => r.payer },
          { header: 'Doctor', cell: (r) => r.doctor || '—' },
          { header: 'Department', cell: (r) => r.department },
          { header: 'Ward', cell: (r) => r.ward || '—' },
          { header: 'Bed', cell: (r) => r.bed || '—' },
          { header: 'Admitted', cell: (r) => r.admittedAt || '—' },
          { header: 'Discharged', cell: (r) => r.dischargedAt || '—' },
          { header: 'Status', cell: (r) => r.status },
          { header: 'Created By', cell: (r) => r.createdBy || '—' },
          { header: 'Action', cell: () => 'View' },
        ]}
        renderCell={(col, row) =>
          col.header === 'Action' ? (
            <button
              type="button"
              onClick={() => openBill(row.id, row.admissionNumber)}
              className="inline-flex items-center gap-1 px-3 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded text-xs font-medium shadow-2xs transition-colors"
              title="View running Hospital bill"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>View</span>
            </button>
          ) : (
            col.cell(row)
          )
        }
      />

      <RunningBillModal target={billTarget} onClose={() => setBillTarget(null)} />
    </>
  );
};

/** Reporting Guide v7.5 §5.3 — point-in-time census for active inpatients. */
export const InpatientCensusReportView: React.FC = () => (
  <GenericReportView<CensusRow>
    title="Inpatient Census"
    subtitle="Point-in-time census with ward/bed and financial attention indicators."
    icon={Users}
    filenamePrefix="Inpatient_Census"
    noDateFilter
    fetchReport={() => fetchInpatientCensus()}
    rowKey={(r) => r.admissionNumber}
    columns={[
      { header: 'Admission #', cell: (r) => r.admissionNumber },
      { header: 'Patient', cell: (r) => r.patient },
      { header: 'Doctor', cell: (r) => r.doctor || '—' },
      { header: 'Department', cell: (r) => r.department },
      { header: 'Ward', cell: (r) => r.ward || '—' },
      { header: 'Bed', cell: (r) => r.bed || '—' },
      { header: 'Admitted', cell: (r) => r.admittedAt },
      { header: 'Hospital Due', align: 'right', cell: (r) => formatPKR(r.hospitalDue), excelValue: (r) => r.hospitalDue },
      { header: 'Pharmacy Clearance', cell: (r) => r.pharmacyClearance },
      { header: 'Discharge Ready', cell: (r) => (r.dischargeReady ? 'Yes' : 'No') },
    ]}
  />
);

/** Reporting Guide v7.5 §5.4 — occupancy by ward. */
export const BedOccupancyReportView: React.FC = () => (
  <GenericReportView<BedOccupancyRow>
    title="Bed Occupancy / Ward Utilization"
    subtitle="Current occupancy and availability by ward."
    icon={Bed}
    filenamePrefix="Bed_Occupancy"
    noDateFilter
    fetchReport={() => fetchBedOccupancy()}
    rowKey={(r) => r.ward}
    columns={[
      { header: 'Ward', cell: (r) => r.ward },
      { header: 'Capacity', align: 'right', cell: (r) => String(r.capacity), excelValue: (r) => r.capacity },
      { header: 'Occupied', align: 'right', cell: (r) => String(r.occupied), excelValue: (r) => r.occupied },
      { header: 'Available', align: 'right', cell: (r) => String(r.available), excelValue: (r) => r.available },
      { header: 'Occupancy %', align: 'right', cell: (r) => `${r.occupancyPercent}%`, excelValue: (r) => r.occupancyPercent },
    ]}
  />
);

/** Reporting Guide v7.5 §5.5 — complete movement history for inpatient location changes. */
export const BedTransferHistoryReportView: React.FC = () => (
  <GenericReportView<BedTransferRow>
    title="Bed / Ward / Room Transfer History"
    subtitle="Complete, immutable movement history for inpatient location changes."
    icon={ArrowLeftRight}
    filenamePrefix="Bed_Transfer_History"
    fetchReport={fetchBedTransferHistory}
    rowKey={(r, i) => `${r.admissionNumber}-${i}`}
    columns={[
      { header: 'Admission #', cell: (r) => r.admissionNumber },
      { header: 'Patient', cell: (r) => r.patient },
      { header: 'From', cell: (r) => `${r.fromWard || '—'} / ${r.fromBed || '—'}` },
      { header: 'To', cell: (r) => `${r.toWard || '—'} / ${r.toBed}` },
      { header: 'Date/Time', cell: (r) => r.transferredAt },
      { header: 'Reason', cell: (r) => r.reason || '—' },
      { header: 'Changed By', cell: (r) => r.changedBy },
    ]}
  />
);

/** Reporting Guide v7.5 §5.6 — inpatient duration for active and discharged cases. */
export const LengthOfStayReportView: React.FC = () => (
  <GenericReportView<LengthOfStayRow>
    title="Length of Stay Report"
    subtitle="Inpatient duration for active and discharged cases."
    icon={Clock}
    filenamePrefix="Length_Of_Stay"
    fetchReport={fetchLengthOfStay}
    rowKey={(r, i) => `${r.admissionNumber}-${i}`}
    columns={[
      { header: 'Admission #', cell: (r) => r.admissionNumber },
      { header: 'Patient', cell: (r) => r.patient },
      { header: 'Department', cell: (r) => r.department },
      { header: 'Admitted', cell: (r) => r.admittedAt },
      { header: 'Discharged', cell: (r) => r.dischargedAt || '—' },
      { header: 'LOS (days)', align: 'right', cell: (r) => String(r.lengthOfStayDays), excelValue: (r) => r.lengthOfStayDays },
      { header: 'Status', cell: (r) => r.status },
    ]}
  />
);

/** Reporting Guide v7.5 §5.14 — department/ward/service consumption analysis. */
export const ServiceConsumptionReportView: React.FC = () => (
  <GenericReportView<ServiceConsumptionRow>
    title="Admission Service Consumption"
    subtitle="Department/ward/service analysis of hospital-side inpatient resource consumption."
    icon={Boxes}
    filenamePrefix="Service_Consumption"
    fetchReport={fetchServiceConsumption}
    rowKey={(r, i) => `${r.department}-${r.service}-${i}`}
    columns={[
      { header: 'Department', cell: (r) => r.department },
      { header: 'Service', cell: (r) => r.service },
      { header: 'Qty', align: 'right', cell: (r) => String(r.qty), excelValue: (r) => r.qty },
      { header: 'Gross', align: 'right', cell: (r) => formatPKR(r.gross), excelValue: (r) => r.gross },
      { header: 'Discount', align: 'right', cell: (r) => formatPKR(r.discount), excelValue: (r) => r.discount },
      { header: 'Net', align: 'right', cell: (r) => formatPKR(r.net), excelValue: (r) => r.net },
      { header: 'Admissions', align: 'right', cell: (r) => String(r.admissionCount), excelValue: (r) => r.admissionCount },
    ]}
  />
);

/** Reporting Guide v7.5 §5.15 — active/discharged admissions with Hospital balances still outstanding. */
export const InpatientOutstandingReportView: React.FC = () => (
  <GenericReportView<InpatientOutstandingRow>
    title="Inpatient Outstanding Balance"
    subtitle="Active/discharged admissions with Hospital balances still outstanding (never includes standalone Pharmacy due)."
    icon={AlertCircle}
    filenamePrefix="Inpatient_Outstanding"
    fetchReport={fetchInpatientOutstanding}
    rowKey={(r, i) => `${r.admissionNumber}-${i}`}
    columns={[
      { header: 'Admission #', cell: (r) => r.admissionNumber },
      { header: 'Patient', cell: (r) => r.patient },
      { header: 'Hospital Net', align: 'right', cell: (r) => formatPKR(r.hospitalNet), excelValue: (r) => r.hospitalNet },
      { header: 'Hospital Paid', align: 'right', cell: (r) => formatPKR(r.hospitalPaid), excelValue: (r) => r.hospitalPaid },
      { header: 'Hospital Outstanding', align: 'right', cell: (r) => formatPKR(r.hospitalOutstanding), excelValue: (r) => r.hospitalOutstanding },
      { header: 'Admission Status', cell: (r) => r.admissionStatus },
    ]}
  />
);

const CLEARANCE_OPTS = opts(['PENDING', 'Pending'], ['CLEARED', 'Cleared'], ['NOT_APPLICABLE', 'Not Applicable']);
const BALANCE_LABEL: Record<DischargeClearanceRow['balanceStatus'], string> = { SETTLED: 'Settled', CREDIT: 'Credit', OUTSTANDING: 'Outstanding' };

/** reporting.md §3 #7 — discharge readiness. Hospital and Pharmacy clearance always shown as two separate states. */
export const DischargeClearanceReportView: React.FC = () => {
  const options = useAdmissionOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', doctorStaffId: '', clinicalStatus: '', hospitalClearance: '', pharmacyClearance: '' });
  return (
    <GenericReportView<DischargeClearanceRow>
      title="Discharge Clearance Report"
      subtitle="Clinical, Hospital and Pharmacy clearance for discharge — Hospital and Pharmacy bills stay separate."
      icon={ShieldCheck}
      filenamePrefix="Discharge_Clearance_Report"
      fetchReport={(range) => fetchDischargeClearance(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Doctor" options={options.doctors} {...bind('doctorStaffId')} />
          <FilterSelect label="Clinical Status" options={opts(['READY', 'Clinically Ready'], ['NOT_READY', 'Not Ready'])} {...bind('clinicalStatus')} />
          <FilterSelect label="Hospital Clearance" options={CLEARANCE_OPTS} {...bind('hospitalClearance')} />
          <FilterSelect label="Pharmacy Clearance" options={CLEARANCE_OPTS} {...bind('pharmacyClearance')} />
        </>
      }
      rowKey={(r, i) => `${r.admissionNumber}-${i}`}
      columns={[
        { header: 'Admission #', cell: (r) => r.admissionNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Department', cell: (r) => r.department },
        { header: 'Doctor', cell: (r) => r.doctor || '—' },
        { header: 'Clinical Ready', cell: (r) => (r.clinicalReady ? 'Yes' : 'No') },
        { header: 'Hospital Clearance', cell: (r) => r.hospitalClearance },
        { header: 'Pharmacy Clearance', cell: (r) => r.pharmacyClearance },
        { header: 'Hospital Due', align: 'right', cell: (r) => formatPKR(r.hospitalDue), excelValue: (r) => r.hospitalDue },
        { header: 'Balance', cell: (r) => BALANCE_LABEL[r.balanceStatus] },
        { header: 'Discharge Date', cell: (r) => r.dischargeDate || '—' },
        { header: 'Completed By', cell: (r) => r.completedBy || '—' },
      ]}
    />
  );
};
