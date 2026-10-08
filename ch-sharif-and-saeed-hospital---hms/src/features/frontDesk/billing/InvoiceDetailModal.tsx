import { DoctorChargeForm } from '../../../components/forms/DoctorChargeForm';
import { ServiceSourcePicker } from '../../../components/forms/ServiceSourcePicker';
import { selectionFromSource } from '../../../utils/serviceSelection';
import { HOSPITAL_SERVICE_SOURCE, NO_ACTIVE_DEPARTMENT_SERVICES, serviceSourceOptions, servicesForSource } from '../../../utils/serviceSelection';
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Tag, CreditCard, RotateCcw, Loader2, AlertCircle, CheckCircle2, Printer } from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import { useToast } from '../../../context/ToastContext';
import {
  InvoiceDetail,
  PaymentMethod,
  fetchInvoiceDetail,
  addServiceLine,
  applyDiscount,
  collectPayment,
  refundPayment,
} from '../../../services/invoiceService';
import { ServiceRatesService, fetchServices } from '../../../services/serviceRatesService';
import { StaffUserService } from '../../../services/staffUserService';
import { DepartmentService, fetchDepartments } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import { getHospitalProfile } from '../../../services/hospitalProfileService';
import { Modal } from '../../../components/common/Modal';
import { Select, NumberInput, TextInput, ServiceChecklist } from '../../../components/forms/FormControls';

export type InvoiceModalAction = 'addLine' | 'discount' | 'payment' | 'refund';

interface InvoiceDetailModalProps {
  invoiceId: string;
  onClose: () => void;
  onChanged: () => void;
  /**
   * When true (fresh Walk-In / New Admission encounter), the modal opens
   * straight into the Collect Payment form — same one-continuous-flow
   * pattern as patient registration — with the amount pre-filled to the
   * full balance due, and shows a prominent "Done" action once paid.
   * Superseded by `initialAction` when both are given.
   */
  autoOpenPayment?: boolean;
  /** Opens straight into a specific action form — used by the row-level "Add Service" / "Refund" quick actions on the invoices list. */
  initialAction?: InvoiceModalAction;
}

type ActiveAction = null | InvoiceModalAction;

const PAYMENT_METHODS: { label: string; value: PaymentMethod }[] = [
  { label: 'Cash', value: 'CASH' },
  { label: 'Card', value: 'CARD' },
  { label: 'Bank Transfer', value: 'BANK' },
  { label: 'Online', value: 'ONLINE' },
];

export function formatServiceName(name?: string | null): string {
  if (!name) return '';
  if (/ward\s*fixed(\s*\/\s*admission\s*fee)?/i.test(name)) {
    return 'Ward Price';
  }
  return name.replace(/\bward\s*fixed\b/gi, 'Ward Price');
}

export function formatServiceCode(code?: string | null): string {
  if (!code) return '';
  if (/^ward[-_]fixed/i.test(code) || code.includes('-DEL-') || /ward[-_]price/i.test(code)) {
    return '';
  }
  return code;
}

export function getInvoiceEncounterLabel(inv?: InvoiceDetail | null): string {
  if (!inv) return 'OPD Intake';
  if (inv.sourceType === 'ADMISSION') return 'Inpatient Admission';
  if (inv.sourceType === 'APPOINTMENT') return 'Doctor Appointment';
  if (inv.encounterType === 'EMERGENCY') return 'Emergency Care';
  if (inv.encounterType === 'OBSERVATION') return 'Observation Stay';
  if (inv.encounterType === 'CUSTOM') return 'Custom Billing';
  if (inv.encounterType === 'OPD') return 'OPD Intake';
  return inv.encounterType ? `${inv.encounterType} Intake` : 'OPD Intake';
}

/**
 * Real invoice detail + billing actions (Add Service Line, Discount,
 * Collect Payment, Refund) — all real `POST /invoices/:id/*` calls, no
 * fabricated totals. Reused across Hospital Invoices / Outstanding
 * Balances / Payments-Receipts / Discounts / Refunds nav items (Front
 * Desk's real billing surface today is this one invoice model — see
 * `services/invoiceService.ts`'s header comment on the pending §2.2 split).
 */
