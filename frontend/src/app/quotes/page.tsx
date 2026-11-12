'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScrollText, Plus, Search, X, Loader2, AlertCircle } from 'lucide-react';
import TopBar from '@/components/TopBar';
import PaginationScrollIndicator from '@/components/PaginationScrollIndicator';
import { usePagedList } from '@/hooks/usePagination';
import { useAuth } from '@/contexts/AuthContext';
import { quotesApi, productionsApi, Production, Quote, QuoteStatus } from '@/lib/api';
import QuoteHeaderFields, { QuoteHeaderForm, validateHeaderForm, headerFormToInput } from '@/components/quotes/QuoteHeaderFields';
import {
  fmtCurrency, isoToday, addDaysIso, QUOTE_STATUS_CONFIG, QUOTE_STATUS_ORDER, recipientLabel, quoteListNote,
} from '@/components/quotes/quoteShared';

const OPEN_STATUSES = QUOTE_STATUS_ORDER.filter(s => s !== 'declined').join(',');

const emptyHeader = (): QuoteHeaderForm => {
  const today = isoToday();
  return {
    title: '', quote_date: today, valid_until: addDaysIso(today, 30), recipient_type: 'internal',
    production_id: '', department: '', recipient_name: '', recipient_company: '', recipient_email: '', introduction: '',
  };
};

