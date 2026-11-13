import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, X, Check, Ban, ShieldAlert, Eye, Settings2, RefreshCw } from 'lucide-react';
import { pharmacyApi, MedicineRow } from '../services/pharmacyApi';
import { formatPKR, formatNumber } from '../utils/format';
import { useToast } from '../context/ToastContext';
import { PharmacyDataTable, Column } from '../components/PharmacyDataTable';

const STATUS_STYLE: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-700 border-amber-200',
  ACCEPTED: 'bg-[#effaf5] text-[#0e7d5a] border-[#c2e7db]',
  PARTIALLY_ACCEPTED: 'bg-blue-50 text-blue-700 border-blue-200',
  DISPENSED: 'bg-[#effaf5] text-[#0e7d5a] border-[#c2e7db]',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
};

interface RequestLineRow {
  id: string;
  medicineId: string;
  medicine: MedicineRow;
  requestedQuantity: string | number;
  dispensedQuantity: string | number;
  notes?: string | null;
}
interface RequestRow {
  id: string;
  requestNumber: string;
  externalAdmissionRef: string;
  patientNameSnapshot?: string | null;
  urgency?: string | null;
  status: string;
  requestedAt: string;
  approvedById?: string | null;
  approvedByUser?: { fullName: string } | null;
  handledByUser?: { fullName: string } | null;
  rejectionReason?: string | null;
  lines: RequestLineRow[];
  invoice?: { invoiceNumber: string; total: string; paidTotal: string; outstanding: string; clearanceStatus?: string | null } | null;
}

function estimatedValue(req: RequestRow): number {
  return req.lines.reduce((sum, l) => sum + Number(l.requestedQuantity) * Number(l.medicine.saleRate), 0);
}