export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoiceId,
  onClose,
  onChanged,
  autoOpenPayment,
  initialAction,
}) => {
  const toast = useToast();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(
    initialAction ?? (autoOpenPayment ? 'payment' : null),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(false);

  const [services, setServices] = useState(() => ServiceRatesService.getServices());
  const doctors = StaffUserService.getStaffUsers().filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE');
  const [departments, setDepartments] = useState<Department[]>(() => DepartmentService.getDepartments().filter((d) => d.status === 'Active'));
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>(HOSPITAL_SERVICE_SOURCE);

  useEffect(() => {

    fetchDepartments().then((depts) => {
      setDepartments(depts.filter((d) => d.status === 'Active'));
    }).catch(() => {});
  }, []);


  const filteredServices = useMemo(
    () => servicesForSource(services, selectedDeptFilter),
    [services, selectedDeptFilter]
  );

  // Add Service Line form state
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedServiceIds((ids) => ids.filter((id) => filteredServices.some((s) => s.id === id)));
  }, [filteredServices]);
  const [lineQty, setLineQty] = useState<number>(1);
  const [linePerformedBy, setLinePerformedBy] = useState('');

  const selectedServices = useMemo(() => {
    return services.filter((s) => selectedServiceIds.includes(s.id));
  }, [services, selectedServiceIds]);

  const selectedServicesTotal = useMemo(() => {
    return selectedServices.reduce((sum, s) => sum + (s.standardRate || 0), 0) * (lineQty || 1);
  }, [selectedServices, lineQty]);

  // Discount form state
  const [discountPercent, setDiscountPercent] = useState<number | ''>('');
  const [discountAmount, setDiscountAmount] = useState<number | ''>('');
  const [discountReason, setDiscountReason] = useState('');

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentReference, setPaymentReference] = useState('');

  // Refund form state
  const [refundAmount, setRefundAmount] = useState<number | ''>('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
  const [refundReason, setRefundReason] = useState('');

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setInvoice(await fetchInvoiceDetail(invoiceId));
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load invoice.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const eligibleHospitalServicesGross = useMemo(() => {
    if (!invoice) return 0;
    if (!invoice.lines || invoice.lines.length === 0) {
      const dept = (invoice.departmentName || '').toLowerCase();
      if (dept.includes('lab') || dept.includes('pharmacy')) return 0;
      return invoice.subtotal || 0;
    }
    return invoice.lines
      .filter((l: any) => {
        return l.billingSource === 'HOSPITAL_SERVICE' && l.discountAllowed !== false;
      })
      .reduce((sum: number, l: any) => sum + (l.lineGross || 0), 0);
  }, [invoice]);

  const hasHospitalServices = eligibleHospitalServicesGross > 0;
  const isDiscountDisabled = invoice?.payerType === 'Corporate / Panel' || !hasHospitalServices;

  // Pre-fill payment amount and automatically focus the Discount field on open
  useEffect(() => {
    if (activeAction === 'payment' && invoice && !paymentAmountTouched && invoice.balanceDue > 0) {
      const disc = (!isDiscountDisabled && typeof discountAmount === 'number') ? discountAmount : 0;
      setPaymentAmount(Math.max(0, invoice.balanceDue - disc));
    }
  }, [activeAction, invoice, discountAmount, paymentAmountTouched, isDiscountDisabled]);

  // Focus directly on the Discount input (or Payment input if no Hospital Services) when the payment collector opens
  useEffect(() => {
    if (activeAction === 'payment' && invoice) {
      const timer = setTimeout(() => {
        const targetId = isDiscountDisabled || invoice.status === 'PAID' ? 'modal-payment-input' : 'modal-discount-input';
        const el = document.getElementById(targetId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [activeAction, invoice, isDiscountDisabled]);

  const closeAction = () => {
    setActiveAction(null);
    setActionError(null);
    setSelectedServiceIds([]);
    setLineQty(1);
    setLinePerformedBy('');
    setDiscountPercent('');
    setDiscountAmount('');
    setDiscountReason('');
    setPaymentAmount('');
    setPaymentAmountTouched(false);
    setPaymentReference('');
    setRefundAmount('');
    setRefundReason('');
  };

  const afterMutate = async (message: string) => {
    toast.success(message);
    closeAction();
    await load();
    onChanged();
  };

  const handleAddLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedServiceIds.length === 0) {
      setActionError('Select at least one service.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      for (const serviceId of selectedServiceIds) {
        await addServiceLine(invoiceId, {
          serviceRateId: serviceId,
          ...selectionFromSource(selectedDeptFilter),
          quantity: lineQty,
          performedByStaffId: linePerformedBy || undefined,
        });
      }
      const count = selectedServiceIds.length;
      await afterMutate(`${count} ${count === 1 ? 'service line' : 'service lines'} added.`);
    } catch (err: any) {
      setActionError(err?.response?.data?.error?.message || err?.message || 'Failed to add service line.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discountReason.trim()) {
      setActionError('Discount reason is required.');
      return;
    }
    if (!discountPercent && !discountAmount) {
      setActionError('Enter a discount percent or amount.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await applyDiscount(invoiceId, {
        discountPercent: discountPercent === '' ? undefined : discountPercent,
        discountAmount: discountAmount === '' ? undefined : discountAmount,
        discountReason: discountReason.trim(),
      });
      await afterMutate('Discount applied.');
    } catch (err: any) {
      setActionError(err?.response?.data?.error?.message || err?.message || 'Failed to apply discount.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCollectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const payAmt = paymentAmount === '' ? 0 : Number(paymentAmount);
    const discAmt = invoice?.status === 'PAID' || discountAmount === '' ? 0 : Number(discountAmount);

    if (payAmt <= 0 && discAmt <= 0) {
      setActionError('Enter a payment amount or a discount.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      // 1. If discount is entered, apply discount first
      if (discAmt > 0) {
        await applyDiscount(invoiceId, {
          discountAmount: discAmt,
          discountReason: discountReason.trim() || 'Counter Patient Discount',
        });
      }

      // 2. If payment amount is specified, collect payment
      if (payAmt > 0) {
        await collectPayment(invoiceId, {
          amount: payAmt,
          paymentMethod,
          reference: paymentReference.trim() || undefined,
        });
      }

      await afterMutate(
        discAmt > 0 && payAmt > 0
          ? 'Discount applied & payment collected.'
          : discAmt > 0
          ? 'Discount applied in full.'
          : 'Payment collected and receipt generated.'
      );
    } catch (err: any) {
      setActionError(err?.response?.data?.error?.message || err?.message || 'Failed to process payment.');
    } finally {
      setIsSaving(false);
    }
  };

  const isFullyPaid = invoice?.status === 'PAID';
  const isVoid = invoice?.status === 'VOID';
  const canCollectPayment = !!invoice && !isVoid && (!isFullyPaid || invoice.sourceType === 'ADMISSION');

  // Pressing Enter when invoice is fully paid closes modal to immediately take next patient
  useEffect(() => {
    if (!isFullyPaid || activeAction !== null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullyPaid, activeAction, onClose]);

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    if (!refundAmount || refundAmount <= 0) {
      setActionError('Enter a refund amount greater than zero.');
      return;
    }
    if (Number(refundAmount) > invoice.paidTotal) {
      setActionError(`Refund amount cannot exceed PKR ${invoice.paidTotal.toFixed(2)} already collected on this invoice.`);
      return;
    }
    if (!refundReason.trim()) {
      setActionError('Refund reason is mandatory.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await refundPayment(invoiceId, { amount: Number(refundAmount), refundMethod, reason: refundReason.trim() });
      await afterMutate('Refund posted.');
    } catch (err: any) {
      setActionError(err?.response?.data?.error?.message || err?.message || 'Failed to post refund.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=800,height=750');
    if (!printWindow) {
      window.print();
      return;
    }
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice - ${invoice?.invoiceNumber}</title>
          <style>
            @page { size: auto; margin: 12mm; }
            body { 
              font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
              margin: 0; 
              color: #0f172a; 
              font-size: 12.5px; 
              font-weight: 500;
              -webkit-font-smoothing: antialiased;
            }
            .header { text-align: center; border-bottom: 2px solid #08775A; padding-bottom: 12px; margin-bottom: 16px; }
            .header h1 { margin: 0; font-size: 22px; color: #08775A; font-weight: 700; letter-spacing: -0.3px; }
            .header p { margin: 2px 0; color: #475569; font-size: 11.5px; font-weight: 500; }
            .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
            .badge-paid { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
            .badge-unpaid { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
            .meta-grid { display: flex; justify-content: space-between; margin-bottom: 16px; background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; font-weight: 500; }
            .meta-col { flex: 1; }
            .meta-row { margin-bottom: 6px; font-size: 12.5px; }
            .meta-label { font-weight: 600; color: #475569; width: 120px; display: inline-block; }
            .meta-val { font-weight: 600; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-family: inherit; }
            th { background: #f1f5f9; text-align: left; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; font-size: 11px; text-transform: uppercase; color: #334155; font-weight: 700; }
            td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12.5px; font-weight: 600; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .summary-box { width: 340px; margin-left: auto; margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; background: #f8fafc; font-family: inherit; }
            .summary-row { display: flex; justify-content: space-between; margin-bottom: 7px; font-size: 12.5px; font-weight: 600; color: #475569; }
            .summary-row span.val { font-weight: 700; color: #0f172a; }
            .summary-row.total { font-weight: 700; border-top: 1px solid #cbd5e1; padding-top: 7px; font-size: 13.5px; color: #0f172a; }
            .summary-row.total span.val { font-weight: 800; }
            .summary-row.balance { font-weight: 800; border-top: 2px solid #08775A; padding-top: 9px; font-size: 14.5px; color: #08775A; }
            .footer { text-align: center; font-size: 10.5px; color: #64748b; font-weight: 500; border-top: 1px dashed #cbd5e1; padding-top: 12px; margin-top: 24px; }
          </style>
        </head>
        <body>
          <div class="header">
            ${getHospitalProfile().logo ? `<img src="${getHospitalProfile().logo}" style="height: 52px; max-width: 140px; object-fit: contain; margin-bottom: 6px; display: block; margin-left: auto; margin-right: auto;" />` : ''}
            <h1>${getHospitalProfile().name || 'CH Sharif and Saeed Hospital'}</h1>
            <p>Excellence in Clinical Care, Diagnostics &amp; Patient Services</p>
            <p>Official Patient Encounter Invoice / Bill</p>
          </div>
          <div class="meta-grid">
            <div class="meta-col">
              <div class="meta-row"><span class="meta-label">Invoice #:</span> <strong class="meta-val">${invoice?.invoiceNumber}</strong></div>
              <div class="meta-row"><span class="meta-label">Date &amp; Time:</span> <span class="meta-val">${invoice?.createdAt}</span></div>
              <div class="meta-row"><span class="meta-label">Encounter:</span> <span class="meta-val">${getInvoiceEncounterLabel(invoice)}</span></div>
              ${invoice?.admissionNumber ? `<div class="meta-row"><span class="meta-label">Admission #:</span> <strong class="meta-val">${invoice.admissionNumber}</strong></div>` : ''}
              ${invoice?.sourceType === 'ADMISSION' && invoice.admissionEstimatedAmount != null ? `<div class="meta-row"><span class="meta-label">Estimated Amount — Subject to Final Billing:</span> <span class="meta-val">${formatPKR(invoice.admissionEstimatedAmount)}</span></div>` : ''}
              ${invoice?.wardName || invoice?.bedNumber ? `<div class="meta-row"><span class="meta-label">Ward / Bed:</span> <span class="meta-val">${[invoice.wardName, invoice.bedNumber ? (/^bed\b/i.test(invoice.bedNumber.trim()) ? invoice.bedNumber.trim() : `Bed ${invoice.bedNumber.trim()}`) : ''].filter(Boolean).join(' - ')}</span></div>` : ''}
              <div class="meta-row"><span class="meta-label">Doctor:</span> <span class="meta-val">${invoice?.doctorName || 'Consultant'}</span></div>
${invoice?.admissionMedicationMode ? `<div class="meta-row"><span class="meta-label">Medication Fulfillment:</span> ${invoice.admissionMedicationMode === 'HOSPITAL_MANAGED' ? 'Hospital Managed' : 'Self Arranged'}</div>` : ''}
${invoice?.sourceType === 'ADMISSION' ? `<div class="meta-row"><span class="meta-label">Admission Department:</span> ${invoice.admissionDepartmentName || invoice.departmentName || 'Not assigned'}</div>` : ''}
              <div class="meta-row"><span class="meta-label">Status:</span> <span class="badge ${invoice?.status === 'PAID' ? 'badge-paid' : 'badge-unpaid'}">${invoice?.status}</span></div>
            </div>
            <div class="meta-col">
              <div class="meta-row"><span class="meta-label">Patient Name:</span> <strong class="meta-val">${invoice?.patientName}</strong></div>
              <div class="meta-row"><span class="meta-label">Father / Guardian:</span> <span class="meta-val">${invoice?.patientGuardian || '—'}</span></div>
              <div class="meta-row"><span class="meta-label">MR Number:</span> <strong class="meta-val">${invoice?.patientMr || '—'}</strong></div>
              <div class="meta-row"><span class="meta-label">Phone:</span> <span class="meta-val">${invoice?.patientPhone || '—'}</span></div>
              <div class="meta-row"><span class="meta-label">Payer:</span> <span class="meta-val">${invoice?.payerType} ${invoice?.panelName ? `(${invoice.panelName})` : ''}</span></div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th class="text-center" style="width: 30px;">#</th>
                <th>Service / Description</th>
                <th class="text-right" style="width: 60px;">Qty</th>
                <th class="text-right" style="width: 90px;">Rate</th>
                <th class="text-right" style="width: 100px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice?.lines.map((l, i) => `
                <tr>
                  <td class="text-center" style="color: #64748b;">${i + 1}</td>
                  <td>
                    <strong>${formatServiceName(l.serviceName)}</strong> ${formatServiceCode(l.serviceCode) ? `<span style="color: #64748b; font-size: 11px; font-weight: 500;">(${formatServiceCode(l.serviceCode)})</span>` : ''}
                    ${l.discountReason ? `<div style="font-size: 11px; color: #475569; font-weight: 500; margin-top: 2px;">${l.discountReason}</div>` : ''}
                  </td>
                  <td class="text-right">${l.quantity}</td>
                  <td class="text-right">${formatPKR(l.rate)}</td>
                  <td class="text-right"><strong style="color: #0f172a;">${formatPKR(l.lineGross)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="summary-box">
            <div class="summary-row"><span>Total Charges</span><span class="val">${formatPKR(invoice?.subtotal || 0)}</span></div>
            <div class="summary-row"><span>Discount</span><span class="val" style="color: #b45309;">${invoice?.discountTotal ? `- ${formatPKR(invoice.discountTotal)}` : formatPKR(0)}</span></div>
            <div class="summary-row total"><span>Patient Share</span><span class="val">${formatPKR(invoice?.patientShare || 0)}</span></div>
            ${invoice?.payerType === 'Corporate / Panel' ? '<div class="summary-row"><span>Panel Receivable (separate)</span><span class="val">' + formatPKR(invoice.panelReceivable) + '</span></div>' : ''}
            ${invoice?.advancePaid ? `<div class="summary-row"><span>Advance Paid / Deposit Received</span><span>${formatPKR(invoice.advancePaid)}</span></div>` : ''}
            <div class="summary-row"><span>${invoice?.advancePaid ? 'Amount Paid (including advance)' : 'Amount Paid'}</span><span class="val" style="color: #08775A;">${formatPKR(invoice?.paidTotal || 0)}</span></div>
            <div class="summary-row" style="font-weight: 600; border-top: 1px solid #cbd5e1; padding-top: 6px;">
              <span>Current Remaining</span>
              <span class="val" style="color: ${(invoice?.paidTotal || 0) > (invoice?.patientShare || 0) ? '#08775A' : '#991b1b'};">
                ${(invoice?.paidTotal || 0) > (invoice?.patientShare || 0)
                  ? `${formatPKR((invoice?.paidTotal || 0) - (invoice?.patientShare || 0))} (Patient Credit)`
                  : (invoice?.balanceDue || 0) > 0
                  ? `${formatPKR(invoice?.balanceDue || 0)} (Due)`
                  : `${formatPKR(0)} (Settled)`}
              </span>
            </div>
            <div class="summary-row balance"><span>Balance Due</span><span>${formatPKR(invoice?.balanceDue || 0)}</span></div>
          </div>
          <div class="footer">
            <p>System-generated official computer invoice issued by CH Sharif &amp; Saeed Hospital HMS.</p>
            <p>Thank you for choosing CH Sharif &amp; Saeed Hospital.</p>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  return (
    <Modal isOpen onClose={onClose} title={invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice'} maxWidth="3xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2 text-sm font-sans font-medium">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading invoice…
        </div>
      ) : loadError || !invoice ? (
        <div className="text-center py-10 font-sans">
          <p className="text-rose-600 text-sm font-semibold">{loadError}</p>
          <button onClick={load} className="mt-2 px-3 py-1.5 bg-[#08775A] text-white text-xs font-semibold rounded-lg">Retry</button>
        </div>
      ) : (
        <div className="space-y-4 font-sans font-medium">
          {/* Top Section: Invoice Number & Patient Details (Side-by-side) */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-sans">
            {/* Left: Invoice Details */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Invoice Information</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10.5px] font-extrabold uppercase border ${
                    isFullyPaid
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-rose-50 text-rose-800 border-rose-300'
                  }`}
                >
                  {invoice.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Invoice Number:</span>
                <span className="font-sans font-bold text-slate-900 text-sm">{invoice.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Date &amp; Time:</span>
                <span className="text-slate-800 font-semibold">{invoice.createdAt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Encounter:</span>
                <span className="font-bold text-slate-900">{getInvoiceEncounterLabel(invoice)}</span>
              </div>
              {invoice.admissionNumber && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Admission #:</span>
                  <span className="font-mono font-bold text-[#08775A]">{invoice.admissionNumber}</span>
                </div>
              )}
              {invoice.sourceType === 'ADMISSION' && invoice.admissionEstimatedAmount != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 font-semibold">Estimated Amount — Subject to Final Billing:</span>
                  <span className="font-semibold text-slate-800">{formatPKR(invoice.admissionEstimatedAmount)}</span>
                </div>
              )}
              {invoice.admissionMedicationMode && <div className="flex justify-between"><span className="text-slate-500 font-semibold">Medication Fulfillment:</span><span className="font-semibold text-slate-800">{invoice.admissionMedicationMode === 'HOSPITAL_MANAGED' ? 'Hospital Managed' : 'Self Arranged'}</span></div>}
              {invoice.sourceType === 'ADMISSION' && <div className="flex justify-between"><span className="text-slate-500 font-semibold">Admission Department:</span><span className="font-semibold text-slate-800">{invoice.admissionDepartmentName || invoice.departmentName || 'Not assigned'}</span></div>}
              {(invoice.wardName || invoice.bedNumber) && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Ward / Bed:</span>
                  <span className="font-semibold text-slate-800">
                    {[invoice.wardName, invoice.bedNumber ? (/^bed\b/i.test(invoice.bedNumber.trim()) ? invoice.bedNumber.trim() : `Bed ${invoice.bedNumber.trim()}`) : ''].filter(Boolean).join(' - ')}
                  </span>
                </div>
              )}
              {invoice.doctorName && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Consultant:</span>
                  <span className="font-semibold text-slate-800">{invoice.doctorName}</span>
                </div>
              )}
            </div>

            {/* Right: Patient Details */}
            <div className="space-y-1.5 sm:border-l sm:border-slate-200/80 sm:pl-4">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Patient Details</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white border border-slate-200 text-slate-700">
                  {invoice.payerType}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Full Name:</span>
                <span className="font-bold text-slate-900">{invoice.patientName}</span>
              </div>
              {invoice.patientGuardian && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Father / Guardian:</span>
                  <span className="text-slate-800 font-semibold">{invoice.patientGuardian}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">MR Number:</span>
                <span className="font-sans font-bold text-slate-900">{invoice.patientMr || '—'}</span>
              </div>
              {invoice.patientPhone && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Phone:</span>
                  <span className="text-slate-800 font-semibold">{invoice.patientPhone}</span>
                </div>
              )}
              {(invoice.patientAge || invoice.patientGender) && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Age / Gender:</span>
                  <span className="text-slate-800 font-semibold">
                    {[invoice.patientAge ? `${invoice.patientAge} Yrs` : '', invoice.patientGender].filter(Boolean).join(' / ')}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Middle: Invoice Items Table ("necha invoice") */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs font-sans">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 uppercase text-[11px] tracking-wide">
                  <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                  <th className="py-2.5 px-3.5">Service Description</th>
                  <th className="py-2.5 px-3.5 text-right w-20">Qty</th>
                  <th className="py-2.5 px-3.5 text-right w-28">Rate</th>
                  <th className="py-2.5 px-3.5 text-right w-32">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {invoice.lines.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400 font-medium">No service lines on invoice.</td></tr>
                ) : (
                  invoice.lines.map((l, idx) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-3.5 text-center text-slate-500 font-semibold">{idx + 1}</td>
                      <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{formatServiceName(l.serviceName)}</span>
                          {formatServiceCode(l.serviceCode) && (
                            <span className="text-slate-400 font-semibold text-[11px]">({formatServiceCode(l.serviceCode)})</span>
                          )}
                          {l.billingSource === 'PHARMACY' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                              Pharmacy
                            </span>
                          )}
                        </div>
                        {l.discountReason && (
                          <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                            {l.discountReason}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 text-right text-slate-800 font-semibold">{l.quantity}</td>
                      <td className="py-2.5 px-3.5 text-right text-slate-800 font-semibold">{formatPKR(l.rate)}</td>
                      <td className="py-2.5 px-3.5 text-right font-bold text-slate-900">{formatPKR(l.lineGross)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Bottom Section: 5 Financial Summary Rows */}
          {(() => {
            const currentDiscountInput = typeof discountAmount === 'number' ? discountAmount : 0;
            const liveDiscountTotal = (invoice.discountTotal || 0) + (isFullyPaid ? 0 : currentDiscountInput);
            const liveNetPayable = invoice.payerType === 'Corporate / Panel' ? invoice.patientShare : Math.max(0, (invoice.subtotal || 0) - liveDiscountTotal);
            const currentPaymentInput = typeof paymentAmount === 'number' ? paymentAmount : 0;
            const livePaidTotal = (invoice.paidTotal || 0) + (activeAction === 'payment' ? currentPaymentInput : 0);
            const liveBalanceDue = Math.max(0, liveNetPayable - livePaidTotal);
            const liveRemainingRefundable = Math.max(0, livePaidTotal - liveNetPayable);

            return (
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-3 pt-1 font-sans">
                {/* Quick action buttons (Collect Payment / Add Line / Discount / Refund) */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {activeAction === null && (
                    <>
                      {canCollectPayment && (
                        <button
                          type="button"
                          onClick={() => setActiveAction('payment')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#08775A] bg-[#effaf5] hover:bg-[#dff5ea] border border-[#c2e7db] rounded-md transition-colors cursor-pointer"
                        >
                          <CreditCard className="h-3 w-3" /> {invoice.sourceType === 'ADMISSION' ? 'Collect Payment / Advance' : 'Collect Payment'}
                        </button>
                      )}
                      {!isVoid && (
                        <button
                          type="button"
                          onClick={() => setActiveAction('addLine')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
                        >
                          <Plus className="h-3 w-3" /> Add Service
                        </button>
                      )}
                      {!isVoid && !isFullyPaid && hasHospitalServices && invoice.payerType !== 'Corporate / Panel' && (
                        <button
                          type="button"
                          onClick={() => setActiveAction('discount')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
                        >
                          <Tag className="h-3 w-3" /> Discount
                        </button>
                      )}
                      {/* Refunds can only ever return money actually collected — matches the backend's
                          `refundAmount <= invoice.paidTotal` guard (invoices.service.ts), so this is
                          available as soon as anything has been paid, not only once fully paid. */}
                      {invoice.paidTotal > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveAction('refund')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" /> Refund
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Summary Rows: Total Charges, Discount, Net Payable, Advance, Amount Paid, Current Remaining, Balance Due */}
                <div className="w-full sm:w-80 bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-2 shadow-2xs font-sans">
                  <div className="flex items-center justify-between text-xs text-slate-700 font-semibold">
                    <span>Total Charges</span>
                    <span className="font-bold text-slate-900">{formatPKR(invoice.subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-700 font-semibold">
                    <span>Discount</span>
                    <span className="font-bold text-amber-700">
                      {liveDiscountTotal > 0 ? `- ${formatPKR(liveDiscountTotal)}` : formatPKR(0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-900 font-extrabold pt-1 border-t border-slate-200">
                    <span className="font-bold">{invoice.payerType === 'Corporate / Panel' ? 'Patient Share' : 'Net Payable'}</span>
                    <span className="font-extrabold text-slate-900 text-sm">{formatPKR(liveNetPayable)}</span>
                  </div>
                  {invoice.payerType === 'Corporate / Panel' && <div className="flex justify-between text-xs text-purple-800"><span>Panel Receivable (separate)</span><strong>{formatPKR(invoice.panelReceivable)}</strong></div>}
                  {invoice.advancePaid > 0 && (
                    <div className="flex items-center justify-between text-xs text-slate-700 font-semibold">
                      <span>Advance Paid / Deposit Received</span>
                      <span className="font-bold text-slate-800">{formatPKR(invoice.advancePaid)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-slate-700 font-semibold">
                    <span>{invoice.advancePaid > 0 ? 'Amount Paid (including advance)' : 'Amount Paid'}</span>
                    <span className="font-bold text-[#08775A]">{formatPKR(livePaidTotal)}</span>
                  </div>

                  {/* Current Remaining Row */}
                  <div className="flex items-center justify-between text-xs text-slate-700 font-semibold pt-1.5 border-t border-slate-200/80">
                    <span>Current Remaining</span>
                    {liveRemainingRefundable > 0 ? (
                      <span className="font-bold text-emerald-700" title="Remaining advance / patient credit">
                        {formatPKR(liveRemainingRefundable)} <span className="text-[10px] font-medium text-emerald-600">(Patient Credit)</span>
                      </span>
                    ) : liveBalanceDue > 0 ? (
                      <span className="font-bold text-rose-700" title="Remaining balance due from patient">
                        {formatPKR(liveBalanceDue)} <span className="text-[10px] font-medium text-rose-600">(Due)</span>
                      </span>
                    ) : (
                      <span className="font-bold text-slate-600">
                        {formatPKR(0)} <span className="text-[10px] font-medium text-slate-500">(Settled)</span>
                      </span>
                    )}
                  </div>

                  {/* Standard Balance Due Box */}
                  <div
                    className={`flex items-center justify-between text-xs p-2.5 rounded-lg border font-semibold ${
                      liveBalanceDue <= 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <span className="font-extrabold uppercase tracking-wide">Balance Due</span>
                    <span className="font-extrabold text-base font-mono">
                      {formatPKR(liveBalanceDue)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {actionError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {actionError}
            </div>
          )}

          {/* Fast Unified Payment & Discount Form (When Balance Due > 0) */}
          {canCollectPayment && activeAction === 'payment' && (
            <form onSubmit={handleCollectPayment} className="p-3.5 bg-[#effaf5] rounded-xl border border-[#c2e7db] space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between pb-1.5 border-b border-[#c2e7db]/70">
                <span className="text-xs font-bold text-[#08775A] flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4" /> Fast Payment &amp; Discount Settlement
                </span>
                <span className="text-[11px] text-slate-600 font-sans font-semibold">
                  Remaining Due: <strong className="text-slate-900">{formatPKR(invoice.balanceDue)}</strong>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1. Discount (Cursor lands here first if not Lab/Pharmacy!) */}
                <NumberInput
                  id="modal-discount-input"
                  label={isDiscountDisabled ? "Discount (Not Permitted)" : "Discount (PKR)"}
                  min={0}
                  max={eligibleHospitalServicesGross}
                  placeholder={isDiscountDisabled ? "N/A" : "0"}
                  value={isDiscountDisabled ? '' : discountAmount}
                  disabled={isDiscountDisabled || isFullyPaid}
                  onChange={(e) => {
                    if (isDiscountDisabled) return;
                    const val = e.target.value === '' ? '' : Number(e.target.value);
                    setDiscountAmount(val);
                    if (!paymentAmountTouched) {
                      const disc = typeof val === 'number' ? val : 0;
                      setPaymentAmount(Math.max(0, invoice.balanceDue - disc));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const payInput = document.getElementById('modal-payment-input') as HTMLInputElement | null;
                      if (payInput) {
                        payInput.focus();
                        payInput.select();
                      }
                    }
                  }}
                  hint={
                    isDiscountDisabled
                      ? "Discounts strictly restricted to Hospital Services (No discount on Lab/Pharmacy)."
                      : eligibleHospitalServicesGross < invoice.subtotal
                        ? `Discount applies to Hospital Services only (Max ${formatPKR(eligibleHospitalServicesGross)}). Outsourced Lab/Pharmacy cannot be discounted.`
                        : "Enter to advance to Amount Paid"
                  }
                />

                {/* 2. Amount Paid (Enter on this triggers payment submission!) */}
                <NumberInput
                  id="modal-payment-input"
                  label="Amount Paid (PKR)"
                  required
                  min={0}
                  value={paymentAmount}
                  onChange={(e) => {
                    setPaymentAmountTouched(true);
                    setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCollectPayment(e);
                    }
                  }}
                  hint={invoice.sourceType === 'ADMISSION' ? 'Any amount may be received. Excess remains as patient credit.' : 'Enter to confirm & submit payment'}
                />

                {/* 3. Payment Method */}
                <Select
                  label="Payment Method"
                  options={PAYMENT_METHODS}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex-1 max-w-sm">
                  <TextInput
                    label="Reference / Auth (optional)"
                    placeholder="e.g. Cash Receipt # / Card Auth Code"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCollectPayment(e);
                      }
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="self-end px-5 py-2.5 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-sm disabled:opacity-60 transition-colors shrink-0 cursor-pointer flex items-center gap-1.5"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Processing…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>
                        Confirm Paid: {formatPKR(typeof paymentAmount === 'number' ? paymentAmount : invoice.balanceDue)} (Enter)
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Discount Form */}
          {activeAction === 'discount' && (
            <form onSubmit={handleApplyDiscount} className="space-y-3 p-3 bg-amber-50/60 rounded-xl border border-amber-200 animate-in fade-in">
              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Discount %" min={0} max={100} value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value === '' ? '' : Number(e.target.value))} />
                <NumberInput label="OR Discount Amount (PKR)" min={0} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <TextInput label="Reason" required placeholder="e.g. Administrative / Patient Relief Discount" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeAction} className="px-3 py-1.5 text-xs font-semibold text-slate-600">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-700 rounded-lg disabled:opacity-60">{isSaving ? 'Applying…' : 'Apply Discount'}</button>
              </div>
            </form>
          )}

          {/* Add Line Form */}
          {activeAction === 'addLine' && (
            <form onSubmit={handleAddLine} className="space-y-3.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                <span className="text-xs font-bold text-[#08775A] flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Service / Procedure to Invoice
                </span>
                <span className="text-[11px] text-slate-500 font-medium">
                  {getInvoiceEncounterLabel(invoice)}
                </span>
              </div>

              {/* Service Category / Source Filter */}
              <div>
                <DoctorChargeForm target="invoices" id={invoiceId} onPosted={() => { load(); }} />
                      <ServiceSourcePicker value={selectedDeptFilter} onChange={value => { setSelectedDeptFilter(value); setSelectedServiceIds([]); }} departments={departments} onServices={setServices} />
              </div>

              {/* Searchable Multi-Select Service Checklist */}
              <ServiceChecklist
                label="2. Select Services / Procedures to Add"
                services={filteredServices}
                selectedServiceIds={selectedServiceIds}
                onChange={setSelectedServiceIds}
                emptyMessage={
                  filteredServices.length === 0
                    ? NO_ACTIVE_DEPARTMENT_SERVICES
                    : 'No services available in this category'
                }
              />

              {selectedServices.length > 0 && (
                <div className="flex items-center justify-between p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs">
                  <span className="font-semibold text-emerald-900">
                    {selectedServices.length} {selectedServices.length === 1 ? 'Service' : 'Services'} Selected
                  </span>
                  <span className="font-bold text-emerald-950">
                    Total: {formatPKR(selectedServicesTotal)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Quantity (per service)" min={1} value={lineQty} onChange={(e) => setLineQty(Number(e.target.value) || 1)} />
                <Select label="Performed By (optional)" options={doctors.map((d) => ({ label: d.fullName, value: d.id }))} value={linePerformedBy} onChange={(e) => setLinePerformedBy(e.target.value)} />
              </div>

              <div className="flex justify-end gap-2 pt-1 border-t border-slate-200">
                <button type="button" onClick={closeAction} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={isSaving || selectedServiceIds.length === 0} className="px-4 py-1.5 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg disabled:opacity-50 transition-colors shadow-2xs">
                  {isSaving ? 'Adding…' : selectedServiceIds.length > 1 ? `Add ${selectedServiceIds.length} Lines` : 'Add Line'}
                </button>
              </div>
            </form>
          )}

          {/* Refund Form */}
          {activeAction === 'refund' && (
            <form onSubmit={handleRefund} className="space-y-3 p-3 bg-rose-50/60 rounded-xl border border-rose-200 animate-in fade-in">
              <div className="flex items-center justify-between text-[11px] font-semibold text-rose-800">
                <span>Refundable (amount collected so far)</span>
                <span className="font-mono font-bold">{formatPKR(invoice.paidTotal)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label="Refund Amount (PKR)"
                  required
                  min={0}
                  max={invoice.paidTotal}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  hint={`Max refundable: ${formatPKR(invoice.paidTotal)}`}
                />
                <Select label="Method" options={PAYMENT_METHODS} value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)} />
              </div>
              <TextInput label="Reason" required placeholder="Mandatory reason for refund" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeAction} className="px-3 py-1.5 text-xs font-semibold text-slate-600">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded-lg disabled:opacity-60">{isSaving ? 'Posting…' : 'Post Refund'}</button>
              </div>
            </form>
          )}

          {/* Bottom Footer Actions: Print Slip & Close */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Printer className="h-4 w-4 text-[#08775A]" />
              <span>Print Invoice Slip</span>
            </button>

            <div className="flex items-center gap-2">
              {canCollectPayment && activeAction !== 'payment' && (
                <button
                  type="button"
                  onClick={() => setActiveAction('payment')}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <CreditCard className="h-4 w-4" />
                  <span>{invoice.sourceType === 'ADMISSION' ? 'Collect Payment / Advance' : 'Collect Payment'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                {isFullyPaid ? 'Done — Next Patient' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
