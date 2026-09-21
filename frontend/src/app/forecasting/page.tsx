'use client';

import { useState, useEffect, useCallback } from 'react';
import TopBar from '@/components/TopBar';
import {
  Calculator, Save, Plus, Trash2, X, Loader2, Search, Pencil,
} from 'lucide-react';
import {
  forecastingApi, productionsApi,
  type Forecast, type PercentometerRatio, type CatalogueItem, type Production,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import RequireRole from '@/components/RequireRole';

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

  const [activeTab, setActiveTab] = useState<'percentometer' | 'catalogue' | 'scenarios'>('percentometer');

  // ── Productions (shared) ──────────────────────────────────────────────────────
  const [productions, setProductions] = useState<Production[]>([]);

  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => {});
  }, []);

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
      .then(data => setRatios(data))
      .catch(() => {})
      .finally(() => setRatiosLoading(false));
  }, []);

  const handleCalculate = async () => {
    const val = parseFloat(carpenterInput);
    if (isNaN(val) || val <= 0) { setCalcError('Enter a valid carpenter cost.'); return; }
    setCalcLoading(true);
    setCalcError('');
    try {
      const res = await forecastingApi.calculate(val);
      setCalcResults(res.result);
      setCalcTotal(res.total_estimated_cost);
    } catch (err: unknown) {
      setCalcError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setCalcLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 2: CATALOGUE
  // ─────────────────────────────────────────────────────────────────────────────

  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const loadCatalogue = useCallback(async () => {
    setCatLoading(true);
    try {
      const data = await forecastingApi.getCatalogue();
      setCatalogue(data);
    } catch { /* silent */ }
    finally { setCatLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'catalogue') loadCatalogue();
  }, [activeTab, loadCatalogue]);

  const filteredCatalogue = catalogue.filter(item => {
    if (!catSearch) return true;
    const q = catSearch.toLowerCase();
    return (
      item.supplier_name.toLowerCase().includes(q) ||
      item.item_description.toLowerCase().includes(q) ||
      (item.category ?? '').toLowerCase().includes(q)
    );
  });

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this catalogue item?')) return;
    setDeletingItemId(id);
    try {
      await forecastingApi.deleteCatalogueItem(id);
      setCatalogue(prev => prev.filter(i => i.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingItemId(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 3: SAVED SCENARIOS
  // ─────────────────────────────────────────────────────────────────────────────

  const [scenarios, setScenarios] = useState<Forecast[]>([]);
  const [scenLoading, setScenLoading] = useState(false);
  const [deletingScenId, setDeletingScenId] = useState<string | null>(null);

  const loadScenarios = useCallback(async () => {
    setScenLoading(true);
    try {
      const data = await forecastingApi.getAllForecasts();
      setScenarios(data);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Tabs config
  // ─────────────────────────────────────────────────────────────────────────────

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'percentometer', label: 'The Percentometer' },
    { id: 'catalogue', label: 'Supplier Catalogue' },
    { id: 'scenarios', label: 'Saved Scenarios' },
  ];

  return (
    <>
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
          onSaved={updated => { setRatios(updated); setShowEditRatios(false); }}
        />
      )}
      {showAddItem && (
        <AddCatalogueItemModal
          onClose={() => setShowAddItem(false)}
          onSaved={item => { setCatalogue(prev => [item, ...prev]); setShowAddItem(false); }}
        />
      )}

      <TopBar title="Forecasting & Job Costing" subtitle="Labour and materials forecasting with scenario comparison" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── SECTION 1: PERCENTOMETER ─────────────────────────────────────────── */}
        {activeTab === 'percentometer' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

            {/* Calculator panel */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-slate-900 font-semibold text-sm">The Percentometer</h2>
                  <p className="text-slate-400 text-xs mt-0.5">Enter a known carpenter cost to estimate all other costs</p>
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
                    <label className="text-xs text-slate-500 font-medium block mb-1">Known Carpenter Cost £</label>
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
                              style={{ width: `${r.percentage}%` }}
                            />
                          </div>
                          <span className="text-slate-500 text-xs w-9 text-right">{r.percentage}%</span>
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
                        <td className="px-4 py-2.5 text-slate-600 text-right font-semibold">{r.percentage}%</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <div className="w-24 bg-slate-100 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${BAR_COLOURS[i % BAR_COLOURS.length]}`}
                                style={{ width: `${Math.min(r.percentage, 100)}%` }}
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
                          {ratios.reduce((s, r) => s + r.percentage, 0)}%
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

        {/* ── SECTION 2: SUPPLIER CATALOGUE ────────────────────────────────────── */}
        {activeTab === 'catalogue' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-4 flex-wrap">
              <div>
                <h2 className="text-slate-900 font-semibold text-sm">Supplier Catalogue</h2>
                <p className="text-slate-400 text-xs mt-0.5">Reference pricing for common items</p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-56">
                  <Search size={13} className="text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="Search catalogue..."
                    value={catSearch}
                    onChange={e => setCatSearch(e.target.value)}
                    className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                  />
                </div>
                {(isMD || isAccountant) && (
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                  >
                    <Plus size={14} /> Add Item
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-left">Supplier Name</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-left">Description</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">Unit</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Unit Price</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-left">Category</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-left">Last Used</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {catLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 bg-slate-100 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filteredCatalogue.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                        {catSearch ? 'No items match your search.' : 'No catalogue items yet.'}
                      </td>
                    </tr>
                  ) : (
                    filteredCatalogue.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3 text-slate-800 font-medium">{item.supplier_name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.item_description}</td>
                        <td className="px-4 py-3 text-slate-500 text-center">{item.unit ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-900 font-semibold text-right">
                          {fmtGBP(parseFloat(item.unit_price))}
                        </td>
                        <td className="px-4 py-3">
                          {item.category ? (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                              {item.category}
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          {item.last_used_date ? fmtDate(item.last_used_date) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {(isMD || isAccountant) && (
                            <button
                              onClick={() => deleteItem(item.id)}
                              disabled={deletingItemId === item.id}
                              className="p-1.5 text-slate-300 hover:text-red-400 transition-colors rounded disabled:opacity-50"
                              title="Delete item"
                            >
                              {deletingItemId === item.id
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Trash2 size={13} />
                              }
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!catLoading && catalogue.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
                <span className="text-slate-400 text-xs">
                  Showing {filteredCatalogue.length} of {catalogue.length} item{catalogue.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
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
                        <td className="px-5 py-3.5 text-slate-800 font-medium">{s.name}</td>
                        <td className="px-4 py-3.5 text-slate-500 text-xs">{s.prod_name ?? '—'}</td>
                        <td className="px-4 py-3.5 text-slate-600 text-right">{fmtGBP(s.total_labour_cost)}</td>
                        <td className="px-4 py-3.5 text-slate-600 text-right">{fmtGBP(s.total_materials_cost)}</td>
                        <td className="px-4 py-3.5 text-slate-900 font-bold text-right">{fmtGBP(s.total_forecast_cost)}</td>
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
  const [draft, setDraft] = useState<PercentometerRatio[]>(ratios.map(r => ({ ...r })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updatePct = (i: number, val: string) => {
    const pct = parseFloat(val);
    setDraft(prev => prev.map((r, idx) => idx === i ? { ...r, percentage: isNaN(pct) ? 0 : pct } : r));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = draft.reduce((s, r) => s + r.percentage, 0);
    if (total !== 100) { setError(`Percentages must sum to 100 (currently ${total}%).`); return; }
    setSaving(true);
    setError('');
    try {
      const updated = await forecastingApi.updateRatios(draft.map(r => ({ cost_type: r.cost_type, percentage: r.percentage })));
      onSaved(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save ratios');
    } finally {
      setSaving(false);
    }
  };

  const total = draft.reduce((s, r) => s + r.percentage, 0);

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
            <span className={`text-xs font-semibold ${total === 100 ? 'text-green-600' : 'text-amber-600'}`}>
              Total: {total}%{total !== 100 ? ' (must equal 100%)' : ''}
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
