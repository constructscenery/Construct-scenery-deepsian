'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowDown, ArrowUp, GripVertical, Loader2, Pencil, Plus, Trash2, X, AlertCircle, CheckCircle2,
  ScrollText, Send, ThumbsUp, ThumbsDown, Hourglass, FileCheck2, Lock, Download, RotateCcw, Mail, Link2, Copy,
} from 'lucide-react';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import {
  quotesApi, productionsApi, crewRatesApi, CrewRate, Production,
  QuoteDetail, QuoteLine, QuoteLineType, QuoteStatus, QuoteSendMethod, VatTreatment, DiscountType,
} from '@/lib/api';
import QuoteHeaderFields, { QuoteHeaderForm, validateHeaderForm, headerFormToInput } from '@/components/quotes/QuoteHeaderFields';
import {
  fmtCurrency, fmtDate, fmtDateTime, round2, QuoteStatusBadge, QuoteWorkflow, LINE_TYPE_LABEL, DEPARTMENTS, inputCls, labelCls, recipientLabel,
} from '@/components/quotes/quoteShared';

const toHeaderForm = (q: QuoteDetail): QuoteHeaderForm => ({
  title: q.title,
  quote_date: q.quote_date.slice(0, 10),
  valid_until: q.valid_until.slice(0, 10),
  recipient_type: q.recipient_type,
  production_id: q.production_id ?? '',
  department: q.department ?? '',
  recipient_name: q.recipient_name ?? '',
  recipient_company: q.recipient_company ?? '',
  recipient_email: q.recipient_email ?? '',
  introduction: q.introduction ?? '',
});

type Toast = { type: 'success' | 'error'; message: string } | null;
type Action = QuoteStatus | 'delete' | 'revise';

const SEND_METHOD_LABEL: Record<QuoteSendMethod, string> = { email: 'Emailed', download: 'Downloaded', link: 'Shared by link' };

