'use client';

import React from 'react';
import { ArrowRight, ArrowUp } from 'lucide-react';
import { QuoteLineType, QuoteStatus, Quote } from '@/lib/api';

// Shared helpers for the Quotes list and quote builder pages.

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Round to 2 dp, half away from zero — matches the API (services/quoteCalculations.js). */
export const round2 = (n: number | string | null | undefined) => {
  const v = Number(n) || 0;
  const shifted = Number(`${Math.abs(v)}e2`);
  const r = Math.round(Number.isFinite(shifted) ? shifted : Math.abs(v) * 100) / 100;
  return v < 0 ? -r : r;
};

export const fmtCurrency = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(v) || 0);

/** Local date as YYYY-MM-DD (the user's calendar day, not UTC). */
export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Solid status colours (Addendum 6 §9–10). */
export const QUOTE_STATUS_CONFIG: Record<QuoteStatus, { label: string; cls: string; sub: string }> = {
  draft:           { label: 'Draft',           cls: 'bg-slate-500 text-white', sub: 'Being built — not yet visible to recipient' },
  sent:            { label: 'Sent',            cls: 'bg-blue-600 text-white',  sub: 'PDF sent — locked for editing' },
  approved:        { label: 'Approved',        cls: 'bg-green-700 text-white', sub: 'Recipient has agreed' },
  declined:        { label: 'Declined',        cls: 'bg-red-700 text-white',   sub: 'Rejected — quote archived' },
  awaiting_po_ref: { label: 'Awaiting PO Ref', cls: 'bg-amber-700 text-white', sub: 'Waiting for PO number' },
  invoice_raised:  { label: 'Invoice Raised',  cls: 'bg-green-800 text-white', sub: 'Invoice raised in Xero — appears in Sales' },
};

export const QUOTE_STATUS_ORDER: QuoteStatus[] = ['draft', 'sent', 'approved', 'declined', 'awaiting_po_ref', 'invoice_raised'];

export const LINE_TYPE_LABEL: Record<QuoteLineType, string> = {
  labour_grade: 'Labour — by grade',
  labour_department: 'Labour — by department',
  materials: 'Materials',
  plant_hire: 'Plant hire',
  misc: 'Miscellaneous',
};

/** Same department list the Purchase Orders module uses. */
export const DEPARTMENTS = [
  'Construction',
  'Scenic Art',
  'Metalwork',
  'Plastering / Sculpting',
  'Rigging',
  'Logistics / Transport',
  'Accounts / Admin',
  'Props',
];

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const c = QUOTE_STATUS_CONFIG[status] ?? QUOTE_STATUS_CONFIG.draft;
  return <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${c.cls}`}>{c.label}</span>;
}

export const recipientLabel = (q: Pick<Quote, 'recipient_type' | 'production_name' | 'department' | 'recipient_company' | 'recipient_name'>) =>
  q.recipient_type === 'internal'
    ? `${q.production_name ?? 'Production'} / ${q.department ?? '—'}`
    : `Ext: ${q.recipient_company ?? q.recipient_name ?? '—'}`;

/** Notes column on the Quotes list: the status note if one was entered, otherwise what the status means. */
export const quoteListNote = (q: Pick<Quote, 'status' | 'status_note' | 'po_reference' | 'revision'>) => {
  if (q.status_note) return q.status_note;
  switch (q.status) {
    case 'draft': return q.revision > 1 ? `Revision ${q.revision} in progress` : 'In progress';
    case 'sent': return 'Awaiting response';
    case 'awaiting_po_ref': return 'PO-REF pending';
    case 'invoice_raised': return q.po_reference ? `PO ${q.po_reference}` : '—';
    default: return '—';
  }
};

// ─── Workflow swimlane (Addendum 6 §9) ───────────────────────────────────────

const PATH: QuoteStatus[] = ['draft', 'sent', 'approved', 'awaiting_po_ref', 'invoice_raised'];
const STEP_NO: Record<QuoteStatus, string> = { draft: '1', sent: '2', approved: '3', declined: '2b', awaiting_po_ref: '4', invoice_raised: '5' };

function stageState(stage: QuoteStatus, current: QuoteStatus): 'current' | 'done' | 'todo' {
  if (stage === current) return 'current';
  if (current === 'declined') return stage === 'draft' || stage === 'sent' ? 'done' : 'todo';
  if (stage === 'declined') return 'todo';
  return PATH.indexOf(stage) < PATH.indexOf(current) ? 'done' : 'todo';
}

function Stage({ stage, current }: { stage: QuoteStatus; current: QuoteStatus }) {
  const c = QUOTE_STATUS_CONFIG[stage];
  const state = stageState(stage, current);
  const cls = state === 'todo'
    ? 'bg-white border border-dashed border-slate-300 text-slate-400'
    : `${c.cls} ${state === 'done' ? 'opacity-55' : 'ring-2 ring-offset-2 ring-slate-900/70 shadow'}`;
  return (
    <div className={`rounded-md px-2 py-2 text-center min-h-[52px] flex flex-col justify-center ${cls}`} aria-current={state === 'current' ? 'step' : undefined}>
      <p className="text-xs font-bold leading-tight">{STEP_NO[stage]}&nbsp; {c.label}</p>
      <p className={`text-[10px] leading-tight mt-0.5 ${state === 'todo' ? 'text-slate-400' : 'text-white/85'}`}>{c.sub}</p>
    </div>
  );
}

const Arrow = () => <div className="flex items-center justify-center text-slate-400"><ArrowRight size={14} /></div>;

/** Draft → Sent → Approved / Declined; Approved → Awaiting PO Ref → Invoice Raised. */
export function QuoteWorkflow({ status }: { status: QuoteStatus }) {
  return (
    <div className="overflow-x-auto p-1">
      <div className="grid grid-cols-[1fr_20px_1fr_20px_1fr] gap-y-2 min-w-[540px]">
        <Stage stage="draft" current={status} /><Arrow /><Stage stage="sent" current={status} /><Arrow /><Stage stage="approved" current={status} />
        <div /><div /><Stage stage="declined" current={status} /><div /><div />
        <Stage stage="awaiting_po_ref" current={status} /><Arrow /><Stage stage="invoice_raised" current={status} /><div />
        <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400"><ArrowUp size={12} /> from Approved</div>
      </div>
    </div>
  );
}

export const inputCls = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60';
export const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
