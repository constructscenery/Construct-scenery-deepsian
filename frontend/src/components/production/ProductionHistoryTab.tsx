'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Loader2, Info } from 'lucide-react';
import {
  productionHistoryApi,
  type ProductionHistory, type ProductionHistoryWeekDetail, type ProductionSetCostRow,
} from '@/lib/api';

/**
 * CS-05 — "Costs & History": the production's five P&L figures, every week (labour + POs) with a
 * drill-down to each person and PO, and cost per set. Live, ex VAT — the same numbers as the dashboard.
 */
const gbp = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

function Figure({ label, value, tone }: { label: string; value: number | null; tone?: 'pl' }) {
  const cls = tone === 'pl' && value != null ? (value < 0 ? 'text-red-600' : 'text-green-700') : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-slate-500 text-xs font-medium">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${cls}`}>{value == null ? '—' : `${value < 0 ? '−' : ''}${gbp(Math.abs(value))}`}</p>
    </div>
  );
}

function WeekDetail({ productionId, weekEnding }: { productionId: string; weekEnding: string }) {
  const [data, setData] = useState<ProductionHistoryWeekDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    productionHistoryApi.week(productionId, weekEnding)
      .then(d => { if (active) setData(d); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load week'); });
    return () => { active = false; };
  }, [productionId, weekEnding]);

  if (error) return <p className="px-5 py-3 text-xs text-red-600">{error}</p>;
  if (!data) return <p className="px-5 py-3"><Loader2 size={14} className="animate-spin text-blue-600" /></p>;
  return (
    <div className="px-5 py-3 bg-slate-50/60 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      <div>
        <p className="font-semibold text-slate-700 mb-1.5">People ({data.timesheets.length})</p>
        {data.timesheets.length === 0 ? <p className="text-slate-400">No timesheets this week.</p> : (
          <table className="w-full">
            <thead className="text-slate-400"><tr><th className="text-left py-1">Name</th><th className="text-left">Trade</th><th className="text-right">Days</th><th className="text-right">OT h</th><th className="text-left pl-3">Sets</th><th className="text-right">Net</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.timesheets.map(t => (
                <tr key={t.timesheet_id}>
                  <td className="py-1.5">
                    <Link href={`/timesheets/${t.timesheet_id}`} className="text-blue-700 hover:underline font-medium">{t.name}</Link>
                    {t.status === 'draft' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">Draft</span>}
                    {t.paid && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-100 text-green-800 text-[10px] font-semibold">Paid</span>}
                  </td>
                  <td className="text-slate-500">{[t.trade, t.rank].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-right">{t.days_worked}</td>
                  <td className="text-right">{t.overtime_hours || '—'}</td>
                  <td className="pl-3 text-slate-500">{t.sets || '—'}</td>
                  <td className="text-right font-semibold">{gbp(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <p className="font-semibold text-slate-700 mb-1.5">Purchase orders ({data.purchase_orders.length})</p>
        {data.purchase_orders.length === 0 ? <p className="text-slate-400">No purchase orders dated this week.</p> : (
          <table className="w-full">
            <thead className="text-slate-400"><tr><th className="text-left py-1">PO</th><th className="text-left">Supplier</th><th className="text-left">Set</th><th className="text-left">Status</th><th className="text-right">Net</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.purchase_orders.map(p => (
                <tr key={p.id} className={p.counts_in_costs ? '' : 'text-slate-400'}>
                  <td className="py-1.5 font-mono">{p.po_number}</td>
                  <td>{p.supplier_name}{p.title ? <span className="text-slate-400"> · {p.title}</span> : null}</td>
                  <td>{p.set_code || '—'}</td>
                  <td title={p.counts_in_costs ? undefined : 'Not counted until the PO is issued'}>{statusLabel(p.status)}</td>
                  <td className="text-right font-semibold">{gbp(p.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ProductionHistoryTab({ productionId }: { productionId: string }) {
  const [history, setHistory] = useState<ProductionHistory | null>(null);
  const [setCosts, setSetCosts] = useState<{ rows: ProductionSetCostRow[]; totals: { labour: number; materials: number; total: number } } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    Promise.all([productionHistoryApi.get(productionId), productionHistoryApi.setCosts(productionId)])
      .then(([h, s]) => { if (active) { setHistory(h); setSetCosts(s); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load history'); });
    return () => { active = false; };
  }, [productionId]);

  if (error) return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>;
  if (!history || !setCosts) return <div className="py-12 text-center"><Loader2 size={20} className="animate-spin text-blue-600 inline" /></div>;

  const s = history.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Budget / Rev" value={s.budget_revenue} />
        <Figure label="Labour Charged" value={s.labour_charged} />
        <Figure label="Materials Charged" value={s.materials_charged} />
        <Figure label="Profit / Loss" value={s.profit_loss} tone="pl" />
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <Info size={12} className="mt-px flex-shrink-0" />
        <span>
          Live and ex VAT: draft timesheets count as soon as they&apos;re saved; POs count once issued; plant &amp; hire included in materials
          ({gbp(s.materials_hire)}).{s.management_costs > 0 ? ` Management costs (${gbp(s.management_costs)}) are shown below but kept out of Profit / Loss.` : ''}
        </span>
      </p>

      {/* Weekly history */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-sm">Week by week</h2>
          <p className="text-slate-400 text-xs mt-0.5">Click a week to see who worked and what was ordered</p>
        </div>
        {history.weeks.length === 0 ? (
          <p className="px-5 py-8 text-center text-slate-400 text-sm">No timesheets or purchase orders on this production yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-5 py-2.5">Week ending</th>
                <th className="text-right px-3 py-2.5">Crew</th>
                <th className="text-right px-3 py-2.5">Labour</th>
                <th className="text-right px-3 py-2.5">POs</th>
                <th className="text-right px-3 py-2.5">Purchase orders</th>
                <th className="text-right px-5 py-2.5">Week total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.weeks.map(w => (
                <React.Fragment key={w.week_ending_date}>
                  <tr className="hover:bg-slate-50/70 cursor-pointer" tabIndex={0}
                    onClick={() => setOpen(o => ({ ...o, [w.week_ending_date]: !o[w.week_ending_date] }))}
                    onKeyDown={e => { if (e.key === 'Enter') setOpen(o => ({ ...o, [w.week_ending_date]: !o[w.week_ending_date] })); }}>
                    <td className="px-5 py-2.5 font-medium text-slate-800">
                      {open[w.week_ending_date] ? <ChevronDown size={13} className="inline mr-1" /> : <ChevronRight size={13} className="inline mr-1" />}
                      {fmtDate(w.week_ending_date)}
                      {w.draft_count > 0 && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">{w.draft_count} draft</span>}
                    </td>
                    <td className="text-right px-3">{w.crew_count || '—'}</td>
                    <td className="text-right px-3">{gbp(w.labour_total)}</td>
                    <td className="text-right px-3">{w.po_count || '—'}</td>
                    <td className="text-right px-3">{gbp(w.po_total)}</td>
                    <td className="text-right px-5 font-semibold">{gbp(w.total)}</td>
                  </tr>
                  {open[w.week_ending_date] && (
                    <tr><td colSpan={6} className="p-0"><WeekDetail productionId={productionId} weekEnding={w.week_ending_date} /></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cost by set */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-sm">Cost by set</h2>
          <p className="text-slate-400 text-xs mt-0.5">Labour split by days worked on each set; materials by PO set code</p>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr><th className="text-left px-5 py-2.5">Set</th><th className="text-left px-3 py-2.5">Name</th><th className="text-right px-3 py-2.5">Labour</th><th className="text-right px-3 py-2.5">Materials</th><th className="text-right px-5 py-2.5">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {setCosts.rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-400">No sets or costs yet.</td></tr>
            ) : setCosts.rows.map(r => (
              <tr key={`${r.source}-${r.set_code ?? 'none'}`}>
                <td className="px-5 py-2 font-mono">{r.set_code ?? '—'}</td>
                <td className="px-3 py-2">
                  {r.set_name}
                  {r.source === 'management' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">Management</span>}
                  {r.source === 'unknown' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">Not in set list</span>}
                </td>
                <td className="px-3 py-2 text-right">{gbp(r.labour)}</td>
                <td className="px-3 py-2 text-right">{gbp(r.materials)}</td>
                <td className="px-5 py-2 text-right font-semibold">{gbp(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
            <tr><td className="px-5 py-2.5" colSpan={2}>Total</td><td className="px-3 py-2.5 text-right">{gbp(setCosts.totals.labour)}</td><td className="px-3 py-2.5 text-right">{gbp(setCosts.totals.materials)}</td><td className="px-5 py-2.5 text-right">{gbp(setCosts.totals.total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
