'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import {
  Clapperboard, ShoppingCart, Users, ArrowUpRight,
  CheckCircle2, Clock, AlertCircle, Layers, Loader2,
} from 'lucide-react';
import {
  dashboardApi, purchaseOrdersApi,
  PurchaseOrder, ProductionStatus,
} from '@/lib/api';

type CoordinatorOverview = Awaited<ReturnType<typeof dashboardApi.coordinatorOverview>>;

const fmtGBP = (n: number | string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(
    typeof n === 'string' ? parseFloat(n) : n
  );

const STATUS_LABELS: Record<ProductionStatus, string> = {
  pre_production: 'Pre-Production',
  active_build:   'Active Build',
  strike:         'Strike',
  complete:       'Complete',
  archived:       'Archived',
};

const STATUS_COLORS: Record<ProductionStatus, string> = {
  pre_production: 'bg-blue-100 text-blue-700',
  active_build:   'bg-blue-100 text-blue-700',
  strike:         'bg-amber-100 text-amber-700',
  complete:       'bg-slate-100 text-slate-500',
  archived:       'bg-red-100 text-red-500',
};

const PO_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:            { label: 'Draft',             className: 'bg-slate-100 text-slate-500'   },
  submitted:        { label: 'Submitted',          className: 'bg-blue-100 text-blue-700'    },
  issued:           { label: 'Issued',             className: 'bg-blue-100 text-blue-700'    },
  invoice_received: { label: 'Invoice Received',   className: 'bg-purple-100 text-purple-700' },
  approved:         { label: 'Approved',           className: 'bg-green-100 text-green-700'  },
};

