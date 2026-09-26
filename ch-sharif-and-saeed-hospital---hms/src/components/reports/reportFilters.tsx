import React, { useEffect, useState } from 'react';
import { Select } from '../forms/FormControls';

// ── Shared filter-row plumbing (reporting.md §1 "Top Filter Row") ─────────
// Each report keeps its filter values in local state; GenericReportView's
// Filter button calls `fetchReport`, which closes over the current values,
// so every dropdown really re-queries the backend.

export interface FilterOption {
  value: string;
  label: string;
}

/** Filter-row state keyed by backend query param. `bind(key)` spreads onto a Select/TextInput; `reset` goes to GenericReportView's `onResetExtraFilters`. */
export function useReportFilters<K extends string>(initial: Record<K, string>) {
  const [filters, setFilters] = useState(initial);
  const bind = (key: K) => ({
    value: filters[key],
    onChange: (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFilters((prev) => ({ ...prev, [key]: e.target.value })),
  });
  return { filters, bind, reset: () => setFilters(initial) };
}

/** Loads dropdown sources once per mount; on failure dropdowns simply stay at "All" and the report still loads. */
export function useFilterOptions<T>(load: () => Promise<T>, empty: T): T {
  const [options, setOptions] = useState(empty);
  useEffect(() => {
    let alive = true;
    load()
      .then((o) => {
        if (alive) setOptions(o);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return options;
}

export const FilterSelect: React.FC<{ label: string; options: FilterOption[]; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement> }> = ({ label, options, value, onChange }) => (
  <div className="w-44">
    <Select label={label} options={[{ value: '', label: 'All' }, ...options]} value={value} onChange={onChange} />
  </div>
);

export const opts = (...pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }));
