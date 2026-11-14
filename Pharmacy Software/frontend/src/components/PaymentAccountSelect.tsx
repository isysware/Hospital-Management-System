import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

export function PaymentAccountSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [accounts, setAccounts] = useState<{ id: string; name: string; netMovement: number }[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { apiClient.get('/vendors/payment-accounts').then(r => setAccounts(r.data.data)).catch(() => setError('Unable to load payment accounts.')); }, []);
  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const { data } = await apiClient.post('/vendors/payment-accounts', { name });
      setAccounts(a => [...a, { ...data.data, netMovement: 0 }]); onChange(data.data.id); setName('');
    } catch (e: any) { setError(e.response?.data?.error?.message || 'Unable to create account.'); }
    finally { setSaving(false); }
  }
  return <div className="space-y-2 text-xs">
    <label className="block font-semibold">Paying Bank / Online Account
      <select required value={value} onChange={e => onChange(e.target.value)} className="w-full mt-1 p-2 border rounded-lg">
        <option value="">Select account</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (recorded movement: {Number(a.netMovement).toFixed(2)})</option>)}
      </select>
    </label>
    <div className="flex gap-2"><input aria-label="New payment account name" value={name} onChange={e => setName(e.target.value)} placeholder="New account name" className="min-w-0 flex-1 p-2 border rounded-lg" /><button type="button" disabled={saving || name.trim().length < 2} onClick={create} className="px-3 border rounded-lg disabled:opacity-50">Add account</button></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
