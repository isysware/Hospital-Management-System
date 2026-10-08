import React, { useEffect, useState } from 'react';
import apiClient from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';

export function DoctorChargeForm({ target, id, onPosted }: { target: 'admissions' | 'invoices'; id: string; onPosted: () => void }) {
  const { currentUser } = useAuth();
  const canConfigure = ['Super Admin','Admin'].includes(currentUser?.role ?? '');
  const [doctors,setDoctors] = useState<any[]>([]), [doctorId,setDoctorId] = useState(''), [fee,setFee] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const load = () => apiClient.get('/setup/doctor-fees').then(r => setDoctors(r.data.data));
  useEffect(() => { load().catch(() => setError('Unable to load doctor fees')); }, []);
  const doctor = doctors.find(d => d.id === doctorId);
  const run = async (configure: boolean) => { setBusy(true); setError(''); try {
    if (configure) { await apiClient.patch('/setup/doctor-fees/' + doctorId, { consultationFee: Number(fee) }); await load(); }
    else { await apiClient.post('/' + target + '/' + id + '/doctor-charges', { doctorStaffId: doctorId, quantity: 1 }); onPosted(); }
  } catch (e: any) { setError(e.response?.data?.error?.message || e.message); } finally { setBusy(false); } };
  return <section className="border rounded p-4 my-3 space-y-2"><h3 className="font-semibold">Doctor Charges</h3>
    <select aria-label="Doctor for visit charge" className="border rounded p-2 w-full" value={doctorId} onChange={e => { setDoctorId(e.target.value); setFee(''); }}><option value="">Select Doctor</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.fullName} — {d.consultationFee == null ? 'Fee not configured' : 'PKR ' + d.consultationFee}</option>)}</select>
    {canConfigure && doctorId && <div><input aria-label="Configured doctor visit fee" type="number" min="0" value={fee} onChange={e => setFee(e.target.value)} placeholder="Visit fee (PKR)" /><button type="button" disabled={busy || fee === '' || Number(fee) < 0} onClick={() => run(true)}>Save Doctor Fee</button></div>}
    <button type="button" className="rounded bg-emerald-700 text-white px-3 py-2" disabled={busy || doctor?.consultationFee == null} onClick={() => run(false)}>Post Doctor Visit Charge</button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </section>;
}
