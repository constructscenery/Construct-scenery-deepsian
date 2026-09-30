'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, Users, Plus, Lock, Unlock, Download, ChevronRight,
  Calendar, Loader2, FileSpreadsheet, Trash2, Eye, Copy
} from 'lucide-react';
import {
  costForecastsApi,
  labourFlowsApi,
  type CostForecast,
  type LabourFlow,
  type Production,
} from '@/lib/api';
import NewCostForecastModal from './NewCostForecastModal';
import NewLabourFlowModal from './NewLabourFlowModal';
import CostForecastEditor from './CostForecastEditor';
import LabourFlowEditor from './LabourFlowEditor';

interface ProductionForecastingPanelProps {
  productionId: string;
  productionName: string;
  canManage?: boolean;
}

const fmt = (n: number | string | null | undefined) => {
  if (n == null || n === '' || isNaN(Number(n))) return '£0.00';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(Number(n));
};

export default function ProductionForecastingPanel({
  productionId,
  productionName,
  canManage = true,
}: ProductionForecastingPanelProps) {
  const [costForecasts, setCostForecasts] = useState<CostForecast[]>([]);
  const [labourFlows, setLabourFlows] = useState<LabourFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'cost_forecasts' | 'labour_flows'>('cost_forecasts');

  // Modals / Editors
  const [showNewForecastModal, setShowNewForecastModal] = useState(false);
  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [selectedForecastId, setSelectedForecastId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cf, lf] = await Promise.all([
        costForecastsApi.list({ production_id: productionId }),
        labourFlowsApi.list({ production_id: productionId }),
      ]);
      setCostForecasts(cf);
      setLabourFlows(lf);
    } catch (err) {
      console.error('Failed to load production forecasting:', err);
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Production wrapper object for modal
  const dummyProd = [{
    id: productionId,
    name: productionName,
    production_code: '',
  }] as unknown as Production[];

  const handleDeleteForecast = async (id: string, title: string) => {
    if (!confirm(`Delete cost forecast "${title}"?`)) return;
    try {
      await costForecastsApi.delete(id);
      setCostForecasts(prev => prev.filter(f => f.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleDeleteFlow = async (id: string, title: string) => {
    if (!confirm(`Delete labour flow "${title}"?`)) return;
    try {
      await labourFlowsApi.delete(id);
      setLabourFlows(prev => prev.filter(f => f.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // If viewing a deep dive editor:
  if (selectedForecastId) {
    return (
      <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200">
        <CostForecastEditor
          forecastId={selectedForecastId}
          onBack={() => { setSelectedForecastId(null); loadAll(); }}
          onVersionCreated={(newRev) => { setSelectedForecastId(newRev.id); loadAll(); }}
        />
      </div>
    );
  }

  if (selectedFlowId) {
    return (
      <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200">
        <LabourFlowEditor
          flowId={selectedFlowId}
          onBack={() => { setSelectedFlowId(null); loadAll(); }}
          onVersionCreated={(newRev) => { setSelectedFlowId(newRev.id); loadAll(); }}
        />
      </div>
    );
  }

  return (
    <>
      {showNewForecastModal && (
        <NewCostForecastModal
          productions={dummyProd}
          defaultProductionId={productionId}
          onClose={() => setShowNewForecastModal(false)}
          onCreated={(newFc) => {
            setShowNewForecastModal(false);
            setCostForecasts(prev => [newFc, ...prev]);
            setSelectedForecastId(newFc.id);
          }}
        />
      )}

      {showNewFlowModal && (
        <NewLabourFlowModal
          productions={dummyProd}
          defaultProductionId={productionId}
          onClose={() => setShowNewFlowModal(false)}
          onCreated={(newFl) => {
            setShowNewFlowModal(false);
            setLabourFlows(prev => [newFl, ...prev]);
            setSelectedFlowId(newFl.id);
          }}
        />
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                <TrendingUp size={16} />
              </span>
              <h2 className="text-base font-bold text-slate-900">Forecasting & Labour Flow</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Production cost estimates and weekly headcount plans linked to live BECTU rates
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewForecastModal(true)}
              disabled={!canManage}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-2xs disabled:opacity-50"
            >
              <Plus size={14} /> New Cost Forecast
            </button>
            <button
              onClick={() => setShowNewFlowModal(true)}
              disabled={!canManage}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-2xs disabled:opacity-50"
            >
              <Plus size={14} /> New Labour Flow
            </button>
          </div>
        </div>

        {/* Sub-tab selection */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/20">
          <button
            onClick={() => setActiveSubTab('cost_forecasts')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeSubTab === 'cost_forecasts'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Cost Forecasts ({costForecasts.length})
          </button>
          <button
            onClick={() => setActiveSubTab('labour_flows')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeSubTab === 'labour_flows'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Weekly Labour Flows ({labourFlows.length})
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin text-blue-600" />
            <span className="text-xs">Loading forecasting records...</span>
          </div>
        ) : activeSubTab === 'cost_forecasts' ? (
          /* Cost Forecasts Table */
          <div className="overflow-x-auto">
            {!costForecasts.length ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No Cost Forecasts yet for this production. Click &quot;+ New Cost Forecast&quot; to build one.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="px-6 py-3">Title / Version</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3 text-center">View</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Crew Cost</th>
                    <th className="px-4 py-3 text-right">Non-Labour</th>
                    <th className="px-4 py-3 text-right">Grand Total</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {costForecasts.map(cf => (
                    <tr key={cf.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-800">
                        <div className="font-semibold text-slate-900">{cf.title}</div>
                        <div className="text-[10px] text-slate-400">Created {new Date(cf.created_at).toLocaleDateString('en-GB')}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {cf.start_date} → {cf.end_date}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase text-[10px] font-semibold">
                          {cf.default_view}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          cf.status === 'locked' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {cf.status === 'locked' ? '🔒 Locked' : '✏️ Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {fmt(cf.total_crew_cost)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {fmt(cf.total_non_labour_cost)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {fmt(cf.grand_total_cost)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedForecastId(cf.id)}
                            className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium rounded-lg text-xs transition-colors"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleDeleteForecast(cf.id, cf.title)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          /* Weekly Labour Flows Table */
          <div className="overflow-x-auto">
            {!labourFlows.length ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No Weekly Labour Flows yet for this production. Click &quot;+ New Labour Flow&quot; to initialize a rolling headcount matrix.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="px-6 py-3">Title / Version</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3 text-center">Weeks</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Overall Flow Cost</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {labourFlows.map(lf => (
                    <tr key={lf.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-800">
                        <div className="font-semibold text-slate-900">{lf.title}</div>
                        <div className="text-[10px] text-slate-400">Created {new Date(lf.created_at).toLocaleDateString('en-GB')}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {lf.start_date} → {lf.end_date}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-700">
                        {lf.num_weeks} wks
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          lf.status === 'locked' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {lf.status === 'locked' ? '🔒 Locked' : '✏️ Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {fmt(lf.grand_total_cost)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedFlowId(lf.id)}
                            className="px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium rounded-lg text-xs transition-colors"
                          >
                            Open Grid
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await labourFlowsApi.exportCsv(lf.id);
                              } catch (err: any) {
                                alert(err.message || 'Export failed');
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                            title="Download CSV"
                          >
                            <Download size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteFlow(lf.id, lf.title)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  );
}