export const HmsRequestQueuePage: React.FC<{ canApprove: boolean }> = ({ canApprove }) => {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [settings, setSettings] = useState<any | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<RequestRow | null>(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const data = await pharmacyApi.listHmsRequests(statusFilter || undefined);
      setRows(data);
    } catch {
      toast.error('Failed to load requests.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [statusFilter]);

  useEffect(() => {
    pharmacyApi.getHmsSettings().then(setSettings);
  }, []);

  // Real-time automatic queue refresh when HMS submits a new requisition
  useEffect(() => {
    const handleNewRequest = () => {
      load();
    };
    window.addEventListener('hms-request-received', handleNewRequest);
    return () => window.removeEventListener('hms-request-received', handleNewRequest);
  }, []);

  // Periodic background poll every 15s to keep queue synchronized if system was offline
  useEffect(() => {
    const interval = setInterval(() => {
      pharmacyApi.listHmsRequests(statusFilter || undefined).then(setRows).catch(() => null);
    }, 15_000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const data = await pharmacyApi.listHmsRequests(statusFilter || undefined);
      setRows(data);
      toast.success('Queue synchronized with HMS.');
    } catch {
      toast.error('Sync failed. Please check HMS connectivity.');
    } finally {
      setSyncing(false);
    }
  };

  const summary = useMemo(() => {
    const s = { pending: 0, partial: 0, dispensed: 0, rejected: 0, needsApproval: 0 };
    for (const r of rows) {
      if (r.status === 'REQUESTED') s.pending += 1;
      if (r.status === 'PARTIALLY_ACCEPTED') s.partial += 1;
      if (r.status === 'DISPENSED') s.dispensed += 1;
      if (r.status === 'REJECTED') s.rejected += 1;
      if (settings?.highValueApprovalEnabled && r.status === 'REQUESTED' && !r.approvedById && estimatedValue(r) >= Number(settings.highValueThreshold)) s.needsApproval += 1;
    }
    return s;
  }, [rows, settings]);

  const handleApprove = async (id: string) => {
    try {
      await pharmacyApi.approveHmsRequest(id);
      toast.success('Request approved for dispensing.');
      load();
      setDetail(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to approve.');
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;
    try {
      await pharmacyApi.rejectHmsRequest(id, reason);
      toast.success('Request rejected.');
      load();
      setDetail(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to reject.');
    }
  };

  const columns: Column<RequestRow>[] = [
    {
      key: 'requestNumber',
      header: 'Request #',
      width: '160px',
      render: (r) => (
        <span className="font-bold text-slate-900 text-xs tracking-wider whitespace-nowrap">
          {r.requestNumber}
        </span>
      ),
    },
    {
      key: 'externalAdmissionRef',
      header: 'Admission Ref',
      width: '150px',
      render: (r) => (
        <span className="font-semibold text-slate-800 text-xs whitespace-nowrap">
          {r.externalAdmissionRef}
        </span>
      ),
    },
    {
      key: 'patientNameSnapshot',
      header: 'Patient Name',
      render: (r) => {
        const totalItems = r.lines.length;
        const pendingItems = r.lines.filter(
          (l) => Number(l.requestedQuantity) > Number(l.dispensedQuantity),
        ).length;
        return (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-bold text-slate-900 text-xs">
              {r.patientNameSnapshot || '—'}
            </span>
            {pendingItems > 0 ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                {pendingItems} to dispense
              </span>
            ) : totalItems > 0 ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {totalItems} fulfilled
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'urgency',
      header: 'Urgency',
      width: '120px',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              r.urgency === 'STAT' || r.urgency === 'URGENT' ? 'bg-rose-500' : 'bg-slate-400'
            }`}
          />
          <span
            className={
              r.urgency === 'STAT' || r.urgency === 'URGENT' ? 'text-rose-700' : 'text-slate-700'
            }
          >
            {r.urgency || 'Normal'}
          </span>
        </span>
      ),
    },
    {
      key: 'estValue',
      header: 'Est. Value (PKR)',
      align: 'right',
      width: '150px',
      render: (r) => (
        <span className="font-bold text-xs text-slate-900 whitespace-nowrap">
          {formatPKR(estimatedValue(r))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      width: '140px',
      render: (r) => {
        const isHighCostPending = r.urgency === 'HIGH_COST_PENDING' && !r.approvedById;
        const needsApproval =
          isHighCostPending ||
          (settings?.highValueApprovalEnabled &&
            r.status === 'REQUESTED' &&
            !r.approvedById &&
            estimatedValue(r) >= Number(settings.highValueThreshold));
        return (
          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-slate-800">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  r.status === 'DISPENSED'
                    ? 'bg-[#0e7d5a]'
                    : r.status === 'CANCELLED' || r.status === 'REJECTED'
                    ? 'bg-rose-500'
                    : isHighCostPending
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
              />
              {r.status.replace('_', ' ')}
            </span>
            {isHighCostPending && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200" title="Awaiting HMS Management Approval">
                Pending Approval
              </span>
            )}
            {!isHighCostPending && needsApproval && (
              <span title="High-value approval required">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      width: '100px',
      render: (r) => (
        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setDetail(r)}
            className="px-2 py-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Eye className="h-3 w-3" /> View
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-[1700px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Hospital Request Queue
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80">
              HMS Ward Requisitions
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Accept &amp; dispense, partial fulfillment, FEFO batch assignment, and dedicated billing invoice creation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing || loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 hover:bg-emerald-100/70 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            title="Pull latest pending medicine requests from HMS queue"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-emerald-700 ${syncing || loading ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync with HMS'}
          </button>
          {canApprove && (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
            >
              <Settings2 className="h-3.5 w-3.5 text-slate-500" /> High-Value Policy
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#0e7d5a] hover:bg-[#0c6b50] rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Log Ward Request
          </button>
        </div>
      </div>

      {/* KPI Cards / Status Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Pending Queue', value: summary.pending, filter: 'REQUESTED' },
          { label: 'Partially Fulfilled', value: summary.partial, filter: 'PARTIALLY_ACCEPTED' },
          { label: 'Dispensed Out', value: summary.dispensed, filter: 'DISPENSED' },
          { label: 'Rejected Orders', value: summary.rejected, filter: 'REJECTED' },
          { label: 'High Value Approval', value: summary.needsApproval, filter: '' },
        ].map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => setStatusFilter(c.filter)}
            className={`bg-white rounded-xl border-t-[3.5px] p-3 text-left shadow-2xs hover:shadow-sm transition-all cursor-pointer ${
              statusFilter === c.filter && c.filter
                ? 'border-t-[#0e7d5a] ring-1 ring-[#0e7d5a]'
                : 'border-t-slate-300 border-x border-b border-slate-200'
            }`}
          >
            <div className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">{c.label}</div>
            <div className="text-xl font-bold text-slate-900 mt-0.5">{c.value}</div>
          </button>
        ))}
      </div>

      {/* Main Table using unified PharmacyDataTable */}
      <PharmacyDataTable
        columns={columns}
        data={rows}
        loading={loading}
        title="Hospital Prescription & Dispense Queue"
        badge="Live Inpatient Orders"
        exportFileName="hospital_inpatient_requests"
        searchPlaceholder="Search request #, admission ref, or patient name…"
        searchFilter={(r, q) =>
          r.requestNumber.toLowerCase().includes(q) ||
          r.externalAdmissionRef.toLowerCase().includes(q) ||
          (r.patientNameSnapshot && r.patientNameSnapshot.toLowerCase().includes(q))
        }
        onRefresh={load}
        onApplyFilters={load}
        onResetFilters={() => {
          setStatusFilter('');
          load();
        }}
        filterControls={
          <div className="w-44">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-8.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="REQUESTED">Pending Only</option>
              <option value="PARTIALLY_ACCEPTED">Partially Accepted</option>
              <option value="DISPENSED">Fully Dispensed</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        }
        emptyTitle="No Hospital Requests Found"
        emptyDescription="No inpatient prescriptions match your selected filters."
      />

      {showSettings && settings && (
        <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onSaved={(s) => { setSettings(s); setShowSettings(false); }} />
      )}
      {showCreate && <CreateRequestModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detail && (
        <DetailModal
          request={detail}
          settings={settings}
          canApprove={canApprove}
          onClose={() => setDetail(null)}
          onApprove={() => handleApprove(detail.id)}
          onReject={() => handleReject(detail.id)}
          onFulfilled={() => { setDetail(null); load(); }}
        />
      )}
    </div>
  );
};

// ── High-Value Settings ─────────────────────────────────────────────────
const SettingsModal: React.FC<{ settings: any; onClose: () => void; onSaved: (s: any) => void }> = ({ settings, onClose, onSaved }) => {
  const [enabled, setEnabled] = useState<boolean>(settings.highValueApprovalEnabled);
  const [threshold, setThreshold] = useState<string>(String(settings.highValueThreshold));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await pharmacyApi.updateHmsSettings({ highValueApprovalEnabled: enabled, highValueThreshold: Number(threshold) || 0 });
      toast.success('Settings saved.');
      onSaved(updated);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl border border-[#e2eae5]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#e2eae5]">
          <h3 className="text-sm font-bold text-[#111827]">High-Value Medicine Approval</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-[#94a3b8]" /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="flex items-center gap-2 text-xs text-[#2d3748]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Require approval above a threshold
          </label>
          <div>
            <label className="block text-[11px] font-semibold text-[#52665e] mb-1">Threshold (PKR)</label>
            <input type="number" disabled={!enabled} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full h-9 px-3 text-sm border border-[#e2eae5] rounded-lg disabled:bg-slate-50" />
          </div>
          <p className="text-[10.5px] text-[#94a3b8]">pharmacy.md §7.3 — a request at/above this value is blocked from dispensing until an Admin/Super Admin approves it.</p>
          <button onClick={handleSave} disabled={saving} className="w-full h-9 text-xs font-semibold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg disabled:opacity-60">{saving ? 'Saving…' : 'Save Settings'}</button>
        </div>
      </div>
    </div>
  );
};

// ── Log Request (stand-in for the future live HMS submission) ─────────────
const CreateRequestModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [medicines, setMedicines] = useState<MedicineRow[]>([]);
  const [admissionRef, setAdmissionRef] = useState('');
  const [patientName, setPatientName] = useState('');
  const [urgency, setUrgency] = useState('ROUTINE');
  const [lines, setLines] = useState<{ medicineId: string; requestedQuantity: string }[]>([{ medicineId: '', requestedQuantity: '' }]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    pharmacyApi.listMedicines().then(setMedicines);
  }, []);

  const updateLine = (idx: number, patch: Partial<{ medicineId: string; requestedQuantity: string }>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { medicineId: '', requestedQuantity: '' }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!admissionRef.trim()) return toast.error('Admission reference is required.');
    const validLines = lines.filter((l) => l.medicineId && Number(l.requestedQuantity) > 0);
    if (validLines.length === 0) return toast.error('Add at least one medicine + quantity.');
    setSaving(true);
    try {
      await pharmacyApi.createHmsRequest({
        externalAdmissionRef: admissionRef.trim(),
        patientNameSnapshot: patientName.trim() || undefined,
        urgency,
        lines: validLines.map((l) => ({ medicineId: l.medicineId, requestedQuantity: Number(l.requestedQuantity) })),
      });
      toast.success('Request logged.');
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to log request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl border border-[#e2eae5] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#e2eae5]">
          <h3 className="text-sm font-bold text-[#111827]">Log Medicine Request</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-[#94a3b8]" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">Stand-in for the future live HMS submission (pharmacy.md §15) — same shape either way.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Admission Ref *"><input value={admissionRef} onChange={(e) => setAdmissionRef(e.target.value)} placeholder="e.g. A-102" className="input" /></Field>
            <Field label="Urgency">
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="input">
                <option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="STAT">STAT</option>
              </select>
            </Field>
          </div>
          <Field label="Patient Name"><input value={patientName} onChange={(e) => setPatientName(e.target.value)} className="input" /></Field>

          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-[#52665e]">Medicines</label>
            {lines.map((l, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <select value={l.medicineId} onChange={(e) => updateLine(idx, { medicineId: e.target.value })} className="input flex-1">
                  <option value="">Select medicine…</option>
                  {medicines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="number" min={0} value={l.requestedQuantity} onChange={(e) => updateLine(idx, { requestedQuantity: e.target.value })} placeholder="Qty" className="input w-24" />
                {lines.length > 1 && <button onClick={() => removeLine(idx)} className="text-rose-500"><X className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
            <button onClick={addLine} className="text-xs font-semibold text-[#129b70] hover:underline">+ Add medicine</button>
          </div>
        </div>
        <div className="p-4 border-t border-[#e2eae5] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#52665e] border border-[#e2eae5] rounded-lg">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-xs font-semibold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg disabled:opacity-60">{saving ? 'Submitting…' : 'Submit Request'}</button>
        </div>
        <style>{`.input { width: 100%; height: 2.25rem; padding: 0 0.75rem; font-size: 0.875rem; background: white; border: 1px solid #e2eae5; border-radius: 0.5rem; }`}</style>
      </div>
    </div>
  );
};

// ── Detail / Fulfill ────────────────────────────────────────────────────
const DetailModal: React.FC<{
  request: RequestRow;
  settings: any;
  canApprove: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onFulfilled: () => void;
}> = ({ request, settings, canApprove, onClose, onApprove, onReject, onFulfilled }) => {
  const [dispenseQty, setDispenseQty] = useState<Record<string, string>>(
    Object.fromEntries(request.lines.map((l) => [l.id, String(Math.max(0, Number(l.requestedQuantity) - Number(l.dispensedQuantity)))])),
  );
  const [fulfilling, setFulfilling] = useState(false);
  const toast = useToast();

  const isHighCostPending = request.urgency === 'HIGH_COST_PENDING' && !request.approvedById;
  const needsApproval =
    isHighCostPending ||
    (settings?.highValueApprovalEnabled &&
      request.status === 'REQUESTED' &&
      !request.approvedById &&
      estimatedValue(request) >= Number(settings.highValueThreshold));
  const canFulfill = (request.status === 'REQUESTED' || request.status === 'PARTIALLY_ACCEPTED') && !needsApproval;

  const handleFulfill = async () => {
    const lines = request.lines
      .map((l) => ({ requestLineId: l.id, dispenseQuantity: Number(dispenseQty[l.id] || 0) }))
      .filter((l) => l.dispenseQuantity > 0);
    if (lines.length === 0) return toast.error('Enter a dispense quantity for at least one line.');
    setFulfilling(true);
    try {
      await pharmacyApi.fulfillHmsRequest(request.id, lines);
      toast.success('Dispensed — Pharmacy invoice created/updated.');
      onFulfilled();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to dispense.');
    } finally {
      setFulfilling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl border border-[#e2eae5] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#e2eae5]">
          <div>
            <h3 className="text-sm font-bold text-[#111827]">{request.requestNumber}</h3>
            <p className="text-[11px] text-[#52665e]">Admission {request.externalAdmissionRef} {request.patientNameSnapshot ? `· ${request.patientNameSnapshot}` : ''}</p>
          </div>
          <button onClick={onClose}><X className="h-4 w-4 text-[#94a3b8]" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {isHighCostPending ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <span>
                <strong>High-Cost Medicine Policy Lock:</strong> This request contains medication exceeding the hospital policy threshold and is awaiting HMS Management authorization. Dispensing is locked until approved in HMS.
              </span>
            </div>
          ) : needsApproval ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Estimated value {formatPKR(estimatedValue(request))} is at/above the high-value threshold ({formatPKR(settings.highValueThreshold)}) — an Admin/Super Admin must approve before dispensing.</span>
            </div>
          ) : null}
          {request.approvedById && (
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Approved for Dispensing:</strong> HMS Management authorization confirmed ({request.approvedByUser?.fullName || 'Authorized'}).
              </span>
            </div>
          )}
          {request.status === 'REJECTED' && request.rejectionReason && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs">Rejected: {request.rejectionReason}</div>
          )}

          <table className="w-full text-sm">
            <thead className="bg-[#f6faf8]">
              <tr className="text-[10px] font-bold uppercase text-[#52665e]">
                <th className="py-2 px-2 text-left">Medicine</th>
                <th className="py-2 px-2 text-right">Requested</th>
                <th className="py-2 px-2 text-right">Dispensed</th>
                <th className="py-2 px-2 text-right">Remaining</th>
                {canFulfill && <th className="py-2 px-2 text-right">Dispense Now</th>}
              </tr>
            </thead>
            <tbody>
              {request.lines.map((l) => {
                const remaining = Number(l.requestedQuantity) - Number(l.dispensedQuantity);
                const isFullyDispensed = remaining <= 0;
                return (
                  <tr key={l.id} className={`border-t border-[#f0f4f2] ${isFullyDispensed ? 'bg-slate-50/40' : 'bg-amber-50/30'}`}>
                    <td className="py-2 px-2 font-semibold text-[#111827]">
                      <div>{l.medicine.name}</div>
                      {l.notes && <div className="text-[10px] text-slate-500 font-normal">{l.notes.replace(/\[HMS_LINE:[^\]]+\]\s*/, '')}</div>}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatNumber(l.requestedQuantity)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-emerald-700 font-semibold">{formatNumber(l.dispensedQuantity)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {isFullyDispensed ? (
                        <span className="text-slate-400 font-normal">0</span>
                      ) : (
                        <span className="font-bold text-amber-700">{formatNumber(remaining)}</span>
                      )}
                    </td>
                    {canFulfill && (
                      <td className="py-2 px-2 text-right">
                        {isFullyDispensed ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <Check className="h-3 w-3" /> Dispensed
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            value={dispenseQty[l.id] ?? ''}
                            onChange={(e) => setDispenseQty((prev) => ({ ...prev, [l.id]: e.target.value }))}
                            className="w-20 h-7 text-right text-xs border border-amber-300 bg-white font-semibold text-slate-900 rounded px-1.5 focus:ring-1 focus:ring-emerald-500"
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {request.invoice && (
            <div className="border-t border-[#e2eae5] pt-3 text-xs space-y-1">
              <p className="font-semibold text-[#111827]">Pharmacy Invoice {request.invoice.invoiceNumber}</p>
              <div className="flex justify-between"><span>Total</span><span className="tabular-nums font-bold">{formatPKR(request.invoice.total)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{formatPKR(request.invoice.paidTotal)}</span></div>
              <div className="flex justify-between"><span>Outstanding</span><span className="tabular-nums font-bold">{formatPKR(request.invoice.outstanding)}</span></div>
              <div className="flex justify-between"><span>Clearance</span><span className="font-semibold">{request.invoice.clearanceStatus ?? '—'}</span></div>
              <p className="text-[10.5px] text-[#94a3b8]">Collect payment from Sales / Invoices — Outstanding auto-clears when fully paid.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#e2eae5] flex items-center justify-end gap-2">
          {request.status === 'REQUESTED' && (
            <button onClick={onReject} className="px-4 py-2 text-xs font-semibold text-rose-700 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Reject</button>
          )}
          {needsApproval && canApprove && (
            <button onClick={onApprove} className="px-4 py-2 text-xs font-semibold text-amber-800 border border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-lg flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Approve High-Value</button>
          )}
          {canFulfill && (
            <button onClick={handleFulfill} disabled={fulfilling} className="px-4 py-2 text-xs font-semibold text-white bg-[#129b70] hover:bg-[#0e7d5a] rounded-lg disabled:opacity-60 flex items-center gap-1.5">
              {fulfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Dispense
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[11px] font-semibold text-[#52665e] mb-1">{label}</label>
    {children}
  </div>
);
