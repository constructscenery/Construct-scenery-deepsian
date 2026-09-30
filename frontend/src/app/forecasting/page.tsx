'use client';

import { useState, useEffect, useCallback } from 'react';
import TopBar from '@/components/TopBar';
import {
  Calculator, Save, Plus, Trash2, X, Loader2, Search, Pencil,
  TrendingUp, Users, Calendar, Download, Eye, Layers, Lock, FileSpreadsheet
} from 'lucide-react';
import {
  forecastingApi, productionsApi, costForecastsApi, labourFlowsApi, dashboardApi,
  type Forecast, type PercentometerRatio, type CatalogueItem, type Production,
  type CostForecast, type LabourFlow, type DashboardData
} from '@/lib/api';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import RequireRole from '@/components/RequireRole';
import CostForecastEditor from '@/components/forecasting/CostForecastEditor';
import LabourFlowEditor from '@/components/forecasting/LabourFlowEditor';
import NewCostForecastModal from '@/components/forecasting/NewCostForecastModal';
import NewLabourFlowModal from '@/components/forecasting/NewLabourFlowModal';

const fmtGBP = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const BAR_COLOURS = [
  'bg-blue-500', 'bg-blue-500', 'bg-indigo-400', 'bg-amber-500',
  'bg-orange-500', 'bg-pink-500', 'bg-slate-400', 'bg-purple-500',
  'bg-cyan-500', 'bg-green-500', 'bg-rose-400',
];

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

type CalcResult = { cost_type: string; percentage: number; estimated_cost: number };

export default function ForecastingPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator', 'guest']}>
      <ForecastingContent />
    </RequireRole>
  );
}

