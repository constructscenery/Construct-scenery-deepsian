'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import {
  ClipboardList, CheckCircle2, Clock, AlertCircle,
  FileText, TrendingDown, ArrowUpRight, Loader2, Banknote,
} from 'lucide-react';
import { dashboardApi, timesheetsApi, Timesheet } from '@/lib/api';

type AccountantOverview = Awaited<ReturnType<typeof dashboardApi.accountantOverview>>;

const fmtGBP = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);

const RAG_CLASS:  Record<string, string> = { green: 'bg-green-500',  amber: 'bg-amber-400',  red: 'bg-red-500',  unknown: 'bg-slate-300' };
const RAG_BADGE:  Record<string, string> = { green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-700', unknown: 'bg-slate-100 text-slate-500' };
const RAG_LABEL:  Record<string, string> = { green: 'On Track', amber: 'Monitor', red: 'At Risk', unknown: 'No Budget' };

export default function AccountantDashboard() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<AccountantOverview | null>(null);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  useEffect(() => {
    Promise.all([dashboardApi.accountantOverview(), timesheetsApi.list()])
      .then(([dash, ts]) => {
        setDashboard(dash);
        setTimesheets(ts);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  // Timesheet counts by status
  const tsCounts = {
    distributed:         timesheets.filter(t => t.status === 'distributed').length,
    amendment_requested: timesheets.filter(t => t.status === 'amendment_requested').length,
    finalised:           timesheets.filter(t => t.status === 'finalised').length,
    draft:               timesheets.filter(t => t.status === 'draft').length,
  };

  // Pending verifications = distributed/amendment_requested timesheets (most recent first, max 5)
  const pendingVerifications = timesheets
    .filter(t => t.status === 'distributed' || t.status === 'amendment_requested')
    .slice(0, 5);

  const statCards = [
    {
      label:   'Distributed',
      value:   tsCounts.distributed,
      subtext: 'timesheets',
      color:   'bg-amber-50 text-amber-600',
      icon:    Clock,
    },
    {
      label:   'Amendment Requested',
      value:   tsCounts.amendment_requested,
      subtext: 'pending action',
      color:   'bg-blue-50 text-blue-600',
      icon:    FileText,
    },
    {
      label:   'Finalised',
      value:   tsCounts.finalised,
      subtext: 'timesheets',
      color:   'bg-green-50 text-green-600',
      icon:    CheckCircle2,
    },
    {
      label:   'Active Productions',
      value:   dashboard?.active_productions.length ?? 0,
      subtext: 'in progress',
      color:   'bg-blue-50 text-blue-600',
      icon:    ClipboardList,
    },
  ];

  if (error) {
    return (
      <>
        <TopBar title="Accounts Dashboard" subtitle={today} />
        <main className="flex-1 p-4 md:p-6">
          <p className="text-red-600 text-sm">{error}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="Accounts Dashboard" subtitle={today} />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-6">

        {/* Timesheet Status Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {statCards.map(({ label, value, subtext, color, icon: Icon }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4 shadow-sm">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-slate-500 text-xs font-medium">{label}</p>
                {loading
                  ? <div className="h-7 w-8 bg-slate-100 rounded animate-pulse mt-1" />
                  : <p className="text-slate-900 text-lg font-bold mt-0.5">{value}</p>
                }
                <p className="text-slate-400 text-xs mt-1">{subtext}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Pending Verifications */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Pending Verifications</h2>
                <p className="text-slate-400 text-xs mt-0.5">Timesheets with invoice received — awaiting verification</p>
              </div>
              <button
                onClick={() => router.push('/timesheets')}
                className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline"
              >
                View all <ArrowUpRight size={12} />
              </button>
            </div>
            {loading ? (
              <div className="divide-y divide-slate-100">
                {[1,2,3].map(i => (
                  <div key={i} className="px-5 py-4 flex justify-between">
                    <div className="space-y-1.5">
                      <div className="h-4 w-36 bg-slate-100 rounded animate-pulse" />
                      <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                    </div>
                    <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : pendingVerifications.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 size={24} className="text-green-400 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">All clear — no timesheets awaiting verification.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingVerifications.map(ts => (
                  <div key={ts.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-slate-800 text-sm font-medium truncate">
                        {ts.first_name} {ts.last_name}
                      </p>
                      <p className="text-slate-400 text-xs">{ts.prod_name} · {ts.crew_trade}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="text-slate-900 text-sm font-semibold">
                        {ts.grand_total ? fmtGBP(parseFloat(ts.grand_total)) : '—'}
                      </p>
                      <p className="text-slate-400 text-xs">
                        w/e {new Date(ts.week_ending_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-3 bg-slate-50 flex justify-between items-center">
                  <span className="text-slate-500 text-xs">{tsCounts.distributed + tsCounts.amendment_requested} timesheets pending</span>
                  <button onClick={() => router.push('/timesheets')} className="text-blue-600 text-xs font-medium hover:underline">
                    View all
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Labour Summary */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold text-sm">Current Week Labour</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                w/e {dashboard?.current_week_labour.week_ending
                  ? new Date(dashboard.current_week_labour.week_ending).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '—'}
              </p>
            </div>
            {loading ? (
              <div className="px-5 py-4 space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : !dashboard?.current_week_labour.by_production.length ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">No labour recorded this week.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {dashboard.current_week_labour.by_production.map(row => (
                  <div key={row.production} className="px-5 py-3.5">
                    <div className="flex justify-between mb-1">
                      <p className="text-slate-700 text-sm font-medium truncate">{row.production}</p>
                      <p className="text-slate-900 text-sm font-bold flex-shrink-0 ml-2">{fmtGBP(row.total)}</p>
                    </div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span className="text-amber-600">{fmtGBP(row.pending)} pending</span>
                      <span className="text-green-600">{fmtGBP(row.approved)} approved</span>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-3 bg-blue-50 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Banknote size={14} className="text-blue-600" />
                    <span className="text-blue-700 text-xs font-semibold">Total This Week</span>
                  </div>
                  <span className="text-blue-900 text-sm font-bold">
                    {fmtGBP(dashboard.current_week_labour.total)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Cost Report Overview */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-slate-900 font-semibold text-sm">Cost Report Overview</h2>
              <p className="text-slate-400 text-xs mt-0.5">Budget utilisation across all active productions</p>
            </div>
            <div className="flex items-center gap-2">
              {dashboard && dashboard.active_productions.filter(p => p.rag_status === 'red').length > 0 && (
                <>
                  <TrendingDown size={14} className="text-red-500" />
                  <span className="text-red-500 text-xs font-medium">
                    {dashboard.active_productions.filter(p => p.rag_status === 'red').length} at risk
                  </span>
                </>
              )}
              <button
                onClick={() => router.push('/cost-report')}
                className="ml-2 text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline"
              >
                Full report <ArrowUpRight size={12} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              {[1,2,3].map(i => (
                <div key={i} className="px-6 py-5 space-y-3">
                  <div className="h-4 w-28 bg-slate-100 rounded animate-pulse" />
                  <div className="h-2 w-full bg-slate-100 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : !dashboard?.active_productions.length ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">No active productions.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              {dashboard.active_productions.map(prod => {
                const pctUsed = prod.percent_remaining != null
                  ? Math.max(0, Math.min(100, 100 - parseFloat(prod.percent_remaining)))
                  : null;
                return (
                  <div key={prod.id} className="px-6 py-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-slate-900 text-sm font-semibold truncate">{prod.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${RAG_BADGE[prod.rag_status]}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${RAG_CLASS[prod.rag_status]}`} />
                        {RAG_LABEL[prod.rag_status]}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                      <div
                        className={`h-2 rounded-full ${RAG_CLASS[prod.rag_status]}`}
                        style={{ width: `${pctUsed ?? 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{fmtGBP(prod.total_costs_to_date)}</span>
                      {prod.total_budget != null
                        ? <span className="font-medium">{pctUsed?.toFixed(0)}% of {fmtGBP(prod.total_budget)}</span>
                        : <span className="text-slate-400">No budget set</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending Approvals Banner */}
        {!loading && (tsCounts.distributed + tsCounts.amendment_requested) > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
              <span className="text-amber-800 text-sm font-medium">
                {tsCounts.distributed + tsCounts.amendment_requested} timesheet{(tsCounts.distributed + tsCounts.amendment_requested) !== 1 ? 's' : ''} distributed — ready to verify
              </span>
            </div>
            <button
              onClick={() => router.push('/timesheets')}
              className="text-amber-700 text-xs font-semibold hover:underline flex-shrink-0 ml-4"
            >
              Review <ArrowUpRight size={11} className="inline" />
            </button>
          </div>
        )}

      </main>
    </>
  );
}