export default function QuotesPage() {
  const router = useRouter();
  const { isGuest } = useAuth();
  const canWrite = !isGuest;

  const [productions, setProductions] = useState<Production[]>([]);
  // Result of the last fetch, tagged with the filters it was fetched for.
  const [loaded, setLoaded] = useState<{ key: string; rows: Quote[]; error: string | null }>({ key: '', rows: [], error: null });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' = all except Declined
  const [productionFilter, setProductionFilter] = useState('');
  const [recipientFilter, setRecipientFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  const dateRangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const filtersActive = Boolean(search || statusFilter || productionFilter || recipientFilter || dateFrom || dateTo);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(() => ({
    status: statusFilter === 'all' ? '' : statusFilter || OPEN_STATUSES,
    production_id: productionFilter,
    recipient_type: recipientFilter,
    date_from: dateRangeInvalid ? '' : dateFrom,
    date_to: dateRangeInvalid ? '' : dateTo,
    search: debouncedSearch.trim(),
  }), [statusFilter, productionFilter, recipientFilter, dateFrom, dateTo, debouncedSearch, dateRangeInvalid]);
  const filtersKey = JSON.stringify(filters);
  const loading = loaded.key !== filtersKey;
  const quotes = loaded.rows;
  const error = loading ? null : loaded.error;

  useEffect(() => {
    let cancelled = false;
    quotesApi.list(JSON.parse(filtersKey))
      .then(rows => { if (!cancelled) setLoaded({ key: filtersKey, rows, error: null }); })
      .catch(e => { if (!cancelled) setLoaded({ key: filtersKey, rows: [], error: e instanceof Error ? e.message : 'Unable to load quotes' }); });
    return () => { cancelled = true; };
  }, [filtersKey]);
  useEffect(() => { productionsApi.list().then(setProductions).catch(() => setProductions([])); }, []);

  const pager = usePagedList(quotes, 'quotes');
  const sortedProductions = useMemo(() => [...productions].sort((a, b) => a.name.localeCompare(b.name)), [productions]);

  const clearFilters = () => {
    setSearch(''); setStatusFilter(''); setProductionFilter(''); setRecipientFilter(''); setDateFrom(''); setDateTo('');
  };

  const selectCls = 'px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-slate-50 min-h-screen text-slate-800">
      <TopBar title="Quotes" />

      <main className="p-4 md:p-6 space-y-4 md:space-y-5 max-w-7xl w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-sm">
                <ScrollText size={22} />
              </div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">Quotes</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">Labour, materials and plant hire quotes for internal departments and external clients.</p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              <Plus size={14} /> New Quote
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
          <div className="relative max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by reference or title…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectCls} aria-label="Status">
                <option value="">Open quotes (hide Declined)</option>
                <option value="all">All statuses</option>
                {QUOTE_STATUS_ORDER.map(s => <option key={s} value={s}>{QUOTE_STATUS_CONFIG[s].label}</option>)}
              </select>
              <select value={productionFilter} onChange={e => setProductionFilter(e.target.value)} className={`${selectCls} max-w-56`} aria-label="Production">
                <option value="">All productions</option>
                {sortedProductions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={recipientFilter} onChange={e => setRecipientFilter(e.target.value)} className={selectCls} aria-label="Recipient type">
                <option value="">Internal and external</option>
                <option value="internal">Internal</option>
                <option value="external">External</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                From <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={selectCls} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                To <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={selectCls} />
              </label>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="text-xs text-red-500 hover:text-red-700 font-medium px-2">Clear Filters</button>
              )}
            </div>
            <div className="text-xs text-slate-400">{quotes.length} quote{quotes.length === 1 ? '' : 's'}</div>
          </div>
          {dateRangeInvalid && <p className="text-xs text-red-600">The From date is after the To date.</p>}
        </div>

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Recipient / Production</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={5} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2"><Loader2 size={20} className="animate-spin text-blue-600" /><span>Loading quotes…</span></div>
                  </td></tr>
                ) : error ? (
                  <tr><td colSpan={5} className="py-12 text-center text-red-600">{error}</td></tr>
                ) : quotes.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-1.5">
                      <ScrollText size={28} className="text-slate-300 mb-1" />
                      <p className="font-semibold text-slate-700 text-sm">No quotes found</p>
                      <p className="text-xs">{filtersActive ? 'Try adjusting your filters or search.' : canWrite ? 'Create your first quote with New Quote.' : ''}</p>
                    </div>
                  </td></tr>
                ) : (
                  pager.pageItems.map(q => (
                    <tr
                      key={q.id}
                      tabIndex={0}
                      onClick={() => router.push(`/quotes/${q.id}`)}
                      onKeyDown={e => { if (e.key === 'Enter') router.push(`/quotes/${q.id}`); }}
                      className="hover:bg-slate-50/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                    >
                      <td className="px-4 py-3 whitespace-nowrap" title={q.title}>
                        <span className="font-semibold text-slate-900">{q.reference}</span>
                        {q.revision > 1 && <span className="ml-1.5 text-slate-400">Rev {q.revision}</span>}
                      </td>
                      <td className="px-4 py-3 min-w-44">{recipientLabel(q)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-medium">{fmtCurrency(q.total)}</td>
                      <td className={`px-4 py-3 text-center font-semibold whitespace-nowrap w-40 ${QUOTE_STATUS_CONFIG[q.status as QuoteStatus]?.cls ?? ''}`}>
                        {QUOTE_STATUS_CONFIG[q.status as QuoteStatus]?.label ?? q.status}
                      </td>
                      <td className="px-4 py-3 min-w-36 max-w-60 text-slate-500">
                        <span className="line-clamp-2">{quoteListNote(q)}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && quotes.length > 0 && <PaginationScrollIndicator {...pager.barProps} itemName="quotes" />}
        </div>
      </main>

      {showCreate && (
        <CreateQuoteModal
          productions={sortedProductions}
          onClose={() => setShowCreate(false)}
          onCreated={id => router.push(`/quotes/${id}`)}
        />
      )}
    </div>
  );
}

function CreateQuoteModal({ productions, onClose, onCreated }: {
  productions: Production[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState<QuoteHeaderForm>(emptyHeader);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateHeaderForm(form);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await quotesApi.create(headerFormToInput(form));
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create quote');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-label="New quote"
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">New quote</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <QuoteHeaderFields value={form} onChange={setForm} productions={productions} />
          <p className="text-xs text-slate-400 mt-3">The quote reference (CSL-Q-XXXX) is assigned when you create it.</p>
        </div>
        {error && (
          <p className="mx-5 mb-2 flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </p>
        )}
        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Create quote
          </button>
        </div>
      </form>
    </div>
  );
}
