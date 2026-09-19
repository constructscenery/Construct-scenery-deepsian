'use client';

import { useEffect, useMemo, useState } from 'react';
import PublicQr from '@/components/PublicQr';
import { Download, ExternalLink, FileText, QrCode, Search, X } from 'lucide-react';
import { safetyHealthApi, type SafetyHealthDocument } from '@/lib/api';

export default function PublicSafetyHealthPage() {
  const [documents, setDocuments] = useState<SafetyHealthDocument[]>([]);
  const [type, setType] = useState<'all' | 'coshh' | 'insurance'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qrDocument, setQrDocument] = useState<SafetyHealthDocument | null>(null);
  const [showDirectoryQr, setShowDirectoryQr] = useState(false);

  useEffect(() => {
    safetyHealthApi.publicList().then(setDocuments).catch(err => setError(err instanceof Error ? err.message : 'Unable to load certificates')).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return documents.filter(doc => {
      const matchesType = type === 'all' || doc.document_type === type;
      const text = [doc.file_name, doc.location || '', ...(doc.tags || []), ...(doc.productions || []).map(production => production.name)].join(' ').toLowerCase();
      return matchesType && (!query || text.includes(query));
    });
  }, [documents, search, type]);

  async function download(certificate: SafetyHealthDocument) {
    const response = await fetch(safetyHealthApi.publicUrl(certificate.public_token!), { cache: 'no-store' });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = certificate.file_name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <main className="min-h-screen bg-slate-50 p-4 md:p-8">
    <div className="max-w-6xl mx-auto space-y-5">
      <header className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <img src="/construct scenery logo.png" alt="Construct Scenery" className="w-12 h-12 rounded-xl object-cover border border-slate-200" />
          <div>
            <p className="text-xs uppercase tracking-wider text-blue-600 font-semibold">Construct Scenery</p>
            <p className="text-xs text-slate-400 mt-0.5">CS HQ · Health & Safety</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 mt-5">Health & Safety Certificates</h1>
        <p className="text-sm text-slate-500 mt-1">Shareable public access to current COSHH and insurance certificates. No login required.</p>
        <button onClick={() => setShowDirectoryQr(true)} className="mt-3 inline-flex items-center gap-2 text-sm text-blue-600"><QrCode size={16} /> View directory QR</button>
      </header>
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row gap-3">
          <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 flex-1"><Search size={15} className="text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search certificates, location, production, or tags..." className="bg-transparent outline-none text-sm w-full" /></div>
          <div className="flex gap-1"><button onClick={() => setType('all')} className={`px-3 py-2 text-sm rounded-lg ${type === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>All</button><button onClick={() => setType('coshh')} className={`px-3 py-2 text-sm rounded-lg ${type === 'coshh' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>COSHH</button><button onClick={() => setType('insurance')} className={`px-3 py-2 text-sm rounded-lg ${type === 'insurance' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Insurance</button></div>
        </div>
        {error && <p className="m-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {loading ? <p className="p-10 text-center text-slate-400">Loading certificates...</p> : filtered.length === 0 ? <p className="p-10 text-center text-slate-400">No certificates match your search.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-slate-50 text-left">{['Certificate', 'Type', 'Location', 'Production', 'Tags', 'Actions'].map(header => <th key={header} className="px-4 py-3 text-xs font-semibold text-slate-500">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(doc => <tr key={doc.id}><td className="px-4 py-3 text-slate-800 font-medium"><FileText size={14} className="inline mr-2 text-blue-600" />{doc.file_name}</td><td className="px-4 py-3 text-slate-600 uppercase text-xs">{doc.document_type}</td><td className="px-4 py-3 text-slate-600">{doc.location || '—'}</td><td className="px-4 py-3 text-slate-600">{(doc.productions || []).map(production => production.name).join(', ') || '—'}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(doc.tags || []).map(tag => <span key={tag} className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-1">{tag}</span>)}</div></td><td className="px-4 py-3"><button onClick={() => download(doc)} className="flex items-center gap-1 text-blue-600 text-xs"><Download size={13} /> Download</button><button onClick={() => setQrDocument(doc)} className="flex items-center gap-1 text-emerald-700 text-xs mt-1"><QrCode size={13} /> View QR</button><a href={safetyHealthApi.publicUrl(doc.public_token!)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-slate-600 text-xs mt-1"><ExternalLink size={13} /> Public link</a></td></tr>)}</tbody></table></div>}
      </section>
      <footer className="flex items-center justify-center gap-2 text-xs text-slate-400"><img src="/construct scenery logo.png" alt="" aria-hidden="true" className="w-5 h-5 rounded object-cover" /> <span>Construct Scenery · CS HQ · Public read-only certificate directory</span></footer>
      {(qrDocument || showDirectoryQr) && <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={() => { setQrDocument(null); setShowDirectoryQr(false); }} />
        <div role="dialog" aria-modal="true" aria-label="Shareable QR Code" className="relative bg-white rounded-lg shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-6 text-center">
          <button onClick={() => { setQrDocument(null); setShowDirectoryQr(false); }} className="absolute top-3 right-3 text-slate-400" aria-label="Close QR modal"><X size={18} /></button>
          <h2 className="font-semibold text-slate-800 pr-5">Shareable QR Code</h2>
          <p className="text-xs text-slate-500 mt-1 break-words">{qrDocument?.file_name || 'COSHH & Insurance Certificate Directory'}</p>
          <div className="mt-4"><PublicQr url={qrDocument ? safetyHealthApi.publicUrl(qrDocument.public_token!) : `${window.location.origin}/public/safety-health`} filename={qrDocument ? `${qrDocument.file_name}-qr.png` : 'health-and-safety-directory-qr.png'} /></div>
          <a href={qrDocument ? safetyHealthApi.publicUrl(qrDocument.public_token!) : '/public/safety-health'} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open public link</a>
        </div>
      </div>}
    </div>
  </main>;
}
