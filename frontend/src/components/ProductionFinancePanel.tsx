'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { PoundSterling, Loader2 } from 'lucide-react';
import { quotesApi, salesApi, Quote, SalesInvoice, SalesInvoiceStatus } from '@/lib/api';
import { fmtCurrency, fmtDate, QUOTE_STATUS_CONFIG } from '@/components/quotes/quoteShared';

const INVOICE_STATUS: Record<SalesInvoiceStatus, { label: string; cls: string }> = {
  overdue:     { label: 'Overdue',     cls: 'bg-red-700 text-white' },
  outstanding: { label: 'Outstanding', cls: 'bg-amber-600 text-white' },
  paid:        { label: 'Paid',        cls: 'bg-green-700 text-white' },
};

const sum = (values: (string | number)[]) => values.reduce<number>((t, v) => t + (Number(v) || 0), 0);

/**
 * Production record → Finance (Addendum 6 §10.2): the production's quotes and the Xero
 * invoices allocated to it in Sales, with total quoted / invoiced / received.
 */
export default function ProductionFinancePanel({ productionId }: { productionId: string }) {
  const [data, setData] = useState<{ id: string; quotes: Quote[]; invoices: SalesInvoice[]; error: string | null } | null>(null);
  const loading = data?.id !== productionId;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      quotesApi.list({ production_id: productionId, status: 'all' }),
      salesApi.listInvoices({ production_id: productionId }),
    ])
      .then(([quotes, invoices]) => { if (!cancelled) setData({ id: productionId, quotes, invoices, error: null }); })
      .catch(e => { if (!cancelled) setData({ id: productionId, quotes: [], invoices: [], error: e instanceof Error ? e.message : 'Unable to load finance' }); });
    return () => { cancelled = true; };
  }, [productionId]);

  const quotes = loading ? [] : data?.quotes ?? [];
  const invoices = loading ? [] : data?.invoices ?? [];
  // Drafts are not quoted yet and Declined quotes were not taken up.
  const quoted = sum(quotes.filter(q => q.status !== 'draft' && q.status !== 'declined').map(q => q.total));
  const invoiced = sum(invoices.map(i => i.total));
  const received = sum(invoices.map(i => i.amount_paid));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
        <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg"><PoundSterling size={16} /></div>
        <div>
          <h2 className="text-slate-900 font-semibold text-sm">Finance</h2>
          <p className="text-slate-400 text-xs">Quotes for this production and the Xero invoices allocated to it in Sales.</p>
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
      ) : data?.error ? (
        <p className="px-5 py-6 text-xs text-red-600">{data.error}</p>
      ) : (
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ['Total quoted', quoted, 'Sent, approved and invoiced quotes'],
              ['Total invoiced', invoiced, `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} from Xero`],
              ['Total received', received, `${fmtCurrency(invoiced - received)} still to come in`],
            ].map(([label, value, sub]) => (
              <div key={label as string} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-bold text-slate-900">{fmtCurrency(value as number)}</p>
                <p className="text-[11px] text-slate-400">{sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Quotes</h3>
              {quotes.length === 0 ? <p className="text-xs text-slate-400">No quotes linked to this production.</p> : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold">
                      <tr><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Title</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-center">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quotes.map(q => (
                        <tr key={q.id}>
                          <td className="px-3 py-2 whitespace-nowrap"><Link href={`/quotes/${q.id}`} className="font-semibold text-blue-600 hover:underline">{q.reference}</Link></td>
                          <td className="px-3 py-2 max-w-48 truncate" title={q.title}>{q.title}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{fmtCurrency(q.total)}</td>
                          <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${QUOTE_STATUS_CONFIG[q.status].cls}`}>{QUOTE_STATUS_CONFIG[q.status].label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Invoices</h3>
              {invoices.length === 0 ? <p className="text-xs text-slate-400">No invoices allocated yet — link them on the Sales page.</p> : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold">
                      <tr><th className="px-3 py-2">Invoice No.</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-center">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoices.map(i => (
                        <tr key={i.id}>
                          <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-800">{i.invoice_number || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{fmtCurrency(i.total)}</td>
                          <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${INVOICE_STATUS[i.sales_status].cls}`}>{INVOICE_STATUS[i.sales_status].label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
