'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { purchaseOrdersApi, type PurchaseOrder } from '@/lib/api';

/** CS-05 — every purchase order on this production, with a status filter. Voided hidden by default. */
const gbp = (v: string | number) => '£' + (Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUSES = ['draft', 'submitted', 'issued', 'invoice_received', 'pending_approval', 'approved', 'voided'] as const;
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

export default function ProductionPOsTab({ productionId }: { productionId: string }) {
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    let active = true;
    purchaseOrdersApi.list({ production_id: productionId })
      .then(list => { if (active) setPos(list); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load purchase orders'); });
    return () => { active = false; };
  }, [productionId]);

  const shown = useMemo(() => (pos ?? [])
    .filter(p => (status ? p.status === status : p.status !== 'voided'))
    .sort((a, b) => (a.date_of_po < b.date_of_po ? 1 : -1)), [pos, status]);
  const total = shown.reduce((s, p) => s + (Number(p.net_amount) || 0), 0);

  if (error) return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>;
  if (!pos) return <div className="py-12 text-center"><Loader2 size={20} className="animate-spin text-blue-600 inline" /></div>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-slate-900 font-semibold text-sm">Purchase orders</h2>
          <p className="text-slate-400 text-xs mt-0.5">{shown.length} shown · {gbp(total)} net</p>
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All except voided</option>
          {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-5 py-2.5">PO</th><th className="text-left px-3 py-2.5">Date</th><th className="text-left px-3 py-2.5">Supplier</th>
              <th className="text-left px-3 py-2.5">Title</th><th className="text-left px-3 py-2.5">Set</th><th className="text-left px-3 py-2.5">Status</th>
              <th className="text-right px-5 py-2.5">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No purchase orders.</td></tr>
            ) : shown.map(p => (
              <tr key={p.id}>
                <td className="px-5 py-2 font-mono">{p.po_number}</td>
                <td className="px-3 py-2 whitespace-nowrap">{new Date(`${String(p.date_of_po).split('T')[0]}T12:00:00`).toLocaleDateString('en-GB')}</td>
                <td className="px-3 py-2">{p.supplier_name}</td>
                <td className="px-3 py-2 text-slate-500">{p.title || p.description || '—'}</td>
                <td className="px-3 py-2">{p.set_code || '—'}</td>
                <td className="px-3 py-2">{label(p.status)}</td>
                <td className="px-5 py-2 text-right font-semibold">{gbp(p.net_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
