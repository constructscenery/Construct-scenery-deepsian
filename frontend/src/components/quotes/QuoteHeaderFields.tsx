'use client';

import React from 'react';
import { Production, QuoteRecipientType } from '@/lib/api';
import { DEPARTMENTS, inputCls, labelCls } from './quoteShared';

export type QuoteHeaderForm = {
  title: string;
  quote_date: string;
  valid_until: string;
  recipient_type: QuoteRecipientType;
  production_id: string;
  department: string;
  recipient_name: string;
  recipient_company: string;
  recipient_email: string;
  introduction: string;
};

/** Client-side check that mirrors the API rules; returns the first problem or null. */
export function validateHeaderForm(f: QuoteHeaderForm): string | null {
  if (!f.title.trim()) return 'Quote title is required';
  if (!f.quote_date) return 'Quote date is required';
  if (!f.valid_until) return 'Valid until is required';
  if (f.valid_until < f.quote_date) return 'Valid until cannot be earlier than the quote date';
  if (f.recipient_type === 'internal') {
    if (!f.production_id) return 'Choose a production';
    if (!f.department.trim()) return 'Choose the department';
  } else {
    if (!f.recipient_name.trim()) return 'Recipient name is required';
    if (!f.recipient_company.trim()) return 'Company is required';
    if (!f.recipient_email.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.recipient_email.trim())) return 'Email address is not valid';
  }
  return null;
}

export function headerFormToInput(f: QuoteHeaderForm) {
  const internal = f.recipient_type === 'internal';
  return {
    title: f.title.trim(),
    quote_date: f.quote_date,
    valid_until: f.valid_until,
    recipient_type: f.recipient_type,
    production_id: f.production_id || null,
    department: internal ? f.department.trim() : null,
    recipient_name: internal ? null : f.recipient_name.trim(),
    recipient_company: internal ? null : f.recipient_company.trim(),
    recipient_email: internal ? null : f.recipient_email.trim(),
    introduction: f.introduction.trim() || null,
  };
}

export default function QuoteHeaderFields({ value, onChange, productions, disabled = false }: {
  value: QuoteHeaderForm;
  onChange: (next: QuoteHeaderForm) => void;
  productions: Production[];
  disabled?: boolean;
}) {
  const set = <K extends keyof QuoteHeaderForm>(key: K, v: QuoteHeaderForm[K]) => onChange({ ...value, [key]: v });
  const activeProductions = productions.filter(p => p.status !== 'archived' || p.id === value.production_id);

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls} htmlFor="q-title">Quote title *</label>
        <input id="q-title" className={inputCls} value={value.title} disabled={disabled}
          placeholder="e.g. Scenic Construction — Les Mis UK Tour" onChange={e => set('title', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="q-date">Quote date *</label>
          <input id="q-date" type="date" className={inputCls} value={value.quote_date} disabled={disabled}
            onChange={e => set('quote_date', e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="q-valid">Valid until *</label>
          <input id="q-valid" type="date" className={inputCls} value={value.valid_until} min={value.quote_date || undefined} disabled={disabled}
            onChange={e => set('valid_until', e.target.value)} />
        </div>
      </div>

      <fieldset>
        <legend className={labelCls}>Recipient type *</legend>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(['internal', 'external'] as QuoteRecipientType[]).map(t => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              aria-pressed={value.recipient_type === t}
              onClick={() => set('recipient_type', t)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold ${value.recipient_type === t ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'} disabled:opacity-60`}
            >
              {t === 'internal' ? 'Internal department' : 'External third party'}
            </button>
          ))}
        </div>
      </fieldset>

      {value.recipient_type === 'internal' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="q-prod">Production *</label>
            <select id="q-prod" className={inputCls} value={value.production_id} disabled={disabled}
              onChange={e => set('production_id', e.target.value)}>
              <option value="">Choose production…</option>
              {activeProductions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="q-dept">Department *</label>
            <select id="q-dept" className={inputCls} value={value.department} disabled={disabled}
              onChange={e => set('department', e.target.value)}>
              <option value="">Choose department…</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              {value.department && !DEPARTMENTS.includes(value.department) && <option value={value.department}>{value.department}</option>}
            </select>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="q-rname">Recipient name *</label>
            <input id="q-rname" className={inputCls} value={value.recipient_name} disabled={disabled}
              onChange={e => set('recipient_name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="q-company">Company *</label>
            <input id="q-company" className={inputCls} value={value.recipient_company} disabled={disabled}
              onChange={e => set('recipient_company', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="q-email">Email *</label>
            <input id="q-email" type="email" className={inputCls} value={value.recipient_email} disabled={disabled}
              onChange={e => set('recipient_email', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="q-prodlink">Production link (optional)</label>
            <select id="q-prodlink" className={inputCls} value={value.production_id} disabled={disabled}
              onChange={e => set('production_id', e.target.value)}>
              <option value="">None</option>
              {activeProductions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="q-intro">Notes / introduction</label>
        <textarea id="q-intro" rows={3} className={inputCls} value={value.introduction} disabled={disabled}
          placeholder="Scope summary — appears at the top of the quote" onChange={e => set('introduction', e.target.value)} />
      </div>
    </div>
  );
}
