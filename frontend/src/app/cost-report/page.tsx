'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import TopBar from '@/components/TopBar';
import {
  Download, ChevronDown, ChevronRight, TrendingUp, TrendingDown,
  Plus, X, Loader2, SlidersHorizontal,
} from 'lucide-react';
import {
  productionsApi, costReportApi, costReportExtApi,
  type Production, type CostReport,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import RequireRole from '@/components/RequireRole';
import CostReportType2, { type Type2Report } from './CostReportType2';

const fmtGBP = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm animate-pulse">
      <div className="h-3 w-24 bg-slate-100 rounded mb-2" />
      <div className="h-6 w-20 bg-slate-100 rounded mb-1" />
      <div className="h-2.5 w-16 bg-slate-100 rounded" />
    </div>
  );
}

interface AddInvoiceFormProps {
  productionId: string;
  onClose: () => void;
  onSaved: () => void;
}

function AddInvoiceForm({ productionId, onClose, onSaved }: AddInvoiceFormProps) {
  const [form, setForm] = useState({
    invoice_description: '',
    po_number: '',
    date: '',
    invoice_number: '',
    amount: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      setError('A valid amount is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await costReportApi.addInvoice(productionId, {
        invoice_description: form.invoice_description || undefined,
        po_number: form.po_number || undefined,
        date: form.date || undefined,
        invoice_number: form.invoice_number || undefined,
        amount: amt,
        notes: form.notes || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add invoice');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-base">Add Invoice to Production</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <input className={inputCls} placeholder="e.g. Phase 2 — Main sets deposit" value={form.invoice_description} onChange={set('invoice_description')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">PO Number</label>
              <input className={inputCls} placeholder="e.g. PO-2026-0104" value={form.po_number} onChange={set('po_number')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Invoice Number</label>
              <input className={inputCls} placeholder="e.g. CSL-0048" value={form.invoice_number} onChange={set('invoice_number')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input type="date" className={inputCls} value={form.date} onChange={set('date')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount (£) *</label>
              <input type="number" step="0.01" min="0.01" className={inputCls} placeholder="0.00" value={form.amount} onChange={set('amount')} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea className={`${inputCls} resize-none`} rows={2} placeholder="e.g. Approved" value={form.notes} onChange={set('notes')} />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Add Invoice
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CostReportPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator']}>
      <CostReportContent />
    </RequireRole>
  );
}

function CostReportContent() {
  const { user } = useAuth();
  const canAddInvoice = true;

  const [productions, setProductions] = useState<Production[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [asAtDate, setAsAtDate] = useState('');
  const [report, setReport] = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [type2Report, setType2Report] = useState<Type2Report | null>(null);

  // Client-side filter state for cost report detail tables
  const [costType, setCostType] = useState<'all' | 'supplier' | 'labour'>('all');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [setCodeFilter, setSetCodeFilter] = useState('');
  const [tradeFilter, setTradeFilter] = useState('');
  const [crewSearch, setCrewSearch] = useState('');
  const [weekFrom, setWeekFrom] = useState('');
  const [weekTo, setWeekTo] = useState('');
  const [showCostFilters, setShowCostFilters] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    productionsApi.list().then(data => {
      setProductions(data);
      if (data.length > 0) setSelectedId(data[0].id);
    }).catch(() => {});
  }, []);

  const loadReport = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    const isCP = productions.find(p => p.id === selectedId)?.contract_type === 'cost_plus';
    try {
      if (isCP) {
        const data = await costReportExtApi.getType2(selectedId, asAtDate ? { as_at_date: asAtDate } : undefined);
        setType2Report(data as Type2Report);
        setReport(null);
      } else {
        const data = await costReportApi.get(selectedId, asAtDate || undefined);
        setReport(data);
        setType2Report(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load cost report');
    } finally {
      setLoading(false);
    }
  }, [selectedId, asAtDate, productions]);

  useEffect(() => {
    if (selectedId) loadReport();
  }, [selectedId, loadReport]);

  const toggleWeek = (weekEnding: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekEnding)) next.delete(weekEnding);
      else next.add(weekEnding);
      return next;
    });
  };

  const exportPDF = async () => {
    if (!report || !selectedId) return;
    const params: Record<string, string> = {};
    if (asAtDate) params.as_at = asAtDate;
    const res = await costReportApi.exportPDF(selectedId, params);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-report-${selectedId}-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (!report) return;
    const header = ['Date', 'Supplier', 'Set/Account', 'Description', 'Ex VAT', 'VAT', 'Total', 'Method'];
    const rows = report.supplier_costs.map(r => [
      r.date,
      `"${r.supplier}"`,
      r.set_code ?? r.account_code ?? '',
      `"${r.description ?? ''}"`,
      r.cost_ex_vat.toFixed(2),
      r.vat.toFixed(2),
      r.total.toFixed(2),
      r.purchase_method,
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-report-${selectedId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isCostPlus = productions.find(p => p.id === selectedId)?.contract_type === 'cost_plus';

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportType2CSV = async (costType: 'labour' | 'supplier') => {
    if (!type2Report || !selectedId) return;
    setExportError('');
    try {
      const params: Record<string, string> = { report_type: 'cost_plus', cost_type: costType };
      if (asAtDate) params.as_at_date = asAtDate;
      const res = await costReportExtApi.exportCSV(selectedId, params);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        setExportError(body.error || `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const suffix = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `${costType}-costs-cost-plus-${suffix}.csv`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const exportType2PDF = async () => {
    if (!type2Report || !selectedId) return;
    const params: Record<string, string> = { report_type: 'cost_plus' };
    if (asAtDate) params.as_at_date = asAtDate;
    const res = await costReportExtApi.exportPDF(selectedId, params);
    if (!res.ok) return;
    const blob = await res.blob();
    triggerDownload(blob, `cost-report-cost-plus-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const m = report?.metrics;
  const profitIsPositive = m ? m.current_profit >= 0 : true;
  const totalCosts = m?.total_costs_to_date ?? 0;
  const totalInvoiced = m?.total_invoiced_to_production ?? 0;
  const progressPct = totalInvoiced > 0 ? Math.min(100, (totalCosts / totalInvoiced) * 100) : 0;

  // Filtered supplier costs
  const filteredSupplierCosts = (report?.supplier_costs ?? []).filter(r => {
    if (supplierSearch && !r.supplier.toLowerCase().includes(supplierSearch.toLowerCase())) return false;
    if (setCodeFilter) {
      const code = setCodeFilter.toLowerCase();
      if (!(r.set_code ?? '').toLowerCase().includes(code) && !(r.account_code ?? '').toLowerCase().includes(code)) return false;
    }
    return true;
  });

  // Filtered labour weeks + crew
  const availableTrades = Array.from(new Set(
    (report?.labour_weekly ?? []).flatMap(w => w.crew.map(c => c.trade)).filter(Boolean)
  )) as string[];

  const filteredLabour = (report?.labour_weekly ?? []).map(week => {
    const filteredCrew = week.crew.filter(c => {
      if (tradeFilter && c.trade !== tradeFilter) return false;
      if (crewSearch && !c.name.toLowerCase().includes(crewSearch.toLowerCase())) return false;
      return true;
    });
    return { ...week, crew: filteredCrew };
  }).filter(week => {
    if (weekFrom && week.week_ending_date < weekFrom) return false;
    if (weekTo   && week.week_ending_date > weekTo)   return false;
    if (tradeFilter || crewSearch) return week.crew.length > 0;
    return true;
  });

  let labourRunning = 0;
  const labourWithRunning = filteredLabour.map(w => {
    labourRunning += w.total;
    return { ...w, running: labourRunning };
  });

  const supplierTotal = filteredSupplierCosts.reduce((s, r) => s + r.total, 0);
  const supplierExVatTotal = filteredSupplierCosts.reduce((s, r) => s + r.cost_ex_vat, 0);
  const supplierVatTotal = filteredSupplierCosts.reduce((s, r) => s + r.vat, 0);
  const invoiceTotal = report?.invoices_to_production.reduce((s, r) => s + parseFloat(r.amount), 0) ?? 0;

  const activeCostFilterCount = [supplierSearch, setCodeFilter, tradeFilter, crewSearch, weekFrom, weekTo].filter(Boolean).length + (costType !== 'all' ? 1 : 0);

  return (
    <>
      {showInvoiceModal && selectedId && (
        <AddInvoiceForm
          productionId={selectedId}
          onClose={() => setShowInvoiceModal(false)}
          onSaved={() => { setShowInvoiceModal(false); loadReport(); }}
        />
      )}

      <TopBar title="Cost Report" subtitle="Live financial reporting across all active productions" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Controls bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-4 py-2.5 shadow-sm">
            <span className="text-slate-500 text-sm">Production:</span>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="text-slate-900 font-semibold text-sm bg-transparent outline-none cursor-pointer"
            >
              {productions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {selectedId && (
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm text-sm text-slate-600">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isCostPlus ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                {isCostPlus ? 'Cost Plus' : 'On a Price'}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className="flex items-center gap-2 text-slate-600 text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 hover:bg-slate-50 shadow-sm"
              >
                As at: <span className="font-semibold text-slate-900">{asAtDate ? fmtDate(asAtDate) : 'Today'}</span>
                <ChevronDown size={14} />
              </button>
              {showDatePicker && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-20 space-y-2 min-w-max">
                  <input
                    type="date"
                    value={asAtDate}
                    onChange={e => { setAsAtDate(e.target.value); setShowDatePicker(false); loadReport(); }}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => { setAsAtDate(''); setShowDatePicker(false); loadReport(); }}
                    className="block w-full text-left text-xs text-slate-500 hover:text-blue-600 px-1"
                  >
                    Clear (use today)
                  </button>
                </div>
              )}
            </div>
            {!isCostPlus && (
            <button
              onClick={exportCSV}
              disabled={!report}
              className="flex items-center gap-2 text-slate-600 text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 hover:bg-slate-50 shadow-sm disabled:opacity-50"
            >
              <Download size={14} /> Export CSV
            </button>
            )}
            {!isCostPlus && (
            <button
              onClick={exportPDF}
              disabled={!report}
              className="flex items-center gap-2 text-slate-600 text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 hover:bg-slate-50 shadow-sm disabled:opacity-50"
            >
              <Download size={14} /> Export PDF
            </button>
            )}
            {isCostPlus && (
            <button
              onClick={() => exportType2CSV('labour')}
              disabled={!type2Report}
              className="flex items-center gap-2 text-slate-600 text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 hover:bg-slate-50 shadow-sm disabled:opacity-50"
            >
              <Download size={14} /> Labour CSV
            </button>
            )}
            {isCostPlus && (
            <button
              onClick={() => exportType2CSV('supplier')}
              disabled={!type2Report}
              className="flex items-center gap-2 text-slate-600 text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 hover:bg-slate-50 shadow-sm disabled:opacity-50"
            >
              <Download size={14} /> Supplier CSV
            </button>
            )}
            {isCostPlus && (
            <button
              onClick={exportType2PDF}
              disabled={!type2Report}
              className="flex items-center gap-2 text-purple-700 text-sm border border-purple-200 bg-purple-50 rounded-lg px-3 py-2 hover:bg-purple-100 shadow-sm disabled:opacity-50"
            >
              <Download size={14} /> Export PDF
            </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4 text-red-600 text-sm">{error}</div>
        )}
        {exportError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-700 text-sm flex items-center justify-between">
            <span>Export failed: {exportError}</span>
            <button onClick={() => setExportError('')} className="ml-4 text-red-400 hover:text-red-600 font-bold">×</button>
          </div>
        )}

        {/* ── Type 2 (Cost Plus) UI ── */}
        {isCostPlus && type2Report && (
          <CostReportType2 report={type2Report} onRefresh={loadReport} userRole={user?.role} />
        )}

        {/* Skeleton only on initial load (before first data arrives) */}
        {isCostPlus && loading && !type2Report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── Type 1 (On a Price) UI ── */}
        {/* Cost detail filter panel */}
        {!isCostPlus && report && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-600 text-xs font-semibold">Filter cost details</span>
                {activeCostFilterCount > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{activeCostFilterCount}</span>
                )}
              </div>
              <button
                onClick={() => setShowCostFilters(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${showCostFilters || activeCostFilterCount > 0 ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}
              >
                <SlidersHorizontal size={12} />
                {showCostFilters ? 'Hide' : 'Show'} Filters
              </button>
            </div>

            {showCostFilters && (
              <div className="px-5 pb-4 border-t border-slate-100 pt-3 space-y-3">
                {/* Cost type row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 font-medium">Show:</span>
                  {(['all', 'supplier', 'labour'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setCostType(v)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${costType === v ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                    >
                      {v === 'all' ? 'All Costs' : v === 'supplier' ? 'Supplier Only' : 'Labour Only'}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {/* Supplier search */}
                  <div className="col-span-2 sm:col-span-1 lg:col-span-2">
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Supplier</label>
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={e => setSupplierSearch(e.target.value)}
                      placeholder="e.g. Treeline"
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  {/* Set/Account code */}
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Set / Account Code</label>
                    <input
                      type="text"
                      value={setCodeFilter}
                      onChange={e => setSetCodeFilter(e.target.value)}
                      placeholder="e.g. S003"
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  {/* Trade */}
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Trade</label>
                    <select
                      value={tradeFilter}
                      onChange={e => setTradeFilter(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">All trades</option>
                      {availableTrades.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {/* Crew member */}
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Crew Member</label>
                    <input
                      type="text"
                      value={crewSearch}
                      onChange={e => setCrewSearch(e.target.value)}
                      placeholder="Name..."
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  {/* Week from */}
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Week From</label>
                    <input
                      type="date"
                      value={weekFrom}
                      onChange={e => setWeekFrom(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  {/* Week to */}
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Week To</label>
                    <input
                      type="date"
                      value={weekTo}
                      onChange={e => setWeekTo(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                </div>

                {activeCostFilterCount > 0 && (
                  <button
                    onClick={() => { setCostType('all'); setSupplierSearch(''); setSetCodeFilter(''); setTradeFilter(''); setCrewSearch(''); setWeekFrom(''); setWeekTo(''); }}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                  >
                    <X size={11} /> Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Type 1 metric cards / tables (On a Price only) ── */}
        {!isCostPlus && <div className="space-y-4 md:space-y-5">

        {/* Metric cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
          {loading ? (
            Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)
          ) : m ? (
            <>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Total Costs to Date</p>
                <p className="text-slate-900 text-xl font-bold mt-1">{fmtGBP(m.total_costs_to_date)}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">supplier + labour + hire</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Total Invoiced to Production</p>
                <p className="text-slate-900 text-xl font-bold mt-1">{fmtGBP(m.total_invoiced_to_production)}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">all invoices raised</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Current Profit</p>
                <div className="flex items-center gap-1 mt-1">
                  {profitIsPositive
                    ? <TrendingUp size={14} className="text-green-600" />
                    : <TrendingDown size={14} className="text-red-500" />
                  }
                  <p className={`text-xl font-bold ${profitIsPositive ? 'text-green-600' : 'text-red-500'}`}>
                    {fmtGBP(m.current_profit)}
                  </p>
                </div>
                <p className="text-slate-400 text-[10px] mt-0.5">invoiced minus costs</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Profit % of Turnover</p>
                <p className={`text-xl font-bold mt-1 ${profitIsPositive ? 'text-green-600' : 'text-red-500'}`}>
                  {m.profit_percentage_of_turnover}
                </p>
                <p className="text-slate-400 text-[10px] mt-0.5">of invoiced revenue</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Supplier Costs</p>
                <p className="text-slate-900 text-xl font-bold mt-1">{fmtGBP(m.total_supplier_costs)}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">approved POs only</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Labour Costs</p>
                <p className="text-slate-900 text-xl font-bold mt-1">{fmtGBP(m.total_labour_costs)}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">verified timesheets</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
                <p className="text-slate-500 text-xs font-medium leading-tight">Hire Equipment</p>
                <p className="text-slate-900 text-xl font-bold mt-1">{fmtGBP((m as any).total_hire_costs || 0)}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">plant & tool hire</p>
              </div>
            </>
          ) : null}
        </div>

        {/* Progress bar */}
        {!loading && m && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span className="font-medium">Total Costs vs Total Invoiced to Production</span>
              <span className="font-semibold text-slate-800">{fmtGBP(totalCosts)} / {fmtGBP(totalInvoiced)}</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${progressPct > 90 ? 'bg-red-500' : progressPct > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
              <span>{progressPct.toFixed(1)}% of invoiced amount spent</span>
              <span>{(100 - progressPct).toFixed(1)}% remaining margin</span>
            </div>
          </div>
        )}

        {/* Amounts Invoiced to Production */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-slate-900 font-semibold text-sm">Amounts Invoiced to Production</h2>
              {!loading && report && (
                <p className="text-slate-400 text-xs mt-0.5">
                  {report.invoices_to_production.length} invoice{report.invoices_to_production.length !== 1 ? 's' : ''} raised
                </p>
              )}
            </div>
            {canAddInvoice && !loading && (
              <button
                onClick={() => setShowInvoiceModal(true)}
                className="flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium"
              >
                <Plus size={14} /> Add Invoice
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-left">Description</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">PO Number</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">Date</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">Invoice No.</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Amount (£)</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-100 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : report?.invoices_to_production.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400 text-sm">No invoices raised yet.</td>
                  </tr>
                ) : (
                  report?.invoices_to_production.map(inv => (
                    <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 text-slate-800 font-medium">{inv.invoice_description ?? '—'}</td>
                      <td className="px-4 py-3 text-blue-700 text-xs font-mono text-center">{inv.po_number ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs text-center">{inv.date ? fmtDate(inv.date) : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs text-center">{inv.invoice_number ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-900 font-semibold text-right">{fmtGBP(parseFloat(inv.amount))}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{inv.notes ?? ''}</td>
                    </tr>
                  ))
                )}
                {!loading && (report?.invoices_to_production.length ?? 0) > 0 && (
                  <tr className="bg-slate-50">
                    <td className="px-5 py-2.5 text-slate-700 font-bold text-xs" colSpan={4}>Total Invoiced to Production</td>
                    <td className="px-4 py-2.5 text-slate-900 font-bold text-right">{fmtGBP(invoiceTotal)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Supplier Costs */}
        {costType !== 'labour' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-slate-900 font-semibold text-sm">
              Supplier Costs
              {(supplierSearch || setCodeFilter) && <span className="ml-2 text-[10px] text-blue-600 font-medium">(filtered)</span>}
            </h2>
            {!loading && <span className="text-blue-600 text-xs font-semibold">Total: {fmtGBP(supplierTotal)}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left">Date</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left">Supplier</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left">Set/Account</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left">Description</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Ex VAT</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">VAT</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Total</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-2.5">
                          <div className="h-3.5 bg-slate-100 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filteredSupplierCosts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                      {(report?.supplier_costs.length ?? 0) === 0 ? 'No supplier costs recorded.' : 'No supplier costs match the filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredSupplierCosts.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-4 py-2.5 text-slate-700 font-medium">{r.supplier}</td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono">{r.set_code ?? r.account_code ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{r.description ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-right">{fmtGBP(r.cost_ex_vat)}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-right">{fmtGBP(r.vat)}</td>
                      <td className="px-4 py-2.5 text-slate-900 font-semibold text-right">{fmtGBP(r.total)}</td>
                      <td className="px-4 py-2.5 text-slate-400">{r.purchase_method}</td>
                    </tr>
                  ))
                )}
                {!loading && filteredSupplierCosts.length > 0 && (
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td className="px-4 py-2.5 font-bold text-slate-700" colSpan={4}>Totals</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 text-right">{fmtGBP(supplierExVatTotal)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 text-right">{fmtGBP(supplierVatTotal)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-900 text-right">{fmtGBP(supplierTotal)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* Labour Summary */}
        {costType !== 'supplier' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-slate-900 font-semibold text-sm">
              Labour Summary — by Week
              {(tradeFilter || crewSearch || weekFrom || weekTo) && <span className="ml-2 text-[10px] text-blue-600 font-medium">(filtered)</span>}
            </h2>
            {!loading && m && (
              <span className="text-blue-600 text-xs font-semibold">Total: {fmtGBP(m.total_labour_costs)}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left w-8" />
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-left">Week Ending</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-center">No. of Crew</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Total (£)</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Running Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-2.5">
                          <div className="h-3.5 bg-slate-100 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : labourWithRunning.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      {(report?.labour_weekly.length ?? 0) === 0 ? 'No labour recorded.' : 'No labour matches the filters.'}
                    </td>
                  </tr>
                ) : (
                  labourWithRunning.map(week => {
                    const isExpanded = expandedWeeks.has(week.week_ending_date);
                    return (
                      <Fragment key={week.week_ending_date}>
                        <tr
                          className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                          onClick={() => toggleWeek(week.week_ending_date)}
                        >
                          <td className="px-4 py-2.5 text-slate-400">
                            <ChevronRight
                              size={13}
                              className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-slate-700 font-medium">
                            {fmtDate(week.week_ending_date)}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 text-center">{week.crew.length}</td>
                          <td className="px-4 py-2.5 text-slate-900 font-semibold text-right">{fmtGBP(week.total)}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-right">{fmtGBP(week.running)}</td>
                        </tr>
                        {isExpanded && week.crew.map(c => (
                          <tr key={c.crew_number} className="bg-blue-50/40 border-l-2 border-l-blue-300">
                            <td />
                            <td className="px-4 py-2 text-slate-500 pl-8">
                              <span className="font-mono text-slate-400 mr-2">{c.crew_number}</span>
                              {c.name}
                            </td>
                            <td className="px-4 py-2 text-slate-400 text-center">
                              {c.trade ?? '—'}{c.rank ? ` · ${c.rank}` : ''}
                            </td>
                            <td className="px-4 py-2 text-slate-600 font-medium text-right">{fmtGBP(c.grand_total)}</td>
                            <td />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })
                )}
                {!loading && labourWithRunning.length > 0 && m && (
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td />
                    <td className="px-4 py-2.5 font-bold text-slate-700" colSpan={2}>Total Labour</td>
                    <td className="px-4 py-2.5 font-bold text-slate-900 text-right">{fmtGBP(m.total_labour_costs)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        </div>}
        {/* ── end Type 1 ── */}

      </main>
    </>
  );
}
