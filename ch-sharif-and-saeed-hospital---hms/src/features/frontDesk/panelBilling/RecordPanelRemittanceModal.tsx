import React, { useMemo, useState } from 'react';
import { AlertCircle, Loader2, Wallet, Building2, CheckCircle2, User } from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { Select, TextInput, Textarea } from '../../../components/forms/FormControls';
import { formatPKR } from '../../../utils/formatters';
import { useToast } from '../../../context/ToastContext';
import {
  recordPanelRemittance,
  PanelRemittanceMethod,
  PanelStatementInvoiceRow,
} from '../../../services/panelBillingService';

const METHODS: { label: string; value: PanelRemittanceMethod }[] = [
  { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
  { label: 'Cheque',        value: 'CHEQUE' },
  { label: 'Online',        value: 'ONLINE' },
  { label: 'Cash',          value: 'CASH' },
];

interface RecordPanelRemittanceModalProps {
  corporatePanelId: string;
  corporatePanelName: string;
  outstandingInvoices: PanelStatementInvoiceRow[];
  onClose: () => void;
  onRecorded: () => void;
}

export const RecordPanelRemittanceModal: React.FC<RecordPanelRemittanceModalProps> = ({
  corporatePanelId,
  corporatePanelName,
  outstandingInvoices,
  onClose,
  onRecorded,
}) => {
  const toast = useToast();

  const totalOutstanding = useMemo(
    () => outstandingInvoices.reduce((s, inv) => s + inv.panelReceivableOutstanding, 0),
    [outstandingInvoices]
  );

  const [amount, setAmount] = useState<string>(totalOutstanding > 0 ? String(totalOutstanding) : '');
  const [method, setMethod] = useState<PanelRemittanceMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const remaining = totalOutstanding - numericAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!numericAmount || numericAmount <= 0) {
      setFormError('Amount is required.');
      return;
    }
    setIsSaving(true);
    try {
      await recordPanelRemittance(corporatePanelId, {
        amount: numericAmount,
        method,
        reference: reference.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      toast.success(`${formatPKR(numericAmount)} payment recorded from ${corporatePanelName}.`);
      onRecorded();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to record payment.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Record Company Payment"
      subtitle={`Payment received from ${corporatePanelName}`}
      maxWidth="lg"
    >
      <div className="space-y-4">

        {/* How much is pending — the key info */}
        <div className={`rounded-xl p-4 border-2 ${totalOutstanding > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Building2 className={`h-4 w-4 ${totalOutstanding > 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
            <span className={`text-xs font-bold uppercase tracking-wide ${totalOutstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {corporatePanelName} — Company Owes
            </span>
          </div>
          <div className={`text-3xl font-black ${totalOutstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {formatPKR(totalOutstanding)}
          </div>
          {totalOutstanding === 0 && (
            <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 mt-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> No outstanding balance
            </span>
          )}
        </div>

        {/* Per-patient breakdown */}
        {outstandingInvoices.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-200 bg-white">
              <span className="text-xs font-bold text-slate-700">Pending per Patient</span>
            </div>
            <div className="divide-y divide-slate-200 max-h-44 overflow-y-auto">
              {outstandingInvoices.map((inv) => (
                <div key={inv.hospitalInvoiceId} className="flex items-center justify-between px-3.5 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                      <User className="h-3.5 w-3.5 text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{inv.patientName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{inv.invoiceNumber}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black text-rose-700">{formatPKR(inv.panelReceivableOutstanding)}</div>
                    <div className="text-[10px] text-slate-400">company share</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payment form */}
        {outstandingInvoices.length === 0 ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">All invoices are settled</p>
            <p className="text-xs text-slate-400 mt-1">No outstanding company receivable to record payment against.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {formError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Amount — clearly labelled */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Amount Received from Company <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">PKR</span>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min={1}
                  max={totalOutstanding}
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-11 pr-3 py-2.5 text-sm font-bold border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] text-slate-900 bg-white"
                  placeholder={String(totalOutstanding)}
                />
              </div>
              {/* Visual feedback: what will still be left */}
              {numericAmount > 0 && (
                <div className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${
                  remaining <= 0 ? 'text-emerald-600' : 'text-amber-600'
                }`}>
                  {remaining <= 0
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> Full payment — company account will be clear</>
                    : <><AlertCircle className="h-3.5 w-3.5" /> {formatPKR(remaining)} will still remain outstanding</>
                  }
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Payment Method"
                required
                options={METHODS}
                value={method}
                onChange={(e) => setMethod(e.target.value as PanelRemittanceMethod)}
              />
              <TextInput
                label="Reference / Cheque No. (optional)"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. CHQ-12345"
              />
            </div>

            <Textarea
              label="Remarks (optional)"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any notes about this payment..."
            />

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || numericAmount <= 0}
                className="px-5 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer transition-all"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <Wallet className="h-3.5 w-3.5" />
                Record Payment
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
