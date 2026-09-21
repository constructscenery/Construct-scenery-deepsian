'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import TopBar from '@/components/TopBar';
import {
  History, Search, Download, RefreshCw, Filter, Calendar,
  Shield, CreditCard, Banknote, HeartPulse, ShieldAlert,
  User, CheckCircle2, ChevronRight, Eye, X, ArrowUpDown,
  FileText, Clock, ExternalLink, RotateCcw
} from 'lucide-react';
import { auditLogApi, AuditLogEntry, AuditSummary, AuditCategory } from '@/lib/api';
import { EmptyStateRow } from '@/components/EmptyState';

const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; bg: string; text: string; border: string }
> = {
  all: { label: 'All Categories', icon: History, bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
  financial: { label: 'Financial', icon: CreditCard, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  payroll: { label: 'Payroll', icon: Banknote, bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  rate_card: { label: 'Rate Cards', icon: ArrowUpDown, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  safety_document: { label: 'Safety Documents', icon: HeartPulse, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  role: { label: 'Role & User Changes', icon: Shield, bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  general: { label: 'General System', icon: History, bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
};

const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Selected entry for Version / Diff Inspector modal
  const [inspectEntry, setInspectEntry] = useState<AuditLogEntry | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedCategory !== 'all') params.category = selectedCategory;
      if (search.trim()) params.search = search.trim();
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const [logRes, sumRes] = await Promise.all([
        auditLogApi.getAll(params),
        auditLogApi.getSummary().catch(() => ({ summary: null })),
      ]);

      setLogs(logRes.logs || []);
      setTotal(logRes.total || 0);
      if (sumRes?.summary) setSummary(sumRes.summary);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, search, dateFrom, dateTo]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleClearFilters = () => {
    setSelectedCategory('all');
    setSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const handleExportCsv = () => {
    const params: Record<string, string> = {};
    if (selectedCategory !== 'all') params.category = selectedCategory;
    if (search.trim()) params.search = search.trim();
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    const url = auditLogApi.exportCsvUrl(params);
    window.open(url, '_blank');
  };

  const renderCategoryBadge = (cat: AuditCategory) => {
    const cfg = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.general;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
        <Icon size={12} />
        <span>{cfg.label}</span>
      </span>
    );
  };

  const formatRoleLabel = (role: string) => {
    if (role === 'managing_director') return 'Director';
    if (role === 'construction_accountant') return 'Accountant';
    if (role === 'construction_coordinator') return 'Coordinator';
    if (role === 'guest') return 'Guest';
    return role || 'System';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <TopBar title="Audit Log & History" />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header Title Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-sm">
                <History size={22} />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Audit Trail & Version History</h1>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Read-only system history tracking changes across financial records, payroll, rate cards, safety documents, and user roles.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition-all shadow-sm"
              title="Download CSV report of audit records"
            >
              <Download size={14} className="text-slate-500" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={loadLogs}
              disabled={loading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh Log</span>
            </button>
          </div>
        </div>

        {/* Top KPI Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Events</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.total ?? total}</span>
              <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                <History size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">Recorded audit events</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">Financial</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.financial ?? 0}</span>
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                <CreditCard size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">POs, Invoices, Margins</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider">Payroll</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.payroll ?? 0}</span>
              <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg border border-purple-100">
                <Banknote size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">Pay runs & timesheets</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">Rate Cards</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.rate_card ?? 0}</span>
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-100">
                <ArrowUpDown size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">BECTU & trade uplifts</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">Safety Docs</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.safety_document ?? 0}</span>
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                <HeartPulse size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">RAMS, COSHH & policies</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider">Roles & Users</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.role ?? 0}</span>
              <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg border border-rose-100">
                <Shield size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">Role & access changes</span>
          </div>
        </div>

        {/* Category Pills Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
            if (key === 'general') return null;
            const active = selectedCategory === key;
            const Icon = cfg.icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedCategory(key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} className={active ? 'text-white' : 'text-slate-400'} />
                <span>{cfg.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search and Date Filter Bar */}
        <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm items-center">
          <div className="relative flex-1 w-full">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search event details, actor name, action code, PO or record ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2.5 flex-wrap w-full md:w-auto items-center">
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
              <Calendar size={13} className="text-slate-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none text-xs"
                placeholder="From"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none text-xs"
                placeholder="To"
              />
            </div>

            {(selectedCategory !== 'all' || search || dateFrom || dateTo) && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                title="Reset filters"
              >
                <RotateCcw size={12} />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Audit Log Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3.5">Timestamp</th>
                  <th className="px-4 py-3.5">Category</th>
                  <th className="px-4 py-3.5">Action & Description</th>
                  <th className="px-4 py-3.5">Target Entity</th>
                  <th className="px-4 py-3.5">Changed By</th>
                  <th className="px-4 py-3.5 text-right">Details / Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-blue-600" />
                      <p className="font-semibold text-slate-700 text-sm">Loading audit events...</p>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <EmptyStateRow
                    colSpan={6}
                    icon={History}
                    title="No audit records found"
                    description="No audit trail events match your active filters or category selection."
                    recommendation="Adjust your date filters or clear the search query to view complete system history."
                    action={{
                      label: 'Clear Filters',
                      onClick: handleClearFilters,
                      icon: RotateCcw,
                    }}
                  />
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Timestamp */}
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5 text-slate-800 font-medium">
                          <Clock size={12} className="text-slate-400" />
                          <span>{fmtDateTime(log.created_at)}</span>
                        </div>
                        {log.production_name && (
                          <div className="text-[10px] text-blue-600 font-sans mt-0.5">
                            Prod: {log.production_name}
                          </div>
                        )}
                      </td>

                      {/* Category Badge */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {renderCategoryBadge(log.category)}
                      </td>

                      {/* Action & Description */}
                      <td className="px-4 py-3 max-w-md">
                        <div className="font-semibold text-slate-900 text-xs">
                          {log.details || log.action}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          action: {log.action}
                        </div>
                      </td>

                      {/* Target Entity */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.entity_id ? (
                          <div className="font-mono text-slate-800 font-semibold text-xs bg-slate-100 px-2 py-0.5 rounded inline-block border border-slate-200">
                            {log.entity_id}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                        {log.entity_type && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {log.entity_type}
                          </div>
                        )}
                      </td>

                      {/* Changed By */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                            {log.user_name ? log.user_name.charAt(0).toUpperCase() : 'S'}
                          </div>
                          <div>
                            <div className="font-medium text-slate-800 text-xs">{log.user_name}</div>
                            <span className="inline-block text-[10px] text-slate-500">
                              {formatRoleLabel(log.user_role)}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Details / Version */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {log.metadata && Object.keys(log.metadata).length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setInspectEntry(log)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 transition-colors border border-slate-200"
                          >
                            <Eye size={13} />
                            <span>Inspect Diff</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── MODAL: VERSION & METADATA DIFF INSPECTOR ───────────────────────── */}
        {inspectEntry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <History size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Audit Event Metadata & Diff</h2>
                    <p className="text-xs text-slate-500 font-mono">{inspectEntry.action} • {fmtDateTime(inspectEntry.created_at)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectEntry(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                {/* Event Summary Card */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    {renderCategoryBadge(inspectEntry.category)}
                    <span className="text-xs font-mono text-slate-500">ID: {inspectEntry.id}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{inspectEntry.details || inspectEntry.action}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-2 border-t border-slate-200">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Actor</span>
                      <strong className="text-slate-800">{inspectEntry.user_name} ({formatRoleLabel(inspectEntry.user_role)})</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Entity</span>
                      <strong className="text-slate-800 font-mono">{inspectEntry.entity_id || '—'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Production</span>
                      <strong className="text-slate-800">{inspectEntry.production_name || 'Global'}</strong>
                    </div>
                  </div>
                </div>

                {/* Diff Comparison View (if previous vs updated exists) */}
                {inspectEntry.metadata && inspectEntry.metadata.previous && inspectEntry.metadata.updated && (
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Version Comparison (Before vs After)</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-3.5">
                        <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wide block mb-1.5">Previous Version</span>
                        <pre className="text-xs font-mono text-rose-950 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(inspectEntry.metadata.previous, null, 2)}
                        </pre>
                      </div>
                      <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5">
                        <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide block mb-1.5">Updated Version</span>
                        <pre className="text-xs font-mono text-emerald-950 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(inspectEntry.metadata.updated, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}

                {/* Raw Metadata Payload */}
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Recorded Event Payload (JSON)</h3>
                  <div className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto border border-slate-800">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(inspectEntry.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end px-6 py-3 border-t border-slate-100 bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => setInspectEntry(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
