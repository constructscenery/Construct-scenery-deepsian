'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Receipt, Search, X, Download, Loader2, ExternalLink, AlertTriangle, CheckCircle2, AlertCircle,
  Building2, Sparkles, RefreshCw, MessageSquare,
} from 'lucide-react';
import TopBar from '@/components/TopBar';
import PaginationScrollIndicator from '@/components/PaginationScrollIndicator';
import { usePagedList } from '@/hooks/usePagination';
import { useAuth } from '@/contexts/AuthContext';
import {
  salesApi, productionsApi, xeroApi, Production, XeroStatus,
  SalesInvoice, SalesInvoiceDetail, SalesInvoiceNote, SalesInvoiceStatus, SalesSummary, SalesSummaryRow,
} from '@/lib/api';

// Addendum 6 — Sales: invoices pulled from Xero, allocated to productions.

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtCurrency = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(v) || 0);

const STATUS: Record<SalesInvoiceStatus, { label: string; cls: string }> = {
  overdue:     { label: 'Overdue',     cls: 'bg-red-700 text-white' },
  outstanding: { label: 'Outstanding', cls: 'bg-amber-600 text-white' },
  paid:        { label: 'Paid',        cls: 'bg-green-700 text-white' },
};
const STATUS_ORDER: SalesInvoiceStatus[] = ['outstanding', 'overdue', 'paid'];

const xeroInvoiceUrl = (xeroInvoiceId: string) =>
  `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(xeroInvoiceId)}`;

/** Result of the Xero consent redirect (?xero=connected|cancelled|error&message=…), if we just came back from it. */
const readXeroRedirect = (): { type: 'success' | 'error'; message: string } | null => {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('xero');
  if (!result) return null;
  if (result === 'connected') return { type: 'success', message: 'Xero connected — pulling invoices now' };
  if (result === 'cancelled') return { type: 'error', message: 'Xero connection cancelled' };
  return { type: 'error', message: params.get('message') || 'Xero connection failed' };
};

type Tab = 'invoices' | 'summary';

