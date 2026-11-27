'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { crewRatesApi, settingsApi, type CrewRate } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  Pencil, Check, X, Upload, Loader2, AlertCircle, RefreshCw, History,
} from 'lucide-react';

const fmt = (v: string | number | null | undefined) => {
  if (v == null || v === '' || v === 'NaN') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

// Group rates by trade
function groupByTrade(rates: CrewRate[]) {
  const groups: Record<string, CrewRate[]> = {};
  for (const r of rates) {
    if (!groups[r.trade]) groups[r.trade] = [];
    groups[r.trade].push(r);
  }
  return groups;
}

// ─── Import CSV Modal ─────────────────────────────────────────────────────────
interface ImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

type PreviewChange = { trade: string; rank: string; old_daily: number | null; new_daily: number; old_overtime: number | null; new_overtime: number; daily_changed: boolean; ot_changed: boolean; is_new: boolean };

function ImportModal({ onClose, onImported }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [rateYear, setRateYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ message: string; inserted: number; expired: number } | null>(null);
  const [preview, setPreview] = useState<{
    rate_year: string; row_count: number; new_entries: number; changed_rates: number; changes: PreviewChange[];
    blocked?: Array<{ trade: string; rank: string; current_from: string }>;
    commercial_overrides_not_carried?: Array<{ trade: string; rank: string }>;
  } | null>(null);

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please select a CSV file.'); return; }
    if (!effectiveFrom) { setError('Effective from date is required.'); return; }
    if (!rateYear) { setError('Rate year is required (e.g. 2027/28).'); return; }
    setLoading(true); setError('');
    const fd = new FormData();
    fd.append('csv', file); fd.append('effective_from', effectiveFrom); fd.append('rate_year', rateYear);
    try {
      const res = await fetch('/api/crew-rates/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
        body: fd,
      }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? 'Preview failed'); } return r.json(); });
      setPreview(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally { setLoading(false); }
  };

  const submit = async () => {
    if (!file) return;
    setLoading(true); setError('');
    const fd = new FormData();
    fd.append('csv', file);
    fd.append('effective_from', effectiveFrom);
    fd.append('rate_year', rateYear);
    try {
      const res = await crewRatesApi.importCSV(fd);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-slate-900 font-semibold text-sm">Import New Year BECTU Rates</h2>
            <p className="text-slate-400 text-xs mt-0.5">CSV format: trade, rank, daily_rate, overtime_rate</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        {result ? (
          <div className="px-5 py-6 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-green-800 font-semibold text-sm">{result.message}</p>
              <p className="text-green-700 text-xs mt-1">{result.inserted} rates inserted · {result.expired} previous rates expired</p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => { onImported(); onClose(); }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Done</button>
            </div>
          </div>
        ) : preview ? (
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-slate-400 text-xs">Total Rows</p><p className="text-slate-900 font-bold text-lg">{preview.row_count}</p></div>
              <div className="bg-amber-50 rounded-lg p-3"><p className="text-amber-600 text-xs">Changed</p><p className="text-amber-800 font-bold text-lg">{preview.changed_rates}</p></div>
              <div className="bg-blue-50 rounded-lg p-3"><p className="text-blue-600 text-xs">New</p><p className="text-blue-800 font-bold text-lg">{preview.new_entries}</p></div>
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Trade / Rank</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-500">Old Daily</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-500">New Daily</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-500">Old OT</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-500">New OT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.changes.map((c, i) => (
                    <tr key={i} className={c.is_new ? 'bg-blue-50/40' : ''}>
                      <td className="px-3 py-2 text-slate-700">{c.trade} · {c.rank}{c.is_new && <span className="ml-1 text-blue-600 font-medium">(new)</span>}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{c.old_daily !== null ? `£${c.old_daily.toFixed(2)}` : '—'}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${c.daily_changed ? 'text-amber-700' : 'text-slate-700'}`}>£{c.new_daily.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{c.old_overtime !== null ? `£${c.old_overtime.toFixed(2)}` : '—'}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${c.ot_changed ? 'text-amber-700' : 'text-slate-700'}`}>£{c.new_overtime.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!preview.blocked?.length && (
              <div className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">
                <p className="font-semibold">This date is not after the current rate for {preview.blocked.length} grade(s) — choose a later Effective From.</p>
                <p className="mt-0.5">{preview.blocked.slice(0, 4).map(b => `${b.trade} · ${b.rank} (current from ${b.current_from})`).join('; ')}{preview.blocked.length > 4 ? '…' : ''}</p>
              </div>
            )}
            {!!preview.commercial_overrides_not_carried?.length && (
              <div className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                <p className="font-semibold">{preview.commercial_overrides_not_carried.length} Set commercial rate(s) will not carry into {preview.rate_year} — they start on Auto (+uplift %).</p>
                <p className="mt-0.5">{preview.commercial_overrides_not_carried.slice(0, 4).map(o => `${o.trade} · ${o.rank}`).join('; ')}{preview.commercial_overrides_not_carried.length > 4 ? '…' : ''}. Set them again in the Commercial view after importing if they still apply.</p>
              </div>
            )}
            {error && <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={13} /> {error}</div>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setPreview(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">← Back</button>
              <button onClick={submit} disabled={loading || !!preview.blocked?.length} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Confirm Import
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePreview} className="px-5 py-4 space-y-4">
            {error && <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={13} /> {error}</div>}
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-700">Expected CSV columns:</p>
              <p className="font-mono">trade, rank, daily_rate, overtime_rate</p>
              <p className="text-slate-500 mt-1">Example: <span className="font-mono">Carpenters,HOD,430.00,64.50</span></p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Effective From *</label>
                <input type="date" className={inp} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Rate Year * <span className="text-slate-400">(e.g. 2027/28)</span></label>
                <input className={inp} placeholder="2027/28" value={rateYear} onChange={e => setRateYear(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">CSV File *</label>
              <label className="flex items-center gap-3 border-2 border-dashed border-slate-200 rounded-lg px-4 py-4 cursor-pointer hover:border-blue-400 transition-colors">
                <Upload size={18} className="text-slate-400 flex-shrink-0" />
                <div>
                  <p className="text-slate-600 text-sm font-medium">{file ? file.name : 'Click to select CSV'}</p>
                  <p className="text-slate-400 text-xs">trade, rank, daily_rate, overtime_rate</p>
                </div>
                <input type="file" className="hidden" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button type="submit" disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Preview Changes
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── RC: rate fields, dates and the two dialogs ─────────────────────────────

type BaseField = 'daily_rate' | 'overtime_rate' | 'weekly_rate';
type RateField = BaseField | 'commercial_daily_rate' | 'commercial_overtime_rate' | 'commercial_weekly_rate';
const FIELD_LABEL: Record<RateField, string> = {
  daily_rate: 'Day rate', overtime_rate: 'OT / hr', weekly_rate: 'Weekly',
  commercial_daily_rate: 'Commercial day rate', commercial_overtime_rate: 'Commercial OT / hr', commercial_weekly_rate: 'Commercial weekly',
};
const commercialField = (f: BaseField) => `commercial_${f}` as RateField;
const num = (v: string | number | null | undefined) => {
  if (v == null || v === '' || v === 'NaN') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
/** Commercial Auto value = standard × (1 + uplift %), rounded per rate to the penny (same rule as timesheets). */
const upliftOf = (v: string | number | null | undefined, pct: number) => {
  const n = num(v);
  if (n == null) return null;
  const pence = Math.round(n * 100) * (1 + pct / 100);
  return Math.round(Number(pence.toPrecision(12))) / 100;
};
/** Today's date in the UK as YYYY-MM-DD — the date a change takes effect from (matches the server). */
const ukToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

type PendingChange = { rate: CrewRate; changes: Array<{ field: RateField; from: string | null; to: string | null }> };

function ConfirmChangeModal({ pending, upliftPct, saving, error, onCancel, onConfirm }: {
  pending: PendingChange; upliftPct: number; saving: boolean; error: string;
  onCancel: () => void; onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const today = ukToday();
  const correctsToday = (pending.rate.effective_from ?? '').slice(0, 10) >= today;
  const show = (field: RateField, v: string | null) => {
    if (v != null) return fmt(v);
    if (field.startsWith('commercial_')) {
      const auto = upliftOf(pending.rate[field.replace('commercial_', '') as BaseField], upliftPct);
      return `Auto${auto != null ? ` (${fmt(auto)})` : ''}`;
    }
    return '—';
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="rc-confirm-title" className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 id="rc-confirm-title" className="text-slate-900 font-semibold text-sm">
            Save rate change — {pending.rate.trade === 'Non-BECTU' ? pending.rate.rank : `${pending.rate.trade} · ${pending.rate.rank}`}
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
            <thead><tr className="bg-slate-50 text-left">
              <th className="px-3 py-2 font-semibold text-slate-500">Rate</th>
              <th className="px-3 py-2 font-semibold text-slate-500 text-right">Now</th>
              <th className="px-3 py-2 font-semibold text-slate-500 text-right">New</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pending.changes.map(c => (
                <tr key={c.field}>
                  <td className="px-3 py-2 text-slate-700">{FIELD_LABEL[c.field]}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{show(c.field, c.from)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{show(c.field, c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-600">
            Applies to weeks ending on or after <strong className="text-slate-800">{fmtDate(today)}</strong>.
            Finalised timesheets, processed pay runs, locked forecasts and quotes keep the rates they were made with.
          </p>
          {correctsToday && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">This rate was already changed today — saving corrects today&apos;s version.</p>
          )}
          <div>
            <label htmlFor="rc-note" className="block text-xs font-medium text-slate-600 mb-1">Note <span className="text-slate-400">(optional)</span></label>
            <textarea id="rc-note" rows={2} maxLength={500} autoFocus value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Agreed commercial rate for 2026/27"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={13} /> {error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onCancel} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={() => onConfirm(note.trim())} disabled={saving}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save change
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionHistoryModal({ rate, onClose }: { rate: CrewRate; onClose: () => void }) {
  const [rows, setRows] = useState<CrewRate[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    crewRatesApi.versions(rate.id).then(setRows).catch(err => setError(err instanceof Error ? err.message : 'Could not load history'));
  }, [rate.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const cell = (v: string | null | undefined, commercial = false) =>
    v == null ? <span className="text-slate-400">{commercial ? 'Auto' : '—'}</span> : fmt(v);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="rc-history-title" className="bg-white rounded-xl shadow-xl w-full max-w-4xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 id="rc-history-title" className="text-slate-900 font-semibold text-sm">
              Rate history — {rate.trade === 'Non-BECTU' ? rate.rank : `${rate.trade} · ${rate.rank}`}
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">Each change starts a new version. Work priced in a week keeps the version in force that week.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">
          {error ? (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={13} /> {error}</div>
          ) : !rows ? (
            <div className="py-8 text-center"><Loader2 size={18} className="animate-spin text-slate-400 mx-auto" /></div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs min-w-[820px]">
                <thead className="bg-slate-50 sticky top-0"><tr className="text-left">
                  <th className="px-3 py-2 font-semibold text-slate-500">From</th>
                  <th className="px-3 py-2 font-semibold text-slate-500">To</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 text-right">Daily</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 text-right">OT / hr</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 text-right">Weekly</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 text-right">Comm. daily</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 text-right">Comm. OT</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 text-right">Comm. weekly</th>
                  <th className="px-3 py-2 font-semibold text-slate-500">Changed by</th>
                  <th className="px-3 py-2 font-semibold text-slate-500">Note</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(v => (
                    <tr key={v.id} className={v.effective_to == null ? 'bg-blue-50/40' : ''}>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {fmtDate(v.effective_from)}
                        {v.effective_to == null && <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">Current</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{v.effective_to ? fmtDate(v.effective_to) : '—'}</td>
                      <td className="px-3 py-2 text-right">{cell(v.daily_rate)}</td>
                      <td className="px-3 py-2 text-right">{cell(v.overtime_rate)}</td>
                      <td className="px-3 py-2 text-right">{cell(v.weekly_rate)}</td>
                      <td className="px-3 py-2 text-right">{cell(v.commercial_daily_rate, true)}</td>
                      <td className="px-3 py-2 text-right">{cell(v.commercial_overtime_rate, true)}</td>
                      <td className="px-3 py-2 text-right">{cell(v.commercial_weekly_rate, true)}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.created_by_name || (v.rate_year ? `${v.rate_year} card` : '—')}</td>
                      <td className="px-3 py-2 text-slate-600">{v.change_note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RateCardPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [rates, setRates] = useState<CrewRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showImport, setShowImport] = useState(false);

  // Inline edit state (both tables). In the Commercial view the inputs edit the commercial_* fields.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<BaseField, string>>({ daily_rate: '', overtime_rate: '', weekly_rate: '' });
  const [editError, setEditError] = useState('');
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [historyFor, setHistoryFor] = useState<CrewRate | null>(null);

  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');
  const [history, setHistory] = useState<Array<{ rate_year: string; effective_from: string; rows: CrewRate[] }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const canManage = true;
  // RC-03: guests can look but not change rates
  const canWrite = !!user && user.role !== 'guest';

  // CS-08 / RC: Standard / Commercial view. A commercial rate is either Set (used as entered) or
  // Auto = standard × (1 + uplift %), rounded per rate to the penny — the same rule timesheets use.
  const [view, setView] = useState<'standard' | 'commercial'>('standard');
  const [upliftPct, setUpliftPct] = useState<number>(10);
  const [upliftDraft, setUpliftDraft] = useState('');
  const [upliftSaving, setUpliftSaving] = useState(false);
  const [upliftMsg, setUpliftMsg] = useState('');
  useEffect(() => {
    settingsApi.get().then(st => {
      const v = Number(st['commercial_rate_uplift_pct']?.value);
      if (Number.isFinite(v)) setUpliftPct(v);
    }).catch(() => {});
  }, []);
  /** What a cell shows in the current view, and whether a commercial value is Set or Auto. */
  const cellOf = (r: CrewRate, f: BaseField): { text: string; set: boolean | null } => {
    if (view === 'standard') return { text: fmt(r[f]), set: null };
    const own = r[commercialField(f) as 'commercial_daily_rate'];
    if (own != null) return { text: fmt(own), set: true };
    const auto = upliftOf(r[f], upliftPct);
    return { text: fmt(auto), set: auto == null ? null : false };
  };
  const saveUplift = async () => {
    const v = Number(upliftDraft);
    if (!upliftDraft.trim() || !Number.isFinite(v) || v < 0 || v > 100) { setUpliftMsg('Enter a percentage from 0 to 100'); return; }
    setUpliftSaving(true); setUpliftMsg('');
    try {
      await settingsApi.patch('commercial_rate_uplift_pct', v);
      setUpliftPct(v); setUpliftDraft('');
      setUpliftMsg(`Saved. Commercial productions use +${v}% for Auto rates on timesheets saved or recalculated from now on.`);
    } catch (err) {
      setUpliftMsg(err instanceof Error ? err.message : 'Save failed');
    } finally { setUpliftSaving(false); }
  };

  useEffect(() => {
    if (user && !canManage) router.replace('/overview');
  }, [user, router, canManage]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await fetch('/api/crew-rates/history', {
        headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
      }).then(r => r.json()) as Array<{ rate_year: string; effective_from: string; rows: CrewRate[] }>;
      setHistory(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setHistoryLoading(false); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await crewRatesApi.list({ current: 'true' });
      setRates(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toVal = (v: string | null | undefined) => {
    const n = num(v);
    return n == null ? '' : n.toFixed(2);
  };
  const fieldsOf = (r: CrewRate): BaseField[] => (r.trade === 'Non-BECTU' ? ['daily_rate', 'overtime_rate'] : ['daily_rate', 'overtime_rate', 'weekly_rate']);

  const startEdit = (rate: CrewRate) => {
    setEditingId(rate.id);
    setEditError('');
    const pick = (f: BaseField) => toVal(view === 'commercial' ? rate[commercialField(f) as 'commercial_daily_rate'] : rate[f]);
    setEditValues({ daily_rate: pick('daily_rate'), overtime_rate: pick('overtime_rate'), weekly_rate: pick('weekly_rate') });
  };

  /** ✓ on a row: work out what changed and ask for confirmation (nothing is saved yet). */
  const reviewEdit = (rate: CrewRate) => {
    const changes: PendingChange['changes'] = [];
    for (const f of fieldsOf(rate)) {
      const raw = editValues[f].trim();
      const next = raw === '' ? null : Number(raw);
      if (next != null && (!Number.isFinite(next) || next < 0 || next > 100000 || Math.abs(next * 100 - Math.round(next * 100)) > 1e-6)) {
        setEditError(`${FIELD_LABEL[f]} must be a number from 0 to 100,000 with up to 2 decimal places`);
        return;
      }
      const field = view === 'commercial' ? commercialField(f) : f;
      const current = num(rate[field as 'daily_rate']);
      const same = current == null || next == null ? current == null && next == null : Math.abs(current - next) < 0.005;
      if (!same) changes.push({ field, from: current == null ? null : current.toFixed(2), to: next == null ? null : next.toFixed(2) });
    }
    setEditError('');
    if (!changes.length) { setEditingId(null); return; }
    setSaveError('');
    setPending({ rate, changes });
  };

  const confirmChange = async (note: string) => {
    if (!pending) return;
    setSaving(true); setSaveError('');
    try {
      const body: Record<string, string | null> = {};
      for (const c of pending.changes) body[c.field] = c.to;
      const saved = await crewRatesApi.update(pending.rate.id, { ...body, change_note: note || null });
      // A new version has a new id — swap it in place of the old one
      setRates(prev => prev.map(r => (r.id === pending.rate.id ? saved : r)));
      setPending(null);
      setEditingId(null);
      if (activeTab === 'history' || history.length) loadHistory();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const grouped = groupByTrade(rates);
  const bectuTrades    = Object.entries(grouped).filter(([t]) => t !== 'Non-BECTU');
  const nonBectuRates  = grouped['Non-BECTU'] ?? [];

  if (!canManage) return null;

  /** One rate cell: an input while editing, otherwise the value (+ Auto / Set in the Commercial view). */
  const renderCell = (r: CrewRate, f: BaseField, valueClass: string) => {
    if (editingId === r.id) {
      const auto = view === 'commercial' ? upliftOf(r[f], upliftPct) : null;
      return (
        <input
          type="number" step="0.01" min="0" aria-label={FIELD_LABEL[view === 'commercial' ? commercialField(f) : f]}
          value={editValues[f]}
          placeholder={view === 'commercial' ? (auto != null ? `Auto ${auto.toFixed(2)}` : 'Auto') : '—'}
          onChange={e => setEditValues(v => ({ ...v, [f]: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') reviewEdit(r); if (e.key === 'Escape') setEditingId(null); }}
          className={`${view === 'commercial' ? 'w-28' : 'w-24'} border border-blue-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400`}
        />
      );
    }
    const c = cellOf(r, f);
    return (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span className={c.text !== '—' ? valueClass : 'text-slate-300 italic'}>{c.text}</span>
        {c.set === true && (
          <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold"
            title={`Set${r.created_by_name ? ` by ${r.created_by_name}` : ''}${r.effective_from ? ` from ${fmtDate(r.effective_from)}` : ''}`}>Set</span>
        )}
        {c.set === false && (
          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium" title={`Standard rate +${upliftPct}%`}>Auto</span>
        )}
      </span>
    );
  };

  /** Row actions: save / cancel while editing; otherwise history and (for managers) edit. */
  const renderActions = (r: CrewRate) => (
    editingId === r.id ? (
      <div className="flex items-center gap-1 justify-end">
        <button onClick={() => reviewEdit(r)} disabled={saving}
          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50" title="Save" aria-label="Save">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button onClick={() => { setEditingId(null); setEditError(''); }}
          className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors" title="Cancel" aria-label="Cancel">
          <X size={13} />
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-1 justify-end">
        <button onClick={() => setHistoryFor(r)}
          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Rate history" aria-label={`Rate history for ${r.rank}`}>
          <History size={13} />
        </button>
        {canWrite && (
          <button onClick={() => startEdit(r)}
            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title={view === 'commercial' ? 'Edit commercial rate' : 'Edit rate'} aria-label={`Edit ${r.rank}`}>
            <Pencil size={13} />
          </button>
        )}
      </div>
    )
  );

  return (
    <>
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
      {pending && (
        <ConfirmChangeModal
          pending={pending} upliftPct={upliftPct} saving={saving} error={saveError}
          onCancel={() => { if (!saving) setPending(null); }} onConfirm={confirmChange}
        />
      )}
      {historyFor && <VersionHistoryModal rate={historyFor} onClose={() => setHistoryFor(null)} />}

      <TopBar title="Rate Card" subtitle="BECTU/Pact Construction Crew Agreement" />
      <main className="flex-1 p-4 md:p-6 space-y-5">

        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {(['current', 'history'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); if (tab === 'history' && !history.length) loadHistory(); }}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {tab === 'current' ? 'Current Rates' : 'Version History'}
              </button>
            ))}
          </div>
          {activeTab === 'current' && (
            <div className="flex items-center gap-2">
              <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
              {canWrite && (
                <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium">
                  <Upload size={13} /> Import New Year Rates
                </button>
              )}
            </div>
          )}
        </div>

        {/* CS-08 / RC: Standard / Commercial view */}
        {activeTab === 'current' && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5" role="tablist" aria-label="Rate card view">
                {(['standard', 'commercial'] as const).map(v => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { setView(v); setEditingId(null); setEditError(''); }}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {v === 'standard' ? 'Standard' : `Commercial (+${upliftPct}%)`}
                  </button>
                ))}
              </div>
              {view === 'commercial' && (
                <span className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Auto</span> = standard +{upliftPct}%. <span className="font-medium text-purple-700">Set</span> values are used as entered — leave a box blank for Auto.
                </span>
              )}
            </div>
            {canWrite && (
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="uplift-pct" className="text-slate-600">Commercial uplift %</label>
                <input id="uplift-pct" type="number" min={0} max={100} step="0.5" placeholder={String(upliftPct)} value={upliftDraft}
                  onChange={e => setUpliftDraft(e.target.value)}
                  className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="button" onClick={saveUplift} disabled={upliftSaving || !upliftDraft.trim()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
                  {upliftSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
                </button>
              </div>
            )}
            {upliftMsg && <p className="w-full text-xs text-slate-600">{upliftMsg}</p>}
            {canWrite && (
              <p className="w-full text-[11px] text-slate-400">
                Rate changes apply to weeks ending from today. Finalised timesheets, processed pay runs, locked forecasts and quotes keep their rates; every change is kept in the rate history.
              </p>
            )}
          </div>
        )}

        {/* History tab */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            {historyLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center"><RefreshCw size={20} className="animate-spin text-slate-400 mx-auto" /></div>
            ) : !history.length ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">No historical rate cards found.</div>
            ) : history.map(yr => (
              <div key={yr.rate_year} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div>
                    <span className="text-slate-900 font-semibold text-sm">{yr.rate_year}</span>
                    <span className="text-slate-400 text-xs ml-3">Superseded versions</span>
                  </div>
                  <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{yr.rows.length} rates</span>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50 sticky top-0">
                      <th className="px-4 py-2 font-semibold text-slate-500 text-left">Trade</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-left">Rank</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-left">From</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-left">To</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-right">Daily</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-right">OT/hr</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-right">Comm. daily</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {yr.rows.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2 text-slate-700">{r.trade}</td>
                          <td className="px-4 py-2 text-slate-600">{r.rank}</td>
                          <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.effective_from)}</td>
                          <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.effective_to)}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{fmt(r.daily_rate)}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{fmt(r.overtime_rate)}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{r.commercial_daily_rate == null ? <span className="text-slate-400">Auto</span> : fmt(r.commercial_daily_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4 text-red-600 text-sm">{error}</div>
        )}
        {editError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-red-600 text-xs" role="alert"><AlertCircle size={13} /> {editError}</div>
        )}

        {/* Non-BECTU Rates — editable */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-slate-900 font-semibold text-sm">Non-BECTU Roles</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {view === 'commercial' ? 'Commercial day and OT rates for director-approved roles.' : 'Director-approved rates. Edit daily and OT rates below.'}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Role</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Daily Rate</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">OT Rate / hr</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 4 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                ))}</tr>
              )) : nonBectuRates.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400 text-xs">No non-BECTU rates found.</td></tr>
              ) : nonBectuRates.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.rank}</td>
                  <td className="px-4 py-3 text-right">{renderCell(r, 'daily_rate', 'text-slate-800 font-medium')}</td>
                  <td className="px-4 py-3 text-right">{renderCell(r, 'overtime_rate', 'text-slate-600')}</td>
                  <td className="px-4 py-3">{renderActions(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* BECTU Rates — editable, grouped by trade */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-slate-900 font-semibold text-sm">BECTU/Pact Rates — 2026/27</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                {view === 'commercial'
                  ? 'Commercial rates used on commercial productions. Set a rate or leave it on Auto.'
                  : <>Union-agreed rates. Edit daily, OT, and weekly rates below, or use &quot;Import New Year Rates&quot; for bulk updates.</>}
              </p>
            </div>
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
              {rates.filter(r => r.rate_type === 'bectu').length} rates active
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Trade</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Rank</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Daily (£)</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">OT / hr (£)</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Weekly (£)</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">{Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                  ))}</tr>
                )) : bectuTrades.map(([trade, tradeRates]) => (
                  tradeRates.map((r, idx) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="px-5 py-2.5">
                        {idx === 0
                          ? <span className="text-slate-800 font-semibold text-xs">{trade}</span>
                          : <span className="text-slate-300 text-xs">↳</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{r.rank}</td>
                      <td className="px-4 py-2.5 text-right">{renderCell(r, 'daily_rate', 'text-slate-800 font-medium')}</td>
                      <td className="px-4 py-2.5 text-right">{renderCell(r, 'overtime_rate', 'text-slate-600')}</td>
                      <td className="px-4 py-2.5 text-right text-xs">{renderCell(r, 'weekly_rate', 'text-slate-500')}</td>
                      <td className="px-4 py-2.5">{renderActions(r)}</td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
