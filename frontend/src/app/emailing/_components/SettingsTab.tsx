'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Trash2, Plus, Play, Eye, Copy, KeyRound, ShieldCheck, ShieldAlert, Save, Search, X, Loader2 } from 'lucide-react';
import {
  emailingApi, fmtDate, fmtDateTime, recentSundays,
  type AutomationRun, type AutomationType, type EmailSettings, type PortalLinkStatus, type ProviderStatus,
  type RecipientRow, type Suppression, type TestRecipient,
} from '@/lib/emailingApi';
import { Card, Empty, ErrorNote, InfoNote, Modal, Spinner, Toggle, btnPrimary, btnSecondary, inputCls, labelCls } from './shared';

const AUTOMATIONS: { type: AutomationType; key: keyof EmailSettings; title: string; when: string; what: string }[] = [
  { type: 'timesheet_reminders', key: 'automation_timesheet_reminders', title: 'Timesheet reminder', when: 'Sundays 16:00 (UK)', what: 'Active crew on an active production who have not submitted that week’s timesheet.' },
  { type: 'timesheet_followups', key: 'automation_timesheet_followups', title: 'Timesheet follow-up', when: 'Mondays 10:00 (UK)', what: 'Anyone still missing last week’s timesheet.' },
  { type: 'invoice_requests', key: 'automation_invoice_requests', title: 'Invoice request', when: 'Tuesdays 10:00 (UK)', what: 'Self-employed crew whose timesheet for last week has no invoice yet.' },
];
const SUPPRESSION_LABEL: Record<Suppression['reason'], string> = { hard_bounce: 'Hard bounce', complaint: 'Spam complaint', invalid_address: 'Invalid address', manual: 'Added manually' };