function ForecastingContent() {
  const { user } = useAuth();
  const isGuest = user?.role === 'guest';
  const isMD = !isGuest;
  const isAccountant = !isGuest;

  const [activeTab, setActiveTab] = useState<'cost_forecasts' | 'labour_flows' | 'percentometer' | 'scenarios'>('cost_forecasts');

  // ── Productions (shared) ──────────────────────────────────────────────────────
  const [productions, setProductions] = useState<Production[]>([]);

  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => { });
  }, []);

  // ── Tool 1: Cost Forecasts State ──────────────────────────────────────────────
  const [costForecasts, setCostForecasts] = useState<CostForecast[]>([]);
  const [costForecastsLoading, setCostForecastsLoading] = useState(false);
  const [selectedCostForecastId, setSelectedCostForecastId] = useState<string | null>(null);
  const [showNewCostForecastModal, setShowNewCostForecastModal] = useState(false);
  const [cfFilterProduction, setCfFilterProduction] = useState<string>('');

  const loadCostForecasts = useCallback(async () => {
    setCostForecastsLoading(true);
    try {
      const data = await costForecastsApi.list(cfFilterProduction ? { production_id: cfFilterProduction } : undefined);
      setCostForecasts(data);
    } catch { /* ignore */ } finally {
      setCostForecastsLoading(false);
    }
  }, [cfFilterProduction]);

  useEffect(() => {
    if (activeTab === 'cost_forecasts') loadCostForecasts();
  }, [activeTab, loadCostForecasts]);

  // ── Tool 2: Weekly Labour Flows State ─────────────────────────────────────────
  const [labourFlows, setLabourFlows] = useState<LabourFlow[]>([]);
  const [labourFlowsLoading, setLabourFlowsLoading] = useState(false);
  const [selectedLabourFlowId, setSelectedLabourFlowId] = useState<string | null>(null);
  const [showNewLabourFlowModal, setShowNewLabourFlowModal] = useState(false);
  const [lfFilterProduction, setLfFilterProduction] = useState<string>('');

  const loadLabourFlows = useCallback(async () => {
    setLabourFlowsLoading(true);
    try {
      const data = await labourFlowsApi.list(lfFilterProduction ? { production_id: lfFilterProduction } : undefined);
      setLabourFlows(data);
    } catch { /* ignore */ } finally {
      setLabourFlowsLoading(false);
    }
  }, [lfFilterProduction]);

  useEffect(() => {
    if (activeTab === 'labour_flows') loadLabourFlows();
  }, [activeTab, loadLabourFlows]);

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 1: PERCENTOMETER
  // ─────────────────────────────────────────────────────────────────────────────

  const [ratios, setRatios] = useState<PercentometerRatio[]>([]);
  const [ratiosLoading, setRatiosLoading] = useState(true);
  const [carpenterInput, setCarpenterInput] = useState('');
  const [calcResults, setCalcResults] = useState<CalcResult[] | null>(null);
  const [calcTotal, setCalcTotal] = useState(0);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState('');

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showEditRatios, setShowEditRatios] = useState(false);

  useEffect(() => {
    forecastingApi.getRatios()
      .then(data => {
        // Coerce percentage strings from Postgres to numbers
        const arr = Array.isArray(data) ? data : [];
        setRatios(arr.map(r => ({ ...r, percentage: parseFloat(String(r.percentage)) })));
      })
      .catch(() => { })
      .finally(() => setRatiosLoading(false));
  }, []);

  const handleCalculate = async () => {
    const val = parseFloat(carpenterInput);
    if (isNaN(val) || val <= 0) { setCalcError('Enter a valid carpenter cost.'); return; }
    setCalcLoading(true);
    setCalcError('');
    try {
      const res = await forecastingApi.calculate(val);
      // Backend returns: { breakdown: [{cost_type, percentage, estimated_value}], total_estimated_job_cost }
      setCalcResults(res.breakdown.map(r => ({
        cost_type: r.cost_type,
        percentage: r.percentage,           // already ×100 from backend
        estimated_cost: r.estimated_value,
      })));
      setCalcTotal(res.total_estimated_job_cost);
    } catch (err: unknown) {
      setCalcError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setCalcLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 2: CATALOGUE (Removed)
  // ─────────────────────────────────────────────────────────────────────────────  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 3: SAVED SCENARIOS
  // ─────────────────────────────────────────────────────────────────────────────

  const [scenarios, setScenarios] = useState<Forecast[]>([]);
  const [varianceData, setVarianceData] = useState<DashboardData['forecasting_variance']>([]);
  const [scenLoading, setScenLoading] = useState(false);
  const [deletingScenId, setDeletingScenId] = useState<string | null>(null);

  const loadScenarios = useCallback(async () => {
    setScenLoading(true);
    try {
      const [data, dash] = await Promise.all([
        forecastingApi.getAllForecasts(),
        dashboardApi.get()
      ]);
      setScenarios(data);
      setVarianceData(dash.forecasting_variance || []);
    } catch { /* silent */ }
    finally { setScenLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'scenarios') loadScenarios();
  }, [activeTab, loadScenarios]);

  const deleteScenario = async (id: string) => {
    if (!confirm('Delete this saved scenario?')) return;
    setDeletingScenId(id);
    try {
      await forecastingApi.deleteForecast(id);
      setScenarios(prev => prev.filter(s => s.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingScenId(null);
    }
  };

  const [deletingCfId, setDeletingCfId] = useState<string | null>(null);
  const handleDeleteCostForecast = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm('Are you sure you want to delete this cost forecast?')) return;
    setDeletingCfId(id);
    try {
      await costForecastsApi.delete(id);
      setCostForecasts(prev => prev.filter(c => c.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete cost forecast');
    } finally {
      setDeletingCfId(null);
    }
  };

  const [deletingLfId, setDeletingLfId] = useState<string | null>(null);
  const handleDeleteLabourFlow = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm('Are you sure you want to delete this weekly labour flow?')) return;
    setDeletingLfId(id);
    try {
      await labourFlowsApi.delete(id);
      setLabourFlows(prev => prev.filter(l => l.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete labour flow');
    } finally {
      setDeletingLfId(null);
    }
  };

  // If a cost forecast is selected, open editor
  if (selectedCostForecastId) {
    return (
      <>
        <TopBar title="Cost Forecast" subtitle="Addendum 4 — Tool 1: Flexible Cost Plan" />
        <main className="flex-1 p-4 md:p-6">
          <CostForecastEditor
            forecastId={selectedCostForecastId}
            onBack={() => {
              setSelectedCostForecastId(null);
              loadCostForecasts();
            }}
            onVersionCreated={(newRev) => {
              setSelectedCostForecastId(newRev.id);
              loadCostForecasts();
            }}
          />
        </main>
      </>
    );
  }

  // If a labour flow is selected, open editor
  if (selectedLabourFlowId) {
    return (
      <>
        <TopBar title="Weekly Labour Flow" subtitle="Addendum 4 — Tool 2: Rolling Weekly Headcount Matrix" />
        <main className="flex-1 p-4 md:p-6">
          <LabourFlowEditor
            flowId={selectedLabourFlowId}
            onBack={() => {
              setSelectedLabourFlowId(null);
              loadLabourFlows();
            }}
            onVersionCreated={(newRev) => {
              setSelectedLabourFlowId(newRev.id);
              loadLabourFlows();
            }}
          />
        </main>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tabs config
  // ─────────────────────────────────────────────────────────────────────────────

  const tabs: { id: typeof activeTab; label: string; count?: number }[] = [
    { id: 'cost_forecasts', label: 'Cost Forecasts', count: costForecasts.length },
    { id: 'labour_flows', label: 'Weekly Labour Flow', count: labourFlows.length },
    { id: 'percentometer', label: 'The Percentometer' },
    { id: 'scenarios', label: 'Saved Scenarios' },
  ];

  return (
    <>
      {showNewCostForecastModal && (
        <NewCostForecastModal
          productions={productions}
          onClose={() => setShowNewCostForecastModal(false)}
          onCreated={(f) => {
            setShowNewCostForecastModal(false);
            loadCostForecasts();
            setSelectedCostForecastId(f.id);
          }}
        />
      )}
      {showNewLabourFlowModal && (
        <NewLabourFlowModal
          productions={productions}
          onClose={() => setShowNewLabourFlowModal(false)}
          onCreated={(lf) => {
            setShowNewLabourFlowModal(false);
            loadLabourFlows();
            setSelectedLabourFlowId(lf.id);
          }}
        />
      )}
      {showSaveModal && (
        <SaveScenarioModal
          carpenterCost={parseFloat(carpenterInput) || null}
          productions={productions}
          onClose={() => setShowSaveModal(false)}
          onSaved={() => { setShowSaveModal(false); }}
        />
      )}
      {showEditRatios && (
        <EditRatiosModal
          ratios={ratios}
          onClose={() => setShowEditRatios(false)}
          onSaved={updated => {
            // Backend returns { message, ratios: [...] } — unwrap the array
            const arr = Array.isArray(updated) ? updated : (updated as unknown as { ratios: typeof ratios }).ratios;
            setRatios(arr ?? []);
            setShowEditRatios(false);
          }}
        />
      )}


      <TopBar title="Forecasting & Job Costing" subtitle="Labour & material forecasting, BECTU rate cards, and weekly labour flow plans" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit overflow-x-auto max-w-full">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-normal rounded-lg transition-colors whitespace-nowrap ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm font-medium' : 'text-slate-600 hover:bg-slate-100'
                }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-blue-700/60 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── TOOL 1: COST FORECASTS ─────────────────────────────────────────── */}
        {activeTab === 'cost_forecasts' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm flex items-center gap-2">
                  <TrendingUp size={16} className="text-blue-600" />
                  Cost Forecast Plans (Tool 1)
                </h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Flexible cost plans with daily & weekly views, BECTU crew rates link, and lock versioning
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <select
                  value={cfFilterProduction}
                  onChange={e => setCfFilterProduction(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">All Productions</option>
                  {productions.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setShowNewCostForecastModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors whitespace-nowrap"
                >
                  <Plus size={14} /> New Cost Forecast
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500">Plan Title & Version</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Production</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Dates & Duration</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-500 text-center">View</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Labour Cost</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Above-The-Line</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Grand Total</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Updated</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {costForecastsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <td key={j} className="px-4 py-3.5">
                            <div className="h-4 bg-slate-100 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : costForecasts.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-12 text-center">
                        <TrendingUp size={36} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-slate-600 text-sm font-medium">No Cost Forecasts yet</p>
                        <p className="text-slate-400 text-xs mt-1">Create a flexible cost plan linked to live BECTU rates.</p>
                        <button
                          onClick={() => setShowNewCostForecastModal(true)}
                          className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          <Plus size={13} /> Create Cost Forecast
                        </button>
                      </td>
                    </tr>
                  ) : (
                    costForecasts.map(cf => (
                      <tr
                        key={cf.id}
                        onClick={() => setSelectedCostForecastId(cf.id)}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                      >
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                            <span>{cf.title}</span>
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              v{cf.version}
                            </span>
                          </div>
                          {cf.notes && <p className="text-xs text-slate-400 truncate max-w-xs">{cf.notes}</p>}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-600 font-medium">
                          {cf.production_name || '—'}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                          {fmtDate(cf.start_date)} – {fmtDate(cf.end_date)}
                          <span className="ml-1.5 text-slate-400 font-mono">
                            ({cf.num_weeks ?? Math.max(1, Math.ceil((new Date(cf.end_date).getTime() - new Date(cf.start_date).getTime()) / (7 * 24 * 3600 * 1000)))}w)
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                            {cf.default_view}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center whitespace-nowrap">
                          {cf.status === 'locked' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Lock size={11} /> Locked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-right font-medium text-slate-700">
                          {fmtGBP(Number(cf.total_crew_cost) || 0)}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-right font-medium text-slate-700">
                          {fmtGBP(Number(cf.total_non_labour_cost) || 0)}
                        </td>
                        <td className="px-4 py-3.5 text-sm text-right font-bold text-slate-900">
                          {fmtGBP(Number(cf.grand_total_cost) || 0)}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-right text-slate-400 whitespace-nowrap">
                          {fmtDate(cf.updated_at)}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedCostForecastId(cf.id)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition-colors"
                              title="Open Cost Forecast"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={(e) => handleDeleteCostForecast(cf.id, e)}
                              disabled={deletingCfId === cf.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition-colors disabled:opacity-50"
                              title="Delete Cost Forecast"
                            >
                              {deletingCfId === cf.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TOOL 2: WEEKLY LABOUR FLOW ──────────────────────────────────────── */}
        {activeTab === 'labour_flows' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm flex items-center gap-2">
                  <Users size={16} className="text-indigo-600" />
                  Weekly Labour Flow Matrices (Tool 2)
                </h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Rolling weekly headcount matrix across 4 departments with dynamic w/e columns & CSV export
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <select
                  value={lfFilterProduction}
                  onChange={e => setLfFilterProduction(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">All Productions</option>
                  {productions.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setShowNewLabourFlowModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors whitespace-nowrap"
                >
                  <Plus size={14} /> New Labour Flow
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500">Plan Title & Version</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Production</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Dates & Duration</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Grand Total Cost</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Updated</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {labourFlowsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-3.5">
                            <div className="h-4 bg-slate-100 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : labourFlows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center">
                        <Users size={36} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-slate-600 text-sm font-medium">No Weekly Labour Flows yet</p>
                        <p className="text-slate-400 text-xs mt-1">Create a rolling weekly headcount matrix across departments.</p>
                        <button
                          onClick={() => setShowNewLabourFlowModal(true)}
                          className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          <Plus size={13} /> Create Labour Flow
                        </button>
                      </td>
                    </tr>
                  ) : (
                    labourFlows.map(lf => (
                      <tr
                        key={lf.id}
                        onClick={() => setSelectedLabourFlowId(lf.id)}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                      >
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                            <span>{lf.title}</span>
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              v{lf.version}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-600 font-medium">
                          {lf.production_name || '—'}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                          {fmtDate(lf.start_date)} – {fmtDate(lf.end_date)}
                          <span className="ml-1.5 text-slate-400 font-mono">({lf.num_weeks}w)</span>
                        </td>
                        <td className="px-3 py-3.5 text-center whitespace-nowrap">
                          {lf.status === 'locked' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Lock size={11} /> Locked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-sm text-right font-bold text-slate-900">
                          {fmtGBP(Number(lf.grand_total_cost) || 0)}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-right text-slate-400 whitespace-nowrap">
                          {fmtDate(lf.updated_at)}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await labourFlowsApi.exportCsv(lf.id);
                                } catch (err: any) {
                                  alert(err.message || 'Export failed');
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                              title="Export CSV"
                            >
                              <Download size={15} />
                            </button>
                            <button
                              onClick={() => setSelectedLabourFlowId(lf.id)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition-colors"
                              title="Open Labour Flow"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={(e) => handleDeleteLabourFlow(lf.id, e)}
                              disabled={deletingLfId === lf.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition-colors disabled:opacity-50"
                              title="Delete Labour Flow"
                            >
                              {deletingLfId === lf.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SECTION 1: PERCENTOMETER ─────────────────────────────────────────── */}
        {activeTab === 'percentometer' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

            {/* Calculator panel */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-slate-900 font-semibold text-sm">The Percentometer</h2>
                  <p className="text-slate-400 text-xs mt-0.5">Enter the <strong className="text-slate-600">total project cost</strong> for Carpenters — we'll estimate every other department proportionally</p>
                </div>
                {(isMD || isAccountant) && (
                  <button
                    onClick={() => setShowEditRatios(true)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
                  >
                    <Pencil size={12} /> Edit Ratios
                  </button>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-end gap-3 mb-5">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 font-medium block mb-1">
                      Known Carpenter Cost
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">Total £ — whole project</span>
                    </label>
                    <div className="flex items-center bg-slate-50 border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                      <span className="px-3 text-slate-500 font-semibold text-sm bg-slate-100 border-r border-slate-300 py-2.5">£</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={carpenterInput}
                        onChange={e => setCarpenterInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCalculate()}
                        placeholder="e.g. 52960"
                        className="flex-1 px-3 py-2.5 text-slate-900 font-bold text-sm bg-transparent outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
                      💡 Enter the <em>total</em> your Carpenters will cost across the entire production run (e.g. all wages, all weeks combined). No time period is needed — this tool uses historical spend <em>ratios</em> to scale everything else.
                    </p>
                  </div>
                  <button
                    onClick={handleCalculate}
                    disabled={calcLoading}
                    className="flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2.5 hover:bg-blue-700 font-medium disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    {calcLoading ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
                    Calculate
                  </button>
                </div>

                {calcError && (
                  <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2 mb-4">{calcError}</p>
                )}

                {/* Results */}
                {ratiosLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />
                    ))}
                  </div>
                ) : calcResults ? (
                  <div className="space-y-3">
                    {calcResults.map((r, i) => (
                      <div key={r.cost_type} className="flex items-center gap-3">
                        <div className="w-28 text-slate-700 text-xs font-medium truncate">{r.cost_type}</div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${BAR_COLOURS[i % BAR_COLOURS.length]}`}
                              style={{ width: `${r.percentage}%` }}
                            />
                          </div>
                          <span className="text-slate-500 text-xs w-9 text-right">{r.percentage}%</span>
                        </div>
                        <div className="w-24 text-slate-900 text-xs font-semibold text-right">
                          {fmtGBP(r.estimated_cost)}
                        </div>
                      </div>
                    ))}
                    <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-slate-700 font-semibold text-sm">Estimated Total Job Cost</span>
                      <span className="text-blue-700 text-xl font-black">{fmtGBP(calcTotal)}</span>
                    </div>
                    <div className="mt-2">
                      <button
                        onClick={() => setShowSaveModal(true)}
                        className="w-full flex items-center justify-center gap-2 border border-blue-200 bg-blue-50 text-blue-700 text-sm rounded-lg px-4 py-2 hover:bg-blue-100 font-medium transition-colors"
                      >
                        <Save size={14} /> Save as Scenario
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ratios.map((r, i) => (
                      <div key={r.cost_type} className="flex items-center gap-3">
                        <div className="w-28 text-slate-700 text-xs font-medium truncate">{r.cost_type}</div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${BAR_COLOURS[i % BAR_COLOURS.length]}`}
                              style={{ width: `${Math.min(parseFloat(String(r.percentage)) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-slate-500 text-xs w-9 text-right">{(parseFloat(String(r.percentage)) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="w-24 text-slate-400 text-xs font-medium text-right">—</div>
                      </div>
                    ))}
                    <p className="text-slate-400 text-xs text-center pt-2">Enter a carpenter cost and click Calculate to see estimates</p>
                  </div>
                )}
              </div>
            </div>

            {/* Ratios reference card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-slate-900 font-semibold text-sm">Current Ratio Reference</h2>
                <p className="text-slate-400 text-xs mt-0.5">Live ratios used for all calculations</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-5 py-2.5 text-slate-500 font-semibold text-left">Cost Type</th>
                      <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Percentage</th>
                      <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Visual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ratiosLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-5 py-2.5"><div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" /></td>
                          <td className="px-4 py-2.5"><div className="h-3.5 w-8 bg-slate-100 rounded animate-pulse ml-auto" /></td>
                          <td className="px-4 py-2.5"><div className="h-2 w-20 bg-slate-100 rounded animate-pulse ml-auto" /></td>
                        </tr>
                      ))
                    ) : ratios.map((r, i) => (
                      <tr key={r.cost_type} className="hover:bg-slate-50/50">
                        <td className="px-5 py-2.5 text-slate-700 font-medium">{r.cost_type}</td>
                        <td className="px-4 py-2.5 text-slate-600 text-right font-semibold">{(parseFloat(String(r.percentage)) * 100).toFixed(2)}%</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <div className="w-24 bg-slate-100 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${BAR_COLOURS[i % BAR_COLOURS.length]}`}
                                style={{ width: `${Math.min(parseFloat(String(r.percentage)) * 100, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {!ratiosLoading && ratios.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td className="px-5 py-2.5 font-bold text-slate-700">Total</td>
                        <td className="px-4 py-2.5 font-bold text-slate-900 text-right">
                          {(ratios.reduce((s, r) => s + parseFloat(String(r.percentage)), 0) * 100).toFixed(2)}%
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}


        {/* ── SECTION 3: SAVED SCENARIOS ───────────────────────────────────────── */}
        {activeTab === 'scenarios' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Saved Scenarios</h2>
                <p className="text-slate-400 text-xs mt-0.5">Named forecasts saved from the percentometer</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-left">Scenario Name</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-left">Production</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Labour Forecast</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Materials Forecast</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Total</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Saved Date</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scenLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-3.5">
                            <div className="h-4 bg-slate-100 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : scenarios.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                        No saved scenarios yet. Use the Percentometer to create one.
                      </td>
                    </tr>
                  ) : (
                    scenarios.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3.5 text-slate-800 font-medium">{s.scenario_name}</td>
                        <td className="px-4 py-3.5 text-slate-500 text-xs">{s.prod_name ?? '—'}</td>
                        <td className="px-4 py-3.5 text-slate-600 text-right">{fmtGBP(Number(s.total_labour) || 0)}</td>
                        <td className="px-4 py-3.5 text-slate-600 text-right">{fmtGBP(Number(s.total_materials) || 0)}</td>
                        <td className="px-4 py-3.5 text-slate-900 font-bold text-right">{fmtGBP(Number(s.combined_total) || Number(s.percentometer_total) || 0)}</td>
                        <td className="px-4 py-3.5 text-slate-400 text-xs">{fmtDate(s.created_at)}</td>
                        <td className="px-4 py-3.5">
                          <button
                            onClick={() => deleteScenario(s.id)}
                            disabled={deletingScenId === s.id}
                            className="p-1.5 text-slate-300 hover:text-red-400 transition-colors rounded disabled:opacity-50"
                            title="Delete scenario"
                          >
                            {deletingScenId === s.id
                              ? <Loader2 size={13} className="animate-spin" />
                              : <Trash2 size={13} />
                            }
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            {/* Chart Section */}
            {varianceData.length > 0 && (
              <div className="p-5 border-t border-slate-100 flex flex-col xl:flex-row gap-8">
                
                {/* Bar Chart: Predicted vs Actual Totals */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Predicted vs Actual Cost Breakdown</h3>
                  <div className="h-[350px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={varianceData.map(v => ({
                          name: v.forecast_name,
                          'Predicted Labour': v.forecast_labour || 0,
                          'Actual Labour': v.actual_labour || 0,
                          'Predicted Materials': v.forecast_materials || 0,
                          'Actual Materials': v.actual_materials || 0,
                        }))}
                        margin={{ top: 20, right: 30, left: 20, bottom: 25 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="name" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#64748b' }} 
                          interval={0}
                          angle={-25}
                          textAnchor="end"
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#64748b' }} 
                          tickFormatter={(val) => `£${(val/1000).toFixed(0)}k`} 
                        />
                        <RechartsTooltip 
                          formatter={(value: any) => fmtGBP(value)}
                          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          cursor={{ fill: '#f8fafc' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                        <Bar dataKey="Predicted Labour" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Actual Labour" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Predicted Materials" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Actual Materials" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Line Chart: Weekly Timesheets vs Forecast (MOCK) */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-900">Weekly Labour Burn Rate</h3>
                    <span className="text-[10px] font-bold tracking-wider uppercase bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Preview Mode</span>
                  </div>
                  <div className="h-[350px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={[
                          { week: 'Week 1', 'Forecasted Weekly': 4500, 'Actual Weekly Pay': 4200 },
                          { week: 'Week 2', 'Forecasted Weekly': 5500, 'Actual Weekly Pay': 6100 },
                          { week: 'Week 3', 'Forecasted Weekly': 8000, 'Actual Weekly Pay': 7800 },
                          { week: 'Week 4', 'Forecasted Weekly': 8000, 'Actual Weekly Pay': 9500 },
                          { week: 'Week 5', 'Forecasted Weekly': 6000, 'Actual Weekly Pay': 6200 },
                          { week: 'Week 6', 'Forecasted Weekly': 3000, 'Actual Weekly Pay': 2500 },
                        ]}
                        margin={{ top: 20, right: 30, left: 20, bottom: 25 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="week" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#64748b' }}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#64748b' }} 
                          tickFormatter={(val) => `£${(val/1000).toFixed(0)}k`} 
                        />
                        <RechartsTooltip 
                          formatter={(value: any) => fmtGBP(value)}
                          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                        <Line type="monotone" dataKey="Forecasted Weekly" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                        <Line type="monotone" dataKey="Actual Weekly Pay" stroke="#ef4444" strokeWidth={2} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-slate-400 text-center mt-2">
                    Note: This requires a new backend endpoint to map Labour Flow weeks to finalised Timesheets.
                  </p>
                </div>

              </div>
            )}
          </div>
        )}

      </main>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE SCENARIO MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface SaveScenarioModalProps {
  carpenterCost: number | null;
  productions: Production[];
  onClose: () => void;
  onSaved: () => void;
}

function SaveScenarioModal({ carpenterCost, productions, onClose, onSaved }: SaveScenarioModalProps) {
  const [name, setName] = useState('');
  const [productionId, setProductionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Scenario name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await forecastingApi.createForecast({
        name: name.trim(),
        production_id: productionId || null,
        percentometer_carpenter_cost: carpenterCost,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save scenario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-base">Save Scenario</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Scenario Name *</label>
            <input
              className={inputCls}
              placeholder="e.g. Meridian — Base Case"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Link to Production (optional)</label>
            <select
              className={inputCls}
              value={productionId}
              onChange={e => setProductionId(e.target.value)}
            >
              <option value="">— None —</option>
              {productions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {carpenterCost !== null && (
            <p className="text-xs text-slate-400">Carpenter cost: {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(carpenterCost)}</p>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save Scenario
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT RATIOS MODAL (MD only)
// ─────────────────────────────────────────────────────────────────────────────

interface EditRatiosModalProps {
  ratios: PercentometerRatio[];
  onClose: () => void;
  onSaved: (updated: PercentometerRatio[]) => void;
}

function EditRatiosModal({ ratios, onClose, onSaved }: EditRatiosModalProps) {
  // DB stores 0.42 to mean 42% — convert to display-space (0-100) for editing
  const [draft, setDraft] = useState<PercentometerRatio[]>(
    ratios.map(r => ({ ...r, percentage: parseFloat((r.percentage * 100).toFixed(4)) }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updatePct = (i: number, val: string) => {
    const pct = parseFloat(val);
    setDraft(prev => prev.map((r, idx) => idx === i ? { ...r, percentage: isNaN(pct) ? 0 : pct } : r));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = draft.reduce((s, r) => s + (parseFloat(String(r.percentage)) || 0), 0);
    if (Math.abs(total - 100) > 0.001) { setError(`Percentages must sum to 100% (currently ${total.toFixed(2)}%).`); return; }
    setSaving(true);
    setError('');
    try {
      // Backend returns { message, ratios: [...] } — unwrap before passing up
      const rawResponse = await forecastingApi.updateRatios(
        draft.map(r => ({ cost_type: r.cost_type, percentage: parseFloat((r.percentage / 100).toFixed(4)) }))
      );
      const arr: PercentometerRatio[] = Array.isArray(rawResponse)
        ? rawResponse
        : ((rawResponse as unknown as { ratios: PercentometerRatio[] }).ratios ?? []);
      onSaved(arr);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save ratios');
    } finally {
      setSaving(false);
    }
  };

  const total = draft.reduce((s, r) => s + (parseFloat(String(r.percentage)) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-base">Edit Percentometer Ratios</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="px-6 py-5 space-y-2.5 max-h-[60vh] overflow-y-auto">
            {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</p>}
            {draft.map((r, i) => (
              <div key={r.cost_type} className="flex items-center gap-3">
                <span className="flex-1 text-slate-700 text-sm font-medium">{r.cost_type}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={r.percentage}
                    onChange={e => updatePct(i, e.target.value)}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800 text-right outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-slate-500 text-sm">%</span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <span className={`text-xs font-semibold ${Math.abs(total - 100) < 0.001 ? 'text-green-600' : 'text-amber-600'}`}>
              Total: {total.toFixed(2)}%{Math.abs(total - 100) > 0.001 ? ' (must equal 100%)' : ' ✓'}
            </span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save Ratios
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD CATALOGUE ITEM MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface AddCatalogueItemModalProps {
  onClose: () => void;
  onSaved: (item: CatalogueItem) => void;
}

function AddCatalogueItemModal({ onClose, onSaved }: AddCatalogueItemModalProps) {
  const [form, setForm] = useState({
    supplier_name: '',
    item_description: '',
    unit: '',
    unit_price: '',
    category: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplier_name.trim()) { setError('Supplier name is required.'); return; }
    if (!form.item_description.trim()) { setError('Item description is required.'); return; }
    const price = parseFloat(form.unit_price);
    if (!form.unit_price || isNaN(price) || price < 0) { setError('A valid unit price is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const item = await forecastingApi.createCatalogueItem({
        supplier_name: form.supplier_name.trim(),
        item_description: form.item_description.trim(),
        unit: form.unit.trim() || undefined,
        unit_price: form.unit_price,
        category: form.category.trim() || undefined,
      });
      onSaved(item);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-base">Add Catalogue Item</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Supplier Name *</label>
            <input className={inputCls} placeholder="e.g. Treeline Timber Co." value={form.supplier_name} onChange={set('supplier_name')} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Item Description *</label>
            <input className={inputCls} placeholder="e.g. Structural timber 4x2 per metre" value={form.item_description} onChange={set('item_description')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
              <input className={inputCls} placeholder="e.g. metre, sheet, kg" value={form.unit} onChange={set('unit')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit Price (£) *</label>
              <input type="number" step="0.01" min="0" className={inputCls} placeholder="0.00" value={form.unit_price} onChange={set('unit_price')} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <input className={inputCls} placeholder="e.g. Timber, Paint, Hardware" value={form.category} onChange={set('category')} />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Add Item
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
