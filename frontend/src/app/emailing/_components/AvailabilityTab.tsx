'use client';

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Plus, RefreshCw, Send, Lock } from 'lucide-react';
import { productionsApi, type Production } from '@/lib/api';
import { emailingApi, fmtDate, fmtDateTime, type AvailabilityPoll, type AvailabilityPollDetail } from '@/lib/emailingApi';
import { Card, Empty, ErrorNote, Modal, Spinner, StatusBadge, btnPrimary, btnSecondary, inputCls, labelCls } from './shared';
import type { ComposePreset } from './ComposeTab';

const RESPONSE_STYLE: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  unavailable: 'bg-red-50 text-red-700',
};

export default function AvailabilityTab({ readOnly, onCompose }: { readOnly: boolean; onCompose: (p: ComposePreset) => void }) {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [polls, setPolls] = useState<AvailabilityPoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPolls(await emailingApi.polls(status));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <Card
      title="Availability requests"
      subtitle="Ask crew whether they're free for a date range. Responses arrive here; apply them to the crew traffic-light status when you're ready."
      actions={
        <>
          <select className={`${inputCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <button className={btnSecondary} onClick={load} aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          {!readOnly && <button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={15} /> New request</button>}
        </>
      }
    >
      <ErrorNote message={error} />
      {loading && !polls.length ? <Spinner /> : !polls.length ? <Empty>No availability requests yet.</Empty> : (
        <ul className="grid md:grid-cols-2 gap-3">
          {polls.map((p) => {
            const total = Number(p.recipient_count ?? 0);
            const responded = Number(p.response_count ?? 0);
            return (
              <li key={p.id}>
                <button onClick={() => setOpenId(p.id)} className="w-full text-left rounded-xl border border-slate-200 p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{p.title}</div>
                      <div className="text-xs text-slate-500">{fmtDate(p.start_date)} – {fmtDate(p.end_date)}{p.production_name ? ` · ${p.production_name}` : ''}</div>
                    </div>
                    {p.closed_at ? <StatusBadge status="cancelled" label="Closed" /> : <StatusBadge status="sent" label="Open" />}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{responded}/{total} responded</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{p.available_count ?? 0} available</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{p.partial_count ?? 0} partly</span>
                    <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700">{p.unavailable_count ?? 0} unavailable</span>
                  </div>
                  {total > 0 && (
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
                      <div className="h-full bg-blue-500" style={{ width: `${Math.round((responded / total) * 100)}%` }} />
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <CreatePollModal
          onClose={() => setCreating(false)}
          onCreated={(poll) => { setCreating(false); load(); onCompose({ messageType: 'availability_poll', pollId: poll.id }); }}
        />
      )}
      {openId && <PollDetail id={openId} readOnly={readOnly} onClose={() => setOpenId(null)} onChanged={load} onCompose={onCompose} />}
    </Card>
  );
}

function CreatePollModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: AvailabilityPoll) => void }) {
  const [productions, setProductions] = useState<Production[]>([]);
  const [form, setForm] = useState({ title: '', message: '', start_date: '', end_date: '', response_deadline: '', production_id: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { productionsApi.list().then(setProductions).catch(() => setProductions([])); }, []);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setError('');
    if (!form.title.trim() || !form.start_date || !form.end_date) { setError('Title, start date and end date are required'); return; }
    setSaving(true);
    try {
      onCreated(await emailingApi.createPoll({
        title: form.title.trim(),
        message: form.message || undefined,
        start_date: form.start_date,
        end_date: form.end_date,
        response_deadline: form.response_deadline || undefined,
        production_id: form.production_id || undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New availability request" onClose={onClose} footer={<><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create and choose crew'}</button></>}>
      <div className="space-y-3">
        <div><label className={labelCls} htmlFor="pt">Title</label><input id="pt" className={inputCls} value={form.title} onChange={set('title')} placeholder="e.g. Strike crew — Stage 4" maxLength={150} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls} htmlFor="ps">From</label><input id="ps" type="date" className={inputCls} value={form.start_date} onChange={set('start_date')} /></div>
          <div><label className={labelCls} htmlFor="pe">To</label><input id="pe" type="date" className={inputCls} value={form.end_date} min={form.start_date || undefined} onChange={set('end_date')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls} htmlFor="pd">Reply by (optional)</label><input id="pd" type="date" className={inputCls} value={form.response_deadline} onChange={set('response_deadline')} /></div>
          <div>
            <label className={labelCls} htmlFor="pp">Production (optional)</label>
            <select id="pp" className={inputCls} value={form.production_id} onChange={set('production_id')}>
              <option value="">None</option>
              {productions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div><label className={labelCls} htmlFor="pm">Details for crew (optional)</label><textarea id="pm" className={inputCls} rows={3} value={form.message} onChange={set('message')} maxLength={2000} placeholder="Location, call times, trades needed…" /></div>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

function PollDetail({ id, readOnly, onClose, onChanged, onCompose }: { id: string; readOnly: boolean; onClose: () => void; onChanged: () => void; onCompose: (p: ComposePreset) => void }) {
  const [data, setData] = useState<AvailabilityPollDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    emailingApi.poll(id).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(load, [load]);

  const apply = async (recipientId: string, status: 'available' | 'booked' | 'unavailable') => {
    setBusy(recipientId);
    setError('');
    try { await emailingApi.applyPollResponse(id, recipientId, status); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const close = async () => {
    setBusy('close');
    try { await emailingApi.closePoll(id); onChanged(); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  return (
    <Modal
      wide
      title={data ? data.title : 'Availability request'}
      onClose={onClose}
      footer={data && !readOnly && !data.closed_at ? (
        <>
          <button className={btnSecondary} onClick={close} disabled={busy === 'close'}><Lock size={14} /> Close request</button>
          <button className={btnSecondary} onClick={() => { onClose(); onCompose({ messageType: 'availability_poll', pollId: id, group: 'poll_non_responders' }); }}><Send size={14} /> Remind non-responders</button>
          <button className={btnPrimary} onClick={() => { onClose(); onCompose({ messageType: 'availability_poll', pollId: id }); }}><Plus size={14} /> Send to more crew</button>
        </>
      ) : undefined}
    >
      {!data ? (error ? <ErrorNote message={error} /> : <Spinner />) : (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">{fmtDate(data.start_date)} – {fmtDate(data.end_date)}{data.response_deadline ? ` · reply by ${fmtDate(data.response_deadline)}` : ''}{data.production_name ? ` · ${data.production_name}` : ''}</div>
          {data.message && <p className="text-sm text-slate-700 whitespace-pre-wrap">{data.message}</p>}
          <ErrorNote message={error} />
          {!data.recipients.length ? <Empty>Not sent to anyone yet.</Empty> : (
            <div className="overflow-x-auto -mx-5 sm:mx-0">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-3 py-2 font-medium">Crew</th>
                    <th className="px-3 py-2 font-medium">Response</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Crew status</th>
                    {!readOnly && <th className="px-3 py-2 font-medium">Apply to crew record</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recipients.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2"><div className="font-medium text-slate-800">{r.first_name} {r.last_name}</div><div className="text-xs text-slate-400">{r.crew_number}{r.crew_trade ? ` · ${r.crew_trade}` : ''}</div></td>
                      <td className="px-3 py-2">
                        {r.response ? (
                          <>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${RESPONSE_STYLE[r.response]}`}>{r.response === 'partial' ? 'Partly available' : r.response}</span>
                            {r.response_notes && <div className="text-xs text-slate-600 mt-1">{r.response_notes}</div>}
                            <div className="text-[11px] text-slate-400">{fmtDateTime(r.responded_at)}</div>
                          </>
                        ) : <span className="text-xs text-slate-400">Awaiting reply</span>}
                      </td>
                      <td className="px-3 py-2">{r.last_email_status ? <StatusBadge status={r.last_email_status} /> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-xs capitalize text-slate-600">{r.availability_status ?? 'available'}{r.applied_at ? <div className="text-[11px] text-slate-400 normal-case">applied {fmtDateTime(r.applied_at)}</div> : null}</td>
                      {!readOnly && (
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {(['available', 'booked', 'unavailable'] as const).map((s) => (
                              <button key={s} disabled={busy === r.id} onClick={() => apply(r.id, s)}
                                className={`px-2 py-1 rounded-md text-[11px] font-medium capitalize border ${r.applied_status === s ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
