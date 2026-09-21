'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import {
  dashboardApi, dashboardNewApi,
  type DashboardData, type CostSummaryItem, type ForecastVarianceItem, type WeeklyPLProduction,
} from '@/lib/api';
import {
  TrendingUp, TrendingDown, Users, ShoppingCart, AlertCircle,
  CheckCircle2, Clock, Clapperboard, ArrowUpRight, Banknote,
} from 'lucide-react';

const fmt = (n: number) =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const statusLabel: Record<string, string> = {
  pre_production: 'Pre-Production', active_build: 'Active Build',
  strike: 'Strike', complete: 'Complete', archived: 'Archived',
};
const phaseColor: Record<string, string> = {
  pre_production: 'bg-slate-100 text-slate-600', active_build: 'bg-blue-100 text-blue-700',
  strike: 'bg-amber-100 text-amber-700', complete: 'bg-green-100 text-green-700',
  archived: 'bg-slate-100 text-slate-400',
};
const ragClass: Record<string, string>  = { green: 'bg-green-500', amber: 'bg-amber-400', red: 'bg-red-500', unknown: 'bg-slate-300' };
const ragLabel: Record<string, string>  = { green: 'On Track', amber: 'Monitor', red: 'At Risk', unknown: 'No Budget' };
const ragBadge: Record<string, string>  = { green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-700', unknown: 'bg-slate-100 text-slate-500' };

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}
function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4 shadow-sm">
      <Skeleton className="w-10 h-10 rounded-lg" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-16" /><Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

type POSpendData = { total_approved_today: number; total_approved_this_week: number; breakdown: Array<{ production_name: string; amount: number }> };

