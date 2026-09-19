'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, Download, Eye, FileText, Loader2, Search, Trash2, Upload, X } from 'lucide-react';
import TopBar from '@/components/TopBar';
import { historicalCostReportsApi, productionsApi, type Production, type HistoricalCostReport, type HistoricalCostReportType } from '@/lib/api';

const TYPE_LABELS: Record<HistoricalCostReportType, string> = { type1: 'Type 1 - On a Price', type2: 'Type 2 - Cost Plus' };
const inputClass = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50';

function UploadReport({ onClose, onStored }: { onClose: () => void; onStored: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [productions, setProductions] = useState<Production[]>([]);
  const [productionChoice, setProductionChoice] = useState('');
  const [reportType, setReportType] = useState<HistoricalCostReportType | ''>('');
  const [loadingProductions, setLoadingProductions] = useState(true);
  const [productionError, setProductionError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    productionsApi.list({ include_archived: 'true' })
      .then(data => { if (active) { setProductions(data.sort((left, right) => left.name.localeCompare(right.name))); setProductionError(''); } })
      .catch(err => { if (active) setProductionError(err instanceof Error ? err.message : 'Unable to load productions.'); })
      .finally(() => { if (active) setLoadingProductions(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (productionChoice !== 'manual') data.set('production_id', productionChoice);
    data.set('is_legacy', data.get('is_legacy') === 'on' ? 'true' : 'false');
    const file = data.get('file');
    if (!(file instanceof File) || !file.size || file.type !== 'application/pdf') { setError('Choose a PDF report.'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('Maximum file size is 25 MB.'); return; }
    setSaving(true);
    setError('');
    try { await historicalCostReportsApi.upload(data); onStored(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to upload report.'); setSaving(false); }
  }

  return <dialog ref={dialogRef} aria-labelledby="upload-report-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl backdrop:bg-black/40">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id="upload-report-title" className="font-semibold text-slate-900">Upload historical report</h2>
      <button type="button" onClick={onClose} disabled={saving} title="Close" aria-label="Close upload" className="p-2 text-slate-500 disabled:opacity-50"><X size={18} /></button>
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
        <label className="block text-xs font-medium text-slate-600">Production<select autoFocus required value={productionChoice} onChange={event => {
          const choice = event.target.value;
          setProductionChoice(choice);
          const production = productions.find(item => item.id === choice);
          if (production) setReportType(production.contract_type === 'cost_plus' ? 'type2' : 'type1');
        }} className={inputClass}>
          <option value="" disabled>{loadingProductions ? 'Loading productions...' : 'Select a production'}</option>
          <option value="manual">Enter a name manually</option>
          {productions.map(production => <option key={production.id} value={production.id}>{production.name}{production.production_company ? ` - ${production.production_company}` : ''}{production.status === 'archived' ? ' (Archived)' : ''}</option>)}
        </select></label>
        {productionError && <p role="alert" className="text-sm text-red-700">{productionError}<button type="button" onClick={() => { setLoadingProductions(true); setLoadAttempt(value => value + 1); }} className="ml-2 underline">Retry</button></p>}
        {productionChoice === 'manual' && <label className="block text-xs font-medium text-slate-600">Production name<input required name="production_name" maxLength={200} className={inputClass} /></label>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0 text-xs font-medium text-slate-600">Report date<input required type="date" name="report_date" className={inputClass} /></label>
          <label className="block min-w-0 text-xs font-medium text-slate-600">Report type<select required name="report_type" value={reportType} onChange={event => setReportType(event.target.value as HistoricalCostReportType)} className={inputClass}><option value="" disabled>Select type</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label className="block text-xs font-medium text-slate-600">PDF report (maximum 25 MB)<input required type="file" name="file" accept="application/pdf,.pdf" className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-slate-700`} /></label>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" name="is_legacy" className="mt-1" />Legacy report</label>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input required type="checkbox" className="mt-1" />Final report confirmed</label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={`${buttonClass} text-slate-600`}>Cancel</button>
          <button type="submit" className={`${buttonClass} bg-blue-600 text-white`}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{saving ? 'Storing...' : 'Store report'}</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}

function ReportViewer({ report, onClose }: { report: HistoricalCostReport; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    historicalCostReportsApi.view(report.id).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to open report.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [report.id, attempt]);

  return <dialog ref={dialogRef} aria-labelledby="report-viewer-title" onCancel={onClose} className="m-auto flex-col w-[calc(100%_-_2rem)] max-w-6xl h-[90dvh] max-h-[90dvh] rounded-lg bg-white p-4 shadow-xl backdrop:bg-black/40 open:flex">
    <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="report-viewer-title" className="break-words font-semibold text-slate-900">{report.production_name}</h2><p className="mt-1 text-xs text-slate-500">{TYPE_LABELS[report.report_type]} | {report.report_date.slice(0, 10)}{report.is_legacy ? ' | Legacy' : ''}</p></div>
      <div className="flex shrink-0 items-center gap-1">
        {url && <a href={url} download={report.file_name} title="Download PDF" aria-label="Download PDF" className="rounded p-2 text-blue-600 hover:bg-blue-50"><Download size={20} /></a>}
        <button type="button" onClick={onClose} title="Close" aria-label="Close report" className="rounded p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </div>
    </div>
    {error ? <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}<button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }} className="ml-3 underline">Retry</button></div>
      : url ? <iframe title={`${report.production_name} cost report`} src={url} className="min-h-0 w-full flex-1 rounded border border-slate-200" />
        : <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />Loading report...</div>}
  </dialog>;
}

export default function HistoricalCostReportsPage() {
  const [reports, setReports] = useState<HistoricalCostReport[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<HistoricalCostReport | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  async function deleteReport(report: HistoricalCostReport) {
    if (!confirm(`Delete the ${TYPE_LABELS[report.report_type]} report for "${report.production_name}" dated ${report.report_date.slice(0, 10)} from Finance? Its records and PDF will be retained, and the production will not be deleted.`)) return;
    setDeletingId(report.id);
    setDeleteError('');
    try {
      await historicalCostReportsApi.delete(report.id);
      setReports(current => current.filter(item => item.id !== report.id));
    } catch (err) { setDeleteError(err instanceof Error ? err.message : 'Unable to delete report.'); }
    finally { setDeletingId(null); }
  }

  useEffect(() => {
    let active = true;
    historicalCostReportsApi.list(filters).then(data => { if (active) { setReports(data); setError(''); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load reports.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, reload]);

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(Array.from(data.entries()).map(([key, value]) => [key, String(value).trim()]).filter(([, value]) => value));
    if (values.date_from && values.date_to && values.date_from > values.date_to) { setError('From date must be on or before the to date.'); return; }
    setError(''); setLoading(true); setFilters(values);
  }

  return <div className="flex min-h-screen min-w-0 flex-col">
    <TopBar title="Finance" />
    <main className="min-w-0 flex-1 space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800"><Archive size={18} />Report archive</h2>
        <button onClick={() => setUploadOpen(true)} className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}><Upload size={16} />Upload report</button>
      </div>
      <form onSubmit={search} className="grid items-end gap-3 border-y border-slate-200 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_200px_150px_150px_auto]">
        <label className="block min-w-0 text-xs font-medium text-slate-600">Production name<input name="search" type="search" maxLength={200} className={inputClass} /></label>
        <label className="block min-w-0 text-xs font-medium text-slate-600">Report type<select name="report_type" className={inputClass}><option value="">All report types</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block min-w-0 text-xs font-medium text-slate-600">From date<input name="date_from" type="date" className={inputClass} /></label>
        <label className="block min-w-0 text-xs font-medium text-slate-600">To date<input name="date_to" type="date" className={inputClass} /></label>
        <div className="flex gap-1"><button type="submit" className={`${buttonClass} border border-slate-200 bg-white text-slate-700`}><Search size={16} />Search</button><button type="reset" title="Clear filters" aria-label="Clear filters" onClick={() => { setLoading(true); setError(''); setFilters({}); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
      </form>
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={() => { setLoading(true); setError(''); setReload(value => value + 1); }} className="ml-3 underline">Retry</button></div>}
      {deleteError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{deleteError}</p>}
      {loading ? <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />Loading reports...</div>
        : !error && !reports.length ? <div className="py-16 text-center text-slate-500"><FileText size={30} className="mx-auto mb-3 text-slate-400" /><p className="text-sm">{Object.keys(filters).length ? 'No reports match your filters.' : 'No historical reports yet.'}</p></div>
          : !error && <>
            <p className="text-xs text-slate-500">{reports.length} {reports.length === 1 ? 'report' : 'reports'}</p>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3 font-medium">Production</th><th className="px-3 py-3 font-medium">Report date</th><th className="px-3 py-3 font-medium">Report type</th><th className="px-3 py-3 font-medium">Source</th><th className="px-3 py-3 text-right font-medium">Report</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{reports.map(report => <tr key={report.id} className="hover:bg-slate-50">
                  <td className="max-w-xs px-3 py-3"><p className="break-words font-medium text-slate-800">{report.production_name}</p>{report.is_legacy && <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Legacy</span>}<p className="mt-1 break-all text-xs text-slate-500">{report.file_name}</p></td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(`${report.report_date.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB')}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700">{TYPE_LABELS[report.report_type]}</td>
                  <td className="px-3 py-3"><span className={`whitespace-nowrap rounded px-2 py-1 text-xs ${report.source === 'automatic' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{report.source === 'automatic' ? 'Automatic' : 'Manual upload'}</span></td>
                  <td className="px-3 py-3 text-right"><div className="flex justify-end gap-1">
                    <button onClick={() => setSelectedReport(report)} disabled={deletingId === report.id} title={`View ${report.production_name}`} aria-label={`View ${report.production_name}`} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50 disabled:opacity-50"><Eye size={18} /></button>
                    <button onClick={() => deleteReport(report)} disabled={deletingId !== null} title={`Delete ${report.production_name} report`} aria-label={`Delete ${report.production_name} report`} className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deletingId === report.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}</button>
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
    </main>
    {uploadOpen && <UploadReport onClose={() => setUploadOpen(false)} onStored={() => { setUploadOpen(false); setLoading(true); setReload(value => value + 1); }} />}
    {selectedReport && <ReportViewer key={selectedReport.id} report={selectedReport} onClose={() => setSelectedReport(null)} />}
  </div>;
}