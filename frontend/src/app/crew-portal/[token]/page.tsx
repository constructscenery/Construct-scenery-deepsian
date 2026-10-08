'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  HardHat, ClipboardList, Receipt, CalendarCheck, Loader2, AlertCircle, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Upload, Undo2, XCircle,
} from 'lucide-react';
import {
  crewPortalApi, fmtDate, fmtDateTime,
  type PortalDay, type PortalHome, type PortalInvoice, type PortalOutstandingInvoice, type PortalPoll,
  type PortalSubmission, type PortalWeek, type SubmissionStatus,
} from '@/lib/emailingApi';

const input = 'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-base sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';
const label = 'block text-xs font-semibold text-slate-600 mb-1';
const primary = 'w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm disabled:opacity-60';

type Tab = 'timesheet' | 'invoices' | 'availability';

const STATUS_COPY: Record<SubmissionStatus, { label: string; cls: string }> = {
  submitted: { label: 'Waiting for approval', cls: 'bg-blue-50 text-blue-700' },
  returned: { label: 'Changes requested', cls: 'bg-amber-50 text-amber-800' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700' },
  declined: { label: 'Declined', cls: 'bg-red-50 text-red-700' },
};
function Badge({ status }: { status: SubmissionStatus }) {
  const s = STATUS_COPY[status];
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}
function Banner({ tone, icon: Icon, children }: { tone: 'blue' | 'amber' | 'emerald' | 'red'; icon: typeof AlertCircle; children: ReactNode }) {
  const tones = { blue: 'bg-blue-50 border-blue-200 text-blue-900', amber: 'bg-amber-50 border-amber-200 text-amber-900', emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900', red: 'bg-red-50 border-red-200 text-red-900' };
  return <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${tones[tone]}`}><Icon size={18} className="shrink-0 mt-0.5" /><div className="min-w-0">{children}</div></div>;
}

export default function CrewPortalPage() {
  return (
    <Suspense fallback={<FullPage><Loader2 className="animate-spin text-blue-600" /></FullPage>}>
      <Portal />
    </Suspense>
  );
}

function FullPage({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">{children}</div>;
}

function Portal() {
  const { token } = useParams<{ token: string }>();
  const params = useSearchParams();
  const [home, setHome] = useState<PortalHome | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'timesheet');

  const loadHome = useCallback(() => {
    crewPortalApi.home(token).then(setHome).catch((e) => setError(e instanceof Error ? e.message : 'This link could not be opened.'));
  }, [token]);
  useEffect(loadHome, [loadHome]);

  if (error) {
    return (
      <FullPage>
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-3">
          <AlertCircle size={36} className="mx-auto text-amber-500" />
          <h1 className="text-lg font-bold text-slate-900">Link unavailable</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <p className="text-xs text-slate-500">Construct Scenery · invoice@constructscenery.co.uk</p>
        </div>
      </FullPage>
    );
  }
  if (!home) return <FullPage><Loader2 className="animate-spin text-blue-600" /></FullPage>;

  const tabs: { key: Tab; label: string; icon: typeof ClipboardList; badge?: number }[] = [
    { key: 'timesheet', label: 'Timesheet', icon: ClipboardList, badge: home.alerts.timesheets_returned },
    ...(home.crew.needs_invoices ? [{ key: 'invoices' as Tab, label: 'Invoices', icon: Receipt, badge: home.alerts.invoices_returned }] : []),
    { key: 'availability', label: 'Availability', icon: CalendarCheck, badge: home.alerts.polls_awaiting },
  ];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'timesheet';

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 sm:py-8 space-y-4">
      <header className="bg-gradient-to-r from-slate-900 to-blue-900 rounded-2xl p-5 text-white shadow">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><HardHat size={22} className="text-blue-200" /></div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-blue-200">Construct Scenery · Crew portal</p>
            <h1 className="text-lg font-bold truncate">Hi {home.crew.first_name}</h1>
          </div>
        </div>
        <p className="mt-3 text-xs text-blue-100">Crew no. {home.crew.crew_number} · This link is personal to you — please don&apos;t share it.</p>
      </header>

      <nav className="grid gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(({ key, label: l, icon: Icon, badge }) => (
          <button key={key} onClick={() => setTab(key)} className={`relative inline-flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-sm font-semibold ${activeTab === key ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>
            <Icon size={16} /> {l}
            {!!badge && <span className={`ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] leading-[18px] ${activeTab === key ? 'bg-white text-blue-700' : 'bg-amber-500 text-white'}`}>{badge}</span>}
          </button>
        ))}
      </nav>

      {activeTab === 'timesheet' && <TimesheetSection token={token} home={home} initialProduction={params.get('production')} initialWeek={params.get('week')} onChanged={loadHome} />}
      {activeTab === 'invoices' && <InvoiceSection token={token} home={home} initialProduction={params.get('production')} initialWeek={params.get('week')} onChanged={loadHome} />}
      {activeTab === 'availability' && <AvailabilitySection token={token} highlight={params.get('poll')} onChanged={loadHome} />}

      <footer className="text-center text-xs text-slate-400 pt-2">Questions? Reply to the email you received, or contact invoice@constructscenery.co.uk</footer>
    </div>
  );
}

