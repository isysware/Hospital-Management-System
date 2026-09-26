import React, { useState } from 'react';
import { LineChart, Bed, ArrowLeftRight, Receipt, Pill, Eye } from 'lucide-react';
import { GenericReportView } from '../../components/reports/GenericReportView';
import { TextInput } from '../../components/forms/FormControls';
import { formatPKR } from '../../utils/formatters';
import { useReportFilters, FilterSelect, opts } from '../../components/reports/reportFilters';
import { useAdmissionOptions, ADMISSION_STATUS_OPTS, RunningBillModal } from './AdmissionExtraReports';
import {
  fetchAdmissionSummary,
  fetchCensusBeds,
  fetchTransferLos,
  fetchHospitalBillStatus,
  fetchPharmacyRequestFulfillment,
  AdmissionSummaryRow,
  CensusBedRow,
  TransferLosRow,
  HospitalBillStatusRow,
  PharmacyRequestFulfillmentRow,
} from '../../services/admissionReportsService';

/**
 * reporting.md §3 — the Admission reports that were combined/re-shaped for
 * the simplified 7-report menu. Register and Discharge Clearance live in
 * `AdmissionExtraReports.tsx`. Admission never collects cash: every money
 * column here is read-only Hospital billing status, never Pharmacy.
 */

const AdmissionNoInput: React.FC<{ value: string; onChange: React.ChangeEventHandler<HTMLInputElement> }> = (props) => (
  <div className="w-40">
    <TextInput label="Admission No" placeholder="e.g. ADM-26-0001" {...props} />
  </div>
);

const ViewButton: React.FC<{ onClick: () => void; title: string }> = ({ onClick, title }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded text-xs font-semibold shadow-2xs transition-colors"
    title={title}
  >
    <Eye className="h-3.5 w-3.5" />
    <span>View</span>
  </button>
);