export default function SettingsTab({ readOnly }: { readOnly: boolean }) {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [form, setForm] = useState({ reply_to_address: '', from_name: '', portal_link_ttl_days: 60 });
  const [testRecipients, setTestRecipients] = useState<TestRecipient[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newTest, setNewTest] = useState({ email: '', name: '' });
  const [newSuppression, setNewSuppression] = useState('');
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [runWeek, setRunWeek] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, sup] = await Promise.all([emailingApi.getSettings(), emailingApi.suppressions()]);
      setSettings(s.settings);
      setForm({ reply_to_address: s.settings.reply_to_address, from_name: s.settings.from_name, portal_link_ttl_days: s.settings.portal_link_ttl_days });
      setTestRecipients(s.test_recipients);
      setSuppressions(sup);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    }
    emailingApi.providerStatus().then(setProvider).catch(() => setProvider(null));
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setError('');
    setNotice('');
    try { await fn(); if (done) setNotice(done); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(''); }
  };

  const toggle = (key: keyof EmailSettings, value: boolean) => {
    if (key === 'live_sending_enabled' && value && !window.confirm('Switch on live sending? Messages will go to crew email addresses, not just the internal test group.')) return;
    if (key !== 'live_sending_enabled' && value && !settings?.live_sending_enabled) {
      if (!window.confirm('Live sending is off, so this automation will only email the internal test group. Enable it?')) return;
    }
    act(key, () => emailingApi.updateSettings({ [key]: value }), 'Settings saved.');
  };

  const runAutomation = async (type: AutomationType, dryRun: boolean) => {
    if (!dryRun && !window.confirm('Send this automation now? Anyone already emailed for the same week is skipped automatically.')) return;
    setBusy(`${type}-${dryRun}`);
    setError('');
    try { setRun(await emailingApi.runAutomation(type, { dry_run: dryRun, week_ending_date: runWeek || undefined })); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(''); }
  };

  if (!settings) return error ? <ErrorNote message={error} /> : <Spinner />;

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {notice && <InfoNote tone="emerald">{notice}</InfoNote>}

      <Card title="Sending" subtitle="Keep live sending off until the full workflow has been tested with the internal group.">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-800">Live sending</div>
            <p className="text-xs text-slate-500 mt-0.5">{settings.live_sending_enabled ? 'On — messages go to crew.' : 'Off — only the internal test group below receives email. Everyone else is skipped and nothing is queued for them.'}</p>
          </div>
          <Toggle checked={settings.live_sending_enabled} disabled={readOnly || busy === 'live_sending_enabled'} onChange={(v) => toggle('live_sending_enabled', v)} label="Live sending" />
        </div>

        <div className="mt-5 grid sm:grid-cols-3 gap-3">
          <div><label className={labelCls} htmlFor="rt">Replies go to</label><input id="rt" className={inputCls} type="email" value={form.reply_to_address} disabled={readOnly} onChange={(e) => setForm({ ...form, reply_to_address: e.target.value })} /></div>
          <div><label className={labelCls} htmlFor="fn">Sender name</label><input id="fn" className={inputCls} value={form.from_name} disabled={readOnly} onChange={(e) => setForm({ ...form, from_name: e.target.value })} maxLength={80} /></div>
          <div><label className={labelCls} htmlFor="ttl">Portal link valid for (days)</label><input id="ttl" className={inputCls} type="number" min={1} max={365} value={form.portal_link_ttl_days} disabled={readOnly} onChange={(e) => setForm({ ...form, portal_link_ttl_days: Number(e.target.value) })} /></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Crew replies land in the business inbox above. Receiving and threading replies inside CS HQ needs an inbound-mail integration and isn&apos;t part of this release.</p>
        {!readOnly && (
          <div className="mt-3 flex justify-end">
            <button className={btnPrimary} disabled={busy === 'form'} onClick={() => act('form', () => emailingApi.updateSettings(form), 'Settings saved.')}><Save size={14} /> Save</button>
          </div>
        )}
      </Card>

      <Card title="Internal test group" subtitle="While live sending is off, only these addresses receive email. Add staff who are also set up as crew records so they can try the portal end to end.">
        {!testRecipients.length ? <Empty>No test recipients yet.</Empty> : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg mb-3">
            {testRecipients.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate"><span className="font-medium text-slate-800">{t.name || t.email}</span> {t.name && <span className="text-slate-400">{t.email}</span>}</span>
                {!readOnly && <button className="p-1.5 text-slate-400 hover:text-red-600" aria-label={`Remove ${t.email}`} onClick={() => act(`rm-${t.id}`, () => emailingApi.removeTestRecipient(t.id))}><Trash2 size={14} /></button>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input className={inputCls} type="email" placeholder="email@constructscenery.co.uk" value={newTest.email} onChange={(e) => setNewTest({ ...newTest, email: e.target.value })} />
            <input className={inputCls} placeholder="Name (optional)" value={newTest.name} onChange={(e) => setNewTest({ ...newTest, name: e.target.value })} />
            <button className={btnSecondary} disabled={!newTest.email || busy === 'add-test'} onClick={() => act('add-test', async () => { await emailingApi.addTestRecipient(newTest.email, newTest.name || undefined); setNewTest({ email: '', name: '' }); })}><Plus size={14} /> Add</button>
          </div>
        )}
      </Card>

      <Card title="Automated reminders" subtitle="Each run is repeat-safe — nobody gets the same reminder twice for the same week." actions={
        <select className={`${inputCls} !w-auto`} value={runWeek} onChange={(e) => setRunWeek(e.target.value)} aria-label="Week for manual run">
          <option value="">Default week</option>
          {recentSundays(6).map((d) => <option key={d} value={d}>w/e {fmtDate(d)}</option>)}
        </select>
      }>
        <ul className="space-y-3">
          {AUTOMATIONS.map((a) => (
            <li key={a.type} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{a.title} <span className="font-normal text-xs text-slate-500">· {a.when}</span></div>
                  <p className="text-xs text-slate-500 mt-0.5">{a.what}</p>
                </div>
                <Toggle checked={!!settings[a.key]} disabled={readOnly || busy === a.key} onChange={(v) => toggle(a.key, v)} label={a.title} />
              </div>
              {!readOnly && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className={btnSecondary} disabled={!!busy} onClick={() => runAutomation(a.type, true)}><Eye size={14} /> Who would get it?</button>
                  <button className={btnSecondary} disabled={!!busy} onClick={() => runAutomation(a.type, false)}><Play size={14} /> Run now</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <PortalLinks readOnly={readOnly} />

      <Card title="Suppressed addresses" subtitle="Hard bounces and spam complaints reported by Amazon SES are blocked automatically to protect the sending reputation." actions={<button className={btnSecondary} onClick={load} aria-label="Refresh"><RefreshCw size={14} /></button>}>
        {!suppressions.length ? <Empty>No suppressed addresses.</Empty> : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg mb-3">
            {suppressions.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 break-all">{s.email}</div>
                  <div className="text-xs text-slate-500">{SUPPRESSION_LABEL[s.reason]} · {fmtDateTime(s.created_at)}{s.crew?.length ? ` · ${s.crew.map((c) => `${c.name} (${c.crew_number})`).join(', ')}` : ''}</div>
                  {s.detail && <div className="text-xs text-slate-400 break-words">{s.detail}</div>}
                </div>
                {!readOnly && (
                  <button className={btnSecondary} onClick={() => {
                    const note = window.prompt('Why is it safe to email this address again? (e.g. crew member confirmed the address)');
                    if (note !== null) act(`clear-${s.id}`, () => emailingApi.clearSuppression(s.id, note), 'Suppression cleared.');
                  }}>Clear</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <div className="flex gap-2">
            <input className={inputCls} type="email" placeholder="Block an address manually" value={newSuppression} onChange={(e) => setNewSuppression(e.target.value)} />
            <button className={btnSecondary} disabled={!newSuppression} onClick={() => act('add-sup', async () => { await emailingApi.addSuppression(newSuppression); setNewSuppression(''); })}><Plus size={14} /> Block</button>
          </div>
        )}
      </Card>

      <Card title="Amazon SES status" actions={<button className={btnSecondary} onClick={() => emailingApi.providerStatus().then(setProvider).catch(() => {})} aria-label="Refresh"><RefreshCw size={14} /></button>}>
        {!provider ? <Spinner label="Checking SES…" /> : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <StatusItem ok={provider.production_access_enabled} label="Production access" hint={provider.production_access_enabled === false ? 'Sandbox — can only send to verified addresses. Request production access in the SES console.' : undefined} />
              <StatusItem ok={provider.sending_enabled} label="Sending enabled" />
              <StatusItem ok={provider.configuration_set ? provider.configuration_set_found : false} label="Event configuration set" hint={!provider.configuration_set ? 'Set SES_CONFIGURATION_SET so delivery, bounce and complaint events are reported.' : undefined} />
              <StatusItem ok={provider.credentials_configured} label="AWS credentials" />
            </div>
            <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
              <div>From: <strong>{provider.from_email || 'not set'}</strong> · Region: <strong>{provider.region}</strong></div>
              <div>Configuration set: <strong>{provider.configuration_set || 'not set'}</strong></div>
              {provider.send_quota && <div>Quota: <strong>{provider.send_quota.sent_last_24_hours}</strong> / {provider.send_quota.max_24_hour_send} in 24h · {provider.send_quota.max_send_rate}/sec</div>}
              {provider.enforcement_status && <div>Account status: <strong>{provider.enforcement_status}</strong></div>}
            </dl>
            {provider.errors.map((e) => <ErrorNote key={e} message={e} />)}
          </div>
        )}
      </Card>

      {run && (
        <Modal title={`${run.dry_run ? 'Preview' : 'Run'} — week ending ${fmtDate(run.week_ending_date)}`} onClose={() => setRun(null)}>
          {run.dry_run ? (
            <>
              <p className="text-sm text-slate-700 mb-2">{run.count} crew member{run.count === 1 ? '' : 's'} would be emailed{run.live_sending_enabled === false ? ' — but live sending is off, so only test-group addresses among them would receive it' : ''}.</p>
              {!run.recipients?.length ? <Empty>Nobody is due.</Empty> : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg text-sm max-h-[50vh] overflow-y-auto">
                  {run.recipients.map((r) => <li key={`${r.crew_member_id}${r.production_name}`} className="px-3 py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-slate-500">{r.email || 'no email'} · {r.production_name}{r.suppressed ? ' · suppressed' : ''}</span></li>)}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-700">{run.count} due. {run.summary ? Object.entries(run.summary).map(([k, v]) => `${v} ${k}`).join(' · ') : 'Nothing sent.'}</p>
          )}
        </Modal>
      )}
    </div>
  );
}

function StatusItem({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 font-medium text-slate-800">
        {ok ? <ShieldCheck size={15} className="text-emerald-600" /> : <ShieldAlert size={15} className={ok === null ? 'text-slate-400' : 'text-amber-600'} />}
        {label}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{ok === null ? 'Unknown' : ok ? 'OK' : 'Needs attention'}</div>
      {hint && <div className="text-[11px] text-amber-700 mt-1">{hint}</div>}
    </div>
  );
}

function PortalLinks({ readOnly }: { readOnly: boolean }) {
  const [search, setSearch] = useState('');
  const [crew, setCrew] = useState<RecipientRow[]>([]);
  const [selected, setSelected] = useState<RecipientRow | null>(null);
  const [status, setStatus] = useState<PortalLinkStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const loadCrew = useCallback(async (query: string) => {
    if (readOnly) return;
    setIsSearching(true);
    setError('');
    try {
      const res = await emailingApi.recipients({ search: query.trim() || undefined });
      setCrew(res.slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to search crew');
      setCrew([]);
    } finally {
      setIsSearching(false);
    }
  }, [readOnly]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      loadCrew(search);
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, isOpen, loadCrew]);

  const pick = async (c: RecipientRow) => {
    setSelected(c);
    setIsOpen(false);
    setSearch('');
    setError('');
    setCopied(false);
    setIsLoadingStatus(true);
    try {
      const s = await emailingApi.portalLink(c.id);
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load link status');
      setStatus(null);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const doAct = async (label: string, fn: () => Promise<PortalLinkStatus | { revoked: boolean }>) => {
    if (!selected) return;
    setError('');
    setCopied(false);
    setActionBusy(label);
    try {
      const res = await fn();
      setStatus('revoked' in res ? { active: false } : res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionBusy('');
    }
  };

  if (readOnly) return null;

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><KeyRound size={15} /> Crew portal links</span>}
      subtitle="Each crew member has one secure link, reused in every email. Copy it to share another way, or issue a new one if it was forwarded."
    >
      <div ref={containerRef} className="relative">
        <div className="relative">
          <input
            className={`${inputCls} pl-9 pr-9`}
            placeholder="Find a crew member by name, number, trade or email"
            value={search}
            onFocus={() => {
              setIsOpen(true);
              if (!crew.length) loadCrew(search);
            }}
            onChange={(e) => {
              setSearch(e.target.value);
              setIsOpen(true);
            }}
          />
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          {isSearching ? (
            <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
          ) : search ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              onClick={() => {
                setSearch('');
                loadCrew('');
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {isOpen && (
          <div className="absolute z-20 mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {isSearching && !crew.length ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                <span>Searching crew members…</span>
              </div>
            ) : crew.length > 0 ? (
              crew.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 transition-colors flex items-center justify-between gap-3 text-sm group"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 group-hover:text-blue-700 truncate">
                      {c.first_name} {c.last_name}
                      <span className="ml-2 font-mono text-xs font-normal text-slate-400">{c.crew_number}</span>
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {c.crew_trade || 'No trade'} {c.email ? `· ${c.email}` : '· (No email)'}
                    </div>
                  </div>
                  {c.is_active === false && (
                    <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 shrink-0">
                      Inactive
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div className="py-4 px-3 text-xs text-slate-500 text-center">
                {search ? `No crew members found matching "${search}"` : 'No crew members available'}
              </div>
            )}
          </div>
        )}
      </div>

      <ErrorNote message={error} />

      {isLoadingStatus && selected && (
        <div className="mt-3 rounded-lg border border-slate-200 p-4 flex items-center gap-2.5 text-sm text-slate-600 bg-slate-50">
          <Loader2 size={15} className="animate-spin text-blue-600" />
          <span>Loading portal link for <strong>{selected.first_name} {selected.last_name}</strong>…</span>
        </div>
      )}

      {selected && status && !isLoadingStatus && (
        <div className="mt-3 rounded-lg border border-slate-200 p-4 space-y-3 bg-white">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <span>{selected.first_name} {selected.last_name}</span>
                <span className="font-mono text-xs font-normal text-slate-500">{selected.crew_number}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {selected.crew_trade || 'No trade'} {selected.email ? `· ${selected.email}` : '· (No email on file)'}
              </div>
            </div>
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-slate-600 underline"
              onClick={() => {
                setSelected(null);
                setStatus(null);
                setError('');
              }}
            >
              Close
            </button>
          </div>

          <div className="text-xs text-slate-600 pt-1 border-t border-slate-100">
            {status.active ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                Active · expires {fmtDate(status.expires_at?.slice(0, 10))}
                {status.last_used_at ? ` · last opened ${fmtDateTime(status.last_used_at)}` : ''}
              </span>
            ) : (
              <span className="text-slate-500">
                No active link — one is created automatically with the next email.
              </span>
            )}
          </div>

          {status.url && (
            <div className="flex gap-2">
              <input
                className={`${inputCls} font-mono text-xs bg-slate-50`}
                readOnly
                value={status.url}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className={btnSecondary}
                onClick={() => {
                  navigator.clipboard?.writeText(status.url!).then(() => setCopied(true)).catch(() => {});
                }}
              >
                <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={btnSecondary}
              disabled={!!actionBusy}
              onClick={() => doAct('show', () => emailingApi.portalLink(selected.id, true))}
            >
              {actionBusy === 'show' ? <Loader2 size={14} className="animate-spin" /> : null}
              Show link
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={!!actionBusy}
              onClick={() => {
                if (window.confirm('Issue a new link? The current link stops working immediately.')) {
                  doAct('rotate', () => emailingApi.rotatePortalLink(selected.id));
                }
              }}
            >
              {actionBusy === 'rotate' ? <Loader2 size={14} className="animate-spin" /> : null}
              Issue new link
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={!!actionBusy}
              onClick={() => {
                if (window.confirm('Revoke this crew member’s link?')) {
                  doAct('revoke', () => emailingApi.revokePortalLink(selected.id));
                }
              }}
            >
              {actionBusy === 'revoke' ? <Loader2 size={14} className="animate-spin" /> : null}
              Revoke
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
