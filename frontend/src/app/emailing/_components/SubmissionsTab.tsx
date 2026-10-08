'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, FileText, ExternalLink, Check, Undo2, X } from 'lucide-react';
import {
  emailingApi, fmtDate, fmtDateTime,
  type InvoiceSubmission, type InvoiceSubmissionDetail, type ReviewResult, type SubmissionReview,
  type SubmissionStatus, type TimesheetSubmission, type TimesheetSubmissionDetail,
} from '@/lib/emailingApi';
import { Card, Empty, ErrorNote, InfoNote, Modal, Spinner, StatusBadge, btnDanger, btnPrimary, btnSecondary, btnWarn, inputCls, labelCls } from './shared';

type Kind = 'timesheets' | 'invoices';
type Filter = SubmissionStatus | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'submitted', label: 'Waiting for review' },
  { key: 'returned', label: 'Returned to crew' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'all', label: 'All' },
];
const money = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : `£${Number(v).toFixed(2)}`);

export default function SubmissionsTab({ readOnly }: { readOnly: boolean }) {
  const [kind, setKind] = useState<Kind>('timesheets');
  const [filter, setFilter] = useState<Filter>('submitted');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<(TimesheetSubmission | InvoiceSubmission)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { status: filter, search: search || undefined };
      setRows(kind === 'timesheets' ? await emailingApi.timesheetSubmissions(params) : await emailingApi.invoiceSubmissions(params));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, [kind, filter, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <Card
      title="Crew submissions"
      subtitle="Timesheets and invoices crew submit through their secure portal link. Nothing reaches Timesheets or Pay Runs until it is approved here."
      actions={
        <>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
            {(['timesheets', 'invoices'] as Kind[]).map((k) => (
              <button key={k} onClick={() => { setKind(k); setOpenId(null); }} className={`px-3 py-1.5 rounded-md capitalize ${kind === k ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{k}</button>
            ))}
          </div>
          <button onClick={load} className={btnSecondary} disabled={loading} aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </>
      }
    >
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{f.label}</button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-8`} placeholder="Search crew" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <ErrorNote message={error} />

      {loading && !rows.length ? <Spinner /> : !rows.length ? (
        <Empty>No {kind} {filter === 'all' ? '' : `with status “${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}”`}.</Empty>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Crew</th>
                <th className="px-4 py-2 font-medium">Production</th>
                <th className="px-4 py-2 font-medium">Week ending</th>
                <th className="px-4 py-2 font-medium">{kind === 'timesheets' ? 'Days / OT' : 'Invoice'}</th>
                <th className="px-4 py-2 font-medium">Submitted</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <td className="px-4 py-2.5"><div className="font-medium text-slate-800">{r.first_name} {r.last_name}</div><div className="text-xs text-slate-400">{r.crew_number} · {r.employment_status === 'self_employed' ? 'Self-employed' : 'PAYE'}</div></td>
                  <td className="px-4 py-2.5 text-slate-700">{r.production_name}</td>
                  <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{fmtDate(r.week_ending_date)}</td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {kind === 'timesheets'
                      ? `${(r as TimesheetSubmission).days_worked ?? 0} days · ${Number((r as TimesheetSubmission).overtime_hours ?? 0)}h OT`
                      : <span>{(r as InvoiceSubmission).invoice_number || 'No number'} · {money((r as InvoiceSubmission).amount)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDateTime(r.submitted_at)}{r.revision > 1 ? <span className="ml-1 text-[11px] text-amber-700">rev {r.revision}</span> : null}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && kind === 'timesheets' && <TimesheetReview id={openId} readOnly={readOnly} onClose={() => setOpenId(null)} onDone={load} />}
      {openId && kind === 'invoices' && <InvoiceReview id={openId} readOnly={readOnly} onClose={() => setOpenId(null)} onDone={load} />}
    </Card>
  );
}

function ReviewTrail({ reviews }: { reviews: SubmissionReview[] }) {
  if (!reviews.length) return null;
  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-1.5">History</div>
      <ol className="space-y-1.5 text-xs">
        {reviews.map((r) => (
          <li key={r.id} className="flex gap-2">
            <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(r.created_at)}</span>
            <span className="text-slate-700"><strong className="capitalize">{r.action}</strong> by {r.actor_type === 'crew' ? 'crew member' : (r.actor_name || 'office')}{r.revision > 1 ? ` (rev ${r.revision})` : ''}{r.notes ? ` — “${r.notes}”` : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type Action = 'approve' | 'return' | 'decline';

function ActionPanel({ kind, selfEmployed, busy, onSubmit, timesheetFinalised }: {
  kind: Kind; selfEmployed: boolean; busy: boolean; timesheetFinalised: boolean;
  onSubmit: (action: Action, opts: { notes: string; finalise: boolean; notify: boolean; request_invoice: boolean }) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [notes, setNotes] = useState('');
  const [finalise, setFinalise] = useState(false);
  const [notify, setNotify] = useState(true);
  const [requestInvoice, setRequestInvoice] = useState(true);

  if (!action) {
    return (
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={() => setAction('approve')} disabled={timesheetFinalised}><Check size={15} /> Approve</button>
        <button className={btnWarn} onClick={() => setAction('return')}><Undo2 size={15} /> Send back for changes</button>
        <button className={btnDanger} onClick={() => setAction('decline')}><X size={15} /> Decline</button>
      </div>
    );
  }
  const needsNotes = action !== 'approve';
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="text-sm font-semibold text-slate-800">
        {action === 'approve' ? (kind === 'timesheets' ? 'Approve and add to Timesheets' : 'Approve and attach to the timesheet') : action === 'return' ? 'Send back to the crew member for changes' : 'Decline this submission'}
      </div>
      <div>
        <label className={labelCls} htmlFor="review-notes">{needsNotes ? (action === 'return' ? 'What needs changing? (sent to the crew member)' : 'Reason (sent to the crew member)') : 'Internal note (optional)'}</label>
        <textarea id="review-notes" className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </div>
      {action === 'approve' && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={finalise} onChange={(e) => setFinalise(e.target.checked)} />
          <span>Also finalise (lock for the pay run){selfEmployed && kind === 'timesheets' ? ' — self-employed crew need an invoice attached first, so this will be skipped if none is on file' : ''}</span>
        </label>
      )}
      {action === 'approve' && kind === 'timesheets' && selfEmployed && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={requestInvoice} onChange={(e) => setRequestInvoice(e.target.checked)} />
          <span>Email the crew member an invoice request now</span>
        </label>
      )}
      {needsNotes && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the crew member with these notes
        </label>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <button className={btnSecondary} onClick={() => setAction(null)} disabled={busy}>Cancel</button>
        <button
          className={action === 'approve' ? btnPrimary : action === 'return' ? btnWarn : btnDanger}
          disabled={busy || (needsNotes && !notes.trim())}
          onClick={() => onSubmit(action, { notes, finalise, notify, request_invoice: requestInvoice })}
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}

function ResultNote({ result }: { result: ReviewResult }) {
  const s = result.submission.status;
  const inv = result.invoice_request && 'queued' in result.invoice_request ? result.invoice_request.queued : 0;
  return (
    <InfoNote tone={s === 'approved' ? 'emerald' : 'amber'}>
      <strong className="capitalize">{s}.</strong>{' '}
      {result.timesheet_id && <>Timesheet {result.timesheet_created ? 'created' : 'updated'} — <Link className="underline" href={`/timesheets/${result.timesheet_id}`}>open in Timesheets</Link>. </>}
      {result.finalise?.finalised && 'Finalised for the pay run. '}
      {result.finalise && !result.finalise.finalised && result.finalise.reason && `Not finalised: ${result.finalise.reason}. `}
      {inv ? 'Invoice request queued. ' : ''}
      {result.notification && `Crew email: ${result.notification.status}${result.notification.reason ? ` (${result.notification.reason})` : ''}.`}
    </InfoNote>
  );
}

function TimesheetReview({ id, readOnly, onClose, onDone }: { id: string; readOnly: boolean; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<TimesheetSubmissionDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  const load = useCallback(() => {
    emailingApi.timesheetSubmission(id).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(load, [load]);

  const submit = async (action: Action, opts: { notes: string; finalise: boolean; notify: boolean; request_invoice: boolean }) => {
    setBusy(true);
    setError('');
    try {
      const res = await emailingApi.reviewTimesheet(id, action, { notes: opts.notes || undefined, finalise: opts.finalise, notify: opts.notify, request_invoice: opts.request_invoice });
      setResult(res);
      onDone();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={data ? `${data.first_name} ${data.last_name} — w/e ${fmtDate(data.week_ending_date)}` : 'Timesheet submission'} onClose={onClose}>
      {!data ? (error ? <ErrorNote message={error} /> : <Spinner />) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={data.status} />
            <span className="text-slate-600">{data.production_name}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">{data.crew_number} · {data.crew_trade || '—'} {data.crew_rank ? `(${data.crew_rank})` : ''} · {data.employment_status === 'self_employed' ? 'Self-employed' : 'PAYE'}</span>
            {data.revision > 1 && <span className="text-xs text-amber-700">Revision {data.revision}</span>}
          </div>
          {data.existing_timesheet_id && (
            <InfoNote tone={data.timesheet_status === 'finalised' ? 'amber' : 'blue'}>
              A timesheet already exists for this week (<strong>{data.timesheet_status}</strong>{data.timesheet_grand_total ? `, ${money(data.timesheet_grand_total)}` : ''}).{' '}
              {data.timesheet_status === 'finalised' ? 'It is finalised, so this submission cannot be applied.' : 'Approving replaces its daily entries with the crew member’s and recalculates totals from the rate card.'}{' '}
              <Link className="underline" href={`/timesheets/${data.existing_timesheet_id}`}>Open</Link>
            </InfoNote>
          )}

          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  {['Day', 'Worked', 'OT (h)', 'Set', 'Site', 'Travel', 'Mileage', 'Per diem', 'Expenses', 'Meals'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.entries.map((e) => (
                  <tr key={e.date} className={e.full_day_worked ? '' : 'text-slate-400'}>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{e.day_of_week.slice(0, 3)} {fmtDate(String(e.date).slice(0, 10)).replace(/ \d{4}$/, '')}</td>
                    <td className="px-3 py-2">{e.full_day_worked ? 'Yes' : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(e.overtime_hours) || '—'}</td>
                    <td className="px-3 py-2">{e.set_number || '—'}</td>
                    <td className="px-3 py-2">{e.site || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(e.travel) ? money(e.travel) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(e.mileage) ? money(e.mileage) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(e.per_diem) ? money(e.per_diem) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(e.ad_hoc_reimbursement) ? money(e.ad_hoc_reimbursement) : '—'}</td>
                    <td className="px-3 py-2">{[e.meal_breakfast && 'B', e.meal_lunch && 'L', e.meal_supper && 'S'].filter(Boolean).join(' ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">Pay is calculated from the rate card when the timesheet is created — crew don&apos;t enter rates.</p>

          {data.crew_notes && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="text-xs font-medium text-slate-500 block mb-1">Crew notes</span>{data.crew_notes}</div>}
          {data.reviewer_notes && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span className="text-xs font-medium block mb-1">Office notes</span>{data.reviewer_notes}</div>}
          <ReviewTrail reviews={data.reviews} />
          <ErrorNote message={error} />
          {result && <ResultNote result={result} />}
          {!readOnly && data.status === 'submitted' && (
            <ActionPanel kind="timesheets" selfEmployed={data.employment_status === 'self_employed'} busy={busy} onSubmit={submit} timesheetFinalised={data.timesheet_status === 'finalised'} />
          )}
        </div>
      )}
    </Modal>
  );
}

function InvoiceReview({ id, readOnly, onClose, onDone }: { id: string; readOnly: boolean; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<InvoiceSubmissionDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  const load = useCallback(() => {
    emailingApi.invoiceSubmission(id).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(load, [load]);

  const submit = async (action: Action, opts: { notes: string; finalise: boolean; notify: boolean }) => {
    setBusy(true);
    setError('');
    try {
      setResult(await emailingApi.reviewInvoice(id, action, { notes: opts.notes || undefined, finalise: opts.finalise, notify: opts.notify }));
      onDone();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={data ? `Invoice — ${data.first_name} ${data.last_name}, w/e ${fmtDate(data.week_ending_date)}` : 'Invoice submission'} onClose={onClose}>
      {!data ? (error ? <ErrorNote message={error} /> : <Spinner />) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={data.status} />
            <span className="text-slate-600">{data.production_name}</span>
            {data.company_name && <span className="text-slate-500">· {data.company_name}</span>}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Invoice number</div><div className="font-medium text-slate-800">{data.invoice_number || '—'}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Invoice amount</div><div className="font-medium text-slate-800">{money(data.amount)}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Timesheet total</div><div className={`font-medium ${data.amount && data.timesheet_grand_total && Math.abs(Number(data.amount) - Number(data.timesheet_grand_total)) > 0.01 ? 'text-amber-700' : 'text-slate-800'}`}>{data.existing_timesheet_id ? money(data.timesheet_grand_total) : 'No timesheet yet'}</div></div>
          </div>
          {!readOnly && (
            <a href={emailingApi.invoiceFileUrl(data.id)} target="_blank" rel="noreferrer" className={btnSecondary}>
              <FileText size={15} /> {data.file_name} <ExternalLink size={13} />
            </a>
          )}
          {!data.existing_timesheet_id && data.status === 'submitted' && (
            <InfoNote tone="amber">There is no timesheet for this week yet. Approve the crew member&apos;s timesheet first, then approve this invoice.</InfoNote>
          )}
          {data.timesheet_has_invoice && data.status === 'submitted' && (
            <InfoNote tone="amber">The timesheet already has an invoice attached — approving replaces it.</InfoNote>
          )}
          {data.crew_notes && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="text-xs font-medium text-slate-500 block mb-1">Crew notes</span>{data.crew_notes}</div>}
          {data.reviewer_notes && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span className="text-xs font-medium block mb-1">Office notes</span>{data.reviewer_notes}</div>}
          <ReviewTrail reviews={data.reviews} />
          <ErrorNote message={error} />
          {result && <ResultNote result={result} />}
          {!readOnly && data.status === 'submitted' && (
            <ActionPanel kind="invoices" selfEmployed={data.employment_status === 'self_employed'} busy={busy} onSubmit={submit} timesheetFinalised={data.timesheet_status === 'finalised'} />
          )}
        </div>
      )}
    </Modal>
  );
}
