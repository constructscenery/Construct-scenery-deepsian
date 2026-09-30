'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Lock, Unlock, Copy, Printer, Save, Plus, Trash2,
  Calendar, CheckCircle2, AlertCircle, Loader2, Sparkles, X
} from 'lucide-react';
import {
  costForecastsApi,
  type CostForecast,
  type CostForecastCrewLine,
  type CostForecastNonLabourLine,
} from '@/lib/api';

interface CostForecastEditorProps {
  forecastId: string;
  onBack: () => void;
  onVersionCreated?: (newForecast: CostForecast) => void;
}

const fmt = (n: number | string | null | undefined) => {
  if (n == null || n === '' || isNaN(Number(n))) return '£0.00';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(Number(n));
};

const SECTION_HEADERS: Record<string, string> = {
  fixed_weekly: 'FIXED WEEKLY COSTS — linked from BECTU / Crew Rate Card',
  carpenters: 'DEPARTMENT — CARPENTERS — linked from BECTU Rate Card',
  painters: 'DEPARTMENT — PAINTERS — linked from BECTU Rate Card',
  riggers: 'DEPARTMENT — RIGGERS — linked from BECTU Rate Card',
  stagehands: 'DEPARTMENT — STAGEHANDS — linked from BECTU Rate Card',
};

