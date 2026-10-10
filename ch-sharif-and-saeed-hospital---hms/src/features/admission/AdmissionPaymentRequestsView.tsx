import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Loader2,
  AlertCircle,
  Plus,
  RefreshCw,
  Search,
  RotateCcw,
  Wallet,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { Select, NumberInput, TextInput, Textarea } from '../../components/forms/FormControls';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/StateViews';
import { formatPKR } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';
import { fetchPaymentRequests, PaymentRequestRecord } from '../../services/paymentRequestService';
import { fetchAdmissions, requestAdmissionPayment, AdmissionRecord } from '../../services/admissionService';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

const STATUS_BADGE: Record<string, { badge: string; dot: string; label: string }> = {
  PENDING: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    label: 'Pending',
  },
  PARTIALLY_FULFILLED: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
    label: 'Partially Collected',
  },
  FULFILLED: {
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Fulfilled',
  },
  CANCELLED: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
    label: 'Cancelled',
  },
};

const NewRequestModal: React.FC<{ admissions: AdmissionRecord[]; onClose: () => void; onRequested: () => void }> = ({
  admissions,
  onClose,
  onRequested,
}) => {
  const toast = useToast();
  const [admissionId, setAdmissionId] = useState('');
  const [requestType, setRequestType] = useState<'ADVANCE' | 'PARTIAL' | 'FINAL'>('PARTIAL');
  const [amount, setAmount] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admissionId) {
      setError('Select an active admission.');
      return;
    }
    if (!amount || amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await requestAdmissionPayment(admissionId, {
        requestType,
        requestedAmount: Number(amount),
        notes: notes.trim() || undefined,
      });
      toast.success('Payment request sent to Front Desk / Billing.');
      onRequested();
    } catch (err: any) {
      setError(err?.message || 'Failed to raise payment request.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Request Hospital Payment"
      subtitle="Sent directly to Front Desk / Billing queue — Admission never collects cash."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-semibold">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
        <Select
          label="Active Admission"
          required
          placeholder="Choose an active admission…"
          options={admissions.map((a) => ({
            label: `${a.admissionNumber} — ${a.patientName} (${a.departmentName})`,
            value: a.id,
          }))}
          value={admissionId}
          onChange={(e) => setAdmissionId(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Request Type"
            options={[
              { label: 'Advance Payment', value: 'ADVANCE' },
              { label: 'Running / Partial Bill', value: 'PARTIAL' },
              { label: 'Final Settlement', value: 'FINAL' },
            ]}
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as any)}
          />
          <NumberInput
            label="Amount (PKR)"
            required
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <Textarea
          label="Notes / Clinical Justification (optional)"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Procedure advance requested per consultant order…"
        />
        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-xl shadow-xs disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
            Send to Cashier
          </button>
        </div>
      </form>
    </Modal>
  );
};

/**
 * Hospital Payment Requests (Admission-portal view) — raise requests to
 * Front Desk Cashier and track collection status against live DB records.
 */
