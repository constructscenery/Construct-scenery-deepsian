'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Users, Eye, Send, CheckSquare, Square, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { productionsApi, type Production } from '@/lib/api';
import {
  emailingApi, MESSAGE_TYPE_LABELS, REASON_LABELS, fmtDate, newRequestId, recentSundays,
  type AvailabilityPoll, type EmailTemplate, type MergeField, type PreviewResult, type RecipientRow,
  type SendRequest, type SendResult, type SendableMessageType,
} from '@/lib/emailingApi';
import { Card, EmailFrame, Empty, ErrorNote, InfoNote, Modal, Spinner, StatusBadge, btnPrimary, btnSecondary, inputCls, labelCls } from './shared';

export type RecipientGroup = 'timesheet_missing' | 'invoice_missing' | 'poll_non_responders';
export type ComposePreset = {
  messageType: SendableMessageType;
  group?: RecipientGroup;
  pollId?: string;
  productionId?: string;
  weekEndingDate?: string;
  nonce?: number;
};

const TYPES: SendableMessageType[] = ['timesheet_reminder', 'invoice_request', 'availability_poll', 'manual'];
const GROUP_FOR: Partial<Record<SendableMessageType, RecipientGroup>> = {
  timesheet_reminder: 'timesheet_missing',
  invoice_request: 'invoice_missing',
  availability_poll: 'poll_non_responders',
};
const GROUP_LABEL: Record<RecipientGroup, string> = {
  timesheet_missing: 'Crew missing a timesheet for the week',
  invoice_missing: 'Self-employed crew with no invoice',
  poll_non_responders: 'Not yet responded to this request',
};

const keyOf = (r: { id: string; production_id?: string | null; week_ending_date?: string | null }) => `${r.id}|${r.production_id ?? ''}|${r.week_ending_date ?? ''}`;

