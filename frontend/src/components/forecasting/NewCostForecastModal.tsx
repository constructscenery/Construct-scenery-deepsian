'use client';

import React, { useState } from 'react';
import { X, Loader2, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { costForecastsApi, type Production, type CostForecast } from '@/lib/api';

interface NewCostForecastModalProps {
  productions: Production[];
  defaultProductionId?: string;
  onClose: () => void;
  onCreated: (forecast: CostForecast) => void;
}

export default function NewCostForecastModal({
  productions,
  defaultProductionId,
  onClose,
  onCreated,
}: NewCostForecastModalProps) {
  const [productionId, setProductionId] = useState(defaultProductionId || (productions[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [defaultView, setDefaultView] = useState<'weekly' | 'daily'>('weekly');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const calculateDuration = () => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();
    if (diffTime < 0) return 'End date must be after start date';
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const weeks = (diffDays / 7).toFixed(1);
    return `${diffDays} days (${weeks} weeks)`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productionId) { setError('Please select a production'); return; }
    if (!title.trim()) { setError('Title is required'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required'); return; }
    if (new Date(endDate) < new Date(startDate)) { setError('End date cannot precede start date'); return; }

    setLoading(true);
    setError('');
    try {
      const created = await costForecastsApi.create({
        production_id: productionId,
        title: title.trim(),
        start_date: startDate,
        end_date: endDate,
        default_view: defaultView,
        notes: notes.trim() || undefined,
      });
      onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create cost forecast');
    } finally {
      setLoading(false);
    }
  };

  const duration = calculateDuration();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Cost Forecast</h2>
            <p className="text-xs text-slate-500 mt-0.5">Build a full production cost estimate with live BECTU rates</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
              {error}
            </div>
          )}

          {/* Production Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Production *</label>
            <select
              value={productionId}
              onChange={e => setProductionId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="" disabled>Select production...</option>
              {productions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.production_code ? `(${p.production_code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Forecast Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Forecast Title *</label>
            <input
              type="text"
              placeholder="e.g. Initial Budget Estimate, Revised Set Build Plan"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End Date *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {duration && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 font-medium">
              <Calendar size={14} className="flex-shrink-0" />
              <span>Duration: {duration}</span>
            </div>
          )}

          {/* Default View Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Default Calculation View</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDefaultView('weekly')}
                className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-all ${defaultView === 'weekly' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
              >
                Weekly View (Standard)
              </button>
              <button
                type="button"
                onClick={() => setDefaultView('daily')}
                className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-all ${defaultView === 'daily' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
              >
                Daily View
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">You can freely toggle between daily and weekly view later without losing data.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Scope (Optional)</label>
            <textarea
              rows={2}
              placeholder="Add assumptions, sets in scope, or contingency notes..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Generate Forecast
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
