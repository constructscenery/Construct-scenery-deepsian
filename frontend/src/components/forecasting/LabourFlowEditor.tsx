'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Lock, Copy, Download, Printer, Save,
  Calendar, CheckCircle2, AlertCircle, Loader2, Users
} from 'lucide-react';
import {
  labourFlowsApi,
  type LabourFlow,
  type LabourFlowRow,
  type LabourFlowWeek,
} from '@/lib/api';

interface LabourFlowEditorProps {
  flowId: string;
  onBack: () => void;
  onVersionCreated?: (newFlow: LabourFlow) => void;
}

const fmt = (n: number | string | null | undefined) => {
  if (n == null || n === '' || isNaN(Number(n))) return '£0.00';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(Number(n));
};

const SECTION_HEADERS: Record<string, string> = {
  fixed_weekly: 'FIXED WEEKLY COSTS',
  carpenters: 'DEPARTMENT — CARPENTERS',
  painters: 'DEPARTMENT — PAINTERS',
  riggers: 'DEPARTMENT — RIGGERS',
  stagehands: 'DEPARTMENT — STAGEHANDS',
};

export default function LabourFlowEditor({
  flowId,
  onBack,
  onVersionCreated,
}: LabourFlowEditorProps) {
  const [flow, setFlow] = useState<LabourFlow | null>(null);
  const [weeks, setWeeks] = useState<LabourFlowWeek[]>([]);
  const [rows, setRows] = useState<LabourFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await labourFlowsApi.getById(flowId);
      setFlow(data);
      setWeeks(data.weeks || []);
      setRows(data.rows || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load labour flow');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [flowId]);

  const isLocked = flow?.status === 'locked';

  // Update headcount for a cell
  const handleHeadcountChange = (rowId: string, weekNum: number, valStr: string) => {
    const count = valStr === '' ? 0 : parseInt(valStr, 10);
    setRows(prev =>
      prev.map(r => {
        if (r.id !== rowId) return r;
        const headcounts = { ...(r.headcounts || {}) };
        if (valStr === '' || isNaN(count) || count === 0) {
          delete headcounts[weekNum];
        } else {
          headcounts[weekNum] = count;
        }

        // recalculate row units and cost
        let rowUnits = 0;
        weeks.forEach(w => {
          rowUnits += parseInt(String(headcounts[w.weekNumber] || 0), 10);
        });

        const rate = parseFloat(String(r.weekly_rate)) || 0;
        return {
          ...r,
          headcounts,
          row_total_units: rowUnits,
          row_total_cost: Number((rowUnits * rate).toFixed(2)),
        };
      })
    );
  };

  // Compute live department subtotals and week grand totals
  const weekTotals: Record<number, number> = {};
  const departmentSubtotals: Record<string, Record<number, number>> = {
    fixed_weekly: {},
    carpenters: {},
    painters: {},
    riggers: {},
    stagehands: {},
  };

  weeks.forEach(w => {
    weekTotals[w.weekNumber] = 0;
    Object.keys(departmentSubtotals).forEach(sec => {
      departmentSubtotals[sec][w.weekNumber] = 0;
    });
  });

  let grandTotalCost = 0;
  rows.forEach(r => {
    const rate = parseFloat(String(r.weekly_rate)) || 0;
    const headcounts = r.headcounts || {};

    weeks.forEach(w => {
      const count = parseInt(String(headcounts[w.weekNumber] || 0), 10);
      const weekCost = count * rate;
      weekTotals[w.weekNumber] = (weekTotals[w.weekNumber] || 0) + weekCost;
      if (departmentSubtotals[r.section]) {
        departmentSubtotals[r.section][w.weekNumber] =
          (departmentSubtotals[r.section][w.weekNumber] || 0) + weekCost;
      }
    });

    grandTotalCost += parseFloat(String(r.row_total_cost)) || 0;
  });

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await labourFlowsApi.update(flowId, {
        rows: rows.map(r => ({
          id: r.id,
          weekly_rate: parseFloat(String(r.weekly_rate)) || 0,
          headcounts: r.headcounts || {},
        })),
      });
      setFlow(prev => prev ? { ...prev, ...updated } : prev);
      setSuccessMsg('Labour Flow saved successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Lock flow
  const handleLock = async () => {
    if (!confirm(`Are you sure you want to approve and lock "${flow?.title}"?\n\nThis will freeze the current rates snapshot and protect this plan from rate updates.`)) {
      return;
    }
    setLocking(true);
    try {
      const locked = await labourFlowsApi.lock(flowId);
      setFlow(prev => prev ? { ...prev, ...locked } : prev);
      setSuccessMsg('Labour Flow locked successfully. Rates snapshot frozen.');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Lock failed');
    } finally {
      setLocking(false);
    }
  };

  // Version flow
  const handleCreateVersion = async () => {
    setVersioning(true);
    try {
      const newRev = await labourFlowsApi.version(flowId);
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

  // Export CSV
  const handleDownloadCsv = async () => {
    try {
      await labourFlowsApi.exportCsv(flowId);
    } catch (err: any) {
      alert(err.message || 'Export failed');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-3">
        <Loader2 size={30} className="animate-spin text-blue-600" />
        <p className="text-sm text-slate-500 font-medium">Generating dynamic weekly matrix & live rates...</p>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-medium">Labour Flow not found.</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm text-slate-700">Back</button>
      </div>
    );
  }

  const sections = ['fixed_weekly', 'carpenters', 'painters', 'riggers', 'stagehands'];

  return (
    <div className="space-y-6 pb-24">
      {/* Header Card */}
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
                  {flow.production_name}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${isLocked ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-green-100 text-green-800 border border-green-200'}`}>
                  {isLocked ? '🔒 Locked' : '✏️ Draft'}
                </span>
                {flow.version > 1 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">
                    v{flow.version}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-1">{flow.title}</h1>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <Printer size={14} /> Print / PDF
            </button>

            {!isLocked ? (
              <button
                onClick={handleLock}
                disabled={locking}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {locking ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                Lock Plan
              </button>
            ) : (
              <button
                onClick={handleCreateVersion}
                disabled={versioning}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {versioning ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                Create Revision (v{flow.version + 1})
              </button>
            )}
          </div>
        </div>

        {/* Schedule & Metadata Bar */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-400" />
            <span>Schedule: <strong>{flow.start_date}</strong> to <strong>{flow.end_date}</strong> ({flow.num_weeks} weeks)</span>
          </div>
          {isLocked && flow.locked_at && (
            <div className="flex items-center gap-1.5 text-amber-700 font-medium">
              <Lock size={13} />
              <span>Locked on {new Date(flow.locked_at).toLocaleDateString('en-GB')} by {flow.locked_by_name || 'User'}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-slate-600 ml-auto">
            <Users size={13} className="text-slate-400" />
            <span>Total Units: <strong>{rows.reduce((acc, r) => acc + (r.row_total_units || 0), 0)}</strong> crew-weeks</span>
          </div>
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

      {/* MATRIX TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 font-bold uppercase tracking-wider border-b border-slate-200">
                <th className="sticky left-0 z-20 bg-slate-100/90 backdrop-blur-xs px-4 py-3 min-w-[200px] border-r border-slate-200">
                  Dept / Grade
                </th>
                <th className="px-3 py-3 text-right w-28 border-r border-slate-200 bg-slate-50">
                  Weekly Rate
                </th>
                {weeks.map(w => (
                  <th key={w.weekNumber} className="px-2.5 py-2.5 text-center min-w-[76px] border-r border-slate-200 bg-white">
                    <div className="font-bold text-slate-800">{w.label}</div>
                    <div className="text-[10px] text-slate-400 font-normal tracking-normal">{w.subLabel}</div>
                  </th>
                ))}
                <th className="px-3 py-3 text-center w-24 border-r border-slate-200 bg-slate-50 font-bold">
                  Total Units
                </th>
                <th className="sticky right-0 z-20 bg-slate-100/90 backdrop-blur-xs px-4 py-3 text-right min-w-[110px] font-bold">
                  Total (£)
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map(secKey => {
                const sectionRows = rows.filter(r => r.section === secKey);
                if (!sectionRows.length) return null;

                const secSubtotals = departmentSubtotals[secKey] || {};
                const secTotalCost = sectionRows.reduce((acc, r) => acc + (parseFloat(String(r.row_total_cost)) || 0), 0);
                const secTotalUnits = sectionRows.reduce((acc, r) => acc + (r.row_total_units || 0), 0);

                return (
                  <React.Fragment key={secKey}>
                    {/* Section Header */}
                    <tr className="bg-slate-900 text-white font-bold tracking-wide text-[11px]">
                      <td colSpan={weeks.length + 4} className="px-4 py-2">
                        {SECTION_HEADERS[secKey] || secKey}
                      </td>
                    </tr>

                    {/* Section Grade Rows */}
                    {sectionRows.map(row => {
                      const rate = parseFloat(String(row.weekly_rate)) || 0;
                      return (
                        <tr key={row.id} className="hover:bg-slate-50/70 transition-colors border-b border-slate-100">
                          <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-800 border-r border-slate-200">
                            {row.rank === 'HOD' ? `HOD — ${row.trade}` : row.rank}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-600 border-r border-slate-200 bg-slate-50/30">
                            {fmt(rate)}
                          </td>

                          {/* Week Headcount Inputs */}
                          {weeks.map(w => {
                            const count = row.headcounts?.[w.weekNumber];
                            return (
                              <td key={w.weekNumber} className="px-1.5 py-1 text-center border-r border-slate-100">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  disabled={isLocked}
                                  value={count == null || count === 0 ? '' : count}
                                  placeholder="—"
                                  onChange={e => handleHeadcountChange(row.id, w.weekNumber, e.target.value)}
                                  className="w-14 px-1 py-1 text-center font-bold text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400 placeholder:text-slate-300"
                                />
                              </td>
                            );
                          })}

                          <td className="px-3 py-2 text-center font-bold text-slate-800 border-r border-slate-200 bg-slate-50/30">
                            {row.row_total_units || '—'}
                          </td>
                          <td className="sticky right-0 z-10 bg-white px-4 py-2 text-right font-bold text-slate-900">
                            {row.row_total_cost != null ? fmt(row.row_total_cost) : '£ auto'}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Department Subtotal Row */}
                    <tr className="bg-slate-100/90 font-bold text-slate-800 border-b-2 border-slate-300">
                      <td className="sticky left-0 z-10 bg-slate-100 px-4 py-2 text-[11px] uppercase tracking-wider border-r border-slate-200">
                        {SECTION_HEADERS[secKey]?.replace('DEPARTMENT — ', '')} SUB TOTAL
                      </td>
                      <td className="px-3 py-2 border-r border-slate-200 bg-slate-100"></td>
                      {weeks.map(w => (
                        <td key={w.weekNumber} className="px-2 py-2 text-center border-r border-slate-200 text-slate-900 text-[11px]">
                          {secSubtotals[w.weekNumber] != null ? fmt(secSubtotals[w.weekNumber]) : '—'}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center font-bold border-r border-slate-200">
                        {secTotalUnits || '—'}
                      </td>
                      <td className="sticky right-0 z-10 bg-slate-100 px-4 py-2 text-right text-slate-900 font-bold">
                        {fmt(secTotalCost)}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

              {/* GRAND TOTAL ROW */}
              <tr className="bg-blue-900 text-white font-extrabold text-xs sticky bottom-0 z-20 shadow-md">
                <td className="sticky left-0 z-30 bg-blue-900 px-4 py-3 tracking-wider uppercase border-r border-blue-800">
                  GRAND TOTAL PER WEEK
                </td>
                <td className="px-3 py-3 border-r border-blue-800 bg-blue-900"></td>
                {weeks.map(w => (
                  <td key={w.weekNumber} className="px-2 py-3 text-center border-r border-blue-800 text-amber-300 font-extrabold">
                    {weekTotals[w.weekNumber] != null ? fmt(weekTotals[w.weekNumber]) : '—'}
                  </td>
                ))}
                <td className="px-3 py-3 text-center border-r border-blue-800 text-blue-200">
                  {rows.reduce((acc, r) => acc + (r.row_total_units || 0), 0)}
                </td>
                <td className="sticky right-0 z-30 bg-blue-900 px-4 py-3 text-right text-amber-300 font-extrabold text-sm whitespace-nowrap">
                  {fmt(grandTotalCost)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* STICKY BOTTOM ACTION BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-6 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">Total Weeks:</span>{' '}
              <strong className="text-slate-800">{weeks.length} weeks</strong>
            </div>
            <div>
              <span className="text-slate-400">Total Headcount Volume:</span>{' '}
              <strong className="text-slate-800">{rows.reduce((acc, r) => acc + (r.row_total_units || 0), 0)} crew-weeks</strong>
            </div>
            <div className="text-sm font-bold text-slate-900 border-l border-slate-200 pl-6">
              <span>OVERALL LABOUR FLOW COST:</span>{' '}
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
                Save Headcounts
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
