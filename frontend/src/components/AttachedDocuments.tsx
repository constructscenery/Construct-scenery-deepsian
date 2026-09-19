'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText, Loader2, Trash2, Upload, X } from 'lucide-react';
import { attachedDocumentsApi, type AttachedDocument, type DocumentOwner } from '@/lib/api';

export default function AttachedDocuments({ owner, ownerId, name, onClose }: { owner: DocumentOwner; ownerId: string; name: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<AttachedDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<{ document: AttachedDocument; url: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttachedDocument | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let active = true;
    attachedDocumentsApi.list(owner, ownerId).then(data => { if (active) setDocuments(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load documents'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, ownerId, reload]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function upload() {
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { setError('Select a PDF, JPEG or PNG file.'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('Maximum file size is 25 MB.'); return; }
    setBusy(true); setError('');
    try {
      const document = await attachedDocumentsApi.upload(owner, ownerId, file);
      setDocuments(current => [document, ...current]);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setBusy(false); }
  }

  async function view(document: AttachedDocument) {
    setBusy(true); setError('');
    try {
      const blob = await attachedDocumentsApi.view(owner, ownerId, document.id);
      setPreview({ document, url: URL.createObjectURL(blob) });
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to open document'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true); setError('');
    try {
      await attachedDocumentsApi.delete(owner, ownerId, deleteTarget.id);
      setDocuments(current => current.filter(document => document.id !== deleteTarget.id));
      if (preview?.document.id === deleteTarget.id) setPreview(null);
      setDeleteTarget(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to delete document'); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialogRef} aria-labelledby="attached-documents-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-4xl max-h-[90dvh] overflow-y-auto rounded-lg bg-white p-4 md:p-6 shadow-xl backdrop:bg-black/40">
    <header className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0"><h2 id="attached-documents-title" className="font-semibold text-slate-900">Documents</h2><p className="text-sm text-slate-500 break-words mt-1">{name}</p></div>
      <button disabled={busy} onClick={onClose} title="Close documents" aria-label="Close documents" className="p-2 text-slate-500 disabled:opacity-50"><X size={18} /></button>
    </header>
    <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
      <label className="block flex-1 min-w-0 text-xs font-medium text-slate-600">Document (PDF, JPEG, PNG; max 25 MB)<input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy || loading} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); }} className="block mt-2 w-full min-w-0 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700" /></label>
      <button disabled={!file || busy || loading} onClick={upload} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Upload size={15} /> Upload</button>
    </div>
    {error && <div role="alert" className="flex flex-wrap gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 mb-3"><span>{error}</span><button disabled={busy} onClick={() => { setError(''); setLoading(true); setReload(current => current + 1); }} className="underline">Reload documents</button></div>}
    {busy && <p role="status" className="flex items-center gap-2 text-sm text-slate-500 mb-3"><Loader2 size={14} className="animate-spin" /> Working...</p>}
    {loading ? <p role="status" className="py-6 text-sm text-slate-500">Loading documents...</p> : documents.length === 0 ? <p className="py-6 text-sm text-slate-500">No documents attached.</p> : <ul className="divide-y divide-slate-100 border-y border-slate-100">
      {documents.map(document => <li key={document.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
        <div className="flex items-start gap-2 min-w-0"><FileText size={18} className="text-blue-600 mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-sm font-medium text-slate-800 break-all">{document.file_name}</p><p className="text-xs text-slate-500 mt-1">{Math.max(1, Math.ceil(Number(document.file_size) / 1024))} KB · {new Date(document.uploaded_at).toLocaleDateString('en-GB')}</p></div></div>
        <div className="flex gap-2 shrink-0"><button disabled={busy} onClick={() => view(document)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-blue-600 disabled:opacity-50"><Eye size={15} /> View</button><button disabled={busy} onClick={() => setDeleteTarget(document)} title={`Delete ${document.file_name}`} aria-label={`Delete ${document.file_name}`} className="p-2 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} /></button></div>
      </li>)}
    </ul>}
    {deleteTarget && <div role="group" aria-label="Confirm document deletion" className="mt-4 border-l-4 border-red-500 bg-red-50 p-3">
      <p className="text-sm text-red-800 break-words">Delete {deleteTarget.file_name} permanently?</p>
      <div className="flex gap-2 mt-3"><button disabled={busy} onClick={() => setDeleteTarget(null)} className="px-3 py-2 text-sm text-slate-600">Cancel</button><button disabled={busy} onClick={remove} className="inline-flex items-center gap-2 rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Trash2 size={14} /> Delete document</button></div>
    </div>}
    {preview && <section aria-label="Document preview" className="mt-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 className="text-sm font-medium text-slate-800 break-all">{preview.document.file_name}</h3><div className="flex gap-3"><a href={preview.url} download={preview.document.file_name} className="inline-flex items-center gap-1 text-sm text-blue-600"><Download size={15} /> Download</a><button onClick={() => setPreview(null)} title="Close preview" aria-label="Close preview" className="text-slate-500"><X size={16} /></button></div></div>
      {preview.document.file_mime_type === 'application/pdf' ? <iframe title={`Preview of ${preview.document.file_name}`} src={preview.url} className="w-full h-[55dvh] min-h-64 border border-slate-200 rounded" /> : <img src={preview.url} alt={preview.document.file_name} className="w-full h-[55dvh] min-h-64 object-contain bg-slate-50" />}
    </section>}
  </dialog>;
}