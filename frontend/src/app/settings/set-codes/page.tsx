'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '@/components/TopBar';
import { setCodesApi, type UniversalSetCode } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Pencil, Check, X, Loader2, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

/**
 * CS-03 — Universal set codes: codes available on every production's timesheets and POs,
 * for management / above-the-line staff (e.g. Ben, Sian). Their costs are reported as
 * management costs and kept out of each production's Profit / Loss.
 * Codes are deactivated, never deleted, so historic timesheets keep their meaning.
 */
const inputCls = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function UniversalSetCodesPage() {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== 'guest';
  const [codes, setCodes] = useState<UniversalSetCode[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState({ code: '', name: '' });
  const [editing, setEditing] = useState<{ id: string; code: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setCodes(await setCodesApi.listUniversal(true)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load set codes'); }
  }, []);
  useEffect(() => {
    let active = true;
    setCodesApi.listUniversal(true)
      .then(c => { if (active) setCodes(c); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load set codes'); });
    return () => { active = false; };
  }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (ok) setNotice(ok); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); return false; }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!newCode.code.trim() || !newCode.name.trim()) { setError('Enter a code and a name'); return; }
    if (await run(() => setCodesApi.createUniversal({ code: newCode.code.trim(), name: newCode.name.trim() }), 'Code added')) {
      setNewCode({ code: '', name: '' });
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await run(() => setCodesApi.updateUniversal(editing.id, { code: editing.code.trim(), name: editing.name.trim() }), 'Code updated')) {
      setEditing(null);
    }
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    await run(async () => {
      const r = await setCodesApi.importUniversal(file);
      setNotice(`Imported: ${r.created} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} rows skipped` : ''}.`);
    });
  };

  return (
    <>
      <TopBar title="Universal Set Codes" subtitle="Codes available on every production — e.g. management / above-the-line staff" />
      <main className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl">
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-900">
          Use these codes on timesheet days and purchase orders for people and costs that aren&apos;t a production cost
          (management). They appear in every production&apos;s set dropdown and are shown separately from each
          production&apos;s Profit / Loss. Production-specific sets are imported on each production&apos;s page.
        </div>

        {error && <p className="flex items-center gap-1.5 text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs"><AlertCircle size={13} /> {error}</p>}
        {notice && <p className="flex items-center gap-1.5 text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs"><CheckCircle2 size={13} /> {notice}</p>}

        {canEdit && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">Code<br />
              <input className={`${inputCls} w-32`} value={newCode.code} maxLength={50} placeholder="e.g. MGT-BEN"
                onChange={e => setNewCode(c => ({ ...c, code: e.target.value }))} />
            </label>
            <label className="text-xs text-slate-600 flex-1 min-w-48">Name<br />
              <input className={`${inputCls} w-full`} value={newCode.name} placeholder="e.g. Ben Keville — management"
                onChange={e => setNewCode(c => ({ ...c, name: e.target.value }))} />
            </label>
            <button type="button" onClick={add} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              <Plus size={13} /> Add code
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Upload size={13} /> Import CSV (code, name)
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { void importFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="text-left px-4 py-2.5">Code</th><th className="text-left px-4 py-2.5">Name</th><th className="text-left px-4 py-2.5">Status</th>{canEdit && <th className="px-4 py-2.5" />}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!codes ? (
                <tr><td colSpan={4} className="py-8 text-center"><Loader2 size={18} className="animate-spin text-blue-600 inline" /></td></tr>
              ) : codes.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-slate-400 text-xs">No universal set codes yet.</td></tr>
              ) : codes.map(c => (
                <tr key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                  {editing?.id === c.id ? (
                    <>
                      <td className="px-4 py-2"><input className={`${inputCls} w-32`} value={editing.code} maxLength={50} onChange={e => setEditing({ ...editing, code: e.target.value })} /></td>
                      <td className="px-4 py-2"><input className={`${inputCls} w-full`} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></td>
                      <td />
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button type="button" onClick={saveEdit} disabled={busy} aria-label="Save" className="p-1.5 rounded hover:bg-green-50 text-green-700"><Check size={15} /></button>
                        <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X size={15} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-mono text-xs">{c.code}</td>
                      <td className="px-4 py-2.5">{c.name}</td>
                      <td className="px-4 py-2.5 text-xs">{c.is_active ? <span className="text-green-700">Active</span> : <span className="text-slate-500">Inactive</span>}</td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => setEditing({ id: c.id, code: c.code, name: c.name })} aria-label={`Edit ${c.code}`} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Pencil size={14} /></button>
                          <button type="button" disabled={busy}
                            onClick={() => run(() => setCodesApi.updateUniversal(c.id, { is_active: !c.is_active }), c.is_active ? `${c.code} deactivated` : `${c.code} reactivated`)}
                            className="ml-1 text-xs font-medium text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline">
                            {c.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
