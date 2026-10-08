'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2, Save } from 'lucide-react';
import { emailingApi, MESSAGE_TYPE_LABELS, fmtDateTime, type EmailTemplate, type MergeField, type MessageType } from '@/lib/emailingApi';
import { Card, Empty, ErrorNote, InfoNote, Spinner, Toggle, btnDanger, btnPrimary, btnSecondary, inputCls, labelCls } from './shared';

const TYPES = Object.keys(MESSAGE_TYPE_LABELS) as MessageType[];
type Draft = { id?: string; name: string; message_type: MessageType; subject: string; body: string; is_active: boolean; is_system: boolean };

export default function TemplatesTab({ readOnly }: { readOnly: boolean }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [fields, setFields] = useState<MergeField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await emailingApi.templates();
      setTemplates(res.templates);
      setFields(res.merge_fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const edit = (t: EmailTemplate) => { setNotice(''); setError(''); setDraft({ id: t.id, name: t.name, message_type: t.message_type, subject: t.subject, body: t.body, is_active: t.is_active, is_system: t.is_system }); };
  const startNew = () => { setNotice(''); setError(''); setDraft({ name: '', message_type: 'manual', subject: '', body: 'Hi {{first_name}},\n\n\n\nThanks,\nConstruct Scenery', is_active: true, is_system: false }); };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const saved = draft.id
        ? await emailingApi.updateTemplate(draft.id, { name: draft.name, subject: draft.subject, body: draft.body, is_active: draft.is_active })
        : await emailingApi.createTemplate({ name: draft.name, message_type: draft.message_type, subject: draft.subject, body: draft.body });
      setNotice('Template saved.');
      await load();
      edit(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!draft?.id || !window.confirm('Reset this template to the original wording?')) return;
    try { const t = await emailingApi.resetTemplate(draft.id); await load(); edit(t); setNotice('Template reset.'); } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed'); }
  };
  const remove = async () => {
    if (!draft?.id || !window.confirm('Delete this template?')) return;
    try { await emailingApi.deleteTemplate(draft.id); setDraft(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const insert = (key: string) => {
    if (!draft) return;
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    setDraft({ ...draft, body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2" title="Templates" actions={!readOnly ? <button className={btnPrimary} onClick={startNew}><Plus size={15} /> New</button> : undefined}>
        {loading ? <Spinner /> : !templates.length ? <Empty>No templates.</Empty> : (
          <div className="space-y-4">
            {TYPES.filter((t) => templates.some((x) => x.message_type === t)).map((type) => (
              <div key={type}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{MESSAGE_TYPE_LABELS[type]}</div>
                <ul className="space-y-1">
                  {templates.filter((t) => t.message_type === type).map((t) => (
                    <li key={t.id}>
                      <button onClick={() => edit(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${draft?.id === t.id ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50 text-slate-700'}`}>
                        <span className="font-medium">{t.name}</span>
                        {t.is_system && <span className="ml-1.5 text-[10px] text-slate-400">system</span>}
                        {!t.is_active && <span className="ml-1.5 text-[10px] text-amber-600">inactive</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="lg:col-span-3" title={draft ? (draft.id ? 'Edit template' : 'New template') : 'Template editor'}>
        {!draft ? <Empty>Choose a template to view or edit it.</Empty> : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={labelCls} htmlFor="tn">Name</label><input id="tn" className={inputCls} value={draft.name} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} /></div>
              <div>
                <label className={labelCls} htmlFor="tt">Used for</label>
                <select id="tt" className={inputCls} value={draft.message_type} disabled={readOnly || !!draft.id} onChange={(e) => setDraft({ ...draft, message_type: e.target.value as MessageType })}>
                  {TYPES.map((t) => <option key={t} value={t}>{MESSAGE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
            </div>
            <div><label className={labelCls} htmlFor="ts">Subject</label><input id="ts" className={inputCls} value={draft.subject} disabled={readOnly} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={300} /></div>
            <div>
              <label className={labelCls} htmlFor="tb">Message</label>
              <textarea id="tb" ref={bodyRef} className={`${inputCls} font-mono text-[13px] leading-relaxed`} rows={14} value={draft.body} disabled={readOnly} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              {!readOnly && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fields.map((f) => (
                    <button key={f.key} type="button" onClick={() => insert(f.key)} title={f.label} className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-[11px] font-mono text-slate-600">{`{{${f.key}}}`}</button>
                  ))}
                </div>
              )}
            </div>
            <InfoNote>Plain text with merge fields. <code className="font-mono">{'{{action_button}}'}</code> inserts the button linking to the crew member&apos;s secure portal (timesheet, invoice or availability page, depending on the message type).</InfoNote>
            {draft.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Toggle checked={draft.is_active} disabled={readOnly} onChange={(v) => setDraft({ ...draft, is_active: v })} label="Active" /> Active (available in Compose)
              </label>
            )}
            {draft.id && <p className="text-xs text-slate-400">Last updated {fmtDateTime(templates.find((t) => t.id === draft.id)?.updated_at)}{templates.find((t) => t.id === draft.id)?.updated_by_name ? ` by ${templates.find((t) => t.id === draft.id)?.updated_by_name}` : ''}</p>}
            <ErrorNote message={error} />
            {notice && <InfoNote tone="emerald">{notice}</InfoNote>}
            {!readOnly && (
              <div className="flex flex-wrap justify-end gap-2">
                {draft.id && draft.is_system && <button className={btnSecondary} onClick={reset}><RotateCcw size={14} /> Reset to default</button>}
                {draft.id && !draft.is_system && <button className={btnDanger} onClick={remove}><Trash2 size={14} /> Delete</button>}
                <button className={btnPrimary} onClick={save} disabled={saving || !draft.name.trim() || !draft.subject.trim() || !draft.body.trim()}><Save size={14} /> {saving ? 'Saving…' : 'Save template'}</button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
