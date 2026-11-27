'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Info } from 'lucide-react';
import { dashboardNewApi, type ProductionPLResponse, type ProductionPLItem } from '@/lib/api';

/**
 * CS-01 — Warren's five headings for every active production, at a glance:
 * Production · Budget / Rev · Labour Charged · Materials Charged · Profit / Loss.
 * Live figures from /api/dashboard/production-pl (draft timesheets included, ex VAT).
 */
const gbp = (n: number) =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const labourTip = (p: ProductionPLItem) =>
  `Paid through pay runs: ${gbp(p.labour_booked)}\nNot yet paid (incl. drafts): ${gbp(p.labour_unbooked)}` +
  (p.draft_timesheets ? `\n${p.draft_timesheets} draft timesheet${p.draft_timesheets === 1 ? '' : 's'} included` : '');

const materialsTip = (p: ProductionPLItem) =>
  `Purchase orders: ${gbp(p.materials_po)} (approved ${gbp(p.materials_po_approved)})\nPlant & hire: ${gbp(p.materials_hire)}`;

function Money({ value, signed = false }: { value: number | null; signed?: boolean }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const cls = signed ? (value < 0 ? 'text-red-600' : 'text-green-700') : 'text-slate-800';
  return <span className={`font-semibold ${cls}`}>{signed && value < 0 ? '−' : ''}{gbp(Math.abs(value))}</span>;
}

export default function ProductionPLCard() {
  const [data, setData] = useState<ProductionPLResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    dashboardNewApi.productionPL()
      .then(d => { if (active) setData(d); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load production P&L'); });
    return () => { active = false; };
  }, []);

  const rows = data?.productions ?? [];
  const management = data?.totals.management_costs ?? 0;

  return (
    <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-slate-900 font-semibold text-sm">Production P&amp;L — Live</h2>
          <p className="text-slate-400 text-xs mt-0.5">Active productions · ex VAT · includes draft timesheets</p>
        </div>
        <Link href="/cost-report" className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline">
          Cost Report <ArrowUpRight size={12} />
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-semibold px-5 py-2.5">Production</th>
              <th className="text-right font-semibold px-3 py-2.5">Budget / Rev</th>
              <th className="text-right font-semibold px-3 py-2.5">Labour Charged</th>
              <th className="text-right font-semibold px-3 py-2.5">Materials Charged</th>
              <th className="text-right font-semibold px-5 py-2.5">Profit / Loss</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-red-600">{error}</td></tr>
            ) : !data ? (
              Array(3).fill(0).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-5 py-3"><div className="animate-pulse bg-slate-200 rounded h-4 w-full" /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No active productions</td></tr>
            ) : rows.map(p => (
              <tr key={p.production_id} className="hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <Link href={`/productions/${p.production_id}`} className="text-slate-900 font-semibold hover:text-blue-700 hover:underline">
                    {p.production_name}
                  </Link>
                  <span className="ml-2 text-slate-400">{p.contract_type === 'cost_plus' ? 'Cost Plus' : 'On a Price'}</span>
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {p.budget_revenue == null
                    ? <Link href={`/cost-report?production_id=${p.production_id}`} className="text-blue-600 hover:underline"
                        title={p.contract_type === 'cost_plus' ? 'Set up the Master Budget on the cost report' : 'Enter the agreed price on the cost report'}>Set budget</Link>
                    : <Money value={p.budget_revenue} />}
                  {p.invoiced_to_date > 0 && <div className="text-slate-400">{gbp(p.invoiced_to_date)} invoiced</div>}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap" title={labourTip(p)}>
                  <Money value={p.labour_charged} />
                  {p.draft_timesheets > 0 && <div className="text-amber-600">{p.draft_timesheets} draft</div>}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap" title={materialsTip(p)}>
                  <Money value={p.materials_charged} />
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <Money value={p.profit_loss} signed />
                  {p.profit_pct != null && <div className="text-slate-400">{p.profit_pct.toFixed(1)}% of budget</div>}
                </td>
              </tr>
            ))}
          </tbody>
          {data && rows.length > 1 && (
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td className="px-5 py-2.5 font-semibold text-slate-700">Total</td>
                <td className="px-3 py-2.5 text-right"><Money value={data.totals.budget_revenue} /></td>
                <td className="px-3 py-2.5 text-right"><Money value={data.totals.labour_charged} /></td>
                <td className="px-3 py-2.5 text-right"><Money value={data.totals.materials_charged} /></td>
                <td className="px-5 py-2.5 text-right"><Money value={data.totals.profit_loss} signed /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {data && (
        <p className="flex items-start gap-1.5 px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400">
          <Info size={12} className="mt-px flex-shrink-0" />
          <span>
            Profit / Loss = Budget − Labour − Materials, for productions with a budget (green = profit, red = loss).
            {data.totals.budgeted_count === 0 && ' No production has a budget yet — use “Set budget”.'}
            {management > 0 && ` Management costs (${gbp(management)}, on universal management set codes) are kept out of production figures.`}
          </span>
        </p>
      )}
    </div>
  );
}
