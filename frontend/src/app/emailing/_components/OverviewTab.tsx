'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, ShieldCheck, ClipboardList, Receipt, CalendarCheck, Send } from 'lucide-react';
import { emailingApi, type Overview } from '@/lib/emailingApi';
import { Card, ErrorNote, InfoNote, Spinner, btnSecondary } from './shared';
import type { ComposePreset } from './ComposeTab';

export default function OverviewTab({ onNavigate, onCompose, readOnly }: { onNavigate: (tab: string) => void; onCompose: (p: ComposePreset) => void; readOnly: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await emailingApi.overview());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorNote message={error} />;

  const s = data.settings;
  const automationsOn = [s.automation_timesheet_reminders, s.automation_timesheet_followups, s.automation_invoice_requests].filter(Boolean).length;

  const tiles = [
    { label: 'Timesheets to review', value: data.submissions.timesheets_pending, icon: ClipboardList, tab: 'submissions', tone: 'text-blue-600' },
    { label: 'Invoices to review', value: data.submissions.invoices_pending, icon: Receipt, tab: 'submissions', tone: 'text-blue-600' },
    { label: 'Open availability requests', value: data.polls.open_polls, icon: CalendarCheck, tab: 'availability', tone: 'text-slate-800' },
    { label: 'Sent (7 days)', value: data.messages.sent_7d, icon: Send, tab: 'history', tone: 'text-slate-800' },
    { label: 'Failed (7 days)', value: data.messages.failed_7d, icon: ShieldAlert, tab: 'history', tone: data.messages.failed_7d ? 'text-red-600' : 'text-slate-800' },
    { label: 'Bounces & complaints (30 days)', value: data.messages.problems_30d, icon: ShieldAlert, tab: 'history', tone: data.messages.problems_30d ? 'text-amber-600' : 'text-slate-800' },
  ];

  return (
    <div className="space-y-4">
      {!s.live_sending_enabled ? (
        <InfoNote tone="amber">
          <strong>Test mode.</strong> Live sending is off, so emails only go to addresses in the internal test group. Run the full workflow with the test group first, then switch on live sending in Settings.
        </InfoNote>
      ) : (
        <InfoNote tone="emerald">
          <strong>Live sending is on.</strong> Messages go to crew email addresses. {automationsOn ? `${automationsOn} automation(s) enabled.` : 'Automations are off.'}
        </InfoNote>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map(({ label, value, icon: Icon, tab, tone }) => (
          <button key={label} onClick={() => onNavigate(tab)} className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:border-blue-300 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">{label}</span>
              <Icon size={16} className="text-slate-400 shrink-0" />
            </div>
            <div className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
          </button>
        ))}
      </div>

      <Card
        title="Quick actions"
        actions={<button onClick={load} className={btnSecondary} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>}
      >
        {readOnly ? (
          <p className="text-sm text-slate-500">Guest access is read-only.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <button className={btnSecondary} onClick={() => onCompose({ messageType: 'timesheet_reminder', group: 'timesheet_missing' })}>Remind missing timesheets</button>
            <button className={btnSecondary} onClick={() => onCompose({ messageType: 'invoice_request', group: 'invoice_missing' })}>Request missing invoices</button>
            <button className={btnSecondary} onClick={() => onNavigate('availability')}>Ask for availability</button>
            <button className={btnSecondary} onClick={() => onCompose({ messageType: 'manual' })}>Send a message</button>
          </div>
        )}
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3">
            {s.live_sending_enabled ? <ShieldCheck size={16} className="text-emerald-600" /> : <ShieldAlert size={16} className="text-amber-600" />}
            <span className="text-slate-600">Live sending: <strong>{s.live_sending_enabled ? 'On' : 'Off (test group only)'}</strong></span>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-slate-600">Replies go to <strong>{s.reply_to_address}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3 text-slate-600">Suppressed addresses: <strong>{data.suppressions.suppressed}</strong> · Queued: <strong>{data.messages.queued}</strong></div>
        </div>
      </Card>
    </div>
  );
}