export const AdmissionPaymentRequestsView: React.FC = () => {
  const [requests, setRequests] = useState<PaymentRequestRecord[]>([]);
  const [activeAdmissions, setActiveAdmissions] = useState<AdmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PARTIALLY_FULFILLED' | 'FULFILLED'>('ALL');

  const load = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const [reqs, active] = await Promise.all([
        fetchPaymentRequests(),
        fetchAdmissions({ status: 'ACTIVE' }),
      ]);
      setRequests(reqs);
      setActiveAdmissions(active);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load hospital payment requests.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalRequested = useMemo(
    () => requests.reduce((acc, r) => acc + (Number(r.requestedAmount) || 0), 0),
    [requests]
  );
  const totalCollected = useMemo(
    () => requests.reduce((acc, r) => acc + (Number(r.collectedAmount) || 0), 0),
    [requests]
  );
  const totalRemaining = useMemo(
    () => requests.reduce((acc, r) => acc + (Number(r.remainingAmount) || 0), 0),
    [requests]
  );

  const kpiItems: KpiItem[] = [
    {
      title: 'Total Requests Raised',
      value: requests.length,
      icon: CreditCard,
      subtitle: `${activeAdmissions.length} Inpatients Eligible`,
      accentColor: '#08775A',
    },
    {
      title: 'Total Amount Requested',
      value: formatPKR(totalRequested),
      icon: Wallet,
      subtitle: 'Hospital Billing Inpatient Intake',
      accentColor: '#0284c7',
    },
    {
      title: 'Collected by Front Desk',
      value: formatPKR(totalCollected),
      icon: CheckCircle2,
      subtitle: totalRequested > 0 ? `${Math.round((totalCollected / totalRequested) * 100)}% Fulfilled` : 'Settled Invoices',
      accentColor: '#16a34a',
    },
    {
      title: 'Remaining to Collect',
      value: formatPKR(totalRemaining),
      icon: Clock,
      subtitle: 'Pending Cashier Settlement',
      accentColor: '#f59e0b',
    },
  ];

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.patientName.toLowerCase().includes(q) ||
        r.admissionNumber.toLowerCase().includes(q) ||
        r.requestType.toLowerCase().includes(q)
      );
    });
  }, [requests, searchTerm, statusFilter]);

  const hasActiveFilters = searchTerm.trim() !== '' || statusFilter !== 'ALL';

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Header Block (§4.1) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#effaf5] border border-[#c2e7db] text-[#08775A] flex items-center justify-center font-bold shadow-2xs">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Hospital Payment Requests</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#08775A] animate-pulse" />
                Cashier Linked
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Raise advance/partial/final payment requests. Front Desk cashier collects; Admission portal tracks reconciliation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 text-xs font-semibold shadow-2xs transition-colors"
            title="Refresh Requests"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[#08775A]' : 'text-slate-500'}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setIsNewOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" /> New Payment Request
          </button>
        </div>
      </div>

      {/* Hospital KPI Telemetry (§4.2) */}
      <HospitalKpiHeader items={kpiItems} />

      {/* Filter Toolbar (§4.4) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
          <div className="relative w-64 sm:w-80">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search patient, admission #, type…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-slate-50/50"
            />
          </div>

          <div className="inline-flex items-center p-1 bg-slate-100/80 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Requests ({requests.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('PENDING')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusFilter === 'PENDING' ? 'bg-amber-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusFilter === 'PENDING' ? 'bg-white' : 'bg-amber-500'}`} />
              Pending
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('PARTIALLY_FULFILLED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusFilter === 'PARTIALLY_FULFILLED' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusFilter === 'PARTIALLY_FULFILLED' ? 'bg-white' : 'bg-blue-500'}`} />
              Partial
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('FULFILLED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusFilter === 'FULFILLED' ? 'bg-[#08775A] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusFilter === 'FULFILLED' ? 'bg-white' : 'bg-emerald-500'}`} />
              Fulfilled
            </button>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setStatusFilter('ALL');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50/60 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
          </button>
        )}
      </div>

      {/* Data Table Container (§4.5) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] px-5 py-3.5 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <CreditCard className="h-4 w-4 text-emerald-300" />
            <h2 className="text-sm font-bold text-white tracking-wide">Inpatient Payment Request Register</h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-200 border border-emerald-700/50 text-xs font-mono font-bold">
              {filtered.length} Record{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          <span className="text-[11px] text-emerald-200/80 font-medium hidden sm:inline">
            Directly synced with Front Desk Cashier / Receipts Register
          </span>
        </div>

        {isLoading ? (
          <div className="p-12">
            <LoadingState message="Loading hospital payment requests…" />
          </div>
        ) : loadError ? (
          <div className="p-8">
            <ErrorState message={loadError} onRetry={() => load()} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10">
            <EmptyState
              title="No payment requests found"
              description="Click '+ New Payment Request' to raise an advance or running bill collection to the Front Desk."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#effaf5] border-b border-[#c2e7db] sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Admission #</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Patient</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Request Type</th>
                  <th className="text-right px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Requested</th>
                  <th className="text-right px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Collected</th>
                  <th className="text-right px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Remaining</th>
                  <th className="text-center px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Status</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Requested At</th>
                  <th className="text-right px-4 py-3 font-bold text-[#08775A] whitespace-nowrap">Ledger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r, idx) => {
                  const conf = STATUS_BADGE[r.status] || {
                    badge: 'bg-slate-100 text-slate-700 border-slate-200',
                    dot: 'bg-slate-400',
                    label: r.status,
                  };

                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors hover:bg-[#e7f6f1]/40 ${
                        idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'
                      }`}
                    >
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono font-bold text-slate-800">
                        {r.admissionNumber}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-bold text-slate-900">{r.patientName}</td>
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          {r.requestType}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-right font-mono font-bold text-slate-900 tabular-nums">
                        {formatPKR(r.requestedAmount)}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-right font-mono font-bold text-emerald-700 tabular-nums">
                        {formatPKR(r.collectedAmount)}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-right font-mono font-bold text-amber-700 tabular-nums">
                        {formatPKR(r.remainingAmount)}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${conf.badge}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
                          {conf.label}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono text-slate-400 text-[11px]">
                        {r.requestedAt}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <AdmissionLedgerButton admissionId={r.admissionId} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isNewOpen && (
        <NewRequestModal
          admissions={activeAdmissions}
          onClose={() => setIsNewOpen(false)}
          onRequested={() => {
            setIsNewOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
};
