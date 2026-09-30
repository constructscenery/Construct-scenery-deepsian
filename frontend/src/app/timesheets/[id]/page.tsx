'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { timesheetsApi, crewApi, type Timesheet } from '@/lib/api';
import { ChevronLeft, Save, Loader2, AlertCircle, Trash2 } from 'lucide-react';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_OPTIONS = [
  { label: '—', value: '' },
  { label: '£5', value: '5' },
  { label: '£10', value: '10' },
];

const selectCls =
  'border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function fmtDate(d: string) {
  const [y, m, day] = d.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtShort(d: string) {
  const [y, m, day] = d.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtGBP(n: number | string | null | undefined) {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  return `£${(isNaN(v) ? 0 : v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMealValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

// Use local date parts to avoid UTC timezone shift
function getWeekDates(weekEndingDate: string): string[] {
  const [y, m, d] = weekEndingDate.split('T')[0].split('-').map(Number);
  return DAYS_OF_WEEK.map((_, i) => {
    const dt = new Date(y, m - 1, d - 6 + i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  });
}

type DayEntry = {
  date: string;
  day_of_week: string;
  full_day_worked: boolean;
  overtime_hours: string;
  set_number: string;
  site: string;
  travel: string;
  mileage: string;
  per_diem: string;
  ad_hoc_reimbursement: string;
  meal_allowance_breakfast: string;
  meal_allowance_lunch: string;
  meal_allowance_supper: string;
};

type TsRecord = Timesheet & Record<string, unknown>;

export default function TimesheetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnProductionId = searchParams.get('production_id') ?? '';
  const returnWeekEnding = searchParams.get('week_ending_date') ?? '';

  const [ts, setTs]           = useState<TsRecord | null>(null);
  const [trades, setTrades]   = useState<{ bectu: Record<string, string[]>; non_bectu: string[] } | null>(null);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [rankOverride, setRankOverride] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleBack = () => {
    if (isDirty) {
      const leave = window.confirm('You have unsaved changes. Are you sure you want to leave without saving?');
      if (!leave) return;
    }
    const qs = new URLSearchParams();
    if (returnProductionId) qs.set('production_id', returnProductionId);
    if (returnWeekEnding) qs.set('week_ending_date', returnWeekEnding);
    router.push(qs.toString() ? `/timesheets?${qs.toString()}` : '/timesheets');
  };

  const handleDelete = async () => {
    if (!ts) return;
    const name = `${ts.first_name ?? ''} ${ts.last_name ?? ''}`.trim() || 'Crew member';
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete this timesheet for ${name} (week ending ${fmtDate(ts.week_ending_date)})? This will remove all day entries and cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    try {
      await timesheetsApi.delete(id);
      const qs = new URLSearchParams();
      if (returnProductionId) qs.set('production_id', returnProductionId);
      if (returnWeekEnding) qs.set('week_ending_date', returnWeekEnding);
      router.push(qs.toString() ? `/timesheets?${qs.toString()}` : '/timesheets');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete timesheet');
      setDeleting(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [tsData, tradesData] = await Promise.all([
        timesheetsApi.getById(id),
        crewApi.getTrades(),
      ]);
      const ts = tsData as TsRecord;
      setTs(ts);
      setTrades(tradesData);
      setRankOverride((ts.rank_override as string) ?? '');

      const dates = getWeekDates(ts.week_ending_date);
      const existing = (ts.timesheet_entries as DayEntry[]) ?? [];
      // Normalize date keys — DB may return full ISO timestamp "2026-06-07T00:00:00.000Z"
      const existingMap = Object.fromEntries(
        existing.map(e => [String(e.date).split('T')[0], e])
      );

      setEntries(dates.map((date, i) => {
        const ex = existingMap[date];
        return {
          date,
          day_of_week:              DAYS_OF_WEEK[i],
          full_day_worked:          ex?.full_day_worked ?? false,
          overtime_hours:           String(ex?.overtime_hours ?? '0'),
          set_number:               ex?.set_number ?? '',
          site:                     ex?.site ?? '',
          travel:                   String(ex?.travel ?? '0'),
          mileage:                  String(ex?.mileage ?? '0'),
          per_diem:                 String(ex?.per_diem ?? '0'),
          ad_hoc_reimbursement:     String(ex?.ad_hoc_reimbursement ?? '0'),
          meal_allowance_breakfast: fmtMealValue(ex?.meal_allowance_breakfast),
          meal_allowance_lunch:     fmtMealValue(ex?.meal_allowance_lunch),
          meal_allowance_supper:    fmtMealValue(ex?.meal_allowance_supper),
        };
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load timesheet');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateEntry = (idx: number, field: keyof DayEntry, value: string | boolean) => {
    setIsDirty(true);
    setEntries(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const hasAnyWork = entries.some(e =>
        e.full_day_worked ||
        parseFloat(e.overtime_hours || '0') > 0 ||
        parseFloat(e.travel || '0') > 0 ||
        parseFloat(e.mileage || '0') > 0 ||
        parseFloat(e.per_diem || '0') > 0 ||
        parseFloat(e.ad_hoc_reimbursement || '0') > 0 ||
        e.meal_allowance_breakfast ||
        e.meal_allowance_lunch ||
        e.meal_allowance_supper ||
        e.set_number.trim() !== '' ||
        e.site.trim() !== ''
      );

      if (!hasAnyWork) {
        setError('Please tick at least one day worked or enter hours/allowances/details before saving.');
        setSaving(false);
        return;
      }

      const payload: Record<string, unknown> = {
        entries: entries.map(e => ({
          date:                     e.date,
          day_of_week:              e.day_of_week,
          full_day_worked:          e.full_day_worked,
          overtime_hours:           parseFloat(e.overtime_hours || '0'),
          set_number:               e.set_number || null,
          site:                     e.site || null,
          travel:                   parseFloat(e.travel || '0'),
          mileage:                  parseFloat(e.mileage || '0'),
          per_diem:                 parseFloat(e.per_diem || '0'),
          ad_hoc_reimbursement:     parseFloat(e.ad_hoc_reimbursement || '0'),
          meal_breakfast:           e.meal_allowance_breakfast !== '',
          meal_lunch:               e.meal_allowance_lunch !== '',
          meal_supper:              e.meal_allowance_supper !== '',
          meal_allowance_breakfast: e.meal_allowance_breakfast ? parseFloat(e.meal_allowance_breakfast) : null,
          meal_allowance_lunch:     e.meal_allowance_lunch     ? parseFloat(e.meal_allowance_lunch)     : null,
          meal_allowance_supper:    e.meal_allowance_supper    ? parseFloat(e.meal_allowance_supper)    : null,
        })),
      };

      const defaultRank = ts ? String(ts.crew_rank ?? '') : '';
      if (rankOverride && rankOverride !== defaultRank) {
        payload.rank_override = rankOverride;
      }

      await fetch(`/api/timesheets/${id}/entries`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
        },
        body: JSON.stringify(payload),
      }).then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error((e as { error?: string }).error ?? 'Save failed');
        }
        return r.json();
      });

      setIsDirty(false);
      await load();
      const qs = new URLSearchParams();
      if (returnProductionId) qs.set('production_id', returnProductionId);
      if (returnWeekEnding) qs.set('week_ending_date', returnWeekEnding);
      router.push(qs.toString() ? `/timesheets?${qs.toString()}` : '/timesheets');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    // Automatically save entries first
    await handleSave();
    if (error) return; // if save failed, abort submit
    
    setSaving(true);
    setError('');
    try {
      await timesheetsApi.submit(id);
      await load();
      const qs = new URLSearchParams();
      if (returnProductionId) qs.set('production_id', returnProductionId);
      if (returnWeekEnding) qs.set('week_ending_date', returnWeekEnding);
      router.push(qs.toString() ? `/timesheets?${qs.toString()}` : '/timesheets');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  const defaultRank    = ts ? String(ts.crew_rank ?? '') : '';
  const currentTrade   = ts ? String(ts.crew_trade ?? '') : '';
  const availableRanks: string[] = trades
    ? (trades.bectu[currentTrade] ?? []).concat(trades.non_bectu)
    : [];

  const isLocked       = ts?.status === 'finalised';
  const isSelfEmployed = ts ? String(ts.employment_status) === 'self_employed' : false;
  const vatRegistered  = isSelfEmployed && !!ts?.vat_registration_number;

  // Rates from backend (fetched on load)
  const dailyRate = parseFloat(String(ts?.daily_rate    ?? '0')) || 0;
  const otRate    = parseFloat(String(ts?.overtime_rate ?? '0')) || 0;

  // ── Real-time totals calculated from current form state ────────────────────
  const stdDays      = entries.filter(e => e.full_day_worked && !['Saturday','Sunday'].includes(e.day_of_week)).length;
  const satWorked    = entries.some(e => e.day_of_week === 'Saturday' && e.full_day_worked);
  const sunWorked    = entries.some(e => e.day_of_week === 'Sunday'   && e.full_day_worked);
  const totalOTHours = entries.reduce((s, e) => s + (parseFloat(e.overtime_hours || '0') || 0), 0);
  const mealTotal    = entries.reduce((s, e) =>
    s + (parseFloat(e.meal_allowance_breakfast || '0') || 0)
      + (parseFloat(e.meal_allowance_lunch     || '0') || 0)
      + (parseFloat(e.meal_allowance_supper    || '0') || 0), 0);
  const travelTotal  = entries.reduce((s, e) => s + (parseFloat(e.travel || '0') || 0), 0);
  const mileageTotal = entries.reduce((s, e) => s + (parseFloat(e.mileage || '0') || 0), 0);
  const perDiemTotal = entries.reduce((s, e) => s + (parseFloat(e.per_diem || '0') || 0), 0);
  const adHocTotal   = entries.reduce((s, e) => s + (parseFloat(e.ad_hoc_reimbursement || '0') || 0), 0);
  const foodTotal    = mealTotal;

  const weeklyRate     = dailyRate * stdDays;
  const saturdayPay   = satWorked ? dailyRate * 1.5 : 0;
  const sundayPay     = sunWorked ? dailyRate * 2.0  : 0;
  const overtimeAmount = totalOTHours * otRate;
  const netTotalAmount = weeklyRate + saturdayPay + sundayPay + overtimeAmount + mealTotal + travelTotal + mileageTotal + perDiemTotal + adHocTotal;
  const grossTotal    = netTotalAmount;
  const vat           = vatRegistered ? grossTotal * 0.20 : 0;
  const grandTotal    = grossTotal + vat;
  const hasTotals     = dailyRate > 0; // show totals as soon as we have a rate

  if (loading) {
    return (
      <>
        <TopBar title="Timesheet" subtitle="Loading…" />
        <main className="flex-1 p-4 md:p-6 space-y-4">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-xl" />
          ))}
        </main>
      </>
    );
  }

  if (!ts) {
    return (
      <>
        <TopBar title="Timesheet" subtitle="Not found" />
        <main className="flex-1 p-4 md:p-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700 text-sm">{error || 'Timesheet not found'}</div>
        </main>
      </>
    );
  }

  const crewName = `${ts.first_name ?? ''} ${ts.last_name ?? ''}`.trim() || 'Unknown';
  const prodName = String(ts.prod_name ?? '');

  return (
    <>
      <TopBar
        title={`Timesheet — ${crewName}`}
        subtitle={`${prodName} · w/e ${fmtDate(ts.week_ending_date)}${ts.amended_at ? ` · Amended: ${new Date(ts.amended_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`}
      />
      <main className="flex-1 p-4 md:p-6 space-y-4">

        {/* Back + Save bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm font-medium"
          >
            <ChevronLeft size={16} /> Back to Timesheets
          </button>
          {!isLocked && (
            <div className="flex items-center gap-3">
              {error && <span className="text-red-600 text-sm flex items-center gap-1.5"><AlertCircle size={14} />{error}</span>}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="flex items-center gap-1.5 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 text-sm px-3.5 py-2 rounded-lg font-medium transition-colors disabled:opacity-60 shadow-sm"
                title="Permanently delete this timesheet"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete Timesheet
              </button>
              <button
                onClick={handleSave}
                disabled={saving || deleting}
                className="flex items-center gap-2 bg-slate-100 text-slate-700 text-sm px-4 py-2 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-60 shadow-sm transition-colors border border-slate-200"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Entries
              </button>
              {ts.status === 'draft' && (
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60 shadow-sm transition-colors"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Submit Timesheet
                </button>
              )}
            </div>
          )}
        </div>

        {isLocked && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm flex items-center gap-2">
            <AlertCircle size={15} /> This timesheet is locked ({ts.status}) and cannot be edited.
          </div>
        )}

        {/* Rank override */}
        {!isLocked && availableRanks.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-slate-900 font-semibold text-sm mb-1">Rank Override This Week</h2>
            <p className="text-slate-500 text-xs mb-3">
              Default rank: <span className="font-medium text-slate-700">{defaultRank}</span>.{' '}
              Select a different rank if this crew member was promoted or acted up this week.
              This only affects this week&apos;s rate — the Crew Database record is not changed.
            </p>
            <select
              value={rankOverride || defaultRank}
              onChange={e => {
                setIsDirty(true);
                setRankOverride(e.target.value === defaultRank ? '' : e.target.value);
              }}
              className={selectCls + ' w-64'}
            >
              <option value={defaultRank}>{defaultRank} (default)</option>
              {availableRanks.filter(r => r !== defaultRank).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {rankOverride && rankOverride !== defaultRank && (
              <span className="ml-3 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Override active</span>
            )}
          </div>
        )}

        {/* Daily entries table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-slate-900 font-semibold text-sm">Daily Entries</h2>
            <p className="text-slate-400 text-xs mt-0.5">Tick days worked, set OT hours, site, and meal allowances</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-28">Day</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-center w-20">Worked</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">OT Hrs</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Set No.</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left">Site</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-20">Travel £</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">Mileage £</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">Per Diem £</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">Ad Hoc £</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">Breakfast</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">Lunch</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-left w-24">Supper</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e, i) => {
                  const isWeekend = e.day_of_week === 'Saturday' || e.day_of_week === 'Sunday';
                  return (
                    <tr key={e.date} className={`${isWeekend ? 'bg-slate-50/50' : ''} ${isLocked ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="text-slate-900 font-medium text-sm">{e.day_of_week}</p>
                        <p className="text-slate-400 text-xs">{fmtShort(e.date)}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={e.full_day_worked}
                          onChange={ev => !isLocked && updateEntry(i, 'full_day_worked', ev.target.checked)}
                          disabled={isLocked}
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number" min="0" step="0.5"
                          value={e.overtime_hours}
                          onChange={ev => !isLocked && updateEntry(i, 'overtime_hours', ev.target.value)}
                          disabled={isLocked}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text" placeholder="—"
                          value={e.set_number}
                          onChange={ev => !isLocked && updateEntry(i, 'set_number', ev.target.value)}
                          disabled={isLocked}
                          className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text" placeholder="—"
                          value={e.site}
                          onChange={ev => !isLocked && updateEntry(i, 'site', ev.target.value)}
                          disabled={isLocked}
                          className="w-32 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number" min="0" step="0.01"
                          value={e.travel}
                          onChange={ev => !isLocked && updateEntry(i, 'travel', ev.target.value)}
                          disabled={isLocked}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number" min="0" step="0.01"
                          value={e.mileage}
                          onChange={ev => !isLocked && updateEntry(i, 'mileage', ev.target.value)}
                          disabled={isLocked}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number" min="0" step="0.01"
                          value={e.per_diem}
                          onChange={ev => !isLocked && updateEntry(i, 'per_diem', ev.target.value)}
                          disabled={isLocked}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number" min="0" step="0.01"
                          value={e.ad_hoc_reimbursement}
                          onChange={ev => !isLocked && updateEntry(i, 'ad_hoc_reimbursement', ev.target.value)}
                          disabled={isLocked}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      {(['meal_allowance_breakfast', 'meal_allowance_lunch', 'meal_allowance_supper'] as const).map(field => (
                        <td key={field} className="px-4 py-3">
                          <select
                            value={e[field]}
                            onChange={ev => !isLocked && updateEntry(i, field, ev.target.value)}
                            disabled={isLocked}
                            className={selectCls + ' w-20'}
                          >
                            {MEAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Weekly Totals — live, updates as form changes */}
        {hasTotals && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-slate-900 font-semibold text-sm mb-4">Weekly Totals</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Weekly Rate</p>
                <p className="text-slate-900 font-semibold">{fmtGBP(weeklyRate)}</p>
                <p className="text-slate-400 text-[10px]">{stdDays} day{stdDays !== 1 ? 's' : ''} × {fmtGBP(dailyRate)}</p>
              </div>
              {(saturdayPay > 0 || sundayPay > 0) && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Weekend Premium</p>
                  <p className="text-slate-900 font-semibold">{fmtGBP(saturdayPay + sundayPay)}</p>
                  <p className="text-slate-400 text-[10px]">{satWorked ? 'Sat ×1.5' : ''}{satWorked && sunWorked ? ' · ' : ''}{sunWorked ? 'Sun ×2' : ''}</p>
                </div>
              )}
              <div>
                <p className="text-slate-400 text-xs mb-0.5">OT Amount</p>
                <p className="text-slate-900 font-semibold">{fmtGBP(overtimeAmount)}</p>
                <p className="text-slate-400 text-[10px]">{totalOTHours}h × {fmtGBP(otRate)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Meal Total</p>
                <p className="text-slate-900 font-semibold">{fmtGBP(mealTotal)}</p>
              </div>
              {travelTotal > 0 && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Travel</p>
                  <p className="text-slate-900 font-semibold">{fmtGBP(travelTotal)}</p>
                </div>
              )}
              {mileageTotal > 0 && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Mileage</p>
                  <p className="text-slate-900 font-semibold">{fmtGBP(mileageTotal)}</p>
                </div>
              )}
              {perDiemTotal > 0 && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Per Diem</p>
                  <p className="text-slate-900 font-semibold">{fmtGBP(perDiemTotal)}</p>
                </div>
              )}
              {adHocTotal > 0 && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Ad Hoc</p>
                  <p className="text-slate-900 font-semibold">{fmtGBP(adHocTotal)}</p>
                </div>
              )}
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Gross Total</p>
                <p className="text-slate-900 font-bold text-lg">{fmtGBP(grossTotal)}</p>
              </div>
              {vatRegistered && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">VAT (20%)</p>
                  <p className="text-slate-900 font-semibold">{fmtGBP(vat)}</p>
                </div>
              )}
              {vatRegistered && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Grand Total (inc. VAT)</p>
                  <p className="text-blue-700 font-bold text-lg">{fmtGBP(grandTotal)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-slate-900 font-semibold text-sm mb-4">Net Amount Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
            <div>
              <p className="text-slate-400 text-xs mb-0.5">OT Amount</p>
              <p className="text-slate-900 font-semibold">{fmtGBP(overtimeAmount)}</p>
              <p className="text-slate-400 text-[10px]">{totalOTHours}h × {fmtGBP(otRate)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Travel Amount</p>
              <p className="text-slate-900 font-semibold">{fmtGBP(travelTotal)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Mileage Amount</p>
              <p className="text-slate-900 font-semibold">{fmtGBP(mileageTotal)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Per Diem Amount</p>
              <p className="text-slate-900 font-semibold">{fmtGBP(perDiemTotal)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Ad Hoc Amount</p>
              <p className="text-slate-900 font-semibold">{fmtGBP(adHocTotal)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Food Amount</p>
              <p className="text-slate-900 font-semibold">{fmtGBP(foodTotal)}</p>
              <p className="text-slate-400 text-[10px]">Breakfast + Lunch + Supper</p>
            </div>
            <div className="lg:col-span-1">
              <p className="text-slate-400 text-xs mb-0.5">Net Total Amount</p>
              <p className="text-blue-700 font-bold text-lg">{fmtGBP(netTotalAmount)}</p>
            </div>
          </div>
        </div>

        {/* Bottom save bar */}
        {!isLocked && (
          <div className="flex items-center justify-end gap-3">
            {error && <span className="text-red-600 text-sm flex items-center gap-1.5"><AlertCircle size={14} />{error}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60 shadow-sm"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Entries
            </button>
          </div>
        )}
      </main>
    </>
  );
}