// ─── Timesheet ───────────────────────────────────────────────────────────────

const weekLabel = (iso: string, i: number) => `${fmtDate(iso)}${i === 0 ? ' (this week)' : i === 1 ? ' (last week)' : ''}`;

function TimesheetSection({ token, home, initialProduction, initialWeek, onChanged }: { token: string; home: PortalHome; initialProduction: string | null; initialWeek: string | null; onChanged: () => void }) {
  const [productionId, setProductionId] = useState(home.productions.some((p) => p.id === initialProduction) ? initialProduction! : (home.productions.length === 1 ? home.productions[0].id : ''));
  const [week, setWeek] = useState(initialWeek && home.weeks.includes(initialWeek) ? initialWeek : home.weeks[1] ?? home.weeks[0]);
  const [data, setData] = useState<PortalWeek | null>(null);
  const [days, setDays] = useState<PortalDay[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [history, setHistory] = useState<PortalSubmission[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const loadHistory = useCallback(() => { crewPortalApi.timesheets(token).then(setHistory).catch(() => {}); }, [token]);
  useEffect(loadHistory, [loadHistory]);

  useEffect(() => {
    if (!productionId || !week) return;
    const t = setTimeout(() => {
      setLoading(true);
      setError('');
      setDone('');
      crewPortalApi.week(token, productionId, week)
        .then((w) => { setData(w); setDays(w.days); setNotes(w.submission?.crew_notes ?? ''); })
        .catch((e) => { setData(null); setError(e instanceof Error ? e.message : 'Could not load this week'); })
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(t);
  }, [token, productionId, week]);

  const update = (i: number, patch: Partial<PortalDay>) => setDays((d) => d.map((day, idx) => (idx === i ? { ...day, ...patch, ...(patch.full_day_worked === false ? { overtime_hours: 0 } : {}) } : day)));
  const daysWorked = days.filter((d) => d.full_day_worked).length;
  const ot = days.reduce((s, d) => s + (Number(d.overtime_hours) || 0), 0);

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await crewPortalApi.submitTimesheet(token, { production_id: productionId, week_ending_date: week, entries: days, notes: notes || undefined });
      setDone(res.message);
      const w = await crewPortalApi.week(token, productionId, week);
      setData(w); setDays(w.days);
      loadHistory();
      onChanged();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setSaving(false);
    }
  };

  const sub = productionId ? data?.submission : undefined;
  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="p">Production</label>
            <select id="p" className={input} value={productionId} onChange={(e) => setProductionId(e.target.value)}>
              <option value="">Choose production…</option>
              {home.productions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="w">Week ending (Sunday)</label>
            <select id="w" className={input} value={week} onChange={(e) => setWeek(e.target.value)}>
              {home.weeks.map((w, i) => <option key={w} value={w}>{weekLabel(w, i)}</option>)}
            </select>
          </div>
        </div>
        {!home.productions.length && <Banner tone="amber" icon={AlertCircle}>There are no productions open for timesheets right now. Please contact the office.</Banner>}
      </section>

      {done && <Banner tone="emerald" icon={CheckCircle2}>{done}. You&apos;ll get an email if the office needs anything changed.</Banner>}
      {error && <Banner tone="red" icon={AlertCircle}>{error}</Banner>}

      {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-600" /></div> : productionId && data && (
        <>
          {sub?.status === 'submitted' && <Banner tone="blue" icon={Clock}>Submitted {fmtDateTime(sub.submitted_at)} — waiting for approval. You can still make changes until the office reviews it.</Banner>}
          {sub?.status === 'returned' && <Banner tone="amber" icon={Undo2}><strong>The office asked for changes:</strong><div className="mt-1 whitespace-pre-wrap">{sub.reviewer_notes}</div><div className="mt-1 text-xs">Update the days below and resubmit.</div></Banner>}
          {sub?.status === 'approved' && <Banner tone="emerald" icon={CheckCircle2}>Approved {fmtDateTime(sub.reviewed_at)}.</Banner>}
          {sub?.status === 'declined' && <Banner tone="red" icon={XCircle}><strong>Declined:</strong> {sub.reviewer_notes}<div className="mt-1 text-xs">You can submit a new timesheet for this week if needed.</div></Banner>}
          {data.locked_reason && sub?.status !== 'approved' && <Banner tone="amber" icon={AlertCircle}>{data.locked_reason}</Banner>}

          <section className="space-y-2">
            {days.map((d, i) => <DayCard key={d.date} day={d} disabled={!data.editable} onChange={(p) => update(i, p)} />)}
          </section>

          {data.editable && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600"><strong className="text-slate-900">{daysWorked}</strong> day{daysWorked === 1 ? '' : 's'} · <strong className="text-slate-900">{ot}</strong>h overtime</span>
              </div>
              <textarea className={input} rows={2} placeholder="Notes for the office (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
              <button className={primary} disabled={saving || !productionId || !daysWorked} onClick={submit}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {sub && sub.status !== 'declined' ? 'Resubmit timesheet' : 'Submit timesheet'}
              </button>
              <p className="text-[11px] text-slate-500">Pay is worked out by the office from the rate card. Your timesheet isn&apos;t final until it&apos;s approved.</p>
            </section>
          )}
        </>
      )}

      {!!history.length && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">Your recent timesheets</h2>
          <ul className="divide-y divide-slate-100 mt-2">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen(open === h.id ? null : h.id)}>
                  <span className="min-w-0"><span className="block text-sm font-medium text-slate-800">w/e {fmtDate(h.week_ending_date)}</span><span className="block text-xs text-slate-500 truncate">{h.production_name} · {h.days_worked ?? 0} days</span></span>
                  <Badge status={h.status} />
                </button>
                {open === h.id && h.reviewer_notes && <p className="mt-2 text-xs text-slate-600 whitespace-pre-wrap">Office: {h.reviewer_notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DayCard({ day, disabled, onChange }: { day: PortalDay; disabled: boolean; onChange: (p: Partial<PortalDay>) => void }) {
  const money = (day.travel || 0) + (day.mileage || 0) + (day.per_diem || 0) + (day.ad_hoc_reimbursement || 0);
  const [open, setOpen] = useState(false);
  const summary = [
    day.set_number && `Set ${day.set_number}`,
    day.site,
    [day.meal_breakfast && 'Breakfast', day.meal_lunch && 'Lunch', day.meal_supper && 'Supper'].filter(Boolean).join(', '),
    money > 0 && `£${money.toFixed(2)} expenses`,
  ].filter(Boolean).join(' · ');
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <div className={`bg-white rounded-xl border shadow-sm ${day.full_day_worked ? 'border-blue-200' : 'border-slate-200'}`}>
      <div className="flex items-center gap-3 p-3">
        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-blue-600" checked={day.full_day_worked} disabled={disabled} onChange={(e) => onChange({ full_day_worked: e.target.checked })} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">{day.day_of_week}</span>
            <span className="block text-xs text-slate-500 truncate">{fmtDate(day.date)}{!open && summary ? ` · ${summary}` : ''}</span>
          </span>
        </label>
        <div className="w-24">
          <label className="sr-only" htmlFor={`ot-${day.date}`}>Overtime hours</label>
          <input id={`ot-${day.date}`} type="number" inputMode="decimal" min={0} max={16} step={0.25} placeholder="OT hrs" className={`${input} !py-2 text-right`}
            value={day.overtime_hours || ''} disabled={disabled || !day.full_day_worked} onChange={(e) => onChange({ overtime_hours: num(e.target.value) })} />
        </div>
        <button type="button" className="p-2 text-slate-400" onClick={() => setOpen(!open)} aria-label={open ? 'Hide details' : 'Show details'} aria-expanded={open}>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-100 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div><label className={label} htmlFor={`set-${day.date}`}>Set no.</label><input id={`set-${day.date}`} className={input} value={day.set_number} disabled={disabled} onChange={(e) => onChange({ set_number: e.target.value })} maxLength={50} /></div>
          <div><label className={label} htmlFor={`site-${day.date}`}>Site</label><input id={`site-${day.date}`} className={input} value={day.site} disabled={disabled} onChange={(e) => onChange({ site: e.target.value })} maxLength={120} /></div>
          {([['travel', 'Travel £'], ['mileage', 'Mileage £'], ['per_diem', 'Per diem £'], ['ad_hoc_reimbursement', 'Other expenses £']] as const).map(([k, l]) => (
            <div key={k}><label className={label} htmlFor={`${k}-${day.date}`}>{l}</label><input id={`${k}-${day.date}`} type="number" inputMode="decimal" min={0} step={0.01} className={input} value={day[k] || ''} disabled={disabled} onChange={(e) => onChange({ [k]: num(e.target.value) } as Partial<PortalDay>)} /></div>
          ))}
          <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-4 pt-1 text-sm text-slate-700">
            <span className="text-xs font-semibold text-slate-600">Meals:</span>
            {([['meal_breakfast', 'Breakfast'], ['meal_lunch', 'Lunch'], ['meal_supper', 'Supper']] as const).map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={day[k]} disabled={disabled} onChange={(e) => onChange({ [k]: e.target.checked } as Partial<PortalDay>)} /> {l}</label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invoices ────────────────────────────────────────────────────────────────

function InvoiceSection({ token, home, initialProduction, initialWeek, onChanged }: { token: string; home: PortalHome; initialProduction: string | null; initialWeek: string | null; onChanged: () => void }) {
  const [list, setList] = useState<PortalInvoice[]>([]);
  const [outstanding, setOutstanding] = useState<PortalOutstandingInvoice[]>([]);
  const [productionId, setProductionId] = useState(initialProduction ?? (home.productions.length === 1 ? home.productions[0].id : ''));
  const [week, setWeek] = useState(initialWeek ?? home.weeks[1] ?? home.weeks[0]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(() => {
    crewPortalApi.invoices(token).then((r) => { setList(r.invoices); setOutstanding(r.outstanding); }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load invoices'));
  }, [token]);
  useEffect(load, [load]);

  const weekOptions = useMemo(() => Array.from(new Set([...home.weeks, ...outstanding.map((o) => o.week_ending_date), ...(initialWeek ? [initialWeek] : [])])).sort().reverse(), [home.weeks, outstanding, initialWeek]);
  const productionOptions = useMemo(() => {
    const map = new Map(home.productions.map((p) => [p.id, p.name]));
    outstanding.forEach((o) => map.set(o.production_id, o.production_name));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [home.productions, outstanding]);
  const current = list.find((i) => i.production_id === productionId && i.week_ending_date === week && i.status !== 'declined');
  const blocked = current?.status === 'approved';

  const submit = async () => {
    if (!file) { setError('Attach your invoice'); return; }
    setSaving(true);
    setError('');
    setDone('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('production_id', productionId);
      form.append('week_ending_date', week);
      if (invoiceNumber) form.append('invoice_number', invoiceNumber);
      if (amount) form.append('amount', amount);
      if (notes) form.append('notes', notes);
      const res = await crewPortalApi.uploadInvoice(token, form);
      setDone(res.message);
      setFile(null); setInvoiceNumber(''); setAmount(''); setNotes('');
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {!!outstanding.length && (
        <section className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Invoices we&apos;re waiting for</h2>
          <ul className="space-y-1.5">
            {outstanding.map((o) => (
              <li key={`${o.production_id}${o.week_ending_date}`}>
                <button onClick={() => { setProductionId(o.production_id); setWeek(o.week_ending_date); setAmount(Number(o.grand_total).toFixed(2)); }} className="w-full flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-sm">
                  <span className="min-w-0 truncate">w/e {fmtDate(o.week_ending_date)} · {o.production_name}</span>
                  <span className="font-semibold text-amber-900">£{Number(o.grand_total).toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Upload an invoice</h2>
        {done && <Banner tone="emerald" icon={CheckCircle2}>{done}.</Banner>}
        {error && <Banner tone="red" icon={AlertCircle}>{error}</Banner>}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="ip">Production</label>
            <select id="ip" className={input} value={productionId} onChange={(e) => setProductionId(e.target.value)}>
              <option value="">Choose production…</option>
              {productionOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="iw">Week ending</label>
            <select id="iw" className={input} value={week} onChange={(e) => setWeek(e.target.value)}>
              {weekOptions.map((w) => <option key={w} value={w}>{fmtDate(w)}</option>)}
            </select>
          </div>
          <div><label className={label} htmlFor="in">Invoice number</label><input id="in" className={input} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={60} /></div>
          <div><label className={label} htmlFor="ia">Amount (£)</label><input id="ia" className={input} type="number" inputMode="decimal" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        {current?.status === 'returned' && <Banner tone="amber" icon={Undo2}><strong>Changes requested:</strong> {current.reviewer_notes}<div className="text-xs mt-1">Upload a corrected invoice below.</div></Banner>}
        {current?.status === 'submitted' && <Banner tone="blue" icon={Clock}>An invoice for this week is waiting for approval. Uploading again replaces it.</Banner>}
        {blocked && <Banner tone="emerald" icon={CheckCircle2}>The invoice for this week has been approved.</Banner>}
        <label className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center cursor-pointer ${file ? 'border-blue-300 bg-blue-50' : 'border-slate-300'}`}>
          <Upload size={20} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">{file ? file.name : 'Choose a PDF, JPEG or PNG'}</span>
          <span className="text-xs text-slate-500">Max 25 MB · you can take a photo on your phone</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <textarea className={input} rows={2} placeholder="Notes for the office (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <button className={primary} disabled={saving || !file || !productionId || blocked} onClick={submit}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Send invoice
        </button>
      </section>

      {!!list.length && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">Your invoices</h2>
          <ul className="divide-y divide-slate-100 mt-2">
            {list.map((i) => (
              <li key={i.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0"><span className="block text-sm font-medium text-slate-800">w/e {fmtDate(i.week_ending_date)}{i.amount ? ` · £${Number(i.amount).toFixed(2)}` : ''}</span><span className="block text-xs text-slate-500 truncate">{i.production_name} · {i.invoice_number || i.file_name}</span></span>
                  <Badge status={i.status} />
                </div>
                {i.reviewer_notes && i.status !== 'approved' && <p className="mt-1 text-xs text-slate-600">Office: {i.reviewer_notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Availability ────────────────────────────────────────────────────────────

function AvailabilitySection({ token, highlight, onChanged }: { token: string; highlight: string | null; onChanged: () => void }) {
  const [polls, setPolls] = useState<PortalPoll[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { crewPortalApi.availability(token).then(setPolls).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')); }, [token]);
  useEffect(load, [load]);

  if (error) return <Banner tone="red" icon={AlertCircle}>{error}</Banner>;
  if (!polls) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-600" /></div>;
  if (!polls.length) return <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">No availability requests right now.</div>;
  const sorted = [...polls].sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : 0));
  return <div className="space-y-3">{sorted.map((p) => <PollCard key={p.id} token={token} poll={p} highlighted={p.id === highlight} onSaved={() => { load(); onChanged(); }} />)}</div>;
}

function PollCard({ token, poll, highlighted, onSaved }: { token: string; poll: PortalPoll; highlighted: boolean; onSaved: () => void }) {
  const [response, setResponse] = useState(poll.response);
  const [notes, setNotes] = useState(poll.response_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const closed = !!poll.closed_at;

  const save = async () => {
    if (!response) return;
    setSaving(true); setError(''); setSaved(false);
    try { await crewPortalApi.respond(token, poll.id, { response, notes: notes || undefined }); setSaved(true); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };

  const options = [
    { key: 'available' as const, label: 'Available', cls: 'border-emerald-500 bg-emerald-50 text-emerald-800' },
    { key: 'partial' as const, label: 'Some days', cls: 'border-amber-500 bg-amber-50 text-amber-800' },
    { key: 'unavailable' as const, label: 'Not available', cls: 'border-red-500 bg-red-50 text-red-800' },
  ];
  return (
    <section className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 ${highlighted ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}`}>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{poll.title}</h2>
        <p className="text-sm text-slate-600">{fmtDate(poll.start_date)} – {fmtDate(poll.end_date)}{poll.production_name ? ` · ${poll.production_name}` : ''}</p>
        {poll.response_deadline && !closed && <p className="text-xs text-slate-500">Please reply by {fmtDate(poll.response_deadline)}</p>}
        {poll.message && <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{poll.message}</p>}
      </div>
      {closed ? (
        <Banner tone="blue" icon={Clock}>This request has closed.{poll.response ? ` You replied: ${poll.response === 'partial' ? 'some days' : poll.response}.` : ''}</Banner>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Your availability">
            {options.map((o) => (
              <button key={o.key} role="radio" aria-checked={response === o.key} onClick={() => setResponse(o.key)}
                className={`rounded-xl border-2 px-2 py-3 text-sm font-semibold ${response === o.key ? o.cls : 'border-slate-200 text-slate-600'}`}>{o.label}</button>
            ))}
          </div>
          {(response === 'partial' || notes) && (
            <textarea className={input} rows={2} placeholder={response === 'partial' ? 'Which days can you do?' : 'Anything the office should know?'} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          )}
          {error && <Banner tone="red" icon={AlertCircle}>{error}</Banner>}
          {saved && <Banner tone="emerald" icon={CheckCircle2}>Thanks — sent to the office.</Banner>}
          <button className={primary} disabled={saving || !response || (response === 'partial' && !notes.trim())} onClick={save}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {poll.response ? 'Update my answer' : 'Send my answer'}
          </button>
          {poll.responded_at && <p className="text-[11px] text-slate-500">Last answered {fmtDateTime(poll.responded_at)}</p>}
        </>
      )}
    </section>
  );
}
