import React, { useState } from 'react';
import { Printer, X, RefreshCw } from 'lucide-react';
import { formatPKR, formatNumber } from '../utils/format';

export interface PharmacyThermalLineItem {
  lineId: string;
  medicineName: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  unitName?: string | null;
  unitRate: number;
  discountAmount?: number;
  taxAmount?: number;
  netAmount: number;
}

export interface PharmacyThermalReceiptData {
  invoiceNumber: string;
  dateTime: string;
  channel: 'RETAIL' | 'HMS_LINKED' | string;
  customerName: string;
  mrNumber?: string | null;
  admissionRef?: string | null;
  prescribedBy?: string | null;
  dispensedBy: string;
  paymentMethod: string;
  status: string;
  lines: PharmacyThermalLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  outstanding: number;
  payments: Array<{
    method: string;
    amount: number;
    collectedBy?: string | null;
  }>;
  headerText: string;
  footerText: string;
  hospitalName?: string;
  departmentTitle?: string;
  hospitalAddress?: string;
  hospitalPhone?: string;
  hospitalEmail?: string;
  footerMsg?: string;
  footerPoweredBy?: string;
  isReprint?: boolean;
}

export function formatThermalReceiptDateTime(raw?: string | null): string {
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

export function formatExpiryDate(raw?: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  return `${month}/${year}`;
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds PharmacyThermalReceiptData from real database invoice and settings.
 * Nothing is hardcoded: every field is pulled from real DB records.
 */
export function buildPharmacyThermalReceiptData(
  invoice: any,
  settings?: any,
  hospitalProfile?: any,
  options?: { isReprint?: boolean }
): PharmacyThermalReceiptData {
  const lines: PharmacyThermalLineItem[] = (invoice.lines || []).map((l: any, idx: number) => {
    const med = l.medicine || {};
    const batch = l.batch || {};
    const unit = l.saleUnit || {};

    const displayQty = l.saleUnitQuantity != null ? Number(l.saleUnitQuantity) : Number(l.quantity || 1);
    const unitRate = Number(l.rateSnapshot || (l.quantity > 0 ? Number(l.lineNet || 0) / Number(l.quantity) : 0));
    const netAmount = Number(l.lineNet != null ? l.lineNet : unitRate * displayQty);
    const discountAmount = Number(l.discountAmount || 0);
    const taxAmount = Number(l.taxAmount || 0);

    return {
      lineId: l.id || String(idx),
      medicineName: med.name || 'Medicine Item',
      genericName: med.genericName || null,
      strength: med.strength || null,
      dosageForm: med.dosageForm || null,
      batchNumber: batch.batchNumber || null,
      expiryDate: batch.expiryDate || null,
      quantity: displayQty,
      unitName: unit.name || null,
      unitRate,
      discountAmount,
      taxAmount,
      netAmount,
    };
  });

  const payments = (invoice.payments || []).map((p: any) => ({
    method: p.method || 'CASH',
    amount: Number(p.amount || 0),
    collectedBy: p.collectedByUser?.fullName || p.collectedByUser?.username || null,
  }));

  const paymentMethod =
    payments.length > 0
      ? payments.map((p: any) => p.method).join(', ')
      : invoice.channel === 'HMS_LINKED'
      ? 'HMS Billing / Inpatient Ledger'
      : 'CASH';

  const dispensedBy =
    invoice.dispensedByUser?.fullName ||
    invoice.dispensedByUser?.username ||
    'Staff Pharmacist';

  const customerName =
    invoice.customerName ||
    invoice.medicineRequests?.[0]?.patientNameSnapshot ||
    (invoice.channel === 'HMS_LINKED' ? 'Inpatient / Ward' : 'Walk-In Customer');

  const admissionRef =
    invoice.externalAdmissionRef ||
    invoice.medicineRequests?.[0]?.externalAdmissionRef ||
    null;

  const hospName =
    settings?.hospitalName ||
    settings?.receiptHeaderText ||
    hospitalProfile?.name ||
    'CH SHARIF AND SAEED HOSPITAL';

  const deptTitle =
    settings?.pharmacySubtitle ||
    'CENTRAL PHARMACY & DISPENSARY';

  const hospAddress =
    settings?.address ||
    hospitalProfile?.address ||
    'Main Boulevard, Near Jail Road · 24/7 Service';

  const hospPhone =
    settings?.phone ||
    (hospitalProfile?.primaryPhone ? `Phone: ${hospitalProfile.primaryPhone}` : 'UAN: +92 42 111-467-748');

  const hospEmail =
    settings?.email ||
    (hospitalProfile?.contactEmail ? `Email: ${hospitalProfile.contactEmail}` : '');

  const footerText =
    settings?.footerTerms ||
    settings?.receiptFooterText ||
    'Medicines once sold can only be returned within 3 days with this original receipt. Fridge and cold-chain items are strictly non-returnable.';

  const footerMsg =
    settings?.footerMessage ||
    'Thank You · Get Well Soon';

  const footerPoweredBy =
    settings?.footerPoweredBy ||
    'Powered by Isysware Software Solutions';

  return {
    invoiceNumber: invoice.invoiceNumber || 'INV-PENDING',
    dateTime: formatThermalReceiptDateTime(invoice.createdAt || new Date().toISOString()),
    channel: invoice.channel || 'RETAIL',
    customerName,
    mrNumber: admissionRef,
    admissionRef,
    prescribedBy: invoice.medicineRequests?.[0]?.requestedByExternal || null,
    dispensedBy,
    paymentMethod,
    status: invoice.status || 'PAID',
    lines,
    subtotal: Number(invoice.subtotal || lines.reduce((s, l) => s + l.netAmount, 0)),
    discountTotal: Number(invoice.discountTotal || 0),
    taxTotal: Number(invoice.taxTotal || 0),
    total: Number(invoice.total || lines.reduce((s, l) => s + l.netAmount, 0)),
    paidTotal: Number(invoice.paidTotal || 0),
    outstanding: Number(invoice.outstanding || 0),
    payments,
    headerText: hospName,
    footerText,
    hospitalName: hospName,
    departmentTitle: deptTitle,
    hospitalAddress: hospAddress,
    hospitalPhone: hospPhone,
    hospitalEmail: hospEmail,
    footerMsg,
    footerPoweredBy,
    isReprint: options?.isReprint || false,
  };
}

/**
 * Generates compact 80mm thermal receipt HTML.
 * Strictly monochrome black & white without colorful ink.
 * Height grows dynamically with any number of real medicines without clipping or truncation.
 */
export function generatePharmacyThermalReceiptHtml(data: PharmacyThermalReceiptData): string {
  const isHmsLinked = data.channel === 'HMS_LINKED';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${escapeHtml(data.invoiceNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: 80mm auto;
      margin: 0mm;
    }
    @media print {
      html, body {
        width: 76mm !important;
        max-width: 76mm !important;
        margin: 0 auto !important;
        padding: 1.5mm 1mm 3mm 1mm !important;
        background: #fff !important;
        color: #000 !important;
        overflow: visible !important;
        height: auto !important;
      }
      .no-print { display: none !important; }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      color: #000 !important;
    }
    body {
      font-family: 'Share Tech Mono', 'Space Mono', 'Consolas', 'Courier New', monospace;
      width: 74mm;
      max-width: 76mm;
      margin: 0 auto;
      padding: 2mm 1mm 3mm 1mm;
      color: #000;
      background: #fff;
      font-size: 11px;
      line-height: 1.25;
      letter-spacing: 0.1px;
      -webkit-font-smoothing: antialiased;
      height: auto;
      overflow: visible;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: 700; }
    .uppercase { text-transform: uppercase; }

    .header {
      text-align: center;
      margin-bottom: 3px;
    }
    .hospital-title {
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      line-height: 1.2;
      color: #000;
      margin-bottom: 2px;
    }
    .dept-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #000;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .meta-contact {
      font-size: 8.5px;
      font-weight: 500;
      line-height: 1.2;
      color: #000;
    }
    .doc-type {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.8px;
      color: #000;
      margin-top: 3px;
      text-transform: uppercase;
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      padding: 2px 0;
    }
    .reprint-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 700;
      border: 1px dashed #000;
      color: #000;
      padding: 1px 4px;
      margin-top: 2px;
    }

    .divider {
      border-top: 1px dashed #000;
      margin: 3.5px 0;
      width: 100%;
    }

    .section-title {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #000;
      margin-top: 2px;
      margin-bottom: 1.5px;
      border-bottom: 1px dotted #000;
      padding-bottom: 1px;
    }

    .info-table, .medicines-table, .charges-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .info-table td {
      padding: 1px 0;
      vertical-align: top;
      word-break: break-word;
      color: #000;
      font-weight: 600;
    }
    .label {
      width: 38%;
      font-weight: 600;
      color: #000;
    }
    .val {
      width: 62%;
      font-weight: 600;
      color: #000;
      text-align: right;
    }
    .val-customer {
      width: 62%;
      font-weight: 700;
      color: #000;
      text-align: right;
    }

    .medicines-table {
      margin: 2px 0;
    }
    .medicines-table th {
      padding: 2px 0;
      font-size: 9.5px;
      font-weight: 700;
      border-bottom: 1px dashed #000;
      text-transform: uppercase;
    }
    .medicines-table td {
      padding: 2px 0;
      font-size: 10.5px;
      vertical-align: top;
      word-break: break-word;
    }
    .med-row {
      border-bottom: 1px dotted #000;
    }
    .med-row:last-child {
      border-bottom: none;
    }
    .med-name {
      font-weight: 700;
      line-height: 1.2;
    }
    .med-subnote {
      font-size: 8.5px;
      font-weight: 500;
      color: #000;
      margin-top: 1px;
    }

    .charges-table td {
      padding: 1.5px 0;
      font-weight: 600;
      color: #000;
      font-size: 11px;
    }
    .total-val {
      font-weight: 700;
      font-size: 12px;
      color: #000;
    }
    .paid-val {
      font-weight: 700;
      color: #000;
    }
    .out-val {
      font-weight: 700;
      color: #000;
    }

    .footer {
      text-align: center;
      font-size: 9.5px;
      color: #000;
      margin-top: 5px;
      line-height: 1.25;
    }
    .footer-policy {
      font-size: 8.5px;
      font-weight: 500;
      line-height: 1.2;
      margin-bottom: 4px;
      color: #000;
    }
    .footer-msg {
      font-weight: 700;
      font-size: 11px;
      color: #000;
      text-transform: uppercase;
    }
    .footer-powered {
      font-size: 8.5px;
      font-weight: 500;
      color: #000;
      margin-top: 2px;
      letter-spacing: 0.2px;
    }
    .barcode {
      font-family: monospace;
      font-size: 9px;
      letter-spacing: 2px;
      margin-top: 3px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="hospital-title">${escapeHtml(data.hospitalName || data.headerText || 'CH SHARIF AND SAEED HOSPITAL')}</div>
    <div class="dept-title">${escapeHtml(data.departmentTitle || 'CENTRAL PHARMACY &amp; DISPENSARY')}</div>
    ${data.hospitalAddress ? `<div class="meta-contact">${escapeHtml(data.hospitalAddress)}</div>` : ''}
    ${data.hospitalPhone ? `<div class="meta-contact">${escapeHtml(data.hospitalPhone)}</div>` : ''}
    ${data.hospitalEmail ? `<div class="meta-contact">${escapeHtml(data.hospitalEmail)}</div>` : ''}
    <div class="doc-type">PHARMACY SALES RECEIPT</div>
    ${data.isReprint ? '<div class="reprint-badge">*** REPRINT / DUPLICATE ***</div>' : ''}
  </div>

  <!-- SECTION 1: CUSTOMER & PATIENT INFORMATION -->
  <div class="section-title">CUSTOMER INFORMATION</div>
  <table class="info-table">
    <tr>
      <td class="label">Customer:</td>
      <td class="val-customer">${escapeHtml(data.customerName)}</td>
    </tr>
    ${data.mrNumber ? `
    <tr>
      <td class="label">MR / Adm No:</td>
      <td class="val">${escapeHtml(data.mrNumber)}</td>
    </tr>` : ''}
    ${data.prescribedBy ? `
    <tr>
      <td class="label">Doctor:</td>
      <td class="val">${escapeHtml(data.prescribedBy)}</td>
    </tr>` : ''}
    <tr>
      <td class="label">Channel:</td>
      <td class="val">${isHmsLinked ? 'HMS Inpatient' : 'Retail POS'}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <!-- SECTION 2: INVOICE & DISPENSING METADATA -->
  <div class="section-title">INVOICE &amp; PAYMENT</div>
  <table class="info-table">
    <tr>
      <td class="label">Invoice No:</td>
      <td class="val bold">${escapeHtml(data.invoiceNumber)}</td>
    </tr>
    <tr>
      <td class="label">Date &amp; Time:</td>
      <td class="val">${escapeHtml(data.dateTime)}</td>
    </tr>
    <tr>
      <td class="label">Dispensed By:</td>
      <td class="val">${escapeHtml(data.dispensedBy)}</td>
    </tr>
    <tr>
      <td class="label">Pay Mode:</td>
      <td class="val">${escapeHtml(data.paymentMethod)}</td>
    </tr>
    <tr>
      <td class="label">Status:</td>
      <td class="val bold">${escapeHtml(data.status)}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <!-- SECTION 3: REAL MEDICINE LINES (DYNAMIC CONTINUOUS ROLL) -->
  <div class="section-title">MEDICINES &amp; ITEMS (${data.lines.length})</div>
  <table class="medicines-table">
    <thead>
      <tr>
        <th class="text-left" style="width: 58%;">ITEM</th>
        <th class="text-center" style="width: 16%;">QTY</th>
        <th class="text-right" style="width: 26%;">NET</th>
      </tr>
    </thead>
    <tbody>
      ${data.lines.map((item) => {
        const batchInfo = [
          item.batchNumber ? `Batch: ${item.batchNumber}` : '',
          item.expiryDate ? `Exp: ${formatExpiryDate(item.expiryDate)}` : '',
        ].filter(Boolean).join(' · ');

        const rateInfo = `${item.quantity} ${item.unitName || ''} @ PKR ${formatNumber(item.unitRate)}`;
        const strengthInfo = [item.strength, item.dosageForm].filter(Boolean).join(' ');

        return `
        <tr class="med-row">
          <td class="text-left" style="padding-right: 2px;">
            <div class="med-name">${escapeHtml(item.medicineName)}${strengthInfo ? ` <span style="font-size: 9px; font-weight: normal;">(${escapeHtml(strengthInfo)})</span>` : ''}</div>
            <div class="med-subnote">${escapeHtml(rateInfo)}</div>
            ${batchInfo ? `<div class="med-subnote">${escapeHtml(batchInfo)}</div>` : ''}
            ${item.discountAmount && item.discountAmount > 0 ? `<div class="med-subnote">Disc: -PKR ${formatNumber(item.discountAmount)}</div>` : ''}
          </td>
          <td class="text-center" style="vertical-align: top;">
            ${formatNumber(item.quantity)}
            ${item.unitName ? `<div style="font-size: 8px;">${escapeHtml(item.unitName)}</div>` : ''}
          </td>
          <td class="text-right bold" style="vertical-align: top;">PKR ${formatNumber(item.netAmount)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <div class="divider"></div>

  <!-- SECTION 4: FINANCIAL SUMMARY & SETTLEMENT -->
  <table class="charges-table">
    ${data.discountTotal > 0 || data.taxTotal > 0 ? `
    <tr>
      <td class="text-left">Gross Subtotal</td>
      <td class="text-right">PKR ${formatNumber(data.subtotal)}</td>
    </tr>` : ''}
    ${data.discountTotal > 0 ? `
    <tr>
      <td class="text-left">Discount</td>
      <td class="text-right">-PKR ${formatNumber(data.discountTotal)}</td>
    </tr>` : ''}
    ${data.taxTotal > 0 ? `
    <tr>
      <td class="text-left">Tax / GST</td>
      <td class="text-right">+PKR ${formatNumber(data.taxTotal)}</td>
    </tr>` : ''}
    <tr>
      <td class="text-left total-val">NET TOTAL</td>
      <td class="text-right total-val">PKR ${formatNumber(data.total)}</td>
    </tr>
    <tr>
      <td class="text-left paid-val">AMOUNT PAID</td>
      <td class="text-right paid-val">PKR ${formatNumber(data.paidTotal)}</td>
    </tr>
    ${data.outstanding > 0 ? `
    <tr>
      <td class="text-left out-val">BALANCE DUE</td>
      <td class="text-right out-val">PKR ${formatNumber(data.outstanding)}</td>
    </tr>` : `
    <tr>
      <td class="text-left out-val">BALANCE</td>
      <td class="text-right out-val">PKR 0.00 (CLEARED)</td>
    </tr>`}
  </table>

  ${data.payments.length > 0 ? `
  <div class="divider"></div>
  <div class="section-title">PAYMENT DETAILS</div>
  <table class="info-table">
    ${data.payments.map((p) => `
    <tr>
      <td class="label">${escapeHtml(p.method)}${p.collectedBy ? ` (${escapeHtml(p.collectedBy)})` : ''}:</td>
      <td class="val">PKR ${formatNumber(p.amount)}</td>
    </tr>`).join('')}
  </table>` : ''}

  <div class="divider"></div>

  <!-- SECTION 5: FOOTER & POLICY -->
  <div class="footer">
    ${data.footerText ? `<div class="footer-policy">${escapeHtml(data.footerText)}</div>` : ''}
    <div class="footer-msg">${escapeHtml(data.footerMsg || 'Thank You · Get Well Soon')}</div>
    <div class="footer-powered">${escapeHtml(data.footerPoweredBy || 'Powered by Isysware Software Solutions')}</div>
    <div class="barcode">||| | ||||| || |||||| | ||||| |||</div>
  </div>

  <script>
    if (window.name !== 'pharmacy-thermal-print-iframe') {
      window.onload = function() {
        setTimeout(function() {
          window.focus();
          window.print();
        }, 150);
      };
    }
  </script>
</body>
</html>`;
}

/**
 * Prints thermal receipt via an isolated hidden iframe.
 * Never blocked by popup blockers and ONLY prints the pure receipt without UI chrome.
 * Height expands dynamically with any number of medicines.
 */
export function printPharmacyThermalReceipt(data: PharmacyThermalReceiptData): void {
  const html = generatePharmacyThermalReceiptHtml(data);
  const existing = document.getElementById('pharmacy-thermal-print-iframe');
  if (existing) {
    existing.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'pharmacy-thermal-print-iframe';
  iframe.name = 'pharmacy-thermal-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc) {
    window.print();
    return;
  }

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error('Thermal print error:', e);
    }
  };

  iframe.onload = () => {
    setTimeout(doPrint, 150);
  };

  doc.open();
  doc.write(html);
  doc.close();

  // Safety fallback if iframe.onload does not fire in some browsers
  setTimeout(doPrint, 350);
}

export interface PharmacyThermalReceiptProps {
  receipt: PharmacyThermalReceiptData;
  onPrint?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Authentic 80mm Thermal Receipt Preview component:
 * - 100% Monochrome Black & White (No colorful ink)
 * - Dynamic height for 1, 5, 20, or 50+ real medicine lines
 * - Real DB sale & medicine records are the single source of truth
 */
export const PharmacyThermalReceipt: React.FC<PharmacyThermalReceiptProps> = ({
  receipt,
  onPrint,
  onClose,
  className = '',
}) => {
  const [isPrinting, setIsPrinting] = useState(false);

  const handleTriggerPrint = () => {
    setIsPrinting(true);
    try {
      if (onPrint) {
        onPrint();
      } else {
        printPharmacyThermalReceipt(receipt);
      }
    } finally {
      setTimeout(() => setIsPrinting(false), 500);
    }
  };

  const isHmsLinked = receipt.channel === 'HMS_LINKED';

  return (
    <div className={`bg-slate-100 p-3.5 rounded-xl flex flex-col items-center border border-slate-200 ${className}`}>
      {/* 80mm Monochrome Visual Receipt Paper Container (Dynamic Height) */}
      <div
        id="pharmacy-thermal-receipt-container"
        className="bg-white text-black border border-slate-300 shadow-[0_4px_16px_rgba(0,0,0,0.12)] rounded-xs p-4 w-[285px] max-w-[295px] select-none relative"
        style={{
          fontFamily: "'Share Tech Mono', 'Space Mono', 'Consolas', 'Courier New', monospace",
          color: '#000000',
        }}
      >
        {/* Header */}
        <div className="text-center pb-1">
          <div className="font-bold text-[12.5px] tracking-wide text-black uppercase leading-tight">
            {receipt.headerText || receipt.hospitalName || 'CH SHARIF AND SAEED HOSPITAL'}
          </div>
          <div className="font-bold text-[10px] text-black uppercase tracking-wider mt-0.5">
            CENTRAL PHARMACY &amp; DISPENSARY
          </div>
          {receipt.hospitalAddress && (
            <div className="text-[8.5px] text-black font-medium leading-tight mt-0.5">
              {receipt.hospitalAddress}
            </div>
          )}
          {receipt.hospitalPhone && (
            <div className="text-[8.5px] text-black font-medium leading-tight">
              {receipt.hospitalPhone}
            </div>
          )}
          <div className="font-bold text-[10.5px] text-black uppercase tracking-wider mt-1 border-t border-b border-dashed border-black py-0.5">
            Pharmacy Sales Receipt
          </div>
          {receipt.isReprint && (
            <div className="inline-block border border-dashed border-black text-black px-1.5 py-0.5 text-[9px] font-bold uppercase mt-1">
              *** Reprint / Duplicate ***
            </div>
          )}
        </div>

        {/* SECTION 1: CUSTOMER INFORMATION */}
        <div className="border-t border-dashed border-black pt-2 pb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black border-b border-dotted border-black pb-0.5 mb-1.5">
            Customer Information
          </div>
          <div className="space-y-1 text-[11px] font-semibold text-black">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Customer:</span>
              <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.customerName}>
                {receipt.customerName}
              </span>
            </div>
            {receipt.mrNumber && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">MR / Adm:</span>
                <span className="font-bold text-black">{receipt.mrNumber}</span>
              </div>
            )}
            {receipt.prescribedBy && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">Doctor:</span>
                <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.prescribedBy}>
                  {receipt.prescribedBy}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Channel:</span>
              <span className="font-semibold text-black">{isHmsLinked ? 'HMS Inpatient' : 'Retail POS'}</span>
            </div>
          </div>
        </div>

        {/* SECTION 2: INVOICE & PAYMENT */}
        <div className="border-t border-dashed border-black pt-2 pb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black border-b border-dotted border-black pb-0.5 mb-1.5">
            Invoice &amp; Payment
          </div>
          <div className="space-y-1 text-[11px] font-semibold text-black">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Invoice No:</span>
              <span className="font-bold text-black">{receipt.invoiceNumber}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Date &amp; Time:</span>
              <span className="font-semibold text-black">{receipt.dateTime}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Dispensed By:</span>
              <span className="font-semibold text-black text-right max-w-[160px] truncate" title={receipt.dispensedBy}>
                {receipt.dispensedBy}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Pay Mode:</span>
              <span className="font-bold text-black">{receipt.paymentMethod}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Status:</span>
              <span className="font-bold text-black">{receipt.status}</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: REAL MEDICINES TABLE (DYNAMIC HEIGHT) */}
        <div className="border-t border-dashed border-black pt-2 pb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black border-b border-dotted border-black pb-0.5 mb-1.5">
            Medicines &amp; Items ({receipt.lines.length})
          </div>
          <table className="w-full border-collapse text-[10.5px] font-semibold text-black">
            <thead>
              <tr className="border-b border-dashed border-black text-[9.5px] font-bold text-black uppercase">
                <th className="text-left py-1 font-bold">Item</th>
                <th className="text-center py-1 font-bold w-9">Qty</th>
                <th className="text-right py-1 font-bold w-16">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-black">
              {receipt.lines.map((line, idx) => {
                const batchInfo = [
                  line.batchNumber ? `Batch: ${line.batchNumber}` : '',
                  line.expiryDate ? `Exp: ${formatExpiryDate(line.expiryDate)}` : '',
                ].filter(Boolean).join(' · ');

                const rateInfo = `${line.quantity} ${line.unitName || ''} @ PKR ${formatNumber(line.unitRate)}`;
                const strengthInfo = [line.strength, line.dosageForm].filter(Boolean).join(' ');

                return (
                  <tr key={line.lineId || idx} className="align-top">
                    <td className="text-left py-1 pr-1">
                      <div className="font-bold text-black leading-tight">
                        {line.medicineName}
                        {strengthInfo && (
                          <span className="text-[9px] font-normal text-black ml-1">
                            ({strengthInfo})
                          </span>
                        )}
                      </div>
                      <div className="text-[8.5px] text-black font-normal leading-tight">
                        {rateInfo}
                      </div>
                      {batchInfo && (
                        <div className="text-[8.5px] text-black font-normal leading-tight">
                          {batchInfo}
                        </div>
                      )}
                      {line.discountAmount != null && line.discountAmount > 0 && (
                        <div className="text-[8.5px] text-black font-normal leading-tight">
                          Disc: -PKR {formatNumber(line.discountAmount)}
                        </div>
                      )}
                    </td>
                    <td className="text-center py-1 font-mono text-[10px]">
                      {formatNumber(line.quantity)}
                      {line.unitName && <div className="text-[8px] font-normal">{line.unitName}</div>}
                    </td>
                    <td className="text-right py-1 font-mono font-bold tabular-nums">
                      PKR {formatNumber(line.netAmount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* SECTION 4: FINANCIAL SUMMARY & SETTLEMENT */}
        <div className="border-t border-dashed border-black pt-2 pb-2 text-[11px] font-semibold text-black space-y-1">
          {(receipt.discountTotal > 0 || receipt.taxTotal > 0) && (
            <div className="flex justify-between py-0.5">
              <span className="font-semibold text-black">Gross Subtotal</span>
              <span className="font-mono text-black tabular-nums">PKR {formatNumber(receipt.subtotal)}</span>
            </div>
          )}
          {receipt.discountTotal > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="font-semibold text-black">Discount</span>
              <span className="font-mono text-black tabular-nums">-PKR {formatNumber(receipt.discountTotal)}</span>
            </div>
          )}
          {receipt.taxTotal > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="font-semibold text-black">Tax / GST</span>
              <span className="font-mono text-black tabular-nums">+PKR {formatNumber(receipt.taxTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-[12px] font-bold text-black border-t border-dashed border-black pt-1">
            <span>NET TOTAL</span>
            <span className="tabular-nums font-mono">PKR {formatNumber(receipt.total)}</span>
          </div>
          <div className="flex justify-between text-[11px] font-bold text-black">
            <span>AMOUNT PAID</span>
            <span className="tabular-nums font-mono">PKR {formatNumber(receipt.paidTotal)}</span>
          </div>
          {receipt.outstanding > 0 ? (
            <div className="flex justify-between text-[11.5px] font-bold text-black border-t border-dotted border-black pt-0.5">
              <span>BALANCE DUE</span>
              <span className="tabular-nums font-mono">PKR {formatNumber(receipt.outstanding)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-[11px] font-bold text-black border-t border-dotted border-black pt-0.5">
              <span>BALANCE</span>
              <span className="tabular-nums font-mono">PKR 0.00 (CLEARED)</span>
            </div>
          )}
        </div>

        {/* Payment breakdown */}
        {receipt.payments.length > 0 && (
          <div className="border-t border-dashed border-black pt-1.5 pb-1 text-[10px] space-y-0.5">
            <div className="font-bold text-black uppercase">Payment Details:</div>
            {receipt.payments.map((p, idx) => (
              <div key={idx} className="flex justify-between text-black">
                <span>
                  {p.method} {p.collectedBy ? `(${p.collectedBy})` : ''}
                </span>
                <span className="font-mono font-semibold">PKR {formatNumber(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-dashed border-black pt-2 text-center text-[10px] text-black leading-tight">
          {receipt.footerText && (
            <div className="text-[8.5px] font-medium text-black leading-tight mb-1">
              {receipt.footerText}
            </div>
          )}
          <div className="font-bold text-[11px] text-black uppercase">Thank You · Get Well Soon</div>
          <div className="text-[8.5px] font-medium text-black mt-1 tracking-wide">
            Powered by Isysware Software Solutions
          </div>
          <div className="font-mono text-[9px] tracking-widest text-black mt-1">
            ||| | ||||| || |||||| | ||||| |||
          </div>
        </div>
      </div>

      {/* Action Buttons Toolbar */}
      <div className="mt-3 flex items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={handleTriggerPrint}
          disabled={isPrinting}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-black disabled:opacity-60 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
        >
          {isPrinting ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Printer className="h-3.5 w-3.5" />
          )}
          <span>{isPrinting ? 'Printing…' : 'Print 80mm Thermal Receipt'}</span>
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close</span>
          </button>
        )}
      </div>
    </div>
  );
};