export default function CoordinatorDashboard() {
  const router = useRouter();
  const [dashboard, setDashboard]   = useState<CoordinatorOverview | null>(null);
  const [openPOs, setOpenPOs]       = useState<PurchaseOrder[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  useEffect(() => {
    Promise.all([
      dashboardApi.coordinatorOverview(),
      // Get submitted/draft POs (ones James can act on)
      purchaseOrdersApi.list({ status: 'submitted' }),
    ])
      .then(([dash, pos]) => {
        setDashboard(dash);
        setOpenPOs(pos.slice(0, 8));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label:   'Active Productions',
      value:   dashboard?.active_count ?? 0,
      color:   'bg-blue-50 text-blue-600',
      icon:    Clapperboard,
    },
    {
      label:   'Crew On Productions',
      value:   dashboard?.crew_headcount.total ?? 0,
      color:   'bg-purple-50 text-purple-600',
      icon:    Users,
    },
    {
      label:   'Open POs (Submitted)',
      value:   dashboard?.open_po_count ?? 0,
      color:   'bg-orange-50 text-orange-600',
      icon:    ShoppingCart,
    },
    {
      label:   'Productions in Pipeline',
      value:   dashboard?.production_pipeline.length ?? 0,
      color:   'bg-blue-50 text-blue-600',
      icon:    Layers,
    },
  ];

  if (error) {
    return (
      <>
        <TopBar title="Coordinator Dashboard" subtitle={today} />
        <main className="flex-1 p-4 md:p-6">
          <p className="text-red-600 text-sm">{error}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="Coordinator Dashboard" subtitle={today} />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-6">

        {/* Stat Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {statCards.map(({ label, value, color, icon: Icon }) => (
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
              </div>
            </div>
          ))}
        </div>

        {/* Production Pipeline */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-slate-900 font-semibold text-sm">Production Pipeline</h2>
              <p className="text-slate-400 text-xs mt-0.5">All active and upcoming productions</p>
            </div>
            <button
              onClick={() => router.push('/productions')}
              className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline"
            >
              Manage <ArrowUpRight size={12} />
            </button>
          </div>
          {loading ? (
            <div className="divide-y divide-slate-100">
              {[1,2,3].map(i => (
                <div key={i} className="px-5 py-4 flex justify-between">
                  <div className="space-y-1.5">
                    <div className="h-4 w-40 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : !dashboard?.production_pipeline.length ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">No productions in pipeline.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboard.production_pipeline.map(p => {
                const sc = STATUS_COLORS[p.current_phase] ?? STATUS_COLORS.pre_production;
                const days = p.days_remaining;
                const daysColor = days == null ? 'text-slate-400'
                  : days < 0  ? 'text-red-600 font-bold'
                  : days < 14 ? 'text-amber-600 font-semibold'
                  : days < 30 ? 'text-amber-500'
                  : 'text-green-600';
                return (
                  <div
                    key={p.id}
                    className="px-5 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/productions/${p.id}`)}
                  >
                    <div>
                      <p className="text-slate-900 text-sm font-semibold">{p.name}</p>
                      <p className="text-slate-400 text-xs mt-0.5">
                        {p.start_date ? new Date(p.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        {' – '}
                        {p.end_date ? new Date(p.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc}`}>
                        {STATUS_LABELS[p.current_phase]}
                      </span>
                      {days != null && (
                        <span className={`text-xs ${daysColor}`}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Open POs — no Approve button (MD only approves) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Submitted Purchase Orders</h2>
                <p className="text-slate-400 text-xs mt-0.5">Awaiting MD approval</p>
              </div>
              <button
                onClick={() => router.push('/purchase-orders')}
                className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline"
              >
                View all <ArrowUpRight size={12} />
              </button>
            </div>
            {loading ? (
              <div className="divide-y divide-slate-100">
                {[1,2,3].map(i => (
                  <div key={i} className="px-5 py-3.5 flex justify-between">
                    <div className="space-y-1.5">
                      <div className="h-4 w-36 bg-slate-100 rounded animate-pulse" />
                      <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                    </div>
                    <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : openPOs.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 size={24} className="text-green-400 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No submitted POs awaiting approval.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {openPOs.map(po => {
                  const sc = PO_STATUS_CONFIG[po.status] ?? PO_STATUS_CONFIG.submitted;
                  return (
                    <div key={po.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                      <div className="min-w-0">
                        <p className="text-slate-800 text-sm font-medium truncate">{po.supplier_name}</p>
                        <p className="text-slate-400 text-xs">{po.po_number} · {po.prod_name}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        <span className="text-slate-900 text-sm font-semibold">{fmtGBP(po.gross_amount)}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sc.className}`}>
                          {sc.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Crew by Production */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Crew by Production</h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  {loading ? '—' : `${dashboard?.crew_headcount.total ?? 0} total active crew`}
                </p>
              </div>
              <button
                onClick={() => router.push('/crew')}
                className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:underline"
              >
                Crew DB <ArrowUpRight size={12} />
              </button>
            </div>
            {loading ? (
              <div className="px-5 py-4 space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : !dashboard?.crew_headcount.by_production.length ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">No crew linked to productions.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {dashboard.crew_headcount.by_production.map(row => {
                  const pct = dashboard.crew_headcount.total > 0
                    ? Math.round((row.headcount / dashboard.crew_headcount.total) * 100)
                    : 0;
                  return (
                    <div key={row.production} className="px-5 py-3.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-slate-700 text-sm font-medium truncate">{row.production}</p>
                        <span className="text-slate-900 text-sm font-bold flex-shrink-0 ml-2">{row.headcount}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Alert: POs waiting for MD approval */}
        {!loading && dashboard && dashboard.open_po_count > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
              <span className="text-amber-800 text-sm font-medium">
                {dashboard.open_po_count} PO{dashboard.open_po_count !== 1 ? 's' : ''} submitted — waiting for Managing Director approval
              </span>
            </div>
            <button
              onClick={() => router.push('/purchase-orders')}
              className="text-amber-700 text-xs font-semibold hover:underline flex-shrink-0 ml-4"
            >
              View POs <ArrowUpRight size={11} className="inline" />
            </button>
          </div>
        )}

      </main>
    </>
  );
}