export default function QuoteBuilderPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { isGuest } = useAuth();

  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [productions, setProductions] = useState<Production[]>([]);
  const [rates, setRates] = useState<CrewRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [editingHeader, setEditingHeader] = useState(false);
  const [lineModal, setLineModal] = useState<{ line: QuoteLine | null; type: QuoteLineType } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  const isDraft = quote?.status === 'draft';
  const canEdit = !isGuest && isDraft;

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    quotesApi.get(id)
      .then(q => { if (!cancelled) { setQuote(q); setLoadError(null); } })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Unable to load quote'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => setProductions([]));
    crewRatesApi.list({ current: 'true' }).then(setRates).catch(() => setRates([]));
  }, []);

  /** Run an API call that returns the updated quote; show its error as a toast. */
  const mutate = async (fn: () => Promise<QuoteDetail>, success?: string) => {
    try {
      const updated = await fn();
      setQuote(updated);
      if (success) showToast('success', success);
      return true;
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Something went wrong');
      return false;
    }
  };

  const download = (sendId?: string) => {
    if (!quote) return;
    quotesApi.downloadPdf(quote.id, sendId).catch(e => showToast('error', e instanceof Error ? e.message : 'Unable to download the PDF'));
  };

  if (loading) {
    return (
      <div className="flex flex-col flex-1 min-w-0 bg-slate-50 min-h-screen">
        <TopBar title="Quote" />
        <div className="flex-1 flex items-center justify-center"><Loader2 size={22} className="animate-spin text-blue-600" /></div>
      </div>
    );
  }

  if (loadError || !quote) {
    return (
      <div className="flex flex-col flex-1 min-w-0 bg-slate-50 min-h-screen">
        <TopBar title="Quote" />
        <main className="p-6 max-w-3xl mx-auto w-full text-center space-y-3">
          <p className="text-sm text-red-600">{loadError || 'Quote not found'}</p>
          <Link href="/quotes" className="text-xs font-semibold text-blue-600 hover:underline">Back to quotes</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-slate-50 min-h-screen text-slate-800">
      <TopBar title={`Quote ${quote.reference}`} />

      {toast && (
        <div className={`fixed top-5 right-5 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      <main className="p-4 md:p-6 space-y-4 md:space-y-5 max-w-6xl w-full mx-auto">
        <Link href="/quotes" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> All quotes
        </Link>

        {/* Title row + status actions */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-sm"><ScrollText size={20} /></div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">{quote.reference}</h1>
              <span className="text-xs font-semibold text-slate-500 border border-slate-200 rounded-md px-2 py-0.5">Rev {quote.revision}</span>
              <QuoteStatusBadge status={quote.status} />
            </div>
            <p className="text-sm text-slate-700 mt-1.5 break-words">{quote.title}</p>
            {!isDraft && (
              <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-1"><Lock size={12} /> Locked for editing once sent.</p>
            )}
          </div>
          <StatusActions quote={quote} canAct={!isGuest} onAction={setAction} onSend={() => setSendOpen(true)} onDownload={() => download()} />
        </div>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 md:p-4">
          <QuoteWorkflow status={quote.status} />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5 items-start">
          {/* Header */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Quote details</h2>
              {canEdit && !editingHeader && (
                <button type="button" onClick={() => setEditingHeader(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <Pencil size={13} /> Edit
                </button>
              )}
            </div>
            {editingHeader ? (
              <HeaderEditor
                quote={quote}
                productions={productions}
                onCancel={() => setEditingHeader(false)}
                onSave={async input => {
                  const ok = await mutate(() => quotesApi.update(quote.id, input), 'Quote details saved');
                  if (ok) setEditingHeader(false);
                }}
              />
            ) : (
              <dl className="space-y-2.5 text-xs">
                <Row label="Recipient">{quote.recipient_type === 'internal' ? 'Internal department' : 'External third party'}</Row>
                <Row label={quote.recipient_type === 'internal' ? 'Production / department' : 'Addressed to'}>
                  {quote.recipient_type === 'internal'
                    ? recipientLabel(quote)
                    : <>{quote.recipient_name}<br />{quote.recipient_company}<br /><span className="text-slate-500">{quote.recipient_email}</span></>}
                </Row>
                {quote.recipient_type === 'external' && quote.production_name && <Row label="Production link">{quote.production_name}</Row>}
                <Row label="Quote date">{fmtDate(quote.quote_date)}</Row>
                <Row label="Valid until">{fmtDate(quote.valid_until)}</Row>
                {quote.po_reference && <Row label="PO reference">{quote.po_reference}</Row>}
                {quote.introduction && <Row label="Introduction"><span className="whitespace-pre-wrap">{quote.introduction}</span></Row>}
                {quote.status_note && <Row label="Last status note"><span className="whitespace-pre-wrap">{quote.status_note}</span></Row>}
                <Row label="Created by">{quote.created_by_name || '—'}</Row>
              </dl>
            )}

            <div className="pt-3 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-900 mb-2">Send history</h3>
              {quote.sends.length === 0 ? (
                <p className="text-xs text-slate-400">Not sent yet.</p>
              ) : (
                <ul className="space-y-2">
                  {quote.sends.map(s => (
                    <li key={s.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">
                          Rev {s.revision} · {SEND_METHOD_LABEL[s.method]}{s.sent_to ? ` to ${s.sent_to}` : ''}
                        </p>
                        <p className="text-slate-500">{fmtDateTime(s.sent_at)}{s.sent_by_name ? ` · ${s.sent_by_name}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => download(s.id)} aria-label={`Download revision ${s.revision} as sent`}
                        title="Download this version" className="p-1.5 rounded text-blue-600 hover:bg-blue-50 flex-shrink-0">
                        <Download size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Lines + totals */}
          <div className="lg:col-span-2 space-y-4">
            <LinesSection
              quote={quote}
              canEdit={canEdit}
              onAdd={type => setLineModal({ line: null, type })}
              onEdit={line => setLineModal({ line, type: line.line_type })}
              onDelete={line => mutate(() => quotesApi.deleteLine(quote.id, line.id), 'Line removed')}
              onReorder={ids => mutate(() => quotesApi.reorderLines(quote.id, ids))}
            />
            <TotalsSection
              quote={quote}
              canEdit={canEdit}
              onSave={input => mutate(() => quotesApi.update(quote.id, input), 'Totals updated')}
            />
          </div>
        </div>
      </main>

      {lineModal && (
        <LineModal
          initial={lineModal.line}
          initialType={lineModal.type}
          rates={rates}
          onClose={() => setLineModal(null)}
          onSave={async input => {
            const ok = await mutate(
              () => (lineModal.line ? quotesApi.updateLine(quote.id, lineModal.line.id, input) : quotesApi.addLine(quote.id, input)),
              lineModal.line ? 'Line updated' : 'Line added'
            );
            if (ok) setLineModal(null);
          }}
        />
      )}

      {sendOpen && (
        <SendModal
          quote={quote}
          production={productions.find(p => p.id === quote.production_id)}
          onClose={() => setSendOpen(false)}
          onSend={async (method, to) => {
            let updated: QuoteDetail;
            try {
              updated = await quotesApi.send(quote.id, { method, to });
            } catch (e) {
              showToast('error', e instanceof Error ? e.message : 'Unable to send the quote');
              return null;
            }
            setQuote(updated);
            if (method === 'email') showToast('success', `Quote emailed to ${updated.sends[0]?.sent_to ?? to}`);
            if (method === 'download') {
              // The send is already recorded; a failed download only needs retrying from Download PDF.
              await quotesApi.downloadPdf(quote.id)
                .catch(() => showToast('error', 'Quote marked as sent, but the download failed — use Download PDF.'));
            }
            return updated;
          }}
        />
      )}

      {action && (
        <ActionModal
          quote={quote}
          action={action}
          onClose={() => setAction(null)}
          onConfirm={async ({ note, po_reference }) => {
            if (action === 'delete') {
              try {
                await quotesApi.delete(quote.id);
                router.push('/quotes');
              } catch (e) {
                showToast('error', e instanceof Error ? e.message : 'Unable to delete quote');
              }
              return;
            }
            if (action === 'revise') {
              const ok = await mutate(() => quotesApi.revise(quote.id), `Revision ${quote.revision + 1} opened as a draft`);
              if (ok) setAction(null);
              return;
            }
            const ok = await mutate(
              () => quotesApi.changeStatus(quote.id, { status: action, note: note || undefined, po_reference: po_reference || undefined }),
              'Status updated'
            );
            if (ok) setAction(null);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800 break-words">{children}</dd>
    </div>
  );
}

// ─── Status actions ──────────────────────────────────────────────────────────

const ACTIONS: Partial<Record<QuoteStatus, { to: QuoteStatus; label: string; icon: React.ElementType; cls: string }[]>> = {
  sent: [
    { to: 'approved', label: 'Mark Approved', icon: ThumbsUp, cls: 'bg-green-700 hover:bg-green-800 text-white' },
    { to: 'declined', label: 'Mark Declined', icon: ThumbsDown, cls: 'bg-white hover:bg-red-50 text-red-600 border border-red-200' },
  ],
  approved: [{ to: 'awaiting_po_ref', label: 'Mark Awaiting PO Ref', icon: Hourglass, cls: 'bg-amber-700 hover:bg-amber-800 text-white' }],
  awaiting_po_ref: [{ to: 'invoice_raised', label: 'Enter PO & Mark Invoice Raised', icon: FileCheck2, cls: 'bg-green-800 hover:bg-green-900 text-white' }],
};

const secondaryBtn = 'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm';

function StatusActions({ quote, canAct, onAction, onSend, onDownload }: {
  quote: QuoteDetail;
  canAct: boolean;
  onAction: (a: Action) => void;
  onSend: () => void;
  onDownload: () => void;
}) {
  const actions = canAct ? ACTIONS[quote.status] ?? [] : [];
  const canSend = canAct && (quote.status === 'draft' || quote.status === 'sent');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canAct && quote.status === 'draft' && !quote.sent_at && (
        <button type="button" onClick={() => onAction('delete')}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-red-50 text-red-600 border border-slate-200 shadow-sm">
          <Trash2 size={14} /> Delete draft
        </button>
      )}
      <button type="button" onClick={onDownload} className={secondaryBtn}>
        <Download size={14} /> {quote.status === 'draft' ? 'Preview PDF' : 'Download PDF'}
      </button>
      {canAct && quote.status === 'sent' && (
        <button type="button" onClick={() => onAction('revise')} className={secondaryBtn}>
          <RotateCcw size={14} /> Revise
        </button>
      )}
      {canSend && (
        <button type="button" onClick={onSend}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm ${quote.status === 'draft' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-white hover:bg-blue-50 text-blue-700 border border-blue-200'}`}>
          <Send size={14} /> {quote.status === 'draft' ? 'Send quote' : 'Re-send'}
        </button>
      )}
      {actions.map(a => (
        <button key={a.to} type="button" onClick={() => onAction(a.to)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm ${a.cls}`}>
          <a.icon size={14} /> {a.label}
        </button>
      ))}
    </div>
  );
}

// ─── Send (Addendum 6 §8.2) ──────────────────────────────────────────────────

function SendModal({ quote, production, onClose, onSend }: {
  quote: QuoteDetail;
  production: Production | undefined;
  onClose: () => void;
  onSend: (method: QuoteSendMethod, to?: string) => Promise<QuoteDetail | null>;
}) {
  const [to, setTo] = useState(quote.recipient_email ?? '');
  const [busy, setBusy] = useState<QuoteSendMethod | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const emailOk = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to.trim()); // one address — same rule as the API

  // Internal quotes go to the production contact (Addendum 6 §8.2): offer the contacts on file.
  const contacts = production ? [
    { role: 'Financial Controller', name: production.financial_controller, email: production.financial_controller_email },
    { role: 'Supervising Art Director', name: production.supervising_art_director, email: production.supervising_art_director_email },
    { role: 'Art Dept Coordinator', name: production.art_dept_coordinator, email: production.art_dept_coordinator_email },
  ].filter((c): c is { role: string; name: string | null | undefined; email: string } => Boolean(c.email)) : [];

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const run = async (method: QuoteSendMethod) => {
    setBusy(method);
    const updated = await onSend(method, method === 'email' ? to.trim() : undefined);
    setBusy(null);
    if (!updated) return;
    if (method === 'link' && updated.share_token) {
      const url = quotesApi.shareUrl(updated.share_token);
      setLink(url);
      await copy(url);
      return;
    }
    onClose();
  };

  const optionCls = 'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Send quote" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{quote.status === 'draft' ? 'Send quote' : 'Re-send quote'} · Rev {quote.revision}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>
        {quote.status === 'draft' && (
          <p className="text-xs text-slate-600">Any of these marks the quote as Sent and locks it. Use Revise later if it needs changing.</p>
        )}

        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Mail size={14} /> Email to recipient</p>
          <input type="email" className={inputCls} value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.co.uk" aria-label="Email address" />
          {quote.recipient_type === 'internal' && contacts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {contacts.map(c => (
                <button key={c.role} type="button" onClick={() => setTo(c.email)}
                  className={`px-2 py-1 rounded-md text-[11px] border ${to === c.email ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {c.role}{c.name ? ` — ${c.name}` : ''}
                </button>
              ))}
            </div>
          )}
          {quote.recipient_type === 'internal' && contacts.length === 0 && (
            <p className="text-[11px] text-slate-400">No production contact email on file — type the address.</p>
          )}
          <button type="button" onClick={() => run('email')} disabled={busy !== null || !emailOk} className={`${optionCls} bg-blue-600 hover:bg-blue-700 text-white`}>
            {busy === 'email' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Email PDF
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={() => run('download')} disabled={busy !== null} className={`${optionCls} justify-center border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            {busy === 'download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PDF
          </button>
          <button type="button" onClick={() => run('link')} disabled={busy !== null} className={`${optionCls} justify-center border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            {busy === 'link' ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Copy secure link
          </button>
        </div>

        {link && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5">
            <p className="text-xs font-medium text-slate-700">{copied ? 'Link copied — paste it to the recipient.' : 'Copy this link for the recipient:'}</p>
            <div className="flex items-center gap-1.5">
              <input readOnly value={link} onFocus={e => e.target.select()} className={`${inputCls} font-mono`} aria-label="Secure link" />
              <button type="button" onClick={() => copy(link)} aria-label="Copy link" className="p-2 rounded-lg border border-slate-200 hover:bg-white text-slate-600"><Copy size={13} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionModal({ quote, action, onClose, onConfirm }: {
  quote: QuoteDetail;
  action: Action;
  onClose: () => void;
  onConfirm: (v: { note: string; po_reference: string }) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [po, setPo] = useState(quote.po_reference ?? '');
  const [busy, setBusy] = useState(false);
  const needsPo = action === 'invoice_raised';
  const poMissing = needsPo && !po.trim();

  const copy: Record<string, { title: string; body: string; confirm: string }> = {
    delete: { title: 'Delete this draft?', body: `${quote.reference} and its lines will be removed. The reference is not reused.`, confirm: 'Delete draft' },
    revise: { title: `Revise ${quote.reference}?`, body: `Opens revision ${quote.revision + 1} as a draft so you can change it and send it again. Everything sent so far stays in the send history.`, confirm: `Open revision ${quote.revision + 1}` },
    approved: { title: 'Mark as Approved?', body: 'Record that the recipient has agreed the quote.', confirm: 'Mark Approved' },
    declined: { title: 'Mark as Declined?', body: 'The quote is archived and cannot be reopened.', confirm: 'Mark Declined' },
    awaiting_po_ref: { title: 'Mark as Awaiting PO Ref?', body: 'The work is agreed; the invoice waits for the recipient\'s PO number.', confirm: 'Mark Awaiting PO Ref' },
    invoice_raised: { title: 'Mark as Invoice Raised', body: 'Enter the PO reference. Then raise the invoice in Xero with this PO number in the Reference field.', confirm: 'Mark Invoice Raised' },
  };
  const c = copy[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={c.title} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900">{c.title}</h2>
        <p className="text-xs text-slate-600">{c.body}</p>
        {needsPo && (
          <div>
            <label className={labelCls} htmlFor="po-ref">PO reference *</label>
            <input id="po-ref" className={inputCls} value={po} onChange={e => setPo(e.target.value)} placeholder="e.g. PO-7781" autoFocus />
          </div>
        )}
        {action !== 'delete' && action !== 'revise' && (
          <div>
            <label className={labelCls} htmlFor="status-note">Note (optional)</label>
            <textarea id="status-note" rows={2} className={inputCls} value={note} onChange={e => setNote(e.target.value)}
              placeholder={action === 'approved' ? 'e.g. Approved by Jane Smith by email' : action === 'declined' ? 'Reason, if given' : ''} />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            disabled={busy || poMissing}
            onClick={async () => { setBusy(true); await onConfirm({ note: note.trim(), po_reference: po.trim() }); setBusy(false); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${action === 'delete' || action === 'declined' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {busy && <Loader2 size={13} className="animate-spin" />} {c.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Header editor ───────────────────────────────────────────────────────────

function HeaderEditor({ quote, productions, onCancel, onSave }: {
  quote: QuoteDetail;
  productions: Production[];
  onCancel: () => void;
  onSave: (input: ReturnType<typeof headerFormToInput>) => Promise<void>;
}) {
  const [form, setForm] = useState<QuoteHeaderForm>(() => toHeaderForm(quote));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <QuoteHeaderFields value={form} onChange={setForm} productions={productions} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            const problem = validateHeaderForm(form);
            if (problem) { setError(problem); return; }
            setError(null);
            setSaving(true);
            await onSave(headerFormToInput(form));
            setSaving(false);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />} Save details
        </button>
      </div>
    </div>
  );
}

// ─── Lines ───────────────────────────────────────────────────────────────────

const ADD_BUTTONS: { type: QuoteLineType; label: string }[] = [
  { type: 'labour_grade', label: 'Labour' },
  { type: 'materials', label: 'Materials' },
  { type: 'plant_hire', label: 'Plant hire' },
  { type: 'misc', label: 'Misc' },
];

function LinesSection({ quote, canEdit, onAdd, onEdit, onDelete, onReorder }: {
  quote: QuoteDetail;
  canEdit: boolean;
  onAdd: (type: QuoteLineType) => void;
  onEdit: (line: QuoteLine) => void;
  onDelete: (line: QuoteLine) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuoteLine | null>(null);
  const lines = quote.lines;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= lines.length || from === to) return;
    const ids = lines.map(l => l.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">Line items</h2>
        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {ADD_BUTTONS.map(b => (
              <button key={b.type} type="button" onClick={() => onAdd(b.type)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200">
                <Plus size={13} /> {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs text-slate-400">
          {canEdit ? 'No lines yet — add labour, materials, plant hire or a misc line.' : 'No lines on this quote.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold">
              <tr>
                {canEdit && <th className="w-16 px-2 py-2.5"><span className="sr-only">Order</span></th>}
                <th className="px-3 py-2.5">Description</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5">Unit</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                {canEdit && <th className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr
                  key={l.id}
                  draggable={canEdit}
                  onDragStart={() => setDragId(l.id)}
                  onDragOver={e => { if (canEdit && dragId) e.preventDefault(); }}
                  onDrop={() => {
                    if (!dragId) return;
                    move(lines.findIndex(x => x.id === dragId), i);
                    setDragId(null);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={dragId === l.id ? 'opacity-40' : 'hover:bg-slate-50/60'}
                >
                  {canEdit && (
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-0.5 text-slate-400">
                        <GripVertical size={14} className="cursor-grab" aria-hidden="true" />
                        <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up" className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={12} /></button>
                        <button type="button" onClick={() => move(i, i + 1)} disabled={i === lines.length - 1} aria-label="Move down" className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={12} /></button>
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2.5 min-w-44">
                    <p className="font-medium text-slate-800">{l.description}</p>
                    {l.note && <p className="text-slate-500 mt-0.5 whitespace-pre-wrap">{l.note}</p>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{LINE_TYPE_LABEL[l.line_type]}</td>
                  <td className="px-3 py-2.5 text-right">{Number(l.quantity)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{l.unit || '—'}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtCurrency(l.unit_rate)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">{fmtCurrency(l.line_total)}</td>
                  {canEdit && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button type="button" onClick={() => onEdit(l)} aria-label="Edit line" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Pencil size={13} /></button>
                      <button type="button" onClick={() => setConfirmDelete(l)} aria-label="Delete line" className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setConfirmDelete(null)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Delete line" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Delete this line?</h2>
            <p className="text-xs text-slate-600 break-words">{confirmDelete.description} — {fmtCurrency(confirmDelete.line_total)}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }} className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Line modal ──────────────────────────────────────────────────────────────

type LineForm = {
  line_type: QuoteLineType;
  description: string;
  bectu_rate_id: string;
  quantity: string;
  unit: string;
  unit_rate: string;
  note: string;
};

const LABOUR_UNITS = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'hour', label: 'Hours' },
];

function rateFor(rate: CrewRate | undefined, unit: string): string {
  if (!rate) return '';
  if (unit === 'day') return rate.daily_rate ?? '';
  if (unit === 'week') return rate.weekly_rate ?? '';
  return '';
}

function LineModal({ initial, initialType, rates, onClose, onSave }: {
  initial: QuoteLine | null;
  initialType: QuoteLineType;
  rates: CrewRate[];
  onClose: () => void;
  onSave: (input: {
    line_type: QuoteLineType; description: string; bectu_rate_id: string | null;
    quantity: number; unit: string | null; unit_rate: number; note: string | null;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState<LineForm>(() => initial ? {
    line_type: initial.line_type,
    description: initial.description,
    bectu_rate_id: initial.bectu_rate_id ?? '',
    quantity: String(Number(initial.quantity)),
    unit: initial.unit ?? '',
    unit_rate: String(Number(initial.unit_rate)),
    note: initial.note ?? '',
  } : {
    line_type: initialType,
    description: '',
    bectu_rate_id: '',
    quantity: initialType === 'misc' ? '1' : '',
    unit: initialType === 'labour_grade' ? 'day' : initialType === 'plant_hire' ? 'day' : '',
    unit_rate: '',
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // `rates` holds the active rate card only (effective_to IS NULL).
  const currentRates = useMemo(
    () => [...rates].sort((a, b) => `${a.trade} ${a.rank}`.localeCompare(`${b.trade} ${b.rank}`)),
    [rates]
  );
  const selectedRate = currentRates.find(r => r.id === form.bectu_rate_id);
  // A line saved against an older rate card keeps its grade even though that rate is no longer active.
  const keepsOldRate = Boolean(initial?.bectu_rate_id && form.bectu_rate_id === initial.bectu_rate_id && !selectedRate);

  const set = <K extends keyof LineForm>(k: K, v: LineForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const isLabour = form.line_type === 'labour_grade' || form.line_type === 'labour_department';
  // Rounded the same way the API stores them, so the preview matches the saved line.
  const qty = round2(form.quantity);
  const rate = round2(form.unit_rate);
  const total = round2(qty * rate);

  const pickRate = (rateId: string) => {
    const r = currentRates.find(x => x.id === rateId);
    setForm(f => ({
      ...f,
      bectu_rate_id: rateId,
      description: r ? `${r.trade} — ${r.rank}` : f.description,
      unit_rate: r ? rateFor(r, f.unit) : f.unit_rate,
    }));
  };

  const pickLabourUnit = (unit: string) => {
    setForm(f => {
      const r = currentRates.find(x => x.id === f.bectu_rate_id);
      return { ...f, unit, unit_rate: f.line_type === 'labour_grade' && r ? rateFor(r, unit) : f.unit_rate };
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.line_type === 'labour_grade' && !form.bectu_rate_id) { setError('Choose a grade from the rate card'); return; }
    if (!form.description.trim()) { setError('Description is required'); return; }
    if (form.line_type !== 'misc' && (form.quantity === '' || !Number.isFinite(Number(form.quantity)) || qty <= 0)) { setError('Quantity must be more than 0'); return; }
    if (form.unit_rate === '' || !Number.isFinite(Number(form.unit_rate)) || rate < 0) { setError(form.line_type === 'misc' ? 'Enter the amount' : 'Rate must be 0 or more'); return; }
    setError(null);
    setSaving(true);
    await onSave({
      line_type: form.line_type,
      description: form.description.trim(),
      bectu_rate_id: form.line_type === 'labour_grade' ? form.bectu_rate_id || null : null,
      quantity: form.line_type === 'misc' ? 1 : qty,
      unit: form.unit.trim() || null,
      unit_rate: rate,
      note: form.note.trim() || null,
    });
    setSaving(false);
  };

  const title = `${initial ? 'Edit' : 'Add'} ${isLabour ? 'labour' : LINE_TYPE_LABEL[form.line_type].toLowerCase()} line`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-label={title}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {isLabour && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {(['labour_grade', 'labour_department'] as QuoteLineType[]).map(t => (
                <button key={t} type="button" aria-pressed={form.line_type === t}
                  onClick={() => setForm(f => ({ ...f, line_type: t, bectu_rate_id: '', description: '', unit: t === 'labour_grade' ? 'day' : f.unit }))}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold ${form.line_type === t ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>
                  {t === 'labour_grade' ? 'By grade' : 'By department'}
                </button>
              ))}
            </div>
          )}

          {form.line_type === 'labour_grade' && (
            <div>
              <label className={labelCls} htmlFor="l-grade">Grade (rate card) *</label>
              <select id="l-grade" className={inputCls} value={form.bectu_rate_id} onChange={e => pickRate(e.target.value)}>
                <option value="">Choose grade…</option>
                {currentRates.map(r => <option key={r.id} value={r.id}>{r.trade} — {r.rank} ({r.rate_type === 'bectu' ? 'BECTU' : 'Internal'})</option>)}
                {keepsOldRate && initial && (
                  <option value={initial.bectu_rate_id ?? ''}>{initial.description} (previous rate card)</option>
                )}
              </select>
            </div>
          )}

          {form.line_type !== 'labour_grade' && (
            <div>
              <label className={labelCls} htmlFor="l-desc">{form.line_type === 'labour_department' ? 'Department *' : 'Description *'}</label>
              {form.line_type === 'labour_department' ? (
                <select id="l-desc" className={inputCls} value={form.description} onChange={e => set('description', e.target.value)}>
                  <option value="">Choose department…</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  {form.description && !DEPARTMENTS.includes(form.description) && <option value={form.description}>{form.description}</option>}
                </select>
              ) : (
                <input id="l-desc" className={inputCls} value={form.description} onChange={e => set('description', e.target.value)}
                  placeholder={form.line_type === 'materials' ? 'e.g. 18mm MDF sheets' : form.line_type === 'plant_hire' ? 'e.g. Scissor lift hire' : 'e.g. Travel and subsistence'} />
              )}
            </div>
          )}

          {form.line_type !== 'misc' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls} htmlFor="l-qty">{form.line_type === 'plant_hire' ? 'Duration *' : 'Quantity *'}</label>
                <input id="l-qty" type="number" min="0" step="0.5" inputMode="decimal" className={inputCls} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="l-unit">Unit</label>
                {isLabour || form.line_type === 'plant_hire' ? (
                  <select id="l-unit" className={inputCls} value={form.unit}
                    onChange={e => (form.line_type === 'labour_grade' ? pickLabourUnit(e.target.value) : set('unit', e.target.value))}>
                    {form.line_type === 'labour_department' && <option value="">—</option>}
                    {(form.line_type === 'plant_hire' ? LABOUR_UNITS.filter(u => u.value !== 'hour') : LABOUR_UNITS).map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    {form.line_type === 'labour_department' && <option value="lump sum">Lump sum</option>}
                  </select>
                ) : (
                  <input id="l-unit" className={inputCls} value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="e.g. sheets" />
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="l-rate">{form.line_type === 'materials' ? 'Unit cost (£) *' : 'Rate (£) *'}</label>
                <input id="l-rate" type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.unit_rate} onChange={e => set('unit_rate', e.target.value)} />
              </div>
            </div>
          )}

          {form.line_type === 'labour_grade' && form.unit === 'hour' && (
            <p className="text-xs text-amber-700">The rate card has no hourly rate — enter it here.</p>
          )}
          {form.line_type === 'labour_grade' && selectedRate && form.unit !== 'hour' && rateFor(selectedRate, form.unit) !== '' && form.unit_rate !== '' && rate !== round2(rateFor(selectedRate, form.unit)) && (
            <p className="text-xs text-slate-500">Rate card: {fmtCurrency(rateFor(selectedRate, form.unit))} per {form.unit}. You have overridden it.</p>
          )}

          {form.line_type === 'misc' && (
            <div className="max-w-48">
              <label className={labelCls} htmlFor="l-amount">Amount (£) *</label>
              <input id="l-amount" type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.unit_rate} onChange={e => set('unit_rate', e.target.value)} />
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="l-note">Note (optional)</label>
            <textarea id="l-note" rows={2} className={inputCls} value={form.note} onChange={e => set('note', e.target.value)} />
          </div>

          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-xs text-slate-500">Line total</span>
            <span className="text-sm font-bold text-slate-900">{fmtCurrency(form.line_type === 'misc' ? rate : total)}</span>
          </div>
        </div>

        {error && (
          <p className="mx-5 mb-2 flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </p>
        )}
        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} {initial ? 'Save line' : 'Add line'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Totals ──────────────────────────────────────────────────────────────────

function TotalsSection({ quote, canEdit, onSave }: {
  quote: QuoteDetail;
  canEdit: boolean;
  onSave: (input: { discount_type: DiscountType | null; discount_value: number; vat_treatment: VatTreatment; footer_notes: string | null }) => Promise<boolean>;
}) {
  const [discountType, setDiscountType] = useState<DiscountType | ''>(quote.discount_type ?? '');
  const [discountValue, setDiscountValue] = useState(String(Number(quote.discount_value) || ''));
  const [vat, setVat] = useState<VatTreatment>(quote.vat_treatment);
  const [footer, setFooter] = useState(quote.footer_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = (discountType || '') !== (quote.discount_type ?? '')
    || (discountType && Number(discountValue) !== Number(quote.discount_value))
    || vat !== quote.vat_treatment
    || footer !== (quote.footer_notes ?? '');

  const save = async () => {
    const dv = Number(discountValue || 0);
    if (discountType === 'percent' && (dv < 0 || dv > 100)) { setError('Percentage must be between 0 and 100'); return; }
    if (discountType === 'fixed' && (dv < 0 || dv > Number(quote.subtotal))) { setError('Fixed discount must be between £0 and the subtotal'); return; }
    setError(null);
    setSaving(true);
    await onSave({ discount_type: discountType || null, discount_value: discountType ? dv : 0, vat_treatment: vat, footer_notes: footer.trim() || null });
    setSaving(false);
  };

  const vatLabel = quote.vat_treatment === 'standard' ? 'VAT 20%' : quote.vat_treatment === 'zero' ? 'VAT 0%' : 'VAT exempt';

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Discount, VAT and terms</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="t-disc-type">Discount</label>
            <select id="t-disc-type" className={inputCls} value={discountType} disabled={!canEdit}
              onChange={e => setDiscountType(e.target.value as DiscountType | '')}>
              <option value="">None</option>
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed amount (£)</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="t-disc-value">{discountType === 'percent' ? 'Percent' : 'Amount (£)'}</label>
            <input id="t-disc-value" type="number" min="0" step="0.01" className={inputCls} value={discountValue}
              disabled={!canEdit || !discountType} onChange={e => setDiscountValue(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="t-vat">VAT</label>
          <select id="t-vat" className={inputCls} value={vat} disabled={!canEdit} onChange={e => setVat(e.target.value as VatTreatment)}>
            <option value="standard">Standard 20%</option>
            <option value="zero">Zero-rated 0%</option>
            <option value="exempt">Exempt</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="t-footer">Footer notes</label>
          <textarea id="t-footer" rows={3} className={inputCls} value={footer} disabled={!canEdit}
            placeholder="Terms, payment instructions…" onChange={e => setFooter(e.target.value)} />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {canEdit && (
          <button type="button" onClick={save} disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Update totals
          </button>
        )}
      </div>

      <dl className="self-end space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-medium">{fmtCurrency(quote.subtotal)}</dd></div>
        {Number(quote.discount_amount) > 0 && (
          <div className="flex justify-between">
            <dt className="text-slate-500">Discount{quote.discount_type === 'percent' ? ` (${Number(quote.discount_value)}%)` : ''}</dt>
            <dd className="font-medium">−{fmtCurrency(quote.discount_amount)}</dd>
          </div>
        )}
        <div className="flex justify-between"><dt className="text-slate-500">{vatLabel}</dt><dd className="font-medium">{fmtCurrency(quote.vat_amount)}</dd></div>
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
          <dt className="font-bold text-slate-900">Total</dt><dd className="font-bold text-slate-900">{fmtCurrency(quote.total)}</dd>
        </div>
      </dl>
    </section>
  );
}