export default function SalesPage() {
  const { user, isGuest } = useAuth();
  const canWrite = Boolean(user) && !isGuest;
  const isMD = user?.role === 'managing_director'; // connects Xero

  const [tab, setTab] = useState<Tab>('invoices');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [productions, setProductions] = useState<Production[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; rows: SalesInvoice[]; error: string | null }>({ key: '', rows: [], error: null });
  const [refreshToken, setRefreshToken] = useState(0);
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [reminder, setReminder] = useState<{ count: number; days: number } | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [panelInvoiceId, setPanelInvoiceId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [xero, setXero] = useState<XeroStatus | null>(null);
  const [xeroBusy, setXeroBusy] = useState<'sync' | 'connect' | 'disconnect' | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ─── Filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statuses, setStatuses] = useState<SalesInvoiceStatus[]>([]);
  const [productionFilter, setProductionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const dateRangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const filtersActive = Boolean(search || statuses.length || productionFilter || dateFrom || dateTo);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(() => ({
    status: statuses.join(','),
    production_id: productionFilter,
    date_from: dateRangeInvalid ? '' : dateFrom,
    date_to: dateRangeInvalid ? '' : dateTo,
    search: debouncedSearch.trim(),
  }), [statuses, productionFilter, dateFrom, dateTo, debouncedSearch, dateRangeInvalid]);
  const filtersKey = JSON.stringify(filters);
  const loading = loaded.key !== filtersKey;
  const invoices = loaded.rows;
  const error = loading ? null : loaded.error;

  const clearFilters = () => {
    setSearch(''); setStatuses([]); setProductionFilter(''); setDateFrom(''); setDateTo('');
  };

  // ─── Data ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    salesApi.listInvoices(JSON.parse(filtersKey))
      .then(rows => { if (!cancelled) setLoaded({ key: filtersKey, rows, error: null }); })
      .catch(e => { if (!cancelled) setLoaded({ key: filtersKey, rows: [], error: e instanceof Error ? e.message : 'Unable to load invoices' }); });
    return () => { cancelled = true; };
  }, [filtersKey, refreshToken]);

  useEffect(() => {
    if (tab !== 'summary') return;
    let cancelled = false;
    salesApi.summary()
      .then(s => { if (!cancelled) setSummary(s); })
      .catch(e => { if (!cancelled) showToast('error', e instanceof Error ? e.message : 'Unable to load summary'); });
    return () => { cancelled = true; };
  }, [tab, summaryRefresh, showToast]);

  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => setProductions([]));
    if (canWrite) salesApi.unallocatedReminder().then(setReminder).catch(() => setReminder(null));
  }, [canWrite]);

  const refreshData = useCallback(() => {
    setRefreshToken(t => t + 1);
    setSummaryRefresh(t => t + 1);
    salesApi.unallocatedReminder().then(setReminder).catch(() => {});
  }, []);

  // Xero: status for everyone. Staff also pull new invoices when the page opens
  // (the server skips it if it synced in the last few minutes).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const redirect = readXeroRedirect();
    if (redirect) window.history.replaceState(null, '', window.location.pathname);
    xeroApi.status()
      .then(s => {
        if (cancelled) return;
        setXero(s);
        if (redirect) showToast(redirect.type, redirect.message);
        if (!canWrite || !s.configured || s.status !== 'connected') return;
        xeroApi.sync('auto')
          .then(r => { if (!cancelled) { setXero(r.status); if (r.ran) refreshData(); } })
          .catch(() => { xeroApi.status().then(st => { if (!cancelled) setXero(st); }).catch(() => {}); });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user, canWrite, refreshData, showToast]);

  const syncNow = async () => {
    setXeroBusy('sync');
    try {
      const r = await xeroApi.sync('manual');
      setXero(r.status);
      if (r.ran) refreshData();
      showToast('success', r.ran ? `Pulled from Xero — ${r.count ?? 0} invoice(s) updated` : 'A sync is already running');
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Xero sync failed');
      xeroApi.status().then(setXero).catch(() => {});
    } finally {
      setXeroBusy(null);
    }
  };

  const connectXero = async () => {
    setXeroBusy('connect');
    try {
      window.location.href = (await xeroApi.connectUrl()).url;
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Unable to start the Xero connection');
      setXeroBusy(null);
    }
  };

  const disconnectXero = async () => {
    setXeroBusy('disconnect');
    try {
      setXero(await xeroApi.disconnect());
      showToast('success', 'Xero disconnected — invoices already pulled stay here');
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Unable to disconnect Xero');
    } finally {
      setXeroBusy(null);
      setConfirmDisconnect(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await salesApi.exportCsv(filters);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const closePanel = useCallback(() => setPanelInvoiceId(null), []);
  const panelError = useCallback((message: string) => showToast('error', message), [showToast]);
  const handleAllocated = (message: string) => {
    showToast('success', message);
    setPanelInvoiceId(null);
    refreshData();
  };

  const pager = usePagedList(invoices, 'sales-invoices');
  const productionOptions = useMemo(() => [...productions].sort((a, b) => a.name.localeCompare(b.name)), [productions]);
  const selectCls = 'px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400';
  const xeroConnected = Boolean(xero?.configured && xero.status === 'connected');

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-slate-50 min-h-screen text-slate-800">
      <TopBar title="Sales" />

      {toast && (
        <div className={`fixed top-5 right-5 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      <main className="p-4 md:p-6 space-y-4 max-w-7xl w-full mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-sm"><Receipt size={22} /></div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">Sales</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">Invoices pulled from Xero and linked to productions.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canWrite && xeroConnected && (
              <button type="button" onClick={syncNow} disabled={xeroBusy !== null}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm disabled:opacity-50">
                <RefreshCw size={14} className={xeroBusy === 'sync' ? 'animate-spin' : ''} /> Sync Now
              </button>
            )}
            {tab === 'invoices' && (
              <button type="button" onClick={handleExport} disabled={exporting || loading || invoices.length === 0}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm disabled:opacity-50">
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export CSV
              </button>
            )}
          </div>
        </div>

        {/* Xero — one line: status, and Connect / Disconnect for the MD */}
        {xero && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs shadow-sm">
            <span className="text-slate-600">
              {!xero.configured ? 'Xero is not set up on the server yet.'
                : xero.status === 'connected' ? (
                  <>
                    <span className="font-semibold text-emerald-700">Xero connected</span> · {xero.tenant_name} · Last pulled {fmtDateTime(xero.last_synced_at)}
                    {xero.last_sync_status === 'failed' && (
                      <span className="text-red-600"> · Last pull failed — showing what was pulled before</span>
                    )}
                  </>
                ) : xero.status === 'needs_reconnect' ? (
                  <span className="text-amber-700"><AlertTriangle size={13} className="inline -mt-0.5 mr-1" />Xero connection expired — invoices are not updating{isMD ? '' : ' until the Managing Director reconnects'}.</span>
                ) : xero.status === 'disconnected' ? (
                  `Xero disconnected — showing invoices already pulled${isMD ? '' : '. The Managing Director can reconnect it'}.`
                ) : (
                  `Xero not connected${isMD ? '' : ' — the Managing Director can connect it here'}.`
                )}
            </span>
            {isMD && xero.configured && (
              xero.status === 'connected' ? (
                <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={xeroBusy !== null}
                  className="self-start sm:self-auto text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">Disconnect</button>
              ) : (
                <button type="button" onClick={connectXero} disabled={xeroBusy !== null}
                  className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {xeroBusy === 'connect' && <Loader2 size={12} className="animate-spin" />}
                  {xero.status === 'not_connected' ? 'Connect Xero' : 'Reconnect Xero'}
                </button>
              )
            )}
          </div>
        )}

        {/* Unallocated for more than 7 days */}
        {reminder && reminder.count > 0 && !reminderDismissed && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>{reminder.count} invoice{reminder.count === 1 ? ' has' : 's have'} been unallocated for over {reminder.days} days.</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { clearFilters(); setProductionFilter('unallocated'); setTab('invoices'); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white">Show unallocated</button>
              <button type="button" onClick={() => setReminderDismissed(true)} aria-label="Dismiss" className="p-1.5 rounded-lg hover:bg-amber-100"><X size={14} /></button>
            </div>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-sm">
          {([['invoices', 'Invoices'], ['summary', "What's Owed"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'invoices' ? (
          <>
            {/* Filters: status, production, date range, invoice number */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Invoice number…" value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <select value={statuses.join(',')} onChange={e => setStatuses(e.target.value ? [e.target.value as SalesInvoiceStatus] : [])} className={selectCls} aria-label="Status">
                <option value="">All statuses</option>
                {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </select>
              <select value={productionFilter} onChange={e => setProductionFilter(e.target.value)} className={`${selectCls} max-w-56`} aria-label="Production">
                <option value="">All productions</option>
                <option value="unallocated">Unallocated</option>
                {productionOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={selectCls} aria-label="Invoice date from" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={selectCls} aria-label="Invoice date to" />
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="text-xs text-red-500 hover:text-red-700 font-medium px-1">Clear</button>
              )}
              {dateRangeInvalid && <span className="text-xs text-red-600">From is after To</span>}
            </div>

            {/* Invoice list */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800 text-white font-semibold">
                    <tr>
                      <th className="px-4 py-3">Invoice No.</th>
                      <th className="px-4 py-3">Production / Client</th>
                      <th className="px-4 py-3">Invoice Date</th>
                      <th className="px-4 py-3">Due Date</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-center w-36">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={6} className="py-12 text-center text-slate-400"><Loader2 size={20} className="animate-spin text-blue-600 inline" /></td></tr>
                    ) : error ? (
                      <tr><td colSpan={6} className="py-12 text-center text-red-600">{error}</td></tr>
                    ) : invoices.length === 0 ? (
                      <tr><td colSpan={6} className="py-12 text-center text-slate-400">{filtersActive ? 'No invoices match these filters.' : 'No invoices pulled from Xero yet.'}</td></tr>
                    ) : pager.pageItems.map(inv => {
                      const due = Number(inv.amount_due);
                      const partPaid = inv.sales_status !== 'paid' && due > 0 && due < Number(inv.total);
                      return (
                        <tr key={inv.id} tabIndex={0}
                          onClick={() => setPanelInvoiceId(inv.id)}
                          onKeyDown={e => { if (e.key === 'Enter') setPanelInvoiceId(inv.id); }}
                          className="hover:bg-slate-50/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                          <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{inv.invoice_number || '—'}</td>
                          <td className="px-4 py-3 min-w-44">{inv.production_name || <span className="text-slate-400 italic">Unallocated</span>}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {fmtCurrency(inv.total)}
                            {partPaid && <div className="text-amber-700">{fmtCurrency(due)} left to pay</div>}
                          </td>
                          <td className={`px-4 py-3 text-center font-semibold ${STATUS[inv.sales_status]?.cls ?? ''}`}>{STATUS[inv.sales_status]?.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!loading && invoices.length > 0 && <PaginationScrollIndicator {...pager.barProps} itemName="invoices" />}
            </div>
          </>
        ) : (
          <SummaryTable summary={summary} onOpen={row => { clearFilters(); setProductionFilter(row.production_id ?? ''); setTab('invoices'); }} />
        )}
      </main>

      {panelInvoiceId && (
        <AllocationPanel key={panelInvoiceId} invoiceId={panelInvoiceId} productions={productionOptions} canWrite={canWrite}
          onClose={closePanel} onSaved={handleAllocated} onError={panelError} />
      )}

      {confirmDisconnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setConfirmDisconnect(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Disconnect Xero" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Disconnect Xero?</h2>
            <p className="text-xs text-slate-600">New invoices stop coming in. Invoices already pulled, and their productions, stay here.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDisconnect(false)} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={disconnectXero} disabled={xeroBusy !== null}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
                {xeroBusy === 'disconnect' && <Loader2 size={13} className="animate-spin" />} Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── What's Owed: one row per production + TOTAL ────────────────────────────

function SummaryTable({ summary, onOpen }: { summary: SalesSummary | null; onOpen: (row: SalesSummaryRow) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800 text-white font-semibold">
            <tr>
              <th className="px-4 py-3">Production</th>
              <th className="px-4 py-3 text-right">Total Invoiced</th>
              <th className="px-4 py-3 text-right">Received</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
              <th className="px-4 py-3 text-right">Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!summary ? (
              <tr><td colSpan={5} className="py-12 text-center"><Loader2 size={20} className="animate-spin text-blue-600 inline" /></td></tr>
            ) : summary.productions.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-slate-400">No invoices allocated to a production yet.</td></tr>
            ) : summary.productions.map(r => (
              <tr key={r.production_id} tabIndex={0} onClick={() => onOpen(r)} onKeyDown={e => { if (e.key === 'Enter') onOpen(r); }}
                title="Show this production's invoices"
                className="hover:bg-slate-50/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                <td className="px-4 py-3 font-medium">{r.production_name}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(r.total_invoiced)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(r.received)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(r.outstanding)}</td>
                <td className={`px-4 py-3 text-right whitespace-nowrap ${r.overdue > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtCurrency(r.overdue)}</td>
              </tr>
            ))}
          </tbody>
          {summary && summary.productions.length > 0 && (
            <tfoot className="bg-slate-800 text-white font-semibold">
              <tr>
                <td className="px-4 py-3">TOTAL</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(summary.totals.total_invoiced)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(summary.totals.received)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(summary.totals.outstanding)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtCurrency(summary.totals.overdue)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Allocation panel: invoice values, Xero comments, link to a production ──

function AllocationPanel({ invoiceId, productions, canWrite, onClose, onSaved, onError }: {
  invoiceId: string;
  productions: Production[];
  canWrite: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [invoice, setInvoice] = useState<SalesInvoiceDetail | null>(null);
  const [comments, setComments] = useState<{ available: boolean; notes: SalesInvoiceNote[] } | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    salesApi.getInvoice(invoiceId)
      .then(inv => {
        if (cancelled) return;
        setInvoice(inv);
        setSelected(inv.production_id ?? inv.suggested_production?.id ?? '');
      })
      .catch(e => { if (!cancelled) { onError(e instanceof Error ? e.message : 'Unable to load invoice'); onClose(); } });
    salesApi.getNotes(invoiceId)
      .then(c => { if (!cancelled) setComments(c); })
      .catch(() => { if (!cancelled) setComments({ available: false, notes: [] }); });
    return () => { cancelled = true; };
  }, [invoiceId, onClose, onError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return productions
      .filter(p => p.status !== 'archived' || p.id === invoice?.production_id)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.production_code ?? '').toLowerCase().includes(q));
  }, [productions, query, invoice?.production_id]);

  const save = async (productionId: string | null) => {
    if (!invoice) return;
    setSaving(true);
    try {
      await salesApi.allocate(invoice.id, productionId);
      const name = productions.find(p => p.id === productionId)?.name;
      onSaved(productionId ? `${invoice.invoice_number} linked to ${name ?? 'production'}` : `${invoice.invoice_number} unlinked`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Unable to link invoice');
    } finally {
      setSaving(false);
    }
  };

  const suggested = Boolean(invoice?.suggested_production && !invoice.production_id && selected === invoice.suggested_production.id);
  const unchanged = selected === (invoice?.production_id ?? '');

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label="Invoice" className="relative w-full sm:max-w-md h-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">{invoice?.invoice_number ?? 'Invoice'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        {!invoice ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-xs">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2"><dt className="text-slate-500">Client (Xero contact)</dt><dd className="font-medium text-slate-800">{invoice.contact_name || '—'}</dd></div>
              <div><dt className="text-slate-500">Invoice date</dt><dd className="font-medium">{fmtDate(invoice.invoice_date)}</dd></div>
              <div><dt className="text-slate-500">Due date</dt><dd className="font-medium">{fmtDate(invoice.due_date)}</dd></div>
              <div><dt className="text-slate-500">Amount</dt><dd className="font-medium">{fmtCurrency(invoice.total)}</dd></div>
              <div><dt className="text-slate-500">Paid</dt><dd className="font-medium">{fmtCurrency(Number(invoice.amount_paid) + Number(invoice.amount_credited))}</dd></div>
              <div><dt className="text-slate-500">Left to pay</dt><dd className="font-medium">{fmtCurrency(invoice.amount_due)}</dd></div>
              <div><dt className="text-slate-500">Status</dt><dd><span className={`inline-block px-2 py-0.5 rounded font-semibold ${STATUS[invoice.sales_status].cls}`}>{STATUS[invoice.sales_status].label}</span></dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Xero reference</dt><dd className="font-medium break-words">{invoice.reference || '—'}</dd></div>
            </dl>

            <a href={xeroInvoiceUrl(invoice.xero_invoice_id)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-blue-600 hover:underline">
              <ExternalLink size={13} /> Open in Xero
            </a>

            {/* Comments left on the invoice in Xero */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 font-semibold text-slate-700"><MessageSquare size={13} /> Comments</p>
              {!comments ? (
                <p className="text-slate-400">Loading…</p>
              ) : !comments.available ? (
                <p className="text-slate-400">Comments can&apos;t be read from Xero right now.</p>
              ) : comments.notes.length === 0 ? (
                <p className="text-slate-400">No comments on this invoice in Xero.</p>
              ) : (
                <ul className="space-y-2">
                  {comments.notes.map((n, i) => (
                    <li key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <p className="text-slate-800 whitespace-pre-wrap">{n.text}</p>
                      <p className="text-slate-400 mt-0.5">{n.user || 'Xero'} · {fmtDateTime(n.date)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Link to a production */}
            {canWrite && (
              <div className="space-y-2">
                <p className="font-semibold text-slate-700">Production</p>
                {suggested && (
                  <p className="flex items-center gap-1.5 text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <Sparkles size={13} /> Suggested from the Xero reference — confirm to link.
                  </p>
                )}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search productions…"
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100" role="listbox" aria-label="Productions">
                  {choices.length === 0 ? (
                    <p className="px-3 py-4 text-slate-400 text-center">No productions match.</p>
                  ) : choices.map(p => (
                    <button key={p.id} type="button" role="option" aria-selected={selected === p.id} onClick={() => setSelected(p.id)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 ${selected === p.id ? 'bg-blue-50 text-blue-800 font-semibold' : 'hover:bg-slate-50'}`}>
                      <Building2 size={13} className="flex-shrink-0 text-slate-400" />
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.production_code && <span className="text-slate-400 font-normal">{p.production_code}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {canWrite && invoice && (
          <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-2">
            {invoice.production_id ? (
              <button type="button" disabled={saving} onClick={() => save(null)} className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">Unlink</button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={!selected || unchanged || saving} onClick={() => save(selected)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                {saving && <Loader2 size={13} className="animate-spin" />} Confirm
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
