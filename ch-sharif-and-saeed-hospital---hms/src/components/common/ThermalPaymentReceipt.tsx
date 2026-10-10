import React from 'react';
import { Printer, X } from 'lucide-react';
import { formatAmount } from '../../utils/formatters';
import { getHospitalProfile } from '../../services/hospitalProfileService';
import { HospitalProfile } from '../../types/hospital';
import { InvoiceDetail, PaymentReceiptRow } from '../../services/invoiceService';

export interface ThermalReceiptData {
  receiptNumber: string;
  invoiceNumber: string;
  dateTime: string;
  encounterType: 'OPD' | 'EMERGENCY' | 'OBSERVATION' | 'CUSTOM' | string;
  tokenNumber?: string | null;
  mrNumber?: string;
  patientName: string;
  doctorName?: string | null;
  serviceName?: string;
  fees: number;
  others: number;
  total: number;
  receivedNow: number;
  paid: number;
  outstanding: number;
  advanceCredit?: number;
  paymentMethod?: string;
  collectedBy?: string | null;
  patientPhone?: string | null;
  isReprint?: boolean;
}

/**
 * Formats date and time cleanly: e.g. "10-Oct-2026, 07:18 PM"
 */
export function formatReceiptDateTime(raw?: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);

  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');

  return `${day}-${month}-${year}, ${strHours}:${minutes} ${ampm}`;
}

/**
 * Builds canonical ThermalReceiptData with 5-6 core fields:
 * Queue No, Invoice No, Date, Doctor, Patient, Fees, Others, Total, Paid, Outstanding.
 *
 * "Fees" captures all doctor consultation + core encounter intake services.
 * "Others" captures only separate additional procedures / medications / tests (0 if none).
 */
export function buildThermalReceiptData(
  invoice: InvoiceDetail,
  receipt?: PaymentReceiptRow | null,
  options?: {
    receivedNow?: number;
    paymentMethod?: string;
    collectedBy?: string;
    isReprint?: boolean;
  }
): ThermalReceiptData {
  const encType = invoice.encounterType || 'OPD';
  const isIpd = invoice.sourceType === 'ADMISSION' || (encType as any) === 'ADMISSION' || (encType as any) === 'IPD';

  // Calculate core Consultation / Encounter Fees vs Others (additional procedures/labs/medicines)
  let fees = 0;
  let others = 0;

  if (!invoice.lines || invoice.lines.length === 0) {
    fees = Number(invoice.total || 0);
    others = 0;
  } else {
    for (const line of invoice.lines) {
      const lineAmt = Number(line.lineNet || line.lineGross || 0);
      const desc = (line.serviceName || (line as any).descriptionSnapshot || '').toLowerCase();
      const bSource = ((line as any).billingSource || '').toUpperCase();

      // Core visit charges: Doctor Visit / Consultation fee OR primary encounter intake service
      const isCoreEncounterCharge =
        bSource === 'DOCTOR_CHARGE' ||
        desc.includes('visit') ||
        desc.includes('consultation') ||
        desc.includes('consult') ||
        desc.includes('observation') ||
        desc.includes('emergency') ||
        desc.includes('triage') ||
        desc.includes('opd');

      if (isCoreEncounterCharge) {
        fees += lineAmt;
      } else {
        others += lineAmt;
      }
    }

    // Fallback: If no line matched core pattern (custom service name), first line is fees, remainder is others
    if (fees === 0 && invoice.lines.length > 0) {
      fees = Number(invoice.lines[0].lineNet || invoice.lines[0].lineGross || 0);
      others = Math.max(0, Number(invoice.total || 0) - fees);
    }
  }

  const netPayable = invoice.payerType === 'Corporate / Panel' ? Number(invoice.patientShare || 0) : Number(invoice.total || 0);

  // Identifiers
  const receiptNumber = receipt?.receiptNumber || (invoice.receipts?.[invoice.receipts.length - 1]?.receiptNumber) || 'RCP-PENDING';
  const invoiceNumber = invoice.invoiceNumber || '—';

  // Clean date & time
  const rawDate = receipt?.collectedAt || invoice.createdAt || new Date().toISOString();
  const dateTime = formatReceiptDateTime(rawDate);

  const receivedNow = options?.receivedNow != null
    ? options.receivedNow
    : receipt
    ? Number(receipt.amount || 0)
    : Number(invoice.paidTotal || 0);

  const paymentMethod = options?.paymentMethod || receipt?.method || 'CASH';
  const collectedBy = options?.collectedBy || receipt?.collectedByName || 'Cashier';

  // Outstanding calculation logic:
  let rawOutstanding = 0;
  if (invoice.status === 'PAID') {
    rawOutstanding = 0;
  } else if (options?.receivedNow != null && options.receivedNow > 0) {
    if (invoice.balanceDue != null && invoice.balanceDue <= 0) {
      rawOutstanding = 0;
    } else if (invoice.balanceDue != null) {
      rawOutstanding = Math.max(0, Number(invoice.balanceDue) - options.receivedNow);
    } else {
      const basePaid = Number(invoice.paidTotal || 0);
      const effectivePaid = basePaid < netPayable ? basePaid + options.receivedNow : basePaid;
      rawOutstanding = Math.max(0, netPayable - effectivePaid);
    }
  } else if (typeof invoice.balanceDue === 'number') {
    rawOutstanding = Math.max(0, invoice.balanceDue);
  } else {
    const currentPaid = Number(invoice.paidTotal || 0);
    rawOutstanding = Math.max(0, netPayable - currentPaid);
  }

  // Clean Doctor Name: add Dr. prefix if not present
  let docName = invoice.doctorName ? invoice.doctorName.trim() : 'Consultant';
  if (docName && docName !== 'Consultant' && !/^dr\.?/i.test(docName)) {
    docName = `Dr. ${docName}`;
  }

  const primaryLine = invoice.lines?.[0];
  const serviceName = primaryLine?.serviceName || (encType === 'OBSERVATION' ? 'Observation' : encType === 'EMERGENCY' ? 'Emergency' : 'OPD');

  return {
    receiptNumber,
    invoiceNumber,
    dateTime,
    encounterType: encType,
    // Strictly omit Token Number for IPD / Admission
    tokenNumber: isIpd ? null : (invoice.queueNumber || null),
    mrNumber: invoice.patientMr || '—',
    patientName: invoice.patientName || 'Patient',
    doctorName: docName,
    serviceName,
    fees,
    others,
    total: netPayable,
    receivedNow,
    paid: receivedNow,
    outstanding: rawOutstanding,
    advanceCredit: 0,
    paymentMethod,
    collectedBy,
    patientPhone: invoice.patientPhone || null,
    isReprint: options?.isReprint || false,
  };
}

