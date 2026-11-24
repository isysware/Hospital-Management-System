import { receiptSettlement } from '../../utils/receiptSettlement';
import React, { useState, useEffect } from 'react';
import { Printer, X, RefreshCw } from 'lucide-react';
import { formatAmount } from '../../utils/formatters';
import { getHospitalProfile } from '../../services/hospitalProfileService';
import { HospitalProfile } from '../../types/hospital';
import { InvoiceDetail, PaymentReceiptRow } from '../../services/invoiceService';

export interface ThermalReceiptLineItem {
  lineId?: string;
  serviceId?: string;
  serviceCode?: string;
  serviceName: string;
  quantity: number;
  unitRate: number;
  grossAmount?: number;
  discountAmount?: number;
  discountReason?: string;
  taxAmount?: number;
  netAmount: number;
  sourceType?: string;
  performedByName?: string;
  billingUnit?: string;
}

export interface ThermalReceiptData {
  receiptNumber: string;
  invoiceNumber: string;
  dateTime: string;
  encounterType: 'OPD' | 'EMERGENCY' | 'OBSERVATION' | 'CUSTOM' | 'ADMISSION' | string;
  encounterRef?: string;
  tokenNumber?: string | null;
  mrNumber?: string;
  patientName: string;
  patientAge?: number | string | null;
  patientGender?: string | null;
  patientWeight?: number | string | null;
  admissionNumber?: string | null;
  bedInfo?: string | null;
  doctorName?: string | null;
  rmoName?: string | null;
  serviceName?: string;
  lines: ThermalReceiptLineItem[];
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  total: number;
  netTotal: number;
  receivedNow: number;
  previouslyPaid: number;
  paid: number;
  outstanding: number;
  advanceCredit: number;
  paymentMethod?: string;
  collectedBy?: string | null;
  patientPhone?: string | null;
  isReprint?: boolean;
  fees: number;
  others: number;
  payerType?: 'Corporate / Panel' | 'Self Pay' | string;
  panelName?: string | null;
  panelMemberId?: string | null;
  patientShare?: number;
  panelReceivable?: number;
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

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds canonical ThermalReceiptData directly from real DB encounter billing lines & receipts.
 * Nothing is hardcoded: every valid service line from the ledger is preserved dynamically.
 */
export function buildThermalReceiptData(
  invoice: InvoiceDetail,
  receipt?: PaymentReceiptRow | null,
  options?: {
    receivedNow?: number;
    paymentMethod?: string;
    collectedBy?: string;
    isReprint?: boolean;
    patientWeight?: number | string | null;
    patientAge?: number | string | null;
    patientGender?: string | null;
    rmoName?: string | null;
  }
): ThermalReceiptData {
  const isIpd = invoice.sourceType === 'ADMISSION' || (invoice.encounterType as any) === 'ADMISSION' || (invoice.encounterType as any) === 'IPD';
  const encType = isIpd ? 'ADMISSION' : (invoice.encounterType || 'OPD');

  // Map ALL real invoice lines from backend ledger
  const rawLines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const lines: ThermalReceiptLineItem[] = rawLines
    .filter((l: any) => invoice.sourceType !== 'ADMISSION' || l.serviceCode !== 'ADM-ADVANCE')
    .map((l: any) => {
      const q = Number(l.quantity != null ? l.quantity : 1);
      const rate = Number(l.rate != null ? l.rate : (l.rateSnapshot != null ? l.rateSnapshot : 0));
      const disc = Number(l.discountAmount != null ? l.discountAmount : (l.discount != null ? l.discount : 0));
      const gross = Number(l.lineGross != null ? l.lineGross : (l.gross != null ? l.gross : rate * q));
      const net = Number(l.lineNet != null ? l.lineNet : (l.net != null ? l.net : Math.max(0, gross - disc)));

      return {
        lineId: l.id,
        serviceId: l.serviceRateId || l.serviceId || '',
        serviceCode: l.serviceCode || '',
        serviceName: l.serviceName || l.descriptionSnapshot || l.billingSource || 'Hospital Service',
        quantity: q,
        unitRate: rate,
        grossAmount: gross,
        discountAmount: disc,
        discountReason: l.discountReason || '',
        taxAmount: 0,
        netAmount: net,
        sourceType: l.billingSource || 'HOSPITAL_SERVICE',
        performedByName: l.performedByName || l.performedBy?.fullName || '',
        billingUnit: l.billingUnit || 'Items',
      };
    });

  // Calculate fees (consultation / visit) vs others for legacy fields
  let fees = 0;
  let others = 0;
  for (const line of lines) {
    const desc = line.serviceName.toLowerCase();
    const isCore =
      line.sourceType === 'DOCTOR_CHARGE' ||
      desc.includes('visit') ||
      desc.includes('consultation') ||
      desc.includes('consult') ||
      desc.includes('observation') ||
      desc.includes('emergency') ||
      desc.includes('triage') ||
      desc.includes('opd') ||
      desc.includes('admission');

    if (isCore) {
      fees += line.netAmount;
    } else {
      others += line.netAmount;
    }
  }
  if (fees === 0 && lines.length > 0) {
    fees = lines[0].netAmount;
    others = lines.slice(1).reduce((sum, l) => sum + l.netAmount, 0);
  }

  const subtotal = Number(invoice.subtotal != null ? invoice.subtotal : lines.reduce((s, l) => s + (l.grossAmount || l.netAmount), 0));
  const totalDiscount = Number(invoice.discountTotal != null ? invoice.discountTotal : lines.reduce((s, l) => s + (l.discountAmount || 0), 0));
  const netPayable = invoice.payerType === 'Corporate / Panel' ? Number(invoice.patientShare ?? 0) : Number(invoice.total ?? 0);
  const netTotal = Number(invoice.total != null ? invoice.total : netPayable);

  // Identifiers
  const receiptNumber = receipt?.receiptNumber || (invoice.receipts?.[invoice.receipts.length - 1]?.receiptNumber) || 'RCP-PENDING';
  const invoiceNumber = invoice.invoiceNumber || '—';

  // Date and Time
  const rawDate = receipt?.collectedAt || (invoice as any).createdAt || new Date().toISOString();
  const dateTime = formatReceiptDateTime(rawDate);

  // Financials & Partial Payments (Real backend data, strictly non-negative outstanding)
  const totalPaidOnInvoice = Number(invoice.paidTotal || 0);

  const receivedNow = options?.receivedNow != null
    ? options.receivedNow
    : receipt
    ? Number(receipt.amount || 0)
    : totalPaidOnInvoice;

  const historicalSettlement = receiptSettlement(invoice.receipts ?? [], receipt, netPayable);
  let previouslyPaid = 0;
  if (historicalSettlement) {
    previouslyPaid = historicalSettlement.previouslyPaid;
  } else if (options?.receivedNow != null) {
    previouslyPaid = Math.max(0, totalPaidOnInvoice - options.receivedNow);
  } else if (receipt && invoice.receipts && invoice.receipts.length > 0) {
    const idx = invoice.receipts.findIndex((r: any) => r.receiptNumber === receipt.receiptNumber || r.id === receipt.id);
    if (idx > 0) {
      previouslyPaid = invoice.receipts
        .slice(0, idx)
        .filter((r: any) => !r.isReversed)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
    } else {
      previouslyPaid = Math.max(0, totalPaidOnInvoice - receivedNow);
    }
  } else {
    previouslyPaid = Math.max(0, totalPaidOnInvoice - receivedNow);
  }

  let rawOutstanding = 0;
  if (historicalSettlement) {
    rawOutstanding = historicalSettlement.outstanding;
  } else if (invoice.status === 'PAID') {
    rawOutstanding = 0;
  } else if (options?.receivedNow != null && options.receivedNow > 0) {
    if (invoice.balanceDue != null && invoice.balanceDue <= 0) {
      rawOutstanding = 0;
    } else if (invoice.balanceDue != null) {
      rawOutstanding = Math.max(0, Number(invoice.balanceDue));
    } else {
      rawOutstanding = Math.max(0, netPayable - (previouslyPaid + receivedNow));
    }
  } else if (typeof invoice.balanceDue === 'number') {
    rawOutstanding = Math.max(0, invoice.balanceDue);
  } else {
    rawOutstanding = Math.max(0, netPayable - totalPaidOnInvoice);
  }

  const effectiveTotalPaid = historicalSettlement?.paid ?? previouslyPaid + receivedNow;
  const advanceCredit = effectiveTotalPaid > netPayable ? effectiveTotalPaid - netPayable : 0;

  const paymentMethod = options?.paymentMethod || receipt?.method || 'CASH';
  const collectedBy = options?.collectedBy || receipt?.collectedByName || 'Cashier';

  // Doctor Name
  let docName = invoice.doctorName ? invoice.doctorName.trim() : (lines[0]?.performedByName || 'Consultant');
  if (docName && docName !== 'Consultant' && !/^dr\.?/i.test(docName)) {
    docName = `Dr. ${docName}`;
  }

  // RMO Name (Eligible ONLY for EMERGENCY and ADMISSION encounters)
  const isRmoEligible = encType === 'EMERGENCY' || encType === 'ADMISSION' || isIpd;
  let resolvedRmo: string | null = null;
  if (isRmoEligible) {
    const rawRmo =
      options?.rmoName ??
      (invoice as any).rmoName ??
      (invoice as any).rmo?.fullName ??
      (invoice as any).admissionRecord?.rmo?.fullName ??
      (invoice as any).admissionRecord?.rmoStaff?.fullName ??
      null;
    if (rawRmo && typeof rawRmo === 'string' && rawRmo.trim()) {
      resolvedRmo = rawRmo.trim();
      if (!/^dr\.?/i.test(resolvedRmo)) {
        resolvedRmo = `Dr. ${resolvedRmo}`;
      }
    }
  }

  const primaryServiceName = lines[0]?.serviceName || (isIpd ? 'Inpatient Admission' : encType === 'OBSERVATION' ? 'Observation' : encType === 'EMERGENCY' ? 'Emergency' : 'OPD');

  const resolvedWeight = options?.patientWeight ?? (invoice as any).patientWeight ?? (invoice as any).weightKg ?? (invoice as any).admissionRecord?.weightKg ?? (invoice as any).selfPayEncounter?.weightKg ?? (() => {
    const allNotes = String((invoice as any).notes || (invoice as any).admissionRecord?.notes || (invoice as any).appointment?.notes || '');
    const m = allNotes.match(/weight[:\s]+([0-9]+(?:\.[0-9]+)?(?:\s*kg)?)/i);
    return m ? m[1] : null;
  })();

  const admissionNum = invoice.admissionNumber || (invoice as any).admissionRecord?.admissionNumber || null;
  const ward = invoice.wardName || (invoice as any).admissionRecord?.bed?.room?.ward?.name;
  const bed = invoice.bedNumber || (invoice as any).admissionRecord?.bed?.bedNumber;
  const bedStr = bed ? (/^bed\b/i.test(String(bed).trim()) ? String(bed).trim() : `Bed ${String(bed).trim()}`) : '';
  const bedInfo = [ward, bedStr].filter(Boolean).join(' - ') || null;

  const resolvedPanelName =
    invoice.panelName ||
    (invoice as any).corporatePanel?.organizationName ||
    (invoice as any).corporatePanel?.name ||
    (invoice as any).panelPatient?.corporatePanel?.organizationName ||
    null;

  const resolvedPanelMemberId =
    invoice.panelMemberId ||
    (invoice as any).panelPatient?.panelMemberId ||
    null;

  return {
    receiptNumber,
    invoiceNumber,
    dateTime,
    encounterType: isIpd ? 'ADMISSION' : encType,
    encounterRef: invoice.sourceType,
    // Queue / Token Number from database (strictly excluded for IPD / Admission and Custom Billing)
    tokenNumber: (isIpd || encType === 'CUSTOM') ? null : (invoice.queueNumber || null),
    mrNumber: invoice.patientMr || '—',
    patientName: invoice.patientName || 'Patient',
    patientAge: options?.patientAge ?? invoice.patientAge ?? null,
    patientGender: options?.patientGender ?? invoice.patientGender ?? null,
    patientWeight: resolvedWeight,
    admissionNumber: admissionNum,
    bedInfo,
    doctorName: docName,
    rmoName: resolvedRmo,
    serviceName: primaryServiceName,
    lines,
    fees,
    others,
    payerType: invoice.payerType,
    panelName: resolvedPanelName,
    panelMemberId: resolvedPanelMemberId,
    patientShare: invoice.patientShare,
    panelReceivable: invoice.panelReceivable,
    subtotal: subtotal > 0 ? subtotal : netTotal,
    totalDiscount,
    totalTax: 0,
    total: netPayable > 0 ? netPayable : netTotal,
    netTotal: netTotal > 0 ? netTotal : netPayable,
    receivedNow,
    previouslyPaid,
    paid: effectiveTotalPaid > 0 ? effectiveTotalPaid : receivedNow,
    outstanding: rawOutstanding,
    advanceCredit,
    paymentMethod,
    collectedBy,
    patientPhone: invoice.patientPhone || null,
    isReprint: options?.isReprint || false,
  };
}

/**
 * Generates compact 80mm thermal receipt HTML with authentic POS monospace typography.
 * Strictly monochrome black & white without colorful ink.
 * Height grows dynamically with any number of real service lines without clipping or truncation.
 */
export function generateThermalReceiptHtml(
  data: ThermalReceiptData,
  profile?: HospitalProfile
): string {
  const hp = profile || getHospitalProfile();
  const hospitalName = hp.name || 'CH SHARIF AND SAEED HOSPITAL';

  const isIpd = data.encounterType === 'ADMISSION' || (data.encounterType as string) === 'IPD';
  const isCustom = data.encounterType === 'CUSTOM';
  const showToken = !isIpd && !isCustom && !!data.tokenNumber;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${data.invoiceNumber || data.receiptNumber}</title>
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
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      line-height: 1.2;
      color: #000;
      margin-bottom: 2px;
    }
    .doc-type {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.8px;
      color: #000;
      margin-top: 1px;
      text-transform: uppercase;
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

    .token-box {
      border: 1.5px solid #000;
      padding: 3px 5px;
      margin: 4px 0;
      text-align: center;
      background: #fff;
    }
    .token-title {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #000;
    }
    .token-num {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 1px;
      color: #000;
      margin-top: 1px;
      line-height: 1.1;
    }

    .info-table, .services-table, .charges-table {
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
    .val-patient {
      width: 62%;
      font-weight: 700;
      color: #000;
      text-align: right;
    }

    .services-table {
      margin: 2px 0;
    }
    .services-table th {
      padding: 2px 0;
      font-size: 9.5px;
      font-weight: 700;
      border-bottom: 1px dashed #000;
      text-transform: uppercase;
    }
    .services-table td {
      padding: 2px 0;
      font-size: 10.5px;
      vertical-align: top;
      word-break: break-word;
    }
    .service-row {
      border-bottom: 1px dotted #000;
    }
    .service-row:last-child {
      border-bottom: none;
    }
    .service-name {
      font-weight: 700;
      line-height: 1.2;
    }
    .service-subnote {
      font-size: 9px;
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
      font-size: 11.5px;
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
      font-size: 10px;
      color: #000;
      margin-top: 5px;
      line-height: 1.25;
    }
    .footer-msg {
      font-weight: 700;
      font-size: 11px;
      color: #000;
    }
    .footer-powered {
      font-size: 8.5px;
      font-weight: 500;
      color: #000;
      margin-top: 2px;
      letter-spacing: 0.2px;
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
  </style>
</head>
<body>
  <div class="header">
    <div class="hospital-title">${escapeHtml(hospitalName)}</div>
    <div class="doc-type">PAYMENT RECEIPT</div>
    ${data.isReprint ? '<div class="reprint-badge">*** REPRINT / DUPLICATE ***</div>' : ''}
  </div>

  <div class="divider"></div>

  ${showToken ? `
  <div class="token-box">
    <div class="token-title">Queue / Token Number</div>
    <div class="token-num">${escapeHtml(data.tokenNumber || '')}</div>
  </div>
  <div class="divider"></div>
  ` : ''}

  <!-- SECTION 1: PATIENT INFORMATION -->
  <div class="section-title">PATIENT INFORMATION</div>
  <table class="info-table">
    <tr>
      <td class="label">Patient:</td>
      <td class="val-patient">${escapeHtml(data.patientName)}</td>
    </tr>
    <tr>
      <td class="label">MR No:</td>
      <td class="val">${escapeHtml(data.mrNumber || '—')}</td>
    </tr>
    ${data.panelName ? `
    <tr>
      <td class="label">Panel:</td>
      <td class="val-patient">${escapeHtml(data.panelName)}</td>
    </tr>` : ''}
    ${data.panelMemberId ? `
    <tr>
      <td class="label">Member ID:</td>
      <td class="val font-mono">${escapeHtml(data.panelMemberId)}</td>
    </tr>` : ''}
    ${(data.patientAge || data.patientGender) ? `
    <tr>
      <td class="label">Age / Sex:</td>
      <td class="val">${[data.patientAge ? `${data.patientAge} Y` : '', data.patientGender].filter(Boolean).join(' / ')}</td>
    </tr>` : ''}
    <tr>
      <td class="label">Weight:</td>
      <td class="val">${data.patientWeight ? (String(data.patientWeight).toLowerCase().includes('kg') ? data.patientWeight : `${data.patientWeight} kg`) : '—'}</td>
    </tr>
    <tr>
      <td class="label">Doctor:</td>
      <td class="val">${escapeHtml(data.doctorName || 'Consultant')}</td>
    </tr>
    ${(data.rmoName && (data.encounterType === 'EMERGENCY' || data.encounterType === 'ADMISSION' || data.encounterType === 'IPD')) ? `
    <tr>
      <td class="label">RMO:</td>
      <td class="val">${escapeHtml(data.rmoName)}</td>
    </tr>` : ''}
    ${data.admissionNumber ? `
    <tr>
      <td class="label">Admission:</td>
      <td class="val">${escapeHtml(data.admissionNumber)}</td>
    </tr>` : ''}
    ${data.bedInfo ? `
    <tr>
      <td class="label">Ward / Bed:</td>
      <td class="val">${escapeHtml(data.bedInfo)}</td>
    </tr>` : ''}
  </table>

  <div class="divider"></div>

  <!-- SECTION 2: INVOICE & PAYMENT -->
  <div class="section-title">INVOICE &amp; PAYMENT</div>
  <table class="info-table">
    <tr>
      <td class="label">Invoice No:</td>
      <td class="val">${escapeHtml(data.invoiceNumber || data.receiptNumber)}</td>
    </tr>
    <tr>
      <td class="label">Receipt No:</td>
      <td class="val">${escapeHtml(data.receiptNumber)}</td>
    </tr>
    <tr>
      <td class="label">Date:</td>
      <td class="val">${escapeHtml(data.dateTime)}</td>
    </tr>
    <tr>
      <td class="label">Pay Mode:</td>
      <td class="val">${escapeHtml(data.paymentMethod || 'CASH')}</td>
    </tr>
    <tr>
      <td class="label">Encounter:</td>
      <td class="val">${escapeHtml(data.encounterType)}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <!-- SECTION 3: REAL SERVICE LINES (DYNAMIC ENCOUNTER LEDGER) -->
  <div class="section-title">SERVICES &amp; CHARGES</div>
  <table class="services-table">
    <thead>
      <tr>
        <th class="text-left" style="width: 60%;">SERVICE</th>
        <th class="text-center" style="width: 15%;">QTY</th>
        <th class="text-right" style="width: 25%;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${data.lines && data.lines.length > 0 ? data.lines.map((item) => `
        <tr class="service-row">
          <td class="text-left" style="padding-right: 2px;">
            <div class="service-name">${escapeHtml(item.serviceName)}</div>
            ${item.quantity > 1 ? `<div class="service-subnote">${item.quantity} x @ ${formatAmount(item.unitRate)}</div>` : ''}
            ${item.discountAmount && item.discountAmount > 0 ? `<div class="service-subnote">Disc: -${formatAmount(item.discountAmount)}</div>` : ''}
          </td>
          <td class="text-center" style="vertical-align: top;">${item.quantity}</td>
          <td class="text-right" style="vertical-align: top; font-weight: 700;">${formatAmount(item.netAmount)}</td>
        </tr>
      `).join('') : `
        <tr class="service-row">
          <td class="text-left">${escapeHtml(data.serviceName || 'Consultation / Encounter Fee')}</td>
          <td class="text-center">1</td>
          <td class="text-right font-bold">${formatAmount(data.total)}</td>
        </tr>
      `}
    </tbody>
  </table>

  <div class="divider"></div>

  <!-- SECTION 4: TOTALS & PAYMENT SETTLEMENT -->
  <table class="charges-table">
    ${data.totalDiscount && data.totalDiscount > 0 ? `
    <tr>
      <td class="text-left">Subtotal</td>
      <td class="text-right">${formatAmount(data.subtotal)}</td>
    </tr>
    <tr>
      <td class="text-left">Discount</td>
      <td class="text-right">-${formatAmount(data.totalDiscount)}</td>
    </tr>
    ` : ''}
    <tr>
      <td class="text-left total-val">NET TOTAL</td>
      <td class="text-right total-val">${formatAmount(data.netTotal || data.total)}</td>
    </tr>
    ${data.previouslyPaid && data.previouslyPaid > 0 ? `
    <tr>
      <td class="text-left">Previously Paid</td>
      <td class="text-right">${formatAmount(data.previouslyPaid)}</td>
    </tr>
    ` : ''}
    <tr>
      <td class="text-left paid-val">RECEIVED NOW</td>
      <td class="text-right paid-val">${formatAmount(data.receivedNow)}</td>
    </tr>
    ${data.paid > data.receivedNow ? `
    <tr>
      <td class="text-left">Total Paid</td>
      <td class="text-right">${formatAmount(data.paid)}</td>
    </tr>
    ` : ''}
    <tr>
      <td class="text-left out-val">OUTSTANDING</td>
      <td class="text-right out-val">${formatAmount(data.outstanding)}</td>
    </tr>
    ${data.advanceCredit && data.advanceCredit > 0 ? `
    <tr>
      <td class="text-left" style="font-weight: 700;">EXCESS / ADVANCE</td>
      <td class="text-right" style="font-weight: 700;">${formatAmount(data.advanceCredit)}</td>
    </tr>
    ` : ''}
  </table>

  <div class="divider"></div>

  <div class="footer">
    <div class="footer-msg">Thank You</div>
    <div class="footer-powered">Powered by Isysware Software Solutions</div>
  </div>

  <script>
    if (window.name !== 'thermal-print-iframe') {
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
 * Never blocked by popup blockers and ONLY prints the pure receipt (no modals, no buttons, no UI chrome).
 */
export function printThermalReceiptViaIframe(
  data: ThermalReceiptData,
  profile?: HospitalProfile
): void {
  const html = generateThermalReceiptHtml(data, profile);
  const existing = document.getElementById('thermal-print-iframe');
  if (existing) {
    existing.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'thermal-print-iframe';
  iframe.name = 'thermal-print-iframe';
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

/**
 * Triggers direct 80mm thermal receipt printing via isolated iframe.
 */
export function printThermalReceipt(
  data: ThermalReceiptData,
  profile?: HospitalProfile
): { success: boolean } {
  printThermalReceiptViaIframe(data, profile);
  return { success: true };
}

export interface ThermalPaymentReceiptProps {
  encounterType?: 'OPD' | 'EMERGENCY' | 'OBSERVATION' | string;
  receipt: ThermalReceiptData;
  onPrint?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Authentic 80mm Thermal Receipt Preview component:
 * - 100% Monochrome Black & White (No colorful ink)
 * - Dynamic height for 1, 3, 10, or 25+ real service lines
 * - Real DB encounter lines are the single source of truth
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
  const isCustom = activeEncounterType === 'CUSTOM';
  const showToken = !isIpd && !isCustom && !!receipt.tokenNumber;

  const [isPrinting, setIsPrinting] = useState(false);

  const handleTriggerPrint = () => {
    setIsPrinting(true);
    try {
      if (onPrint) {
        onPrint();
      } else {
        printThermalReceipt(receipt, hp);
      }
    } finally {
      setTimeout(() => setIsPrinting(false), 500);
    }
  };

  return (
    <div className={`bg-slate-100 p-3.5 rounded-xl flex flex-col items-center border border-slate-200 ${className}`}>
      {/* 80mm Monochrome Visual Receipt Paper Container (Dynamic Height) */}
      <div
        id="thermal-receipt-container"
        className="bg-white text-black border border-slate-300 shadow-[0_4px_16px_rgba(0,0,0,0.12)] rounded-xs p-4 w-[285px] max-w-[295px] select-none relative"
        style={{
          fontFamily: "'Share Tech Mono', 'Space Mono', 'Consolas', 'Courier New', monospace",
          color: '#000000',
        }}
      >
        {/* Header */}
        <div className="text-center pb-1">
          <div className="font-bold text-[13px] tracking-wide text-black uppercase leading-tight">
            {hp.name || 'CH SHARIF AND SAEED HOSPITAL'}
          </div>
          <div className="font-bold text-[10.5px] text-black uppercase tracking-wider mt-1 border-t border-b border-dashed border-black py-0.5">
            Payment Receipt
          </div>
          {receipt.isReprint && (
            <div className="inline-block border border-dashed border-black text-black px-1.5 py-0.5 text-[9px] font-bold uppercase mt-1">
              *** Reprint / Duplicate ***
            </div>
          )}
        </div>

        {/* Token Number Box (OPD / ER / Observation only) - Prominent & Bold */}
        {showToken && (
          <div className="border-2 border-black bg-white p-2 my-2 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black">
              Queue / Token Number
            </div>
            <div className="text-2xl font-bold tracking-widest text-black mt-0.5 leading-none">
              {receipt.tokenNumber}
            </div>
          </div>
        )}

        {/* SECTION 1: PATIENT INFORMATION */}
        <div className="border-t border-dashed border-black pt-2 pb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black border-b border-dotted border-black pb-0.5 mb-1.5">
            Patient Information
          </div>
          <div className="space-y-1 text-[11px] font-semibold text-black">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Patient:</span>
              <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.patientName}>
                {receipt.patientName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">MR No:</span>
              <span className="font-bold text-black">{receipt.mrNumber || '—'}</span>
            </div>
            {receipt.panelName && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">Panel:</span>
                <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.panelName}>
                  {receipt.panelName}
                </span>
              </div>
            )}
            {receipt.panelMemberId && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">Member ID:</span>
                <span className="font-bold text-black font-mono">{receipt.panelMemberId}</span>
              </div>
            )}
            {(receipt.patientAge || receipt.patientGender) && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">Age / Sex:</span>
                <span className="font-semibold text-black">
                  {[receipt.patientAge ? `${receipt.patientAge} Y` : '', receipt.patientGender].filter(Boolean).join(' / ')}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Weight:</span>
              <span className="font-bold text-black font-mono">
                {receipt.patientWeight ? (String(receipt.patientWeight).toLowerCase().includes('kg') ? receipt.patientWeight : `${receipt.patientWeight} kg`) : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Doctor:</span>
              <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.doctorName || 'Consultant'}>
                {receipt.doctorName || 'Consultant'}
              </span>
            </div>
            {(receipt.rmoName && (receipt.encounterType === 'EMERGENCY' || receipt.encounterType === 'ADMISSION' || (receipt.encounterType as string) === 'IPD')) && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">RMO:</span>
                <span className="font-bold text-black text-right max-w-[170px] truncate" title={receipt.rmoName}>
                  {receipt.rmoName}
                </span>
              </div>
            )}
            {receipt.admissionNumber && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">Admission:</span>
                <span className="font-bold text-black font-mono">{receipt.admissionNumber}</span>
              </div>
            )}
            {receipt.bedInfo && (
              <div className="flex justify-between items-center">
                <span className="font-semibold text-black">Ward / Bed:</span>
                <span className="font-semibold text-black text-right max-w-[170px] truncate" title={receipt.bedInfo}>
                  {receipt.bedInfo}
                </span>
              </div>
            )}
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
              <span className="font-bold text-black">{receipt.invoiceNumber || receipt.receiptNumber}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Receipt No:</span>
              <span className="font-bold text-black">{receipt.receiptNumber}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Date:</span>
              <span className="font-semibold text-black">{receipt.dateTime}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Pay Mode:</span>
              <span className="font-bold text-black">{receipt.paymentMethod || 'CASH'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-black">Encounter:</span>
              <span className="font-semibold text-black">{receipt.encounterType}</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: REAL SERVICE LINES (DYNAMIC ENCOUNTER LEDGER) */}
        <div className="border-t border-dashed border-black pt-2 pb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-black border-b border-dotted border-black pb-0.5 mb-1.5">
            Services &amp; Charges
          </div>
          <table className="w-full border-collapse text-[10.5px] font-semibold text-black">
            <thead>
              <tr className="border-b border-dashed border-black text-[9.5px] font-bold text-black uppercase">
                <th className="text-left py-1 font-bold">Service</th>
                <th className="text-center py-1 font-bold w-9">Qty</th>
                <th className="text-right py-1 font-bold w-16">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-black">
              {receipt.lines && receipt.lines.length > 0 ? (
                receipt.lines.map((line, idx) => (
                  <tr key={line.lineId || idx} className="align-top">
                    <td className="text-left py-1 pr-1">
                      <div className="font-bold text-black leading-tight">{line.serviceName}</div>
                      {line.quantity > 1 && (
                        <div className="text-[9px] text-black font-normal">
                          {line.quantity} × @ {formatAmount(line.unitRate)}
                        </div>
                      )}
                      {line.discountAmount != null && line.discountAmount > 0 && (
                        <div className="text-[9px] text-black font-normal">
                          Disc: -{formatAmount(line.discountAmount)}
                        </div>
                      )}
                    </td>
                    <td className="text-center py-1 font-mono">{line.quantity}</td>
                    <td className="text-right py-1 font-mono font-bold tabular-nums">
                      {formatAmount(line.netAmount)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="text-left py-1">{receipt.serviceName || 'Consultation / Encounter Fee'}</td>
                  <td className="text-center py-1 font-mono">1</td>
                  <td className="text-right py-1 font-mono font-bold">{formatAmount(receipt.total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* SECTION 4: TOTALS & SETTLEMENT */}
        <div className="border-t border-dashed border-black pt-2 pb-2 text-[11px] font-semibold text-black space-y-1">
          {receipt.totalDiscount > 0 && (
            <>
              <div className="flex justify-between py-0.5">
                <span className="font-semibold text-black">Subtotal</span>
                <span className="font-mono text-black tabular-nums">{formatAmount(receipt.subtotal)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="font-semibold text-black">Discount</span>
                <span className="font-mono text-black tabular-nums">-{formatAmount(receipt.totalDiscount)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-[12px] font-bold text-black border-t border-dashed border-black pt-1">
            <span>NET TOTAL</span>
            <span className="tabular-nums font-mono">{formatAmount(receipt.netTotal || receipt.total)}</span>
          </div>
          {receipt.previouslyPaid > 0 && (
            <div className="flex justify-between py-0.5">
              <span className="font-semibold text-black">Previously Paid</span>
              <span className="font-mono text-black tabular-nums">{formatAmount(receipt.previouslyPaid)}</span>
            </div>
          )}
          <div className="flex justify-between text-[11.5px] font-bold text-black">
            <span>RECEIVED NOW</span>
            <span className="tabular-nums font-mono">{formatAmount(receipt.receivedNow)}</span>
          </div>
          {receipt.paid > receipt.receivedNow && (
            <div className="flex justify-between py-0.5">
              <span className="font-semibold text-black">Total Paid</span>
              <span className="font-mono text-black tabular-nums">{formatAmount(receipt.paid)}</span>
            </div>
          )}
          <div className="flex justify-between text-[11.5px] font-bold text-black border-t border-dotted border-black pt-0.5">
            <span>OUTSTANDING</span>
            <span className="tabular-nums font-mono">{formatAmount(receipt.outstanding)}</span>
          </div>
          {receipt.advanceCredit > 0 && (
            <div className="flex justify-between text-[11px] font-bold text-black">
              <span>EXCESS / ADVANCE</span>
              <span className="tabular-nums font-mono">{formatAmount(receipt.advanceCredit)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-dashed border-black pt-2 text-center text-[10px] text-black leading-tight">
          <div className="font-bold text-[11px] text-black">Thank You</div>
          <div className="text-[8.5px] font-medium text-black mt-1 tracking-wide">
            Powered by Isysware Software Solutions
          </div>
        </div>
      </div>

      {/* Print isolation styles when printed from parent window */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #thermal-receipt-container, #thermal-receipt-container * {
            visibility: visible !important;
          }
          #thermal-receipt-container {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            padding: 2mm 1mm 3mm 1mm !important;
            box-shadow: none !important;
            border: none !important;
            width: 74mm !important;
            max-width: 76mm !important;
            height: auto !important;
          }
        }
      `}</style>

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
          <span>{isPrinting ? 'Printing…' : 'Print 80mm Receipt'}</span>
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

export interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: ThermalReceiptData | null;
}

/**
 * Modal wrapper for displaying and printing the 80mm thermal receipt.
 * Clean, high-contrast backdrop (z-[70]) without cheap stacked blur distortion.
 */
export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  isOpen,
  onClose,
  receipt,
}) => {
  if (!isOpen || !receipt) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/75 animate-in fade-in duration-150 print:p-0 print:bg-transparent print:static">
      <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200/90 max-w-sm w-full p-4 overflow-y-auto max-h-[95vh] print:p-0 print:border-none print:shadow-none print:max-w-none print:w-auto">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 mb-2.5 print:hidden">
          <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider font-sans">
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