/** #1 Admission Summary — the portal's only KPI-strip report; table breaks the period down by department. */
export const AdmissionSummaryView: React.FC<{ title?: string; subtitle?: string }> = ({
  title = 'Admission Summary',
  subtitle = 'Admissions, discharges, active patients, beds, pending discharge and Hospital outstanding for the period.',
}) => {
  const options = useAdmissionOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', wardId: '', doctorStaffId: '', status: '' });
  return (
    <GenericReportView<AdmissionSummaryRow>
      title={title}
      subtitle={subtitle}
      icon={LineChart}
      filenamePrefix="Admission_Summary"
      showKpis
      fetchReport={(range) => fetchAdmissionSummary(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Ward" options={options.wards} {...bind('wardId')} />
          <FilterSelect label="Doctor" options={options.doctors} {...bind('doctorStaffId')} />
          <FilterSelect label="Status" options={ADMISSION_STATUS_OPTS} {...bind('status')} />
        </>
      }
      rowKey={(r) => r.department}
      emptyMessage="No admissions match these filters."
      columns={[
        { header: 'Department', cell: (r) => r.department },
        { header: 'Admissions', align: 'right', cell: (r) => String(r.admissions), excelValue: (r) => r.admissions },
        { header: 'Discharges', align: 'right', cell: (r) => String(r.discharges), excelValue: (r) => r.discharges },
        { header: 'Active Patients', align: 'right', cell: (r) => String(r.active), excelValue: (r) => r.active },
        { header: 'Pending Discharge', align: 'right', cell: (r) => String(r.pendingDischarge), excelValue: (r) => r.pendingDischarge },
        { header: 'Hospital Outstanding', align: 'right', cell: (r) => formatPKR(r.hospitalOutstanding), excelValue: (r) => r.hospitalOutstanding },
      ]}
    />
  );
};

const BED_STATUS_LABEL: Record<string, string> = { OCCUPIED: 'Occupied', AVAILABLE: 'Available', RESERVED: 'Reserved', OUT_OF_SERVICE: 'Out of Service' };
const BED_STATUS_BADGE: Record<string, string> = {
  OCCUPIED: 'bg-rose-100 text-rose-800 border-rose-300',
  AVAILABLE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  RESERVED: 'bg-amber-100 text-amber-800 border-amber-300',
  OUT_OF_SERVICE: 'bg-slate-200 text-slate-700 border-slate-300',
};

/** #3 Inpatient Census / Bed — one combined screen: every bed, and who is in it as of the chosen date. */
export const CensusBedReportView: React.FC = () => {
  const options = useAdmissionOptions();
  const { filters, bind, reset } = useReportFilters({ asOf: '', departmentId: '', wardId: '', roomBed: '', bedStatus: '' });
  return (
    <GenericReportView<CensusBedRow>
      title="Inpatient Census / Bed Report"
      subtitle="Every bed with its status and the admitted patient in it. Leave As-of blank for right now."
      icon={Bed}
      filenamePrefix="Inpatient_Census_Beds"
      noDateFilter
      fetchReport={() => fetchCensusBeds(filters)}
      onResetExtraFilters={reset}
      noTotalColumns={['Hospital Due']}
      extraFilters={
        <>
          <div className="w-40">
            <TextInput label="As-of Date" type="date" lang="en-GB" {...bind('asOf')} />
          </div>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Ward" options={options.wards} {...bind('wardId')} />
          <div className="w-36">
            <TextInput label="Room / Bed" placeholder="e.g. Room-1" {...bind('roomBed')} />
          </div>
          <FilterSelect label="Bed Status" options={opts(['OCCUPIED', 'Occupied'], ['AVAILABLE', 'Available'], ['RESERVED', 'Reserved'], ['OUT_OF_SERVICE', 'Out of Service'])} {...bind('bedStatus')} />
        </>
      }
      rowKey={(r, i) => `${r.ward}-${r.room}-${r.bed}-${i}`}
      emptyMessage="No beds match these filters."
      columns={[
        { header: 'Ward', cell: (r) => r.ward },
        { header: 'Room', cell: (r) => r.room || '—' },
        { header: 'Bed', cell: (r) => r.bed },
        { header: 'Bed Status', cell: (r) => BED_STATUS_LABEL[r.bedStatus] || r.bedStatus },
        { header: 'Admission #', cell: (r) => r.admissionNumber || '—' },
        { header: 'Patient', cell: (r) => r.patient || '—' },
        { header: 'Department', cell: (r) => r.department || '—' },
        { header: 'Doctor', cell: (r) => r.doctor || '—' },
        { header: 'Admitted', cell: (r) => r.admittedAt || '—' },
        { header: 'Hospital Due', align: 'right', cell: (r) => (r.admissionNumber ? formatPKR(r.hospitalDue) : '—'), excelValue: (r) => r.hospitalDue },
      ]}
      renderCell={(col, row) =>
        col.header === 'Bed Status' ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${BED_STATUS_BADGE[row.bedStatus] || ''}`}>
            {BED_STATUS_LABEL[row.bedStatus] || row.bedStatus}
          </span>
        ) : (
          col.cell(row)
        )
      }
    />
  );
};

/** #4 Transfer / Length of Stay — one row per transfer; admissions never transferred show one row with their current bed. */
export const TransferLosReportView: React.FC = () => {
  const options = useAdmissionOptions();
  const { filters, bind, reset } = useReportFilters({ admissionNumber: '', departmentId: '', wardId: '', doctorStaffId: '' });
  return (
    <GenericReportView<TransferLosRow>
      title="Transfer / Length of Stay"
      subtitle="Ward/room/bed transfer history with admit/discharge times and length of stay (days)."
      icon={ArrowLeftRight}
      filenamePrefix="Transfer_Length_Of_Stay"
      fetchReport={(range) => fetchTransferLos(range, filters)}
      onResetExtraFilters={reset}
      noTotalColumns={['LOS (days)']}
      extraFilters={
        <>
          <AdmissionNoInput {...bind('admissionNumber')} />
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Ward" options={options.wards} {...bind('wardId')} />
          <FilterSelect label="Doctor" options={options.doctors} {...bind('doctorStaffId')} />
        </>
      }
      rowKey={(r, i) => `${r.admissionNumber}-${i}`}
      columns={[
        { header: 'Admission #', cell: (r) => r.admissionNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Department', cell: (r) => r.department },
        { header: 'Doctor', cell: (r) => r.doctor || '—' },
        { header: 'From (Ward / Room / Bed)', cell: (r) => r.from || (r.transferredAt ? '—' : 'No transfer') },
        { header: 'To (Ward / Room / Bed)', cell: (r) => r.to || '—' },
        { header: 'Transfer Time', cell: (r) => r.transferredAt || '—' },
        { header: 'Reason', cell: (r) => r.reason || '—' },
        { header: 'Admitted', cell: (r) => r.admittedAt || '—' },
        { header: 'Discharged', cell: (r) => r.dischargedAt || '—' },
        { header: 'LOS (days)', align: 'right', cell: (r) => r.losDays.toFixed(1), excelValue: (r) => r.losDays },
        { header: 'Status', cell: (r) => r.status },
      ]}
    />
  );
};

const PAYMENT_STATUS_LABEL: Record<string, string> = { PAID: 'Paid', PARTIALLY_PAID: 'Partially Paid', UNPAID: 'Unpaid', NO_CHARGES: 'No Charges' };

/** #5 Running Hospital Bill / Payment Status — read-only; View opens the itemised running bill. */
export const HospitalBillStatusReportView: React.FC = () => {
  const options = useAdmissionOptions();
  const { filters, bind, reset } = useReportFilters({ admissionNumber: '', departmentId: '', paymentStatus: '', clearanceStatus: '' });
  const [billTarget, setBillTarget] = useState<{ id: string; number: string } | null>(null);
  return (
    <>
      <GenericReportView<HospitalBillStatusRow>
        title="Running Hospital Bill / Payment Status"
        subtitle="Hospital charges, payments collected by Billing, outstanding and latest receipt — read-only. Pharmacy bill is separate."
        icon={Receipt}
        filenamePrefix="Hospital_Bill_Payment_Status"
        fetchReport={(range) => fetchHospitalBillStatus(range, filters)}
        onResetExtraFilters={reset}
        extraFilters={
          <>
            <AdmissionNoInput {...bind('admissionNumber')} />
            <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
            <FilterSelect label="Payment Status" options={opts(['UNPAID', 'Unpaid'], ['PARTIALLY_PAID', 'Partially Paid'], ['PAID', 'Paid'], ['NO_CHARGES', 'No Charges'])} {...bind('paymentStatus')} />
            <FilterSelect label="Hospital Clearance" options={opts(['PENDING', 'Pending'], ['CLEARED', 'Cleared'], ['NOT_APPLICABLE', 'Not Applicable'])} {...bind('clearanceStatus')} />
          </>
        }
        rowKey={(r) => r.id}
        columns={[
          { header: 'Admission #', cell: (r) => r.admissionNumber },
          { header: 'Patient', cell: (r) => r.patient },
          { header: 'Payer', cell: (r) => r.payer },
          { header: 'Department', cell: (r) => r.department },
          { header: 'Hospital Charges', align: 'right', cell: (r) => formatPKR(r.hospitalCharges), excelValue: (r) => r.hospitalCharges },
          { header: 'Payments Collected', align: 'right', cell: (r) => formatPKR(r.paymentsCollected), excelValue: (r) => r.paymentsCollected },
          { header: 'Outstanding', align: 'right', cell: (r) => formatPKR(r.hospitalOutstanding), excelValue: (r) => r.hospitalOutstanding },
          { header: 'Payment Status', cell: (r) => PAYMENT_STATUS_LABEL[r.paymentStatus] || r.paymentStatus },
          { header: 'Latest Receipt', cell: (r) => (r.latestReceipt ? `${r.latestReceipt} · ${r.latestReceiptAt}` : '—') },
          { header: 'Payment Request', cell: (r) => r.latestRequestStatus || '—' },
          { header: 'Hospital Clearance', cell: (r) => r.hospitalClearance },
          { header: 'Action', cell: () => 'View' },
        ]}
        renderCell={(col, row) =>
          col.header === 'Action' ? <ViewButton onClick={() => setBillTarget({ id: row.id, number: row.admissionNumber })} title="View running Hospital bill" /> : col.cell(row)
        }
      />
      <RunningBillModal target={billTarget} onClose={() => setBillTarget(null)} />
    </>
  );
};

const REQUEST_STATUS_OPTS = opts(
  ['REQUESTED', 'Requested'],
  ['ACCEPTED', 'Accepted'],
  ['PARTIALLY_FULFILLED', 'Partially Fulfilled'],
  ['DISPENSING', 'Dispensing'],
  ['DISPENSED', 'Dispensed'],
  ['INVOICED', 'Invoiced'],
  ['CLEARANCE_SENT', 'Clearance Sent'],
  ['REJECTED', 'Rejected'],
  ['AUTHORIZATION_REQUIRED', 'Authorization Required'],
  ['INTEGRATION_ERROR', 'Integration Error'],
);
const APPROVAL_LABEL: Record<string, string> = { NOT_REQUIRED: 'Not Required', PENDING: 'Pending', AUTHORIZED: 'Approved', REJECTED: 'Rejected' };

/** #6 Pharmacy Request & Fulfillment — one row per requested medicine. */
export const PharmacyRequestFulfillmentView: React.FC = () => {
  const { filters, bind, reset } = useReportFilters({ admissionNumber: '', medicine: '', status: '', approvalStatus: '' });
  return (
    <GenericReportView<PharmacyRequestFulfillmentRow>
      title="Pharmacy Request & Fulfillment"
      subtitle="Medicines requested for inpatients: requested vs dispensed, Pharmacy invoice/clearance and high-cost approval."
      icon={Pill}
      filenamePrefix="Pharmacy_Request_Fulfillment"
      fetchReport={(range) => fetchPharmacyRequestFulfillment(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <AdmissionNoInput {...bind('admissionNumber')} />
          <div className="w-40">
            <TextInput label="Medicine" placeholder="Medicine name" {...bind('medicine')} />
          </div>
          <FilterSelect label="Request Status" options={REQUEST_STATUS_OPTS} {...bind('status')} />
          <FilterSelect label="Approval Status" options={opts(['NOT_REQUIRED', 'Not Required'], ['PENDING', 'Pending'], ['AUTHORIZED', 'Approved'], ['REJECTED', 'Rejected'])} {...bind('approvalStatus')} />
        </>
      }
      rowKey={(r, i) => `${r.requestRef}-${r.medicine}-${i}`}
      columns={[
        { header: 'Request #', cell: (r) => r.requestRef },
        { header: 'Requested At', cell: (r) => r.requestedAt },
        { header: 'Admission #', cell: (r) => r.admissionNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Medicine', cell: (r) => r.medicine },
        { header: 'Requested Qty', align: 'right', cell: (r) => String(r.requestedQty), excelValue: (r) => r.requestedQty },
        { header: 'Dispensed Qty', align: 'right', cell: (r) => String(r.dispensedQty), excelValue: (r) => r.dispensedQty },
        { header: 'Request Status', cell: (r) => r.requestStatus },
        { header: 'Notes / Urgency', cell: (r) => r.notes || '—' },
        { header: 'Pharmacy Invoice', cell: (r) => r.pharmacyInvoice || '—' },
        { header: 'Pharmacy Clearance', cell: (r) => r.pharmacyClearance },
        { header: 'High-Cost Approval', cell: (r) => APPROVAL_LABEL[r.approvalStatus] || r.approvalStatus },
      ]}
    />
  );
};
