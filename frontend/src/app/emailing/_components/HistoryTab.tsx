'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, RotateCcw, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  emailingApi, MESSAGE_TYPE_LABELS, fmtDate, fmtDateTime,
  type DeliveryStatus, type EmailMessage, type EmailMessageDetail, type MessageType,
} from '@/lib/emailingApi';
import { Card, EmailFrame, Empty, ErrorNote, Modal, Spinner, StatusBadge, btnSecondary, inputCls } from './shared';

const STATUSES: DeliveryStatus[] = ['queued', 'sent', 'delivered', 'delayed', 'soft_bounced', 'bounced', 'complained', 'rejected', 'failed', 'suppressed', 'cancelled'];
const TYPES = Object.keys(MESSAGE_TYPE_LABELS) as MessageType[];
const LIMIT = 50;

export default function HistoryTab({ readOnly }: { readOnly: boolean }) {
  const [filters, setFilters] = useState({ search: '', status: '', message_type: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ messages: EmailMessage[]; total: number }>({ messages: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await emailingApi.messages({ ...filters, page, limit: LIMIT });
      setData({ messages: res.messages, total: res.total });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: keyof typeof filters) => (v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const pages = Math.max(1, Math.ceil(data.total / LIMIT));

  return (
    <Card
      title="Communication history"
      subtitle="Every message sent from the Emailing tab, with its content, recipient and delivery status."
      actions={<button className={btnSecondary} onClick={load} aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
        <div className="relative lg:col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-8`} placeholder="Search recipient or subject" value={filters.search} onChange={(e) => set('search')(e.target.value)} />
        </div>
        <select className={inputCls} value={filters.message_type} onChange={(e) => set('message_type')(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{MESSAGE_TYPE_LABELS[t]}</option>)}
        </select>
        <select className={inputCls} value={filters.status} onChange={(e) => set('status')(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <div className="flex gap-2">
          <input type="date" className={inputCls} value={filters.from} onChange={(e) => set('from')(e.target.value)} aria-label="From" />
          <input type="date" className={inputCls} value={filters.to} onChange={(e) => set('to')(e.target.value)} aria-label="To" />
        </div>
      </div>
      <ErrorNote message={error} />

      {loading && !data.messages.length ? <Spinner /> : !data.messages.length ? <Empty>No messages match.</Empty> : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Recipient</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Related</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.messages.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(m.id)}>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDateTime(m.created_at ?? m.sent_at)}</td>
                    <td className="px-4 py-2.5"><div className="text-slate-800 font-medium truncate max-w-[200px]">{m.recipient_name || m.recipient_email}</div><div className="text-xs text-slate-400 truncate max-w-[200px]">{m.recipient_email}</div></td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{m.message_type ? MESSAGE_TYPE_LABELS[m.message_type] : m.module}{m.is_automated && <span className="ml-1 text-[10px] text-slate-400">auto</span>}{m.is_test && <span className="ml-1 text-[10px] text-amber-600">test</span>}</td>
                    <td className="px-4 py-2.5 text-slate-700 truncate max-w-[260px]">{m.subject || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{m.production_name || '—'}{m.week_ending_date ? ` · w/e ${fmtDate(m.week_ending_date)}` : ''}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
            <span>{data.total} message{data.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <button className={btnSecondary} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
              <span>Page {page} of {pages}</span>
              <button className={btnSecondary} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
            </div>
          </div>
        </>
      )}

      {openId && <MessageDetail id={openId} readOnly={readOnly} onClose={() => setOpenId(null)} onChanged={load} />}
    </Card>
  );
}

function MessageDetail({ id, readOnly, onClose, onChanged }: { id: string; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const [m, setM] = useState<EmailMessageDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { emailingApi.message(id).then(setM).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load')); }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await fn(); load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Modal
      wide
      title={m?.subject || 'Message'}
      onClose={onClose}
      footer={m && !readOnly ? (
        <>
          {['failed', 'cancelled'].includes(m.status) && m.message_type && <button className={btnSecondary} disabled={busy} onClick={() => act(() => emailingApi.retryMessage(id))}><RotateCcw size={14} /> Retry</button>}
          {m.status === 'queued' && <button className={btnSecondary} disabled={busy} onClick={() => act(() => emailingApi.cancelMessage(id))}><Ban size={14} /> Cancel</button>}
        </>
      ) : undefined}
    >
      {!m ? (error ? <ErrorNote message={error} /> : <Spinner />) : (
        <div className="grid md:grid-cols-5 gap-4">
          <div className="md:col-span-3 min-w-0">
            {m.body_html ? <EmailFrame html={m.body_html} height={480} /> : <p className="text-sm text-slate-500">Message content was not recorded for this (older) email.</p>}
          </div>
          <div className="md:col-span-2 space-y-3 text-sm min-w-0">
            <dl className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs">
              <dt className="text-slate-500">Status</dt><dd className="col-span-2"><StatusBadge status={m.status} /></dd>
              <dt className="text-slate-500">To</dt><dd className="col-span-2 break-all text-slate-800">{m.recipient_name ? `${m.recipient_name} <${m.recipient_email}>` : m.recipient_email}</dd>
              <dt className="text-slate-500">Type</dt><dd className="col-span-2 text-slate-800">{m.message_type ? MESSAGE_TYPE_LABELS[m.message_type] : m.module}</dd>
              <dt className="text-slate-500">Production</dt><dd className="col-span-2 text-slate-800">{m.production_name || '—'}{m.week_ending_date ? ` · w/e ${fmtDate(m.week_ending_date)}` : ''}</dd>
              <dt className="text-slate-500">Reply-to</dt><dd className="col-span-2 break-all text-slate-800">{m.reply_to || '—'}</dd>
              <dt className="text-slate-500">Sent by</dt><dd className="col-span-2 text-slate-800">{m.is_automated ? 'Automation' : (m.sent_by_name || '—')}</dd>
              <dt className="text-slate-500">Created</dt><dd className="col-span-2 text-slate-800">{fmtDateTime(m.created_at ?? m.sent_at)}</dd>
              <dt className="text-slate-500">Attempts</dt><dd className="col-span-2 text-slate-800">{m.attempts}</dd>
              <dt className="text-slate-500">Provider ID</dt><dd className="col-span-2 break-all font-mono text-[11px] text-slate-600">{m.provider_message_id || '—'}</dd>
            </dl>
            {m.error_message && <ErrorNote message={m.error_message} />}
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">Delivery events</div>
              {!m.events.length ? <p className="text-xs text-slate-400">No provider events yet.</p> : (
                <ol className="space-y-1.5 text-xs">
                  {m.events.map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(e.occurred_at)}</span>
                      <span className="text-slate-700"><strong className="capitalize">{e.event_type.replace(/_/g, ' ')}</strong>{e.bounce_type ? ` (${e.bounce_type}${e.bounce_subtype ? `/${e.bounce_subtype}` : ''})` : ''}{e.diagnostic ? ` — ${e.diagnostic}` : ''}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <ErrorNote message={error} />
          </div>
        </div>
      )}
    </Modal>
  );
}
