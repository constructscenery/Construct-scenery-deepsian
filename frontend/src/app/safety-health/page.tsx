'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { productionsApi, safetyHealthApi, type Production, type SafetyHealthDocument, type SafetyHealthDocumentType } from '@/lib/api';
import { Check, Copy, Download, ExternalLink, FileText, HeartPulse, Pencil, QrCode, Search, Upload, X } from 'lucide-react';
import QRCode from 'qrcode';

const tabs: Array<{ type: SafetyHealthDocumentType; label: string; description: string }> = [
  { type: 'risk_template', label: '6.1 Risk Assessment Template', description: 'The standard Word template available for download and completion.' },
  { type: 'risk_assessment', label: '6.2 Filled Risk Assessments', description: 'Completed risk assessments stored as searchable PDFs.' },
  { type: 'coshh', label: '6.3 COSHH Certificates', description: 'Tagged certificates with public QR access.' },
  { type: 'insurance', label: '6.4 Insurance Certificates', description: 'Tagged certificates with public QR access.' },
];

function PublicQr({ token, filename = 'certificate-qr.png', size = 96 }: { token: string; filename?: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/api/public/safety-health/${token}`, { width: size, margin: 1 })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [token]);
  return src ? (
    <a href={src} download={filename} title="Download shareable QR code">
      <img src={src} alt="Public certificate QR code" style={{ width: size, height: size }} />
    </a>
  ) : null;
}

export default function SafetyHealthPage() {
  const { user } = useAuth();
  const [activeType, setActiveType] = useState<SafetyHealthDocumentType>('risk_template');
  const [coshhStatus, setCoshhStatus] = useState<'active' | 'pending_alteration'>('active');
  const [documents, setDocuments] = useState<SafetyHealthDocument[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [productionIds, setProductionIds] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingDocument, setEditingDocument] = useState<SafetyHealthDocument | null>(null);
  const [qrDocument, setQrDocument] = useState<SafetyHealthDocument | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploader = Boolean(user);

  const loadDocuments = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: Record<string, string> = { document_type: activeType };
      if (activeType === 'coshh') params.status = coshhStatus;
      setDocuments(await safetyHealthApi.list(params));
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load documents.'); }
    finally { setLoading(false); }
  }, [activeType, coshhStatus]);

  useEffect(() => { loadDocuments(); productionsApi.list().then(setProductions).catch(() => setProductions([])); }, [loadDocuments]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return documents.filter(doc => !query || [doc.file_name, doc.location || '', doc.production_name || '', ...doc.tags].some(value => value.toLowerCase().includes(query)));
  }, [documents, search]);

  function openUpload(documentToReplace: SafetyHealthDocument | null = null) {
    setEditingDocument(documentToReplace);
    setFile(null); setDate(documentToReplace?.assessment_date || ''); setLocation(documentToReplace?.location || ''); setProductionIds(documentToReplace?.production_ids || (documentToReplace?.production_id ? [documentToReplace.production_id] : [])); setTags(documentToReplace?.tags.join(', ') || ''); setError(''); setShowUpload(true);
  }

  async function handleUpload() {
    if (!editingDocument && !file) { setError('Choose a document first.'); return; }
    setSaving(true); setError('');
    try {
      const data = new FormData();
      if (file) data.append('file', file); data.append('document_type', activeType); data.append('status', activeType === 'coshh' ? coshhStatus : 'active'); data.append('assessment_date', date); data.append('location', location); data.append('production_ids', JSON.stringify(productionIds)); data.append('tags', tags);
      if (editingDocument) await safetyHealthApi.replace(editingDocument.id, data);
      else await safetyHealthApi.upload(data);
      setShowUpload(false); setEditingDocument(null); await loadDocuments();
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(documentToDelete: SafetyHealthDocument) {
    if (!window.confirm(`Delete ${documentToDelete.file_name}? This also removes its stored file.`)) return;
    try {
      await safetyHealthApi.delete(documentToDelete.id);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  const currentTab = tabs.find(tab => tab.type === activeType)!;
  const template = activeType === 'risk_template' ? documents[0] : null;
  const acceptedFiles = activeType === 'risk_template' ? '.doc,.docx' : '.pdf';
  const publicDirectoryUrl = typeof window !== 'undefined' ? `${window.location.origin}/public/safety-health` : '/public/safety-health';

  async function copyPublicDirectoryLink() {
    await navigator.clipboard.writeText(publicDirectoryUrl);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }

  return <>
    <TopBar title="Safety & Health" subtitle="Controlled safety documents and certificates" />
    <main className="flex-1 p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200">
        {tabs.map(tab => <button key={tab.type} onClick={() => setActiveType(tab.type)} className={`whitespace-nowrap px-4 py-3 text-sm font-normal border-b-2 ${activeType === tab.type ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600'}`}>{tab.label}</button>)}
      </div>
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="mb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-blue-900">Shareable certificate directory</p>
            <p className="text-xs text-blue-700 mt-0.5">Share this link with users who need to view current COSHH and insurance certificates. No login is required.</p>
            <p className="text-xs text-blue-800 mt-2 break-all">{publicDirectoryUrl}</p>
          </div>
          <button onClick={copyPublicDirectoryLink} className="flex items-center justify-center gap-2 flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {linkCopied ? <Check size={14} /> : <Copy size={14} />}
            {linkCopied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-3"><div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><HeartPulse size={18} /></div><div><h2 className="text-slate-800 font-semibold">{currentTab.label}</h2><p className="text-slate-500 text-sm mt-1">{currentTab.description}</p></div></div>
          {isUploader && <button onClick={() => openUpload()} className="flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium"><Upload size={14} /> Upload</button>}
        </div>
        {activeType === 'risk_template' && <div className="mt-5 border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><FileText size={20} className="text-blue-600" /><div><p className="text-sm font-medium text-slate-800">{template?.file_name || 'No template uploaded yet'}</p><p className="text-xs text-slate-400">Word document template</p></div></div>{template && <div className="flex items-center gap-3"><button onClick={() => safetyHealthApi.download(template.id, template.file_name)} className="flex items-center gap-2 text-sm text-blue-600"><Download size={14} /> Download</button><button onClick={() => openUpload(template)} className="flex items-center gap-1 text-sm text-amber-700"><Pencil size={13} /> Edit</button><button onClick={() => handleDelete(template)} className="text-sm text-red-600">Delete</button></div>}</div>}
        {activeType !== 'risk_template' && <>
          {activeType === 'coshh' && <div className="mt-5 flex items-center gap-1 border-b border-slate-200"><button onClick={() => setCoshhStatus('active')} className={`px-3 py-2 text-sm border-b-2 ${coshhStatus === 'active' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600'}`}>Active COSHH</button><button onClick={() => setCoshhStatus('pending_alteration')} className={`px-3 py-2 text-sm border-b-2 ${coshhStatus === 'pending_alteration' ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-600'}`}>Pending Alteration</button></div>}
          <div className="mt-5 flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2"><Search size={15} className="text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search file name, location, production, or tags..." className="bg-transparent outline-none text-sm w-full" /></div>
          {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead><tr className="bg-slate-50 text-left">{['Document', 'Date', 'Location', 'Production', 'Tags', 'Access', 'Actions'].map(header => <th key={header} className="px-3 py-3 text-xs font-semibold text-slate-500">{header}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Loading documents…</td></tr> : filtered.length === 0 ? <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">No documents found.</td></tr> : filtered.map(doc => (
                  <tr key={doc.id}>
                    <td className="px-3 py-3 text-slate-800 font-medium">{doc.file_name}</td>
                    <td className="px-3 py-3 text-slate-600">{doc.assessment_date || '—'}</td>
                    <td className="px-3 py-3 text-slate-600">{doc.location || '—'}</td>
                    <td className="px-3 py-3 text-slate-600">{doc.production_name || '—'}</td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{doc.tags.map(tag => <span key={tag} className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-1">{tag}</span>)}</div></td>
                    <td className="px-3 py-3">{doc.public_token ? <span className="text-xs text-emerald-700">Public QR</span> : <span className="text-xs text-slate-400">Authenticated</span>}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => safetyHealthApi.download(doc.id, doc.file_name)} className="flex items-center gap-1 text-blue-600 text-xs"><Download size={13} /> Download</button>
                      <button onClick={() => openUpload(doc)} className="flex items-center gap-1 text-amber-700 text-xs mt-1"><Pencil size={13} /> Edit</button>
                      <button onClick={() => handleDelete(doc)} className="flex items-center gap-1 text-red-600 text-xs mt-1"><X size={13} /> Delete</button>
                      {doc.public_token && <><button onClick={() => setQrDocument(doc)} className="flex items-center gap-1 text-emerald-700 text-xs mt-1"><QrCode size={13} /> View QR</button><a href={safetyHealthApi.publicUrl(doc.public_token)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-700 text-xs mt-1"><ExternalLink size={13} /> Public link</a></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </section>
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setShowUpload(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-slate-800">{editingDocument ? `Edit ${currentTab.label}` : `Upload ${currentTab.label}`}</h2>
                <p className="text-xs text-slate-500 mt-1">Choose a file from your computer, then upload it to the Safety & Health document store.</p>
              </div>
              <button onClick={() => setShowUpload(false)} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close upload modal"><X size={18} /></button>
            </div>

            {template && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
                <div className="flex items-center gap-2 min-w-0"><FileText size={18} className="text-emerald-600 flex-shrink-0" /><div className="min-w-0"><p className="text-xs font-medium text-emerald-800">Attached file</p><p className="text-xs text-emerald-700 truncate">{template.file_name}</p></div></div>
                <button type="button" onClick={() => safetyHealthApi.download(template.id, template.file_name)} className="text-xs font-medium text-emerald-700 hover:text-emerald-900 whitespace-nowrap">Download</button>
              </div>
            )}

            {!editingDocument && <label
              htmlFor="safety-health-file"
              onDragOver={event => event.preventDefault()}
              onDrop={event => { event.preventDefault(); setFile(event.dataTransfer.files?.[0] || null); }}
              className="flex flex-col items-center justify-center gap-2 min-h-36 border-2 border-dashed border-blue-200 bg-blue-50/40 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors px-5 text-center"
            >
              <Upload size={26} className="text-blue-600" />
              <span className="text-sm font-semibold text-slate-800">Click here to browse your computer</span>
              <span className="text-xs text-slate-500">or drag and drop a {activeType === 'risk_template' ? 'Word document' : 'PDF'} here</span>
              <span className="text-xs text-blue-700 font-medium">{file ? `Selected: ${file.name}` : `Accepted files: ${acceptedFiles}`}</span>
              <input ref={fileInputRef} id="safety-health-file" type="file" accept={acceptedFiles} onChange={e => setFile(e.target.files?.[0] || null)} className="sr-only" />
            </label>}

            {(activeType !== 'risk_template' || editingDocument) && <>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" className="w-full border rounded-lg px-3 py-2 text-sm" />
              <select multiple value={productionIds} onChange={e => setProductionIds(Array.from(e.target.selectedOptions, option => option.value))} className="w-full border rounded-lg px-3 py-2 text-sm min-h-24"><option value="" disabled>Select one or more productions</option>{productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags separated by commas" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </>}
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-1"><button onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm text-slate-600">Cancel</button><button disabled={saving || (!editingDocument && !file)} onClick={handleUpload} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{saving ? 'Saving…' : editingDocument ? 'Save changes' : 'Upload file'}</button></div>
          </div>
        </div>
      )}
      {qrDocument?.public_token && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setQrDocument(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="flex items-start justify-between text-left"><div><h2 className="font-semibold text-slate-800">Shareable QR Code</h2><p className="text-xs text-slate-500 mt-1 truncate max-w-64">{qrDocument.file_name}</p></div><button onClick={() => setQrDocument(null)} className="p-1 text-slate-400" aria-label="Close QR modal"><X size={18} /></button></div>
            <div className="flex justify-center"><PublicQr token={qrDocument.public_token} filename={`${qrDocument.file_name}-qr.png`} size={280} /></div>
            <p className="text-xs text-slate-500">Scan this code to open the public certificate PDF.</p>
            <a href={safetyHealthApi.publicUrl(qrDocument.public_token)} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open public link</a>
          </div>
        </div>
      )}
    </main>
  </>;
}
