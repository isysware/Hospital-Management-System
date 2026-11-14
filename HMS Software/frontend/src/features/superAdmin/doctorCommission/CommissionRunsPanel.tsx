import React, { useEffect, useState } from 'react';
import { Select, TextInput } from '../../../components/forms/FormControls';
import { useToast } from '../../../context/ToastContext';
import { formatPKR } from '../../../utils/formatters';
import { fetchDepartments } from '../../../services/departmentService';
import {
  CommissionAccrual, CommissionRun, CommissionRunFilters, previewCommissionRun,
  generateCommissionRun, fetchCommissionRuns, getCommissionRun, approveCommissionRun,
} from '../../../services/commissionService';

type Option = { id: string; name: string };
const button = 'px-3 py-2 rounded-lg bg-[#08775A] text-white text-xs font-semibold disabled:opacity-50';

export const CommissionRunsPanel: React.FC<{ doctors: Option[]; services: Option[]; ledgerVersion: number; onChanged: () => void }> = ({ doctors, services, ledgerVersion, onChanged }) => {
  const toast = useToast();
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [filters, setFilters] = useState<CommissionRunFilters>({ periodType: 'MONTHLY', periodStart: `${localDate.slice(0, 7)}-01`, periodEnd: localDate });
  const [departments, setDepartments] = useState<Option[]>([]);
  const [runs, setRuns] = useState<CommissionRun[]>([]);
  const [preview, setPreview] = useState<{ lines: CommissionAccrual[]; totalAmount: number } | null>(null);
  const [detail, setDetail] = useState<CommissionRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([fetchCommissionRuns(), fetchDepartments()]).then(([r, d]) => {
      if (active) { setRuns(r); setDepartments(d.map(x => ({ id: x.id, name: x.name }))); }
    }).catch(e => { if (active) setError(e?.response?.data?.error?.message || 'Unable to load commission runs.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!detail?.id) return;
    let active = true;
    getCommissionRun(detail.id).then(run => { if (active) setDetail(run); })
      .catch(() => { if (active) setError('Unable to refresh statement balances.'); });
    return () => { active = false; };
  }, [detail?.id, ledgerVersion]);
  const change = (patch: Partial<CommissionRunFilters>) => { setFilters(f => ({ ...f, ...patch })); setPreview(null); };
  const execute = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (e: any) { setError(e?.response?.data?.error?.message || e.message || 'Commission operation failed.'); }
    finally { setBusy(false); }
  };
  const lines = detail?.lines ?? preview?.lines ?? [];
  return <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
    <h2 className="font-bold text-slate-900">Commission Runs &amp; Statements</h2>
    <p className="text-xs text-slate-500">Preview commission earned from collections in the selected period, generate, then approve. Later collections create separate entries. Record commission payments below.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Select label="Run Type" value={filters.periodType} options={['DAILY', 'MONTHLY', 'CUSTOM'].map(value => ({ value, label: value }))}
        onChange={e => change({ periodType: e.target.value as CommissionRunFilters['periodType'], ...(e.target.value === 'DAILY' ? { periodEnd: filters.periodStart } : {}) })} />
      <TextInput label="From" type="date" value={filters.periodStart} onChange={e => change({ periodStart: e.target.value, ...(filters.periodType === 'DAILY' ? { periodEnd: e.target.value } : {}) })} />
      <TextInput label="To" type="date" disabled={filters.periodType === 'DAILY'} value={filters.periodEnd} onChange={e => change({ periodEnd: e.target.value })} />
      <Select label="Department" value={filters.departmentId ?? ''} options={[{ value: '', label: 'All departments' }, ...departments.map(d => ({ value: d.id, label: d.name }))]} onChange={e => change({ departmentId: e.target.value || undefined })} />
      <Select label="Doctor / Staff" value={filters.staffId ?? ''} options={[{ value: '', label: 'All doctors' }, ...doctors.map(d => ({ value: d.id, label: d.name }))]} onChange={e => change({ staffId: e.target.value || undefined })} />
      <Select label="Service" value={filters.serviceRateId ?? ''} options={[{ value: '', label: 'All services' }, ...services.map(d => ({ value: d.id, label: d.name }))]} onChange={e => change({ serviceRateId: e.target.value || undefined })} />
    </div>
    <div className="flex gap-2">
      <button className={button} disabled={busy} onClick={() => execute(async () => { setDetail(null); setPreview(await previewCommissionRun(filters)); })}>Preview Commission</button>
      <button className={button} disabled={busy || !preview?.lines.length} onClick={() => execute(async () => {
        const run = await generateCommissionRun(filters); setDetail(await getCommissionRun(run.id)); setPreview(null);
        setRuns(await fetchCommissionRuns()); onChanged(); toast.success('Commission run generated.');
      })}>Generate Run</button>
    </div>
    <Select label="Generated Runs" value={detail?.id ?? ''} options={[{ value: '', label: 'Select a run' }, ...runs.map(r => ({ value: r.id, label: `${r.periodStart.slice(0, 10)} – ${r.periodEnd.slice(0, 10)} · ${r.status} · ${formatPKR(Number(r.totalAmount))}` }))]}
      onChange={e => { const id = e.target.value; if (!id) setDetail(null); else void execute(async () => { setPreview(null); setDetail(await getCommissionRun(id)); }); }} />
    {detail?.status === 'GENERATED' && <button className={button} disabled={busy} onClick={() => execute(async () => {
      setDetail(await approveCommissionRun(detail.id)); setRuns(await fetchCommissionRuns()); onChanged(); toast.success('Commission run approved.');
    })}>Approve Commission Run</button>}
    {(preview || detail) && <>
      <p className="text-sm font-semibold">{lines.length} collection entries · {detail ? 'Generated snapshot total' : 'Preview payable'}: {formatPKR(Number(detail?.totalAmount ?? preview?.totalAmount ?? 0))}</p>
      <div className="overflow-x-auto"><table className="w-full text-xs text-left">
        <thead><tr>{['Doctor', 'Date', 'Invoice / Service', 'Qty', 'Collected To Date', 'Rule', 'Gross', 'Tax', 'Reversed', 'Adjustments', 'Payable', 'Paid', 'Remaining', 'Overpaid'].map(h => <th key={h} className="p-2 border-b whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{lines.map(line => <tr key={line.id}>
          <td className="p-2">{line.doctorName}</td><td className="p-2 whitespace-nowrap">{line.periodStart}</td>
          <td className="p-2">{line.invoiceNumber}<br />{line.serviceName}</td><td className="p-2">{line.quantity}</td>
          <td className="p-2">{formatPKR(line.eligibleNet)}</td><td className="p-2">{line.ruleLabel}</td>
          {[line.commissionAmount, line.tax, line.reversedTotal, line.adjustmentsTotal, line.payable, line.paidTotal, line.remaining, line.overpaid].map((n, i) => <td key={i} className="p-2 whitespace-nowrap">{formatPKR(n)}</td>)}
        </tr>)}{!lines.length && <tr><td colSpan={14} className="p-4 text-center text-slate-500">No ungenerated commission earnings in this period.</td></tr>}</tbody>
      </table></div>
    </>}
  </section>;
};
