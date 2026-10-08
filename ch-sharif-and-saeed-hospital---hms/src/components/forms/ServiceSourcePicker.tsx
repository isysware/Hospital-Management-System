import React, { useEffect, useState } from 'react';
import { fetchServices } from '../../services/serviceRatesService';
import { selectionFromSource } from '../../utils/serviceSelection';
import type { Department } from '../../types/department';
import type { HospitalService } from '../../types/serviceRates';

export function ServiceSourcePicker({ value, onChange, departments, onServices }: {
  value: string;
  onChange: (value: string) => void;
  departments: Department[];
  onServices: (services: HospitalService[]) => void;
}) {
  const selection = selectionFromSource(value);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const available = departments.filter(d =>
    d.status === 'Active' &&
    !d.pharmacyRelated &&
    (d.fulfillmentOwnership === 'Outsourced' ? 'OUTSOURCED' : 'INTERNAL') === selection.providerType
  );
  const providers = [...new Map(
    available.filter(d => d.outsourcedProviderId).map(d => [d.outsourcedProviderId!, d.outsourcedProviderName || d.name])
  ).entries()];
  const scoped = available.filter(d =>
    selection.providerType === 'INTERNAL' || d.outsourcedProviderId === selection.outsourcedProviderId
  );

  useEffect(() => {
    let current = true;
    onServices([]); setError('');
    if (!selection.departmentId || (selection.providerType === 'OUTSOURCED' && !selection.outsourcedProviderId)) {
      setLoading(false); return;
    }
    setLoading(true);
    fetchServices({ ...selection, status: 'ACTIVE' })
      .then(rows => { if (current) onServices(rows); })
      .catch(() => { if (current) setError('Unable to load services. Please select the department again.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [value, onServices]);

  // HMS design-system select style — matches all other HMS dropdowns exactly
  const selectCls =
    'block w-full text-xs px-2.5 py-2 border border-[#c2e7db] rounded-lg bg-white text-[#111827] ' +
    'font-medium focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] ' +
    'cursor-pointer transition-colors';

  // HMS design-system label style
  const labelCls = 'block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1';

  return (
    <div className="grid gap-3">
      {/* Service Source / Provider Type */}
      <div>
        <label className={labelCls}>Service Source / Provider Type</label>
        <select
          aria-label="Service Source / Provider Type"
          className={selectCls}
          value={selection.providerType}
          onChange={e => onChange(e.target.value + '::')}
        >
          <option value="INTERNAL">Hospital / Internal</option>
          <option value="OUTSOURCED">Outsourced</option>
        </select>
        <p className="text-[11px] text-slate-500 mt-1 pl-0.5">
          {selection.providerType === 'INTERNAL'
            ? 'Internal hospital procedures, clinical care & nursing'
            : 'Outsourced lab, radiology, or third-party provider'}
        </p>
      </div>

      {/* Outsourced Provider (only when OUTSOURCED selected) */}
      {selection.providerType === 'OUTSOURCED' && (
        <div>
          <label className={labelCls}>Provider</label>
          <select
            aria-label="Outsourced Provider"
            className={selectCls}
            value={selection.outsourcedProviderId ?? ''}
            onChange={e => onChange('OUTSOURCED::' + e.target.value)}
          >
            <option value="">Select Provider</option>
            {providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      )}

      {/* Department */}
      <div>
        <label className={labelCls}>Department</label>
        <select
          aria-label="Service Department"
          className={selectCls}
          value={selection.departmentId ?? ''}
          onChange={e => onChange(
            selection.providerType + ':' + e.target.value + ':' + (selection.outsourcedProviderId ?? '')
          )}
        >
          <option value="">Select Department</option>
          {scoped.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <p role="status" className="text-[11px] text-slate-500">Loading services…</p>
      )}

      {/* Error */}
      {error && (
        <p role="alert" className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