export default function ComposeTab({ preset, onSent }: { preset: ComposePreset | null; onSent: () => void }) {
  const sundays = useMemo(() => recentSundays(8), []);
  const [messageType, setMessageType] = useState<SendableMessageType>(preset?.messageType ?? 'manual');
  const [productions, setProductions] = useState<Production[]>([]);
  const [polls, setPolls] = useState<AvailabilityPoll[]>([]);
  const [productionId, setProductionId] = useState(preset?.productionId ?? '');
  const [week, setWeek] = useState(preset?.weekEndingDate ?? sundays[1]);
  const [pollId, setPollId] = useState(preset?.pollId ?? '');

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [mergeFields, setMergeFields] = useState<MergeField[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [source, setSource] = useState<'group' | 'pick'>(preset?.group ? 'group' : 'pick');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [selected, setSelected] = useState<Map<string, RecipientRow>>(new Map());
  const [error, setError] = useState('');

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const requestId = useRef<string>(newRequestId());

  useEffect(() => {
    productionsApi.list().then((p) => setProductions(p.filter((x) => ['active_build', 'strike', 'pre_production'].includes(x.status)))).catch(() => setProductions([]));
    emailingApi.polls('open').then(setPolls).catch(() => setPolls([]));
  }, []);

  // Templates for the message type.
  useEffect(() => {
    let cancelled = false;
    emailingApi.templates(messageType).then(({ templates: t, merge_fields }) => {
      if (cancelled) return;
      const active = t.filter((x) => x.is_active);
      setTemplates(active);
      setMergeFields(merge_fields);
      const first = active.find((x) => x.is_system) ?? active[0];
      setTemplateId(first?.id ?? '');
      setSubject(first?.subject ?? '');
      setBody(first?.body ?? '');
    }).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load templates'));
    return () => { cancelled = true; };
  }, [messageType]);

  const group = GROUP_FOR[messageType];
  const needsProductionWeek = messageType === 'timesheet_reminder' || messageType === 'invoice_request';
  const useGroup = source === 'group' && !!group;

  const loadRows = useCallback(async () => {
    setError('');
    setRowsLoading(true);
    try {
      let data: RecipientRow[];
      if (useGroup && group) {
        if (group === 'poll_non_responders' && !pollId) { setRows([]); return; }
        data = await emailingApi.recipientGroup({
          group,
          production_id: productionId || undefined,
          week_ending_date: group === 'poll_non_responders' ? undefined : week,
          poll_id: group === 'poll_non_responders' ? pollId : undefined,
        });
        // Preselect everyone who can receive email.
        setSelected(new Map(data.filter((r) => r.eligible).map((r) => [keyOf(r), r])));
      } else {
        data = await emailingApi.recipients({ search: search || undefined, production_id: productionId || undefined });
      }
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load crew');
      setRows([]);
    } finally {
      setRowsLoading(false);
    }
  }, [useGroup, group, productionId, week, pollId, search]);

  useEffect(() => {
    const t = setTimeout(loadRows, source === 'pick' ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadRows, source]);

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) { setSubject(t.subject); setBody(t.body); }
  };

  const insertField = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) { setBody((b) => b + token); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const toggle = (r: RecipientRow) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const k = keyOf(r);
      if (next.has(k)) next.delete(k); else next.set(k, r);
      return next;
    });
  };
  const allSelectable = rows.filter((r) => r.eligible);
  const allChecked = allSelectable.length > 0 && allSelectable.every((r) => selected.has(keyOf(r)));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allChecked) allSelectable.forEach((r) => next.delete(keyOf(r)));
      else allSelectable.forEach((r) => next.set(keyOf(r), r));
      return next;
    });
  };

  const buildRequest = (): SendRequest | null => {
    if (!selected.size) { setError('Select at least one recipient'); return null; }
    if (needsProductionWeek && !useGroup && !productionId) { setError('Choose a production for this message'); return null; }
    if (messageType === 'availability_poll' && !pollId) { setError('Choose the availability request to send'); return null; }
    return {
      message_type: messageType,
      template_id: templateId || undefined,
      subject,
      body,
      poll_id: messageType === 'availability_poll' ? pollId : undefined,
      recipients: Array.from(selected.values()).map((r) => ({
        crew_member_id: r.id,
        production_id: needsProductionWeek ? (r.production_id ?? productionId) : (productionId || null),
        week_ending_date: needsProductionWeek ? (r.week_ending_date ?? week) : null,
        amount: r.grand_total ? Number(r.grand_total) : undefined,
      })),
      client_request_id: requestId.current,
    };
  };

  const openPreview = async () => {
    setError('');
    const req = buildRequest();
    if (!req) return;
    setPreviewing(true);
    try {
      setPreview(await emailingApi.preview(req));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const doSend = async () => {
    const req = buildRequest();
    if (!req) return;
    setSending(true);
    setError('');
    try {
      const res = await emailingApi.send(req);
      setResult(res);
      setPreview(null);
      setSelected(new Map());
      requestId.current = newRequestId();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const selectedPoll = polls.find((p) => p.id === pollId);

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4 min-w-0">
        <Card title="Message">
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="msg-type">Message type</label>
                <select id="msg-type" className={inputCls} value={messageType} onChange={(e) => { setMessageType(e.target.value as SendableMessageType); setResult(null); }}>
                  {TYPES.map((t) => <option key={t} value={t}>{MESSAGE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="tpl">Template</label>
                <select id="tpl" className={inputCls} value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_system ? '' : ' (custom)'}</option>)}
                </select>
              </div>
            </div>

            {(needsProductionWeek || messageType === 'manual') && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="prod">Production{needsProductionWeek ? '' : ' (optional filter)'}</label>
                  <select id="prod" className={inputCls} value={productionId} onChange={(e) => setProductionId(e.target.value)}>
                    <option value="">{needsProductionWeek && useGroup ? 'All active productions' : 'Any production'}</option>
                    {productions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {needsProductionWeek && (
                  <div>
                    <label className={labelCls} htmlFor="week">Week ending</label>
                    <select id="week" className={inputCls} value={week} onChange={(e) => setWeek(e.target.value)}>
                      {sundays.map((d, i) => <option key={d} value={d}>{fmtDate(d)}{i === 0 ? ' (this week)' : i === 1 ? ' (last week)' : ''}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {messageType === 'availability_poll' && (
              <div>
                <label className={labelCls} htmlFor="poll">Availability request</label>
                <select id="poll" className={inputCls} value={pollId} onChange={(e) => setPollId(e.target.value)}>
                  <option value="">Choose…</option>
                  {polls.map((p) => <option key={p.id} value={p.id}>{p.title} · {fmtDate(p.start_date)} – {fmtDate(p.end_date)}</option>)}
                </select>
                {!polls.length && <p className="text-xs text-slate-500 mt-1">Create an availability request in the Availability tab first.</p>}
                {selectedPoll && <p className="text-xs text-slate-500 mt-1">{selectedPoll.response_count ?? 0}/{selectedPoll.recipient_count ?? 0} responded so far.</p>}
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="subject">Subject</label>
              <input id="subject" className={inputCls} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="body">Message</label>
              <textarea id="body" ref={bodyRef} className={`${inputCls} font-mono text-[13px] leading-relaxed`} rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mergeFields.map((f) => (
                  <button key={f.key} type="button" onClick={() => insertField(f.key)} title={f.label}
                    className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-[11px] font-mono text-slate-600">
                    {`{{${f.key}}}`}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">Plain text — blank lines start a new paragraph. <code className="font-mono">{'{{action_button}}'}</code> adds the crew member&apos;s secure portal button. Edits here apply to this send only; change the template in Templates to reuse them.</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-4 min-w-0">
        <Card
          title={<span className="inline-flex items-center gap-2"><Users size={15} /> Recipients <span className="text-xs font-normal text-slate-500">({selected.size} selected)</span></span>}
          actions={group ? (
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button className={`px-2.5 py-1 rounded-md ${source === 'group' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} onClick={() => setSource('group')}>Suggested</button>
              <button className={`px-2.5 py-1 rounded-md ${source === 'pick' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} onClick={() => setSource('pick')}>Pick crew</button>
            </div>
          ) : undefined}
        >
          {useGroup && group ? (
            <p className="text-xs text-slate-500 mb-3">{GROUP_LABEL[group]}{group !== 'poll_non_responders' ? ` · week ending ${fmtDate(week)}` : ''}.</p>
          ) : (
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-8`} placeholder="Search name, crew number or email" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}

          {rowsLoading ? <Spinner /> : !rows.length ? (
            <Empty>{useGroup ? 'Nobody matches — everyone is up to date.' : 'No crew found.'}</Empty>
          ) : (
            <>
              <button onClick={toggleAll} className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                {allChecked ? <CheckSquare size={14} /> : <Square size={14} />} {allChecked ? 'Clear all' : `Select all (${allSelectable.length})`}
              </button>
              <ul className="max-h-[440px] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {rows.map((r) => {
                  const k = keyOf(r);
                  const checked = selected.has(k);
                  return (
                    <li key={k}>
                      <label className={`flex items-start gap-2.5 px-3 py-2.5 ${r.eligible ? 'cursor-pointer hover:bg-slate-50' : 'opacity-70'}`}>
                        <input type="checkbox" className="mt-0.5" checked={checked} disabled={!r.eligible} onChange={() => toggle(r)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800 truncate">{r.first_name} {r.last_name} <span className="text-xs font-normal text-slate-400">{r.crew_number}</span></span>
                          <span className="block text-xs text-slate-500 truncate">{r.email || 'No email'}{r.production_name ? ` · ${r.production_name}` : ''}{r.week_ending_date && group === 'invoice_missing' ? ` · w/e ${fmtDate(r.week_ending_date)}` : ''}</span>
                        </span>
                        {!r.eligible && r.reason && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={12} /> {REASON_LABELS[r.reason]}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <ErrorNote message={error} />
        {result && (
          <InfoNote tone={result.summary.queued ? 'emerald' : 'amber'}>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <div>
                <strong>{result.summary.queued ?? 0} queued for sending.</strong>{' '}
                {Object.entries(result.summary).filter(([k]) => k !== 'queued').map(([k, v]) => `${v} ${k}`).join(' · ')}
                {!result.live_sending_enabled && <div className="mt-1">Test mode: only internal test group addresses were queued.</div>}
                <button className="mt-1 block underline" onClick={onSent}>View in History</button>
              </div>
            </div>
          </InfoNote>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <button className={btnPrimary} onClick={openPreview} disabled={previewing || !selected.size}>
            <Eye size={15} /> {previewing ? 'Preparing…' : `Preview & send (${selected.size})`}
          </button>
        </div>
      </div>

      {preview && (
        <Modal
          wide
          title="Preview before sending"
          onClose={() => setPreview(null)}
          footer={
            <>
              <button className={btnSecondary} onClick={() => setPreview(null)}>Back to edit</button>
              <button className={btnPrimary} onClick={doSend} disabled={sending || !preview.summary.eligible}>
                <Send size={15} /> {sending ? 'Sending…' : `Send to ${preview.summary.eligible} recipient${preview.summary.eligible === 1 ? '' : 's'}`}
              </button>
            </>
          }
        >
          <div className="grid md:grid-cols-5 gap-4">
            <div className="md:col-span-3 space-y-2 min-w-0">
              <div className="text-xs text-slate-500">Subject (first recipient)</div>
              <div className="text-sm font-semibold text-slate-900 break-words">{preview.subject}</div>
              <EmailFrame html={preview.html} height={460} />
              <p className="text-[11px] text-slate-500">Each recipient gets their own name, details and secure portal link (hidden here).</p>
            </div>
            <div className="md:col-span-2 min-w-0">
              {!preview.live_sending_enabled && (
                <div className="mb-2"><InfoNote tone="amber">Live sending is off — only addresses in the internal test group will receive this.</InfoNote></div>
              )}
              <div className="text-xs font-medium text-slate-600 mb-1.5">{preview.summary.eligible} of {preview.summary.total} will receive it</div>
              <ul className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg text-xs">
                {preview.recipients.map((r) => (
                  <li key={`${r.crew_member_id}${r.production_id}${r.week_ending_date}`} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 truncate"><span className="font-medium text-slate-800">{r.name ?? 'Unknown'}</span> <span className="text-slate-400">{r.email}</span></span>
                    {r.eligible ? <StatusBadge status="queued" label="Will send" /> : <StatusBadge status="failed" label={r.reason ? REASON_LABELS[r.reason] : 'Skipped'} />}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