export default function MDDashboard() {
  const [data, setData]         = useState<DashboardData | null>(null);
  const [costSummary, setCost]  = useState<CostSummaryItem[] | null>(null);
  const [variance, setVariance] = useState<ForecastVarianceItem[] | null>(null);
  const [weeklyPL, setWeeklyPL] = useState<WeeklyPLProduction[] | null>(null);
  const [labour, setLabour]     = useState<{ current_week_ending: string; total_labour_this_week: number; breakdown: Array<{ production_name: string; amount: number; status: 'approved' | 'pending' }> } | null>(null);
  const [crew, setCrew]         = useState<{ total_active_crew: number; breakdown: Array<{ production_name: string; crew_count: number }> } | null>(null);
  const [poSpend, setPoSpend]   = useState<POSpendData | null>(null);
  const [loading, setLoading]   = useState(true);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => {
    Promise.allSettled([
      dashboardApi.get().then(setData),
      dashboardNewApi.costSummary().then(setCost),
      dashboardNewApi.forecastVariance().then(setVariance),
      dashboardNewApi.weeklyPL().then(setWeeklyPL),
      dashboardNewApi.labourCosts().then(setLabour),
      dashboardNewApi.crewHeadcount().then(setCrew),
      dashboardNewApi.poSpend().then(setPoSpend),
    ]).finally(() => setLoading(false));
  }, []);

  const pendingTotal  = data?.pending_approvals.total ?? 0;
  const pendingDetail = data ? `${data.pending_approvals.purchase_orders} POs · ${data.pending_approvals.timesheets} timesheets` : '';
  const statCards = [
    { label: 'Active Productions', value: String(costSummary?.length ?? data?.active_productions.length ?? '—'), change: 'Active now', up: null, icon: Clapperboard, color: 'bg-blue-50 text-blue-600' },
    { label: 'Total Crew On Site', value: String(crew?.total_active_crew ?? '—'), change: 'Across active productions', up: null, icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Weekly Labour Cost', value: labour ? fmt(labour.total_labour_this_week) : '—', change: labour ? `w/e ${fmtDate(labour.current_week_ending)}` : 'Loading…', up: false, icon: ShoppingCart, color: 'bg-orange-50 text-orange-600' },
    { label: 'Pending Approvals', value: String(pendingTotal), change: pendingDetail, up: null, icon: AlertCircle, color: 'bg-amber-50 text-amber-600' },
  ];

  return (
    <>
      <TopBar title="Managing Director Dashboard" subtitle={today} />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-6">

        {/* ── Stat Cards ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {loading
            ? Array(4).fill(0).map((_, i) => <CardSkeleton key={i} />)
            : statCards.map(({ label, value, change, up, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4 shadow-sm">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}><Icon size={20} /></div>
                <div>
                  <p className="text-slate-500 text-xs font-medium">{label}</p>
                  <p className="text-slate-900 text-2xl font-bold mt-0.5">{value}</p>
                  <p className={`text-xs mt-1 flex items-center gap-1 ${up === true ? 'text-green-600' : up === false ? 'text-red-500' : 'text-slate-400'}`}>
                    {up === true && <TrendingUp size={12} />}{up === false && <TrendingDown size={12} />}{change}
                  </p>
                </div>
              </div>
            ))}
        </div>

        {/* ── Budget Summary + Labour Costs ────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Budget Summary (cost-summary endpoint) */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Budget Summary — Active Productions</h2>
                <p className="text-slate-400 text-xs mt-0.5">Live costs vs budget with RAG status</p>
              </div>
              <Link href="/cost-report" className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline">
                Cost Report <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {loading
                ? Array(3).fill(0).map((_, i) => (
                  <div key={i} className="px-5 py-4 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-2 w-full" /></div>
                ))
                : !costSummary?.length
                  ? <p className="px-5 py-8 text-slate-400 text-sm text-center">No active productions</p>
                  : costSummary.map((p) => (
                    <div key={p.production_id} className="px-5 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-slate-900 text-sm font-semibold">{p.production_name}</span>
                          <span className="ml-2 text-xs text-slate-400">{p.contract_type === 'cost_plus' ? 'Cost Plus' : 'On a Price'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500 text-xs">
                            {fmt(p.total_costs_to_date)}{p.total_budget ? ` / ${fmt(p.total_budget)}` : ''}
                          </span>
                          {p.total_budget ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ragBadge[p.rag_status]}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${ragClass[p.rag_status]}`} />
                              {ragLabel[p.rag_status]}
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Budget not set</span>
                          )}
                        </div>
                      </div>
                      {p.total_budget ? (
                        <>
                          <div className="w-full bg-slate-100 rounded-full h-2">
                            <div className={`h-2 rounded-full ${ragClass[p.rag_status]}`} style={{ width: `${Math.min(p.budget_utilisation_pct ?? 0, 100)}%` }} />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-slate-400 text-[10px]">{fmt(p.amount_remaining ?? 0)} remaining</span>
                            <span className="text-slate-400 text-[10px]">{(p.budget_utilisation_pct ?? 0).toFixed(1)}% used</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-slate-400 text-xs mt-1">Set a budget in the Cost Report to enable tracking</p>
                      )}
                    </div>
                  ))
              }
            </div>
          </div>

          {/* Labour Costs this week */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold text-sm">Current Week Labour</h2>
              <p className="text-slate-400 text-xs mt-0.5">{labour ? `w/e ${fmtDate(labour.current_week_ending)}` : 'Loading…'}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {loading
                ? Array(3).fill(0).map((_, i) => (<div key={i} className="px-5 py-3.5 flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-16" /></div>))
                : !labour?.breakdown.length
                  ? <p className="px-5 py-8 text-slate-400 text-sm text-center">No timesheets this week</p>
                  : labour.breakdown.map((l) => {
                    const crewRow = crew?.breakdown.find(c => c.production_name === l.production_name);
                    return (
                      <div key={l.production_name} className="px-5 py-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-slate-800 text-sm font-medium">{l.production_name}</p>
                          <p className="text-slate-400 text-xs">{crewRow?.crew_count ?? '—'} crew</p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-900 text-sm font-semibold">{fmt(l.amount)}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${l.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                            {l.status === 'pending' ? <><Clock size={9} className="inline mr-1" />Pending</> : <><CheckCircle2 size={9} className="inline mr-1" />Approved</>}
                          </span>
                        </div>
                      </div>
                    );
                  })
              }
              {!loading && labour && (
                <div className="px-5 py-3 bg-slate-50 flex justify-between items-center">
                  <span className="text-slate-600 text-xs font-medium">Total This Week</span>
                  <span className="text-slate-900 text-sm font-bold">{fmt(labour.total_labour_this_week)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Pipeline + Forecast Variance ──────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Production Pipeline */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Production Pipeline</h2>
                <p className="text-slate-400 text-xs mt-0.5">All active & upcoming productions</p>
              </div>
              <Link href="/productions" className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline">
                View all <ArrowUpRight size={12} />
              </Link>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Production</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Phase</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Start Date</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">End Date</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Days Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading
                  ? Array(3).fill(0).map((_, i) => (<tr key={i}><td colSpan={5} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td></tr>))
                  : data?.production_pipeline.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3.5 text-slate-900 font-medium text-sm">{p.name}</td>
                      <td className="px-3 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${phaseColor[p.current_phase] ?? 'bg-slate-100 text-slate-600'}`}>
                          {statusLabel[p.current_phase] ?? p.current_phase}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-slate-500 text-xs">{p.start_date ? fmtDate(p.start_date) : '—'}</td>
                      <td className="px-3 py-3.5 text-slate-500 text-xs">{fmtDate(p.end_date)}</td>
                      <td className="px-3 py-3.5 text-right">
                        {p.days_remaining === null ? <span className="text-slate-400 text-xs">—</span>
                          : p.days_remaining <= 0 ? <span className="text-slate-400 text-xs">Done</span>
                          : <span className={`text-xs font-semibold ${p.days_remaining <= 14 ? 'text-red-600' : p.days_remaining <= 30 ? 'text-amber-600' : 'text-green-600'}`}>{p.days_remaining}d</span>}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Forecast Variance */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Forecast vs Actual</h2>
                <p className="text-slate-400 text-xs mt-0.5">Live variance against primary forecasts</p>
              </div>
              <Link href="/forecasting" className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline">
                Forecasting <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {loading
                ? Array(3).fill(0).map((_, i) => (<div key={i} className="px-5 py-3"><Skeleton className="h-4 w-full" /></div>))
                : !variance?.length
                  ? <p className="px-5 py-8 text-slate-400 text-sm text-center">No productions with linked primary forecasts</p>
                  : variance.map((v) => {
                    const over = (v.variance_amount ?? 0) > 0;
                    const under = (v.variance_amount ?? 0) < 0;
                    return (
                      <div key={v.production_id} className="px-5 py-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-slate-900 text-sm font-medium">{v.production_name}</p>
                          <p className="text-slate-400 text-xs">Forecast: {fmt(v.forecast_total)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-700 text-sm">Actual: {fmt(v.actual_total)}</p>
                          <p className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${over ? 'text-red-600' : under ? 'text-green-600' : 'text-slate-500'}`}>
                            {over && <TrendingUp size={11} />}{under && <TrendingDown size={11} />}
                            {over ? '+' : ''}{fmt(v.variance_amount)}
                            {v.variance_pct !== null && <span className="font-normal">({v.variance_pct.toFixed(1)}%)</span>}
                          </p>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </div>

        {/* ── Weekly P&L (Cost Plus productions) ───────────────────────────── */}
        {(loading || (weeklyPL?.length ?? 0) > 0) && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Weekly P&amp;L — Cost Plus Productions</h2>
                <p className="text-slate-400 text-xs mt-0.5">Margin earned vs salary and uplifts</p>
              </div>
              <Link href="/cost-report" className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline">
                Cost Report <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="overflow-x-auto">
              {loading
                ? <div className="p-5"><Skeleton className="h-20 w-full" /></div>
                : weeklyPL?.map((prod) => {
                  const latestWeek = prod.weeks[prod.weeks.length - 1];
                  if (!latestWeek) return null;
                  return (
                    <div key={prod.production_id} className="px-5 py-4 border-b border-slate-100 last:border-0">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-slate-900 font-semibold text-sm">{prod.production_name}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${latestWeek.running_total_profit >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          Running: {fmt(latestWeek.running_total_profit)}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-center">
                        {[
                          { label: 'Margin Earned', val: latestWeek.margin_earned },
                          { label: "Director's Salary", val: -latestWeek.warrens_salary },
                          { label: 'Luton/Box Uplift', val: -(latestWeek.luton_uplift + latestWeek.box_rental_uplift) },
                          { label: 'Weekly Profit', val: latestWeek.weekly_profit, bold: true },
                        ].map(({ label, val, bold }) => (
                          <div key={label} className="bg-slate-50 rounded-lg p-2">
                            <p className="text-slate-500 text-[10px]">{label}</p>
                            <p className={`text-sm font-${bold ? 'bold' : 'semibold'} mt-0.5 ${val < 0 ? 'text-red-600' : 'text-slate-900'}`}>{fmt(Math.abs(val))}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        )}

        {/* ── Pending Approvals ─────────────────────────────────────────────── */}
        {!loading && data && data.pending_approvals.total > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-800 text-sm font-semibold">{data.pending_approvals.total} items awaiting approval</p>
              <p className="text-amber-600 text-xs">{data.pending_approvals.purchase_orders} purchase orders · {data.pending_approvals.timesheets} timesheets</p>
            </div>
            <div className="flex gap-2">
              <Link href="/purchase-orders" className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-amber-700">POs</Link>
              <Link href="/timesheets" className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-amber-700">Timesheets</Link>
            </div>
          </div>
        )}

        {/* ── PO Spend ──────────────────────────────────────────────────────── */}
        {!loading && poSpend && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">PO Approved Spend</h2>
                <p className="text-slate-400 text-xs mt-0.5">Total approved purchase orders</p>
              </div>
              <Link href="/purchase-orders" className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline">
                View POs <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-slate-500 text-xs mb-1">Today</p>
                <p className="text-slate-900 font-bold text-lg">{fmt(poSpend.total_approved_today)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-slate-500 text-xs mb-1">This Week</p>
                <p className="text-slate-900 font-bold text-lg">{fmt(poSpend.total_approved_this_week)}</p>
              </div>
            </div>
            {poSpend.breakdown.length > 0 && (
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                {poSpend.breakdown.map((b) => (
                  <div key={b.production_name} className="px-5 py-3 flex items-center justify-between">
                    <p className="text-slate-700 text-sm">{b.production_name}</p>
                    <p className="text-slate-900 text-sm font-semibold">{fmt(b.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Cash Flow placeholder ─────────────────────────────────────────── */}
        {!loading && (
          <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
              <Banknote size={16} className="text-slate-500" />
            </div>
            <div>
              <p className="text-slate-600 text-sm font-medium">Cash Flow</p>
              <p className="text-slate-400 text-xs">Coming soon</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
