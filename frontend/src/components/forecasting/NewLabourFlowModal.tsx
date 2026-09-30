'use client';

import React, { useState } from 'react';
import { X, Loader2, Calendar, CheckCircle2 } from 'lucide-react';
import { labourFlowsApi, type Production, type LabourFlow } from '@/lib/api';

interface NewLabourFlowModalProps {
  productions: Production[];
  defaultProductionId?: string;
  onClose: () => void;
  onCreated: (flow: LabourFlow) => void;
}

export default function NewLabourFlowModal({
  productions,
  defaultProductionId,
  onClose,
  onCreated,
}: NewLabourFlowModalProps) {
  const [productionId, setProductionId] = useState(defaultProductionId || (productions[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Calculate weeks summary (UTC-safe — avoids timezone off-by-one)
  const calculateWeeksCount = () => {
    if (!startDate || !endDate) return null;
    // Parse YYYY-MM-DD as UTC midnight to avoid local-timezone day shifts
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const start = new Date(Date.UTC(sy, sm - 1, sd));
    const end   = new Date(Date.UTC(ey, em - 1, ed));
    if (end < start) return null;

    // Align start to Monday (UTC)
    const day = start.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const firstMonday = new Date(start.getTime());
    firstMonday.setUTCDate(start.getUTCDate() + diffToMonday);

    let count = 0;
    const curr = new Date(firstMonday.getTime());
    while (curr.getTime() <= end.getTime() || count === 0) {
      count++;
      curr.setUTCDate(curr.getUTCDate() + 7);
    }
    return count;
  };

  const weekCount = calculateWeeksCount();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productionId) { setError('Please select a production'); return; }
    if (!title.trim()) { setError('Title is required'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required'); return; }
    if (new Date(endDate) < new Date(startDate)) { setError('End date must be after start date'); return; }

    setLoading(true);
    setError('');
    try {
      const created = await labourFlowsApi.create({
        production_id: productionId,
        title: title.trim(),
        start_date: startDate,
        end_date: endDate,
      });
      onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create labour flow');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Weekly Labour Flow</h2>
            <p className="text-xs text-slate-500 mt-0.5">Plan department crew headcount week by week</p>
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

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Labour Flow Title *</label>
            <input
              type="text"
              placeholder="e.g. Master Weekly Labour Flow — Main Stage Build"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date (Monday) *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End Date (Sunday) *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {weekCount != null && weekCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 font-medium">
              <Calendar size={14} className="flex-shrink-0" />
              <span>Calculated Schedule: <strong>{weekCount} weekly column{weekCount === 1 ? '' : 's'}</strong> will be created</span>
            </div>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
            💡 <strong>How it works:</strong> The tool automatically creates column headers (e.g. <em>Week 1 w/e 11.10.26</em>) across Fixed Weekly, Carpenters, Painters, Riggers, and Stagehands. Entering whole-number headcounts instantly calculates weekly & department totals based on live BECTU rates.
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
              Initialize Grid
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
