import React, { useState, useRef } from 'react';
import {
  X,
  Printer,
  Receipt,
  FileText,
  CreditCard,
  Undo2,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  Clock,
  User,
  Plus,
  Loader2,
  Pill,
} from 'lucide-react';
import { formatPKR, formatNumber, formatDateTime } from '../utils/format';
import { pharmacyApi } from '../services/pharmacyApi';
import apiClient, { HMS_BASE_URL } from '../services/apiClient';
import { useToast } from '../context/ToastContext';

import {
  PharmacyThermalReceipt,
  buildPharmacyThermalReceiptData,
  printPharmacyThermalReceipt,
} from './PharmacyThermalReceipt';

interface PharmacyInvoiceModalProps {
  invoice: any;
  onClose: () => void;
  onUpdated?: (updatedInvoice: any) => void;
  initialAction?: 'return' | 'payment';
}

export const PharmacyInvoiceModal: React.FC<PharmacyInvoiceModalProps> = ({
  invoice: initialInvoice,
  onClose,
  onUpdated,
  initialAction,
}) => {
  const toast = useToast();
  const [invoice, setInvoice] = useState(initialInvoice);
  const [viewMode, setViewMode] = useState<'thermal' | 'tax_invoice' | 'hms_details'>(
    initialInvoice.channel === 'HMS_LINKED' ? 'hms_details' : 'thermal'
  );
  const [hmsTab, setHmsTab] = useState<'granular' | 'aggregated'>('granular');

  // Payment states
  const [showAddPayment, setShowAddPayment] = useState(initialAction === 'payment');
  const [payAmount, setPayAmount] = useState(
    Number(invoice.outstanding) > 0 ? String(invoice.outstanding) : ''
  );
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'ONLINE'>('CASH');
  const [paying, setPaying] = useState(false);

  // Return states
  const [showReturn, setShowReturn] = useState(initialAction === 'return');
  const [returnLines, setReturnLines] = useState<Record<string, { qty: string; restock: boolean }>>({});
  const returnRequest = useRef<{ fingerprint:string; key:string } | null>(null);
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'CARD' | 'ONLINE'>('CASH');
  const [returnReason, setReturnReason] = useState('');
  const [returning, setReturning] = useState(false);
  const [hospitalLogo, setHospitalLogo] = useState<string | null>(null);
  const [hospitalProfile, setHospitalProfile] = useState<any>(null);
  const [pharmacySettings, setPharmacySettings] = useState<any>(null);

  React.useEffect(() => {
    fetch(`${HMS_BASE_URL}/public/hospital-profile`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.data) {
          setHospitalProfile(data.data);
          if (data.data.logo) {
            setHospitalLogo(data.data.logo);
          }
        }
      })
      .catch(() => {});

    pharmacyApi
      .getPharmacySettings()
      .then((s) => setPharmacySettings(s))
      .catch(() => {});

    if (initialInvoice?.id) {
      pharmacyApi
        .getInvoiceById(initialInvoice.id)
        .then((fresh) => {
          if (fresh) setInvoice(fresh);
        })
        .catch(() => {});
    }
  }, [initialInvoice?.id]);

  const thermalData = buildPharmacyThermalReceiptData(
    invoice,
    pharmacySettings,
    hospitalProfile,
    { isReprint: false }
  );

  const handlePrint = () => {
    if (viewMode === 'thermal') {
      printPharmacyThermalReceipt(thermalData);
    } else {
      window.print();
    }
  };

  const handleAddPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    setPaying(true);
    try {
      const res = await apiClient.post(`/pharmacy/invoices/${invoice.id}/payments`, {
        amount,
        method: payMethod,
      });
      toast.success('Payment recorded successfully.');
      setInvoice(res.data.data);
      if (onUpdated) onUpdated(res.data.data);
      setShowAddPayment(false);
      setPayAmount('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to record payment.');
    } finally {
      setPaying(false);
    }
  };

  const handleReturn = async () => {
    const lines = Object.entries(returnLines)
      .filter(([, v]) => Number(v.qty) > 0)
      .map(([invoiceLineId, v]) => ({
        invoiceLineId,
        quantity: Number(v.qty),
        restock: v.restock,
      }));
    if (lines.length === 0) {
      toast.error('Enter a return quantity for at least one medicine.');
      return;
    }
    if (!returnReason.trim()) {
      toast.error('Return reason is required.');
      return;
    }
    setReturning(true);
    try {
      const fingerprint = JSON.stringify({invoiceId:invoice.id,lines,returnReason,refundMethod});
      if (returnRequest.current?.fingerprint !== fingerprint) returnRequest.current = {fingerprint,key:crypto.randomUUID()};
      const res = await pharmacyApi.salesReturn({
        requestKey:returnRequest.current.key,
        invoiceId: invoice.id,
        lines,
        reason: returnReason,
        refundMethod,
      });
      toast.success(`Return processed — Refund of ${formatPKR(res.refundTotal)} issued.`);
      returnRequest.current = null;
      setShowReturn(false);
      setReturnLines({});
      setReturnReason('');
      // Reload fresh invoice details
      const fresh = await pharmacyApi.getInvoiceById(invoice.id);
      setInvoice(fresh);
      if (onUpdated) onUpdated(fresh);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to process sales return.');
    } finally {
      setReturning(false);
    }
  };

  const statusColor =
    invoice.status === 'PAID'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : invoice.status === 'PARTIALLY_PAID'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-rose-50 text-rose-700 border-rose-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs overflow-y-auto print:p-0 print:bg-white print:static">
      <div className={`bg-white rounded-2xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden print:max-h-none print:shadow-none print:border-none print:w-full print:max-w-none ${viewMode === 'hms_details' ? 'max-w-4xl' : 'max-w-2xl'}`}>
        {/* Top Control Bar (Clean White Theme — Hidden when printing) */}
        <div className="px-5 py-3.5 bg-white border-b border-slate-200/90 flex items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-[#0e7d5a] flex items-center justify-center font-bold">
              {viewMode === 'hms_details' ? <Pill className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-extrabold tracking-tight text-slate-900">
                  {invoice.invoiceNumber}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusColor}`}>
                  {invoice.status.replace('_', ' ')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {pharmacySettings?.hospitalName || pharmacySettings?.receiptHeaderText || hospitalProfile?.name || 'CH Sharif & Saeed Hospital'} · {pharmacySettings?.pharmacySubtitle || 'Central Pharmacy POS Slip'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle (Clean Slate Pill) */}
            <div className="bg-slate-100 p-0.5 rounded-lg flex items-center border border-slate-200">
              {invoice.channel === 'HMS_LINKED' && (
                <button
                  type="button"
                  onClick={() => setViewMode('hms_details')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                    viewMode === 'hms_details'
                      ? 'bg-white text-[#0e7d5a] shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Pill className="h-3.5 w-3.5" /> Inpatient Details
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewMode('thermal')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                  viewMode === 'thermal'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="h-3.5 w-3.5" /> Thermal (80mm)
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tax_invoice')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                  viewMode === 'tax_invoice'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="h-3.5 w-3.5" /> A4 Invoice
              </button>
            </div>

            {/* Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#0e7d5a] hover:bg-[#0c6b50] rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Close invoice"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Action Toolbar (Return & Add Payment options) */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0 print:hidden text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Channel:</span>
            <span className="font-semibold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
              {invoice.channel === 'HMS_LINKED' ? 'Inpatient / HMS Dispense' : 'Retail Walk-In POS'}
            </span>
            {invoice.customerName && (
              <span className="text-slate-600">
                Customer: <strong className="text-slate-900">{invoice.customerName}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowReturn((prev) => !prev);
                setShowAddPayment(false);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold border flex items-center gap-1 transition-colors ${
                showReturn
                  ? 'bg-rose-50 text-rose-700 border-rose-300'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Undo2 className="h-3.5 w-3.5" /> {showReturn ? 'Cancel Return' : 'Sales Return'}
            </button>

            {/* HMS-linked invoices are paid by the patient at the HMS Front
                Desk, not at this pharmacy counter — "Record Payment" here
                is only for retail/walk-in invoices. What HMS owes Pharmacy
                back is collected via "Request Settlement" instead (see the
                HMS Receivable card above / HMS Receivables page). */}
            {invoice.channel !== 'HMS_LINKED' && Number(invoice.outstanding) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowAddPayment((prev) => !prev);
                  setShowReturn(false);
                }}
                className={`px-2.5 py-1 rounded-md font-semibold border flex items-center gap-1 transition-colors ${
                  showAddPayment
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-[#08775A] text-white border-[#08775A] hover:bg-[#065f46]'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" /> {showAddPayment ? 'Close' : 'Record Payment'}
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Modal Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 bg-slate-100/60 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          {viewMode === 'thermal' && (
            <PharmacyThermalReceipt
              receipt={thermalData}
              onPrint={() => printPharmacyThermalReceipt(thermalData)}
              onClose={onClose}
            />
          )}

          {viewMode === 'tax_invoice' && (
            <div
              id="pharmacy-printable-invoice"
              className="bg-white shadow-sm border border-slate-200 print:shadow-none print:border-none w-full transition-all max-w-2xl p-7 text-xs text-slate-800"
            >
              {/* ═════════════════════════════════════════════════════════════
                 STANDARD TAX INVOICE VIEW (A4 Medical Bill)
                 ═════════════════════════════════════════════════════════════ */}
              <div className="space-y-6">
                {/* Header Banner */}
                <div className="flex items-start justify-between pb-4 border-b-2 border-emerald-800">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {hospitalLogo ? (
                        <img
                          src={hospitalLogo}
                          alt="Hospital Logo"
                          className="h-8 w-8 object-contain rounded border border-emerald-200"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-base">
                          CH
                        </div>
                      )}
                      <h1 className="text-lg font-black tracking-tight text-slate-900 uppercase">
                        {pharmacySettings?.hospitalName || pharmacySettings?.receiptHeaderText || hospitalProfile?.name || 'CH Sharif & Saeed Hospital'}
                      </h1>
                    </div>
                    <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                      {pharmacySettings?.pharmacySubtitle || 'Central Pharmacy & Retail Dispensary'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {pharmacySettings?.address || hospitalProfile?.address || 'Main Boulevard, Near Jail Road · 24/7 Pharmacy Care'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {pharmacySettings?.phone || (hospitalProfile?.primaryPhone ? `Phone: ${hospitalProfile.primaryPhone}` : 'UAN: +92 42 111-467-748')}
                    </p>
                    {pharmacySettings?.email && (
                      <p className="text-[11px] text-slate-500">
                        {pharmacySettings.email}
                      </p>
                    )}
                  </div>

                  <div className="text-right space-y-1">
                    <div className="inline-block px-3 py-1 rounded bg-slate-900 text-white font-mono text-xs font-bold uppercase tracking-wider">
                      PHARMACY INVOICE
                    </div>
                    <div className="font-mono text-sm font-bold text-slate-950">
                      {invoice.invoiceNumber}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Dated: {formatDateTime(invoice.createdAt)}
                    </div>
                    <div className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>
                      {invoice.status.replace('_', ' ')}
                    </div>
                  </div>
                </div>

                {/* Patient / Customer & Dispenser Info Cards */}
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Patient / Customer Details
                    </div>
                    <div className="font-bold text-sm text-slate-900">
                      {invoice.customerName || 'Walk-In Customer'}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Channel: <span className="font-semibold text-slate-800">{invoice.channel === 'HMS_LINKED' ? 'Inpatient / Admission' : 'Retail Walk-in'}</span>
                    </div>
                    {invoice.medicineRequestId && (
                      <div className="text-[11px] text-slate-600">
                        HMS Request Ref: <span className="font-mono">{invoice.medicineRequestId.slice(0, 8).toUpperCase()}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 text-right sm:text-left">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Dispensing Attribution
                    </div>
                    <div className="font-bold text-sm text-slate-900">
                      {invoice.dispensedByUser?.fullName || invoice.dispensedByUser?.username || 'Staff Pharmacist'}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Role: <span className="font-semibold text-slate-800">{invoice.dispensedByUser?.role || 'Pharmacist'}</span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Station: Central Pharmacy POS-1
                    </div>
                  </div>
                </div>

                {/* Medicine Items Grid */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left">
                    <thead className="bg-[#f1f5f9] text-[11px] font-bold text-slate-800 uppercase tracking-wide border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 text-center w-10">#</th>
                        <th className="py-2.5 px-3">Medicine Description</th>
                        <th className="py-2.5 px-3">Batch &amp; Expiry</th>
                        <th className="py-2.5 px-3 text-center">Qty</th>
                        <th className="py-2.5 px-3 text-right">Unit Rate</th>
                        <th className="py-2.5 px-3 text-right">Discount</th>
                        <th className="py-2.5 px-3 text-right">Net Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {invoice.lines?.map((line: any, idx: number) => {
                        const medName = line.medicine?.name || 'Medicine Item';
                        const medCode = line.medicine?.code || '';
                        const batchNo = line.batch?.batchNumber || '—';
                        const expDate = line.batch?.expiryDate
                          ? new Date(line.batch.expiryDate).toLocaleDateString('en-GB')
                          : '—';
                        const qty = Number(line.quantity || 0);
                        const retQty = Number(line.returnedQuantity || 0);
                        const rate = Number(line.rateSnapshot || 0);
                        const disc = Number(line.discountAmount || 0);
                        const net = Number(line.lineNet || 0);

                        return (
                          <tr key={line.id || idx} className="hover:bg-slate-50/60">
                            <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-bold text-slate-900">{medName}</div>
                              {medCode && (
                                <div className="text-[10px] text-slate-400 font-mono">{medCode}</div>
                              )}
                              {retQty > 0 && (
                                <span className="inline-block mt-0.5 text-[9.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded">
                                  {retQty} returned
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-[11px] text-slate-600">
                              <span className="font-mono font-medium">{batchNo}</span>
                              <div className="text-[10px] text-slate-400">Exp: {expDate}</div>
                            </td>
                            <td className="py-2 px-3 text-center font-bold tabular-nums">
                              {qty}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-700">
                              {formatPKR(rate)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-500">
                              {disc > 0 ? formatPKR(disc) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-bold tabular-nums text-slate-900">
                              {formatPKR(net)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Financial Summary & Signatures */}
                <div className="grid grid-cols-2 gap-6 pt-2 items-start">
                  <div className="space-y-3">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
                      <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                        Pharmacy Terms &amp; Return Conditions:
                      </div>
                      <p className="whitespace-pre-line leading-relaxed">
                        {pharmacySettings?.footerTerms ||
                          pharmacySettings?.receiptFooterText ||
                          '1. Returns accepted within 3 days with this original receipt.\n2. Cut strips, syringes, ampoules, and cold chain items cannot be returned.\n3. Keep all medicines out of reach of children.'}
                      </p>
                      {pharmacySettings?.footerMessage && (
                        <p className="font-semibold text-emerald-800 pt-1.5 border-t border-slate-200/80 text-[11px]">
                          {pharmacySettings.footerMessage}
                        </p>
                      )}
                    </div>

                    <div className="pt-8 grid grid-cols-2 gap-4 text-center">
                      <div className="border-t border-slate-300 pt-1 text-[10px] text-slate-500">
                        Dispensed by Pharmacist
                      </div>
                      <div className="border-t border-slate-300 pt-1 text-[10px] text-slate-500">
                        Customer Signature
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Gross Amount:</span>
                      <span className="font-semibold tabular-nums">{formatPKR(invoice.subtotal)}</span>
                    </div>
                    {Number(invoice.discountTotal) > 0 && (
                      <div className="flex justify-between text-xs text-emerald-700">
                        <span>Total Discounts:</span>
                        <span className="font-semibold tabular-nums">- {formatPKR(invoice.discountTotal)}</span>
                      </div>
                    )}
                    {Number(invoice.taxTotal) > 0 && (
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Applicable GST/Tax:</span>
                        <span className="font-semibold tabular-nums">+ {formatPKR(invoice.taxTotal)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-300 pt-2 flex justify-between text-sm font-bold text-slate-900">
                      <span>Total Net Payable:</span>
                      <span className="tabular-nums text-base text-emerald-800">{formatPKR(invoice.total)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-emerald-800 font-semibold">
                      <span>Total Paid:</span>
                      <span className="tabular-nums">{formatPKR(invoice.paidTotal)}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex justify-between text-xs font-bold">
                      <span className={Number(invoice.outstanding) > 0 ? 'text-rose-700' : 'text-slate-700'}>
                        Outstanding Balance:
                      </span>
                      <span className={`tabular-nums ${Number(invoice.outstanding) > 0 ? 'text-rose-700 text-sm' : 'text-slate-800'}`}>
                        {formatPKR(invoice.outstanding)}
                      </span>
                    </div>
                  </div>
                </div>

                {pharmacySettings?.footerPoweredBy && (
                  <div className="text-[10px] text-slate-400 text-center pt-3 border-t border-slate-100">
                    {pharmacySettings.footerPoweredBy}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
             HMS-LINKED INPATIENT DISPENSE DETAILS (§15)
             ═════════════════════════════════════════════════════════════ */}
          {viewMode === 'hms_details' && (
            <div
              id="pharmacy-printable-invoice"
              className="bg-white shadow-sm border border-slate-200 print:shadow-none print:border-none w-full transition-all max-w-4xl p-7 text-xs text-slate-800"
            >
              <div className="space-y-5">
                {/* Header Information Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-emerald-50/60 rounded-xl border border-emerald-200">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#0e7d5a] text-white flex items-center justify-center font-bold shadow-2xs">
                      <Pill className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-extrabold text-slate-900">
                          {invoice.invoiceNumber}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusColor}`}>
                          {invoice.status.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] font-bold bg-[#effaf5] text-[#0e7d5a] border border-[#b2e5d6] px-2 py-0.5 rounded-full">
                          ONE ACTIVE ADMISSION INVOICE
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-medium">
                        Patient: <strong className="text-slate-800">{invoice.customerName || 'Inpatient Admission'}</strong> · Admission Ref: <strong className="font-mono text-[#0e7d5a]">{invoice.externalAdmissionRef || 'N/A'}</strong>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Channel &amp; Collection</span>
                    <span className="text-xs font-bold text-slate-700">HMS Front Desk Managed</span>
                  </div>
                </div>

                {/* 8-Card Summary Metrics (§15) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Medicines</span>
                    <span className="text-base font-extrabold text-slate-900">{invoice.lines?.length || 0} line(s)</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Subtotal</span>
                    <span className="text-base font-extrabold text-slate-900">{formatPKR(invoice.subtotal)}</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Tax / GST</span>
                    <span className="text-base font-extrabold text-slate-900">{formatPKR(invoice.taxTotal)}</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Discount</span>
                    <span className="text-base font-extrabold text-emerald-700">{formatPKR(invoice.discountTotal)}</span>
                  </div>
                  <div className="p-3 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-2xs">
                    <span className="text-[10px] text-slate-300 uppercase font-semibold block">Net Total</span>
                    <span className="text-base font-extrabold text-emerald-400">{formatPKR(invoice.total)}</span>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 shadow-2xs">
                    <span className="text-[10px] text-emerald-700 uppercase font-semibold block">Collected By HMS</span>
                    <span className="text-base font-extrabold text-emerald-800">{formatPKR(invoice.hmsCollectedAmount)}</span>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 shadow-2xs">
                    <span className="text-[10px] text-amber-700 uppercase font-semibold block">HMS Receivable</span>
                    <span className="text-base font-extrabold text-amber-900">{formatPKR(invoice.hmsReceivable)}</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Settlement Status</span>
                    <span className="text-xs font-bold text-slate-800 uppercase px-2 py-0.5 rounded bg-slate-100 inline-block mt-0.5">
                      {(invoice.internalSettlementStatus || 'NOT_DUE').replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {Number(invoice.hmsReceivable) > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50/70 border border-amber-200 rounded-lg px-3 py-2">
                    HMS owes Pharmacy {formatPKR(invoice.hmsReceivable)} for this invoice — collect it from{' '}
                    <strong>HMS Receivables → Request Settlement</strong>, not "Record Payment" here.
                  </p>
                )}

                {/* Tab Switcher: Granular History vs Aggregated Summary */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setHmsTab('granular')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        hmsTab === 'granular'
                          ? 'bg-white text-slate-900 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Granular Dispense Traceability ({invoice.lines?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHmsTab('aggregated')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        hmsTab === 'aggregated'
                          ? 'bg-white text-slate-900 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Aggregated Medicines Summary
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {hmsTab === 'granular' ? 'Every dispense event & batch separately traceable' : 'Combined medicine quantities'}
                  </span>
                </div>

                {/* Table Content */}
                {hmsTab === 'granular' ? (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
                    <table className="w-full text-left">
                      <thead className="bg-[#f8fafc] text-[11px] font-bold text-slate-700 uppercase tracking-wide border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Medicine</th>
                          <th className="py-2.5 px-3 text-center">Batch</th>
                          <th className="py-2.5 px-3 text-center">Dispensed Qty</th>
                          <th className="py-2.5 px-3 text-right">Rate</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3">Request / Event</th>
                          <th className="py-2.5 px-3">Date / Dispensed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {invoice.lines?.map((line: any, idx: number) => {
                          const medName = line.medicine?.name || 'Medicine Item';
                          const unit = line.medicine?.unit || '';
                          const batchNo = line.batch?.batchNumber || '—';
                          const qty = Number(line.quantity || 0);
                          const rate = Number(line.rateSnapshot || 0);
                          const net = Number(line.lineNet || 0);
                          const reqRef = line.externalRequestRef || '—';
                          const eventId = line.dispenseEventId || '—';
                          const dispTime = line.dispensedAt ? formatDateTime(line.dispensedAt) : '—';
                          const dispUser = invoice.dispensedByUser?.fullName || invoice.dispensedByUser?.username || 'Pharmacist';

                          return (
                            <tr key={line.id || idx} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                <div>{medName}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{line.medicine?.code}</div>
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-700">
                                <span className="bg-slate-100 px-1.5 py-0.5 rounded font-medium">{batchNo}</span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold text-slate-900 tabular-nums">
                                {qty} {unit}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                                {formatPKR(rate)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-extrabold text-slate-900 tabular-nums">
                                {formatPKR(net)}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-mono text-[11px] font-bold text-[#0e7d5a]">{reqRef}</div>
                                <div className="font-mono text-[9px] text-slate-400">{eventId}</div>
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                                <div>{dispTime}</div>
                                <div className="text-[10px] text-slate-400">{dispUser}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
                    <table className="w-full text-left">
                      <thead className="bg-[#f8fafc] text-[11px] font-bold text-slate-700 uppercase tracking-wide border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Medicine Name</th>
                          <th className="py-2.5 px-3 text-center">Total Quantity</th>
                          <th className="py-2.5 px-3 text-right">Standard Rate</th>
                          <th className="py-2.5 px-3 text-right">Net Amount</th>
                          <th className="py-2.5 px-3 text-center">Dispenses</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(() => {
                          const map = new Map<string, { name: string; unit: string; totalQty: number; rate: number; totalAmount: number; count: number }>();
                          for (const l of (invoice.lines || [])) {
                            const name = l.medicine?.name || 'Medicine Item';
                            const unit = l.medicine?.unit || 'Units';
                            const qty = Number(l.quantity || 0);
                            const amount = Number(l.lineNet || (qty * Number(l.rateSnapshot || 0)));
                            const rate = Number(l.rateSnapshot || (qty > 0 ? amount / qty : 0));
                            const existing = map.get(name);
                            if (existing) {
                              existing.totalQty += qty;
                              existing.totalAmount += amount;
                              existing.count += 1;
                            } else {
                              map.set(name, { name, unit, totalQty: qty, rate, totalAmount: amount, count: 1 });
                            }
                          }
                          const list = Array.from(map.values());
                          return list.map((m) => (
                            <tr key={m.name} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3 font-bold text-slate-900">{m.name}</td>
                              <td className="py-2.5 px-3 text-center font-extrabold text-slate-900 tabular-nums">
                                {m.totalQty} {m.unit}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{formatPKR(m.rate)}</td>
                              <td className="py-2.5 px-3 text-right font-extrabold text-slate-900 tabular-nums">{formatPKR(m.totalAmount)}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                  {m.count} dispense event(s)
                                </span>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* In-Modal Add Payment Section */}
        {showAddPayment && (
          <div className="p-4 bg-emerald-50 border-t border-emerald-200 shrink-0 print:hidden space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-emerald-700" />
                Record Settlement / Payment for {invoice.invoiceNumber}
              </span>
              <span className="text-xs text-emerald-800">
                Outstanding: <strong>{formatPKR(invoice.outstanding)}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as any)}
                className="h-9 px-3 text-xs bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
              >
                <option value="CASH">Cash Payment</option>
                <option value="CARD">Debit / Credit Card</option>
                <option value="ONLINE">Bank Transfer / Online</option>
              </select>

              <input
                type="number"
                min={0}
                max={Number(invoice.outstanding)}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Amount (PKR)"
                className="flex-1 h-9 px-3 text-xs bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold text-slate-900"
              />

              <button
                type="button"
                onClick={handleAddPayment}
                disabled={paying}
                className="h-9 px-5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60 transition-colors"
              >
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Confirm Payment
              </button>
            </div>
          </div>
        )}

        {/* In-Modal Sales Return Section */}
        {showReturn && (
          <div className="p-4 bg-rose-50 border-t border-rose-200 shrink-0 print:hidden space-y-3 max-h-60 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-950 flex items-center gap-1.5">
                <Undo2 className="h-4 w-4 text-rose-700" />
                Process Sales Return &amp; Refund
              </span>
              <span className="text-xs text-rose-700">Select medicine quantities to return</span>
            </div>

            <div className="space-y-2">
              {invoice.lines?.map((line: any) => {
                const billedQty = Number(line.quantity || 0);
                const returnedQty = Number(line.returnedQuantity || 0);
                const availableForReturn = Math.max(0, billedQty - returnedQty);

                return (
                  <div
                    key={line.id}
                    className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-rose-200 text-xs"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="font-semibold text-slate-900">{line.medicine?.name}</span>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Billed: {billedQty} @ PKR {Number(line.rateSnapshot)}
                        {returnedQty > 0 && (
                          <span className="text-rose-600 font-semibold ml-2">
                            ({returnedQty} already returned • {availableForReturn} left)
                          </span>
                        )}
                      </div>
                    </div>

                    {availableForReturn > 0 ? (
                      <div className="flex items-center gap-3 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={availableForReturn}
                          placeholder={`Max ${availableForReturn}`}
                          value={returnLines[line.id]?.qty ?? ''}
                          onChange={(e) =>
                            setReturnLines((prev) => ({
                              ...prev,
                              [line.id]: {
                                qty: e.target.value,
                                restock: prev[line.id]?.restock ?? true,
                              },
                            }))
                          }
                          className="w-24 h-7 px-2 text-xs border border-rose-300 rounded text-center font-bold"
                        />

                        <label className="flex items-center gap-1 text-[11px] text-slate-600 select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={returnLines[line.id]?.restock ?? true}
                            onChange={(e) =>
                              setReturnLines((prev) => ({
                                ...prev,
                                [line.id]: {
                                  qty: prev[line.id]?.qty ?? '',
                                  restock: e.target.checked,
                                },
                              }))
                            }
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>Restock</span>
                        </label>
                      </div>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">
                        Fully Returned
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                placeholder="Reason for return (required) *"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="flex-1 h-8 px-2.5 text-xs bg-white border border-rose-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
              />

              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as any)}
                className="h-8 px-2.5 text-xs bg-white border border-rose-300 rounded-lg"
              >
                <option value="CASH">Refund Cash</option>
                <option value="CARD">Refund to Card</option>
                <option value="ONLINE">Refund Online</option>
              </select>

              <button
                type="button"
                onClick={handleReturn}
                disabled={returning}
                className="h-8 px-4 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs flex items-center gap-1 disabled:opacity-60 transition-colors shrink-0"
              >
                {returning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirm Return &amp; Refund
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