export default function CostForecastEditor({
  forecastId,
  onBack,
  onVersionCreated,
}: CostForecastEditorProps) {
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [crewLines, setCrewLines] = useState<CostForecastCrewLine[]>([]);
  const [nonLabourLines, setNonLabourLines] = useState<CostForecastNonLabourLine[]>([]);
  const [viewMode, setViewMode] = useState<'weekly' | 'daily'>('weekly');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add custom line modal state
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customDesc, setCustomDesc] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [customRate, setCustomRate] = useState('');
  const [customQty, setCustomQty] = useState('1');
  const [customUnitType, setCustomUnitType] = useState('lump_sum');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await costForecastsApi.getById(forecastId);
      setForecast(data);
      setCrewLines(data.crew_lines || []);
      setNonLabourLines(data.non_labour_lines || []);
      setViewMode(data.default_view || 'weekly');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load forecast');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [forecastId]);

  const isLocked = forecast?.status === 'locked';

  // Toggle View Mode (Daily vs Weekly)
  const handleToggleView = (mode: 'weekly' | 'daily') => {
    if (mode === viewMode) return;
    setViewMode(mode);

    // Adjust crew line unit rates if factor of 5 applies
    setCrewLines(prev =>
      prev.map(line => {
        const currentRate = parseFloat(String(line.unit_rate)) || 0;
        const newRate = mode === 'daily'
          ? (line.rate_unit === 'weekly' ? Number((currentRate / 5).toFixed(2)) : currentRate)
          : (line.rate_unit === 'daily' ? Number((currentRate * 5).toFixed(2)) : currentRate);

        const units = parseFloat(String(line.units)) || 0;
        return {
          ...line,
          rate_unit: mode,
          unit_rate: newRate,
          line_total: Number((units * newRate).toFixed(2)),
        };
      })
    );
  };

  // Update crew line units
  const handleCrewUnitsChange = (lineId: string, valStr: string) => {
    const units = valStr === '' ? 0 : parseFloat(valStr);
    setCrewLines(prev =>
      prev.map(l => {
        if (l.id !== lineId) return l;
        const rate = parseFloat(String(l.unit_rate)) || 0;
        return {
          ...l,
          units: valStr,
          line_total: Number(((isNaN(units) ? 0 : units) * rate).toFixed(2)),
        };
      })
    );
  };

  // Update non-labour line quantity or rate
  const handleNonLabourChange = (lineId: string, field: 'quantity' | 'unit_rate', valStr: string) => {
    setNonLabourLines(prev =>
      prev.map(l => {
        if (l.id !== lineId) return l;
        const qty = field === 'quantity' ? (valStr === '' ? 0 : parseFloat(valStr)) : (parseFloat(String(l.quantity)) || 0);
        const rate = field === 'unit_rate' ? (valStr === '' ? 0 : parseFloat(valStr)) : (parseFloat(String(l.unit_rate)) || 0);
        return {
          ...l,
          [field]: valStr,
          line_total: Number(((isNaN(qty) ? 0 : qty) * (isNaN(rate) ? 0 : rate)).toFixed(2)),
        };
      })
    );
  };

  // Remove non-labour custom line
  const handleRemoveNonLabourLine = (lineId: string) => {
    setNonLabourLines(prev => prev.filter(l => l.id !== lineId));
  };

  // Add custom line
  const handleAddCustomLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDesc.trim()) return;

    const rate = parseFloat(customRate) || 0;
    const qty = parseFloat(customQty) || 1;
    const newLine: CostForecastNonLabourLine = {
      id: `temp-${Date.now()}`,
      cost_forecast_id: forecastId,
      category: 'custom',
      cost_code: customCode.trim() || '599',
      description: customDesc.trim(),
      unit_rate: rate,
      quantity: qty,
      unit_type: customUnitType,
      line_total: Number((rate * qty).toFixed(2)),
      is_custom: true,
      sort_order: nonLabourLines.length + 1,
    };

    setNonLabourLines(prev => [...prev, newLine]);
    setCustomDesc('');
    setCustomCode('');
    setCustomRate('');
    setCustomQty('1');
    setShowAddCustom(false);
  };

  // Live Totals Calculation
  const totalCrewCost = crewLines.reduce((acc, l) => acc + (parseFloat(String(l.line_total)) || 0), 0);
  const totalNonLabourCost = nonLabourLines.reduce((acc, l) => acc + (parseFloat(String(l.line_total)) || 0), 0);
  const grandTotalCost = totalCrewCost + totalNonLabourCost;

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await costForecastsApi.update(forecastId, {
        default_view: viewMode,
        crew_lines: crewLines,
        non_labour_lines: nonLabourLines,
      });
      setForecast(prev => prev ? { ...prev, ...updated } : prev);
      setSuccessMsg('Changes saved successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Lock forecast
  const handleLock = async () => {
    if (!confirm(`Are you sure you want to approve and lock "${forecast?.title}"?\n\nThis will freeze all rate snapshots and protect it from automatic rate updates.`)) {
      return;
    }
    setLocking(true);
    try {
      const locked = await costForecastsApi.lock(forecastId);
      setForecast(prev => prev ? { ...prev, ...locked } : prev);
      setSuccessMsg('Cost Forecast has been locked and rates are frozen.');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Lock failed');
    } finally {
      setLocking(false);
    }
  };

  // Version revision from locked
  const handleCreateVersion = async () => {
    setVersioning(true);
    try {
      const newRev = await costForecastsApi.version(forecastId);
      if (onVersionCreated) {
        onVersionCreated(newRev);
      } else {
        alert(`Created revision: ${newRev.title}`);
        window.location.reload();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create revision');
    } finally {
      setVersioning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-3">
        <Loader2 size={30} className="animate-spin text-blue-600" />
        <p className="text-sm text-slate-500 font-medium">Loading cost plan & live rates...</p>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-medium">Cost Forecast not found.</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm text-slate-700">Back</button>
      </div>
    );
  }

  // Group crew lines by section
  const sections = ['fixed_weekly', 'carpenters', 'painters', 'riggers', 'stagehands'];

  return (
    <div className="space-y-6 pb-24">
      {/* Top Navigation & Status Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              title="Return"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                  {forecast.production_name}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${isLocked ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-green-100 text-green-800 border border-green-200'}`}>
                  {isLocked ? '🔒 Locked' : '✏️ Draft'}
                </span>
                {forecast.version > 1 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">
                    v{forecast.version}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-1">{forecast.title}</h1>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => handleToggleView('weekly')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${viewMode === 'weekly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Weekly View
              </button>
              <button
                type="button"
                onClick={() => handleToggleView('daily')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${viewMode === 'daily' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Daily View
              </button>
            </div>

            {/* Print / Export */}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-700 text-xs font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Printer size={14} /> Print / PDF
            </button>

            {/* Lock / Revise button */}
            {!isLocked ? (
              <button
                onClick={handleLock}
                disabled={locking}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {locking ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                Lock & Freeze Rates
              </button>
            ) : (
              <button
                onClick={handleCreateVersion}
                disabled={versioning}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {versioning ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                Create Revision (v{forecast.version + 1})
              </button>
            )}
          </div>
        </div>

        {/* Schedule & Metadata Bar */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-400" />
            <span>Dates: <strong>{forecast.start_date}</strong> to <strong>{forecast.end_date}</strong></span>
          </div>
          {isLocked && forecast.locked_at && (
            <div className="flex items-center gap-1.5 text-amber-700 font-medium">
              <Lock size={13} />
              <span>Locked on {new Date(forecast.locked_at).toLocaleDateString('en-GB')} by {forecast.locked_by_name || 'User'}</span>
            </div>
          )}
          {forecast.notes && (
            <div className="italic text-slate-400 max-w-md truncate">
              Notes: {forecast.notes}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-700 text-xs rounded-xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 size={15} className="flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* SECTION 1: CREW COSTS (LINKED TO RATE CARD) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">1. Crew Costs (Linked from BECTU Rate Card)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Rates dynamically pulled from active BECTU agreement. Enter required crew units.</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg">
            Subtotal: {fmt(totalCrewCost)}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <th className="px-5 py-3 w-24">Cost Code</th>
                <th className="px-4 py-3">Description / Grade</th>
                <th className="px-4 py-3 text-right">Unit Rate ({viewMode === 'daily' ? 'Daily' : 'Weekly'})</th>
                <th className="px-4 py-3 text-center w-32">No. of Units</th>
                <th className="px-4 py-3 text-center w-24">Period</th>
                <th className="px-5 py-3 text-right">Total (£)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sections.map(secKey => {
                const sectionLines = crewLines.filter(l => l.section === secKey);
                if (!sectionLines.length) return null;

                return (
                  <React.Fragment key={secKey}>
                    <tr className="bg-slate-100/70 border-t border-b border-slate-200">
                      <td colSpan={6} className="px-5 py-2 text-xs font-bold text-slate-700 uppercase tracking-wide">
                        {SECTION_HEADERS[secKey] || secKey}
                      </td>
                    </tr>
                    {sectionLines.map(line => {
                      const units = parseFloat(String(line.units)) || 0;
                      return (
                        <tr key={line.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{line.cost_code || '—'}</td>
                          <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                            {line.rank === 'HOD' ? `HOD — ${line.trade}` : line.rank}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-right font-medium text-slate-600">
                            {fmt(line.unit_rate)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={isLocked}
                              value={line.units === 0 ? '' : line.units}
                              placeholder="0"
                              onChange={e => handleCrewUnitsChange(line.id, e.target.value)}
                              className="w-20 px-2 py-1 text-center font-medium text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs text-slate-500 capitalize">
                            {viewMode}
                          </td>
                          <td className="px-5 py-2.5 text-right text-xs font-semibold text-slate-900">
                            {fmt(line.line_total)}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: ABOVE THE LINE & NON-LABOUR COSTS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">2. Above-the-Line & Non-Labour Costs</h2>
            <p className="text-xs text-slate-500 mt-0.5">Plant hire, workshop, skips, fuel, standby crew, materials, and custom cost lines.</p>
          </div>
          <div className="flex items-center gap-3">
            {!isLocked && (
              <button
                type="button"
                onClick={() => setShowAddCustom(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
              >
                <Plus size={13} /> Add Custom Line
              </button>
            )}
            <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg">
              Subtotal: {fmt(totalNonLabourCost)}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <th className="px-5 py-3 w-24">Cost Code</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Unit Rate (£)</th>
                <th className="px-4 py-3 text-center w-28">Quantity</th>
                <th className="px-4 py-3 text-center w-28">Unit Type</th>
                <th className="px-5 py-3 text-right">Total (£)</th>
                {!isLocked && <th className="px-4 py-3 w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {nonLabourLines.map(nl => (
                <tr key={nl.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{nl.cost_code || '—'}</td>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                    {nl.description}
                    {nl.is_custom && <span className="ml-2 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">custom</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={isLocked}
                      value={nl.unit_rate}
                      onChange={e => handleNonLabourChange(nl.id, 'unit_rate', e.target.value)}
                      className="w-24 px-2 py-1 text-right text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      disabled={isLocked}
                      value={nl.quantity}
                      onChange={e => handleNonLabourChange(nl.id, 'quantity', e.target.value)}
                      className="w-20 px-2 py-1 text-center text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-slate-500 capitalize">
                    {nl.unit_type || 'weekly'}
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs font-semibold text-slate-900">
                    {fmt(nl.line_total)}
                  </td>
                  {!isLocked && (
                    <td className="px-4 py-2 text-center">
                      {nl.is_custom && (
                        <button
                          type="button"
                          onClick={() => handleRemoveNonLabourLine(nl.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                          title="Remove line"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Custom Line Modal */}
      {showAddCustom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Add Custom Non-Labour Cost</h3>
              <button onClick={() => setShowAddCustom(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleAddCustomLine} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Courier & Freight, Extra Scaffolding"
                  value={customDesc}
                  onChange={e => setCustomDesc(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Code</label>
                  <input
                    type="text"
                    placeholder="599"
                    value={customCode}
                    onChange={e => setCustomCode(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Unit Type</label>
                  <select
                    value={customUnitType}
                    onChange={e => setCustomUnitType(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily</option>
                    <option value="item">Per Item</option>
                    <option value="lump_sum">Lump Sum</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Unit Rate (£) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={customRate}
                    onChange={e => setCustomRate(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={customQty}
                    onChange={e => setCustomQty(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddCustom(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STICKY BOTTOM SUMMARY BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-6 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">Labour Total:</span>{' '}
              <strong className="text-slate-800">{fmt(totalCrewCost)}</strong>
            </div>
            <div>
              <span className="text-slate-400">Non-Labour Total:</span>{' '}
              <strong className="text-slate-800">{fmt(totalNonLabourCost)}</strong>
            </div>
            <div className="text-sm font-bold text-slate-900 border-l border-slate-200 pl-6">
              <span>TOTAL FORECAST COST:</span>{' '}
              <span className="text-blue-600 ml-1.5">{fmt(grandTotalCost)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isLocked && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