/**
 * Generates compact 80mm thermal receipt HTML with authentic POS monospace typography.
 */
export function generateThermalReceiptHtml(
  data: ThermalReceiptData,
  profile?: HospitalProfile
): string {
  const hp = profile || getHospitalProfile();
  const hospitalName = hp.name || 'CH SHARIF AND SAEED HOSPITAL';

  const isIpd = data.encounterType === 'ADMISSION' || (data.encounterType as string) === 'IPD';
  const showToken = !isIpd && !!data.tokenNumber;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${data.invoiceNumber || data.receiptNumber}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    @media print {
      html, body {
        width: 80mm;
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
      }
      .no-print { display: none !important; }
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Roboto Mono', 'Consolas', 'Courier New', Monaco, monospace;
      width: 74mm;
      max-width: 80mm;
      margin: 0 auto;
      padding: 3mm 2.5mm 4mm 2.5mm;
      color: #000;
      background: #fff;
      font-size: 11.5px;
      line-height: 1.35;
      -webkit-font-smoothing: antialiased;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: 700; }
    .extrabold { font-weight: 800; }
    .uppercase { text-transform: uppercase; }

    .header {
      text-align: center;
      margin-bottom: 4px;
    }
    .hospital-title {
      font-size: 13.5px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      line-height: 1.25;
      margin-bottom: 2px;
    }
    .doc-type {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-top: 2px;
      text-transform: uppercase;
    }
    .reprint-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 800;
      border: 1px dashed #000;
      padding: 1px 5px;
      margin-top: 3px;
    }

    .divider {
      border-top: 1px dashed #000;
      margin: 4px 0;
      width: 100%;
    }

    .token-box {
      border: 2px solid #000;
      padding: 4px 4px;
      margin: 4px 0;
      text-align: center;
      background: #fff;
    }
    .token-title {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .token-num {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 1.5px;
      margin-top: 1px;
    }

    .info-table, .charges-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .info-table td {
      padding: 1.5px 0;
      vertical-align: top;
      word-break: break-word;
    }
    .label {
      width: 34%;
      font-weight: 500;
    }
    .val {
      width: 66%;
      font-weight: 700;
      text-align: right;
    }

    .charges-table td {
      padding: 2px 0;
      word-break: break-word;
    }

    .footer {
      text-align: center;
      font-size: 10.5px;
      margin-top: 6px;
      line-height: 1.3;
    }
    .footer-msg {
      font-weight: 700;
      font-size: 11px;
    }
    .tear-line {
      margin-top: 8px;
      border-top: 1px dashed #000;
      text-align: center;
      font-size: 8.5px;
      color: #000;
      padding-top: 3px;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="hospital-title">${hospitalName}</div>
    <div class="doc-type">PAYMENT RECEIPT</div>
    ${data.isReprint ? '<div class="reprint-badge">*** REPRINT / DUPLICATE ***</div>' : ''}
  </div>

  <div class="divider"></div>

  ${showToken ? `
  <div class="token-box">
    <div class="token-title">Queue / Token Number</div>
    <div class="token-num">${data.tokenNumber}</div>
  </div>
  <div class="divider"></div>
  ` : ''}

  <table class="info-table">
    <tr>
      <td class="label">Invoice No:</td>
      <td class="val">${data.invoiceNumber}</td>
    </tr>
    <tr>
      <td class="label">Date:</td>
      <td class="val">${data.dateTime}</td>
    </tr>
    <tr>
      <td class="label">Doctor:</td>
      <td class="val">${data.doctorName || 'Consultant'}</td>
    </tr>
    <tr>
      <td class="label">Patient:</td>
      <td class="val">${data.patientName}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <table class="charges-table">
    <tr>
      <td class="text-left">Fees</td>
      <td class="text-right bold">${formatAmount(data.fees)}</td>
    </tr>
    <tr>
      <td class="text-left">Others</td>
      <td class="text-right bold">${formatAmount(data.others)}</td>
    </tr>
    <tr>
      <td colspan="2"><div class="divider"></div></td>
    </tr>
    <tr>
      <td class="text-left bold">TOTAL</td>
      <td class="text-right extrabold">${formatAmount(data.total)}</td>
    </tr>
    <tr>
      <td class="text-left bold">PAID</td>
      <td class="text-right extrabold">${formatAmount(data.paid ?? data.receivedNow)}</td>
    </tr>
    <tr>
      <td class="text-left bold">OUTSTANDING</td>
      <td class="text-right extrabold">${formatAmount(data.outstanding)}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <div class="footer">
    <div class="footer-msg">Thank You</div>
  </div>

  <div class="tear-line">---------------- TEAR HERE ----------------</div>

  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`;
}

/**
 * Triggers direct 80mm thermal receipt printing in a clean popup window.
 */
export function printThermalReceipt(
  data: ThermalReceiptData,
  profile?: HospitalProfile
): string | void {
  const printWindow = window.open('', '_blank', 'width=380,height=600');
  if (!printWindow) {
    window.print();
    return;
  }
  const html = generateThermalReceiptHtml(data, profile);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

export interface ThermalPaymentReceiptProps {
  encounterType?: 'OPD' | 'EMERGENCY' | 'OBSERVATION' | string;
  receipt: ThermalReceiptData;
  onPrint?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * One reusable 80mm Thermal Payment Receipt preview component with authentic POS thermal typography.
 */
export const ThermalPaymentReceipt: React.FC<ThermalPaymentReceiptProps> = ({
  encounterType,
  receipt,
  onPrint,
  onClose,
  className = '',
}) => {
  const hp = getHospitalProfile();
  const activeEncounterType = encounterType || receipt.encounterType || 'OPD';
  const isIpd = activeEncounterType === 'ADMISSION' || (activeEncounterType as string) === 'IPD';
  const showToken = !isIpd && !!receipt.tokenNumber;

  const handleTriggerPrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      printThermalReceipt(receipt, hp);
    }
  };

  return (
    <div className={`bg-slate-100 p-4 rounded-xl flex flex-col items-center ${className}`}>
      {/* 80mm Visual Representation Container with Authentic Monospace Receipt Styling */}
      <div
        id="thermal-receipt-container"
        className="bg-white text-black border border-slate-300 shadow-md p-4 w-[280px] max-w-[300px] text-xs select-none relative"
        style={{
          fontFamily: "'Roboto Mono', 'Consolas', 'Courier New', Monaco, monospace",
          boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
        }}
      >
        {/* Header Strip */}
        <div className="text-center pb-1">
          <div className="font-extrabold text-[13px] tracking-wide text-black uppercase leading-tight">
            {hp.name || 'CH SHARIF AND SAEED HOSPITAL'}
          </div>
          <div className="font-bold text-[11px] uppercase tracking-widest mt-1 border-t border-b border-black py-0.5">
            Payment Receipt
          </div>
          {receipt.isReprint && (
            <div className="inline-block border border-dashed border-black px-1.5 py-0.5 text-[9px] font-bold uppercase mt-1">
              *** Reprint / Duplicate ***
            </div>
          )}
        </div>

        {/* Token Number Box (OPD / ER / Observation only) */}
        {showToken && (
          <div className="border-2 border-black bg-white p-1.5 my-2 text-center rounded-none">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-black">
              Queue / Token Number
            </div>
            <div className="text-2xl font-black tracking-widest text-black mt-0.5">
              {receipt.tokenNumber}
            </div>
          </div>
        )}

        {/* 4 Clean Meta Fields */}
        <div className="border-t border-dashed border-black pt-2 pb-2 space-y-1 text-[11.5px]">
          <div className="flex justify-between">
            <span className="font-medium text-black">Invoice No:</span>
            <span className="font-bold text-black">{receipt.invoiceNumber || receipt.receiptNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-black">Date:</span>
            <span className="font-bold text-black text-[10.5px]">{receipt.dateTime}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-black">Doctor:</span>
            <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.doctorName || 'Consultant'}>
              {receipt.doctorName || 'Consultant'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-black">Patient:</span>
            <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.patientName}>
              {receipt.patientName}
            </span>
          </div>
        </div>

        {/* Charges Table */}
        <div className="border-t border-dashed border-black pt-2 pb-2 text-[11.5px]">
          <div className="flex justify-between py-0.5">
            <span className="font-medium text-black">Fees</span>
            <span className="font-bold text-black">{formatAmount(receipt.fees)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="font-medium text-black">Others</span>
            <span className="font-bold text-black">{formatAmount(receipt.others)}</span>
          </div>

          <div className="border-t border-dashed border-black pt-1.5 mt-1 space-y-1">
            <div className="flex justify-between font-extrabold text-xs">
              <span>TOTAL</span>
              <span className="text-sm font-bold">{formatAmount(receipt.total)}</span>
            </div>
            <div className="flex justify-between font-bold text-xs text-[#08775A]">
              <span>PAID</span>
              <span className="text-sm font-bold">{formatAmount(receipt.paid ?? receipt.receivedNow)}</span>
            </div>
            <div className="flex justify-between font-bold text-xs text-rose-700">
              <span>OUTSTANDING</span>
              <span className="text-sm font-bold">{formatAmount(receipt.outstanding)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-dashed border-black pt-2 text-center text-[10.5px] text-black leading-tight">
          <div className="font-bold text-[11px] text-black">Thank You</div>
          <div className="text-[9px] text-black mt-2 border-t border-dashed border-black pt-1 tracking-wider">
            ---------------- TEAR HERE ----------------
          </div>
        </div>
      </div>

      {/* Action Buttons Toolbar */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleTriggerPrint}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer font-sans"
        >
          <Printer className="h-4 w-4" />
          <span>Print 80mm Receipt</span>
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer font-sans"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close</span>
          </button>
        )}
      </div>
    </div>
  );
};

export interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: ThermalReceiptData | null;
}

/**
 * Modal wrapper for displaying and printing the 80mm thermal receipt.
 */
export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  isOpen,
  onClose,
  receipt,
}) => {
  if (!isOpen || !receipt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-100">
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-4 overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-2">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider font-sans">
            80mm Thermal Receipt Preview
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ThermalPaymentReceipt
          receipt={receipt}
          encounterType={receipt.encounterType}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
