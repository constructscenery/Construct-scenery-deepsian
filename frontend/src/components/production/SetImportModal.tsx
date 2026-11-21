'use client';

import { useRef, useState } from 'react';
import { Upload, Download, Loader2, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { setCodesApi, type SetImportPlan } from '@/lib/api';

/**
 * CS-03 — import a production's sets from CSV: download template → choose file → preview → import.
 * Matching set numbers (any case/spacing) are updated, new ones added; nothing is deleted.
 */
export default function SetImportModal({ productionId, onClose, onImported }: {
  productionId: string;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<SetImportPlan | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | 'template' | null>(null);
  const [error, setError] = useState('');

  const choose = async (f: File | null) => {
    setFile(f);
    setPlan(null);
    setError('');
    if (!f) return;
    setBusy('preview');
    try {
      setPlan(await setCodesApi.previewSetImport(productionId, f));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy('import');
    setError('');
    try {
      const r = await setCodesApi.importSets(productionId, file);
      onImported(`Sets imported: ${r.created} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} rows skipped` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setBusy(null);
    }
  };

  const template = async () => {
    setBusy('template');
    try { await setCodesApi.downloadSetTemplate(); } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); }
    setBusy(null);
  };

  const importable = plan ? plan.summary.create + plan.summary.update : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Import sets" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-slate-900 font-semibold text-lg">Import sets</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto text-sm">
          <p className="text-slate-600">
            Columns: <span className="font-mono text-xs">set_number, set_name</span> (required),
            <span className="font-mono text-xs"> shoot_week, handover_date, completion_status, notes</span>.
            Set numbers already on this production are updated; new ones are added. Nothing is deleted.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={template} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy === 'template' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download template
            </button>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {file ? 'Choose another file' : 'Choose CSV file'}
            </button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { void choose(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            {file && <span className="self-center text-xs text-slate-500 truncate max-w-56">{file.name}</span>}
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs"><AlertCircle size={13} /> {error}</p>
          )}

          {plan && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-green-50 border border-green-100 py-2"><p className="text-lg font-bold text-green-700">{plan.summary.create}</p>new</div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 py-2"><p className="text-lg font-bold text-blue-700">{plan.summary.update}</p>updated</div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 py-2"><p className="text-lg font-bold text-amber-700">{plan.summary.invalid}</p>with errors (skipped)</div>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr><th className="text-left px-3 py-2">Row</th><th className="text-left px-3 py-2">Set #</th><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Handover</th><th className="text-left px-3 py-2">Result</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.rows.map(r => (
                      <tr key={r.row} className={r.valid ? '' : 'bg-amber-50/60'}>
                        <td className="px-3 py-1.5 text-slate-400">{r.row}</td>
                        <td className="px-3 py-1.5 font-mono">{r.set_number || '—'}</td>
                        <td className="px-3 py-1.5">{r.set_name || '—'}</td>
                        <td className="px-3 py-1.5">{r.handover_date || '—'}</td>
                        <td className="px-3 py-1.5">
                          {r.valid
                            ? <span className={r.action === 'create' ? 'text-green-700' : 'text-blue-700'}>{r.action === 'create' ? 'New' : 'Update'}</span>
                            : <span className="text-amber-800">{r.errors.join('; ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={runImport} disabled={!plan || importable === 0 || busy !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {busy === 'import' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Import {importable || ''} set{importable === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
