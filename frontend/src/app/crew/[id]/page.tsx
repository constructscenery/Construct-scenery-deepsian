'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Pencil, Trash2, Upload, FileText, X, Loader2,
  Building2, CreditCard, Phone, Calendar, Link2, CheckCircle2,
  Clock, AlertCircle, Plus,
} from 'lucide-react';
import {
  crewApi, productionsApi, crewRatesApi,
  CrewDetail, CrewDocument, CrewProductionHistory, CrewRate,
  Production, EmploymentStatus,
} from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtGBP = (n: string | number | null) =>
  n == null ? '—' :
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
    .format(typeof n === 'string' ? parseFloat(n) : n);

const DOC_TYPE_LABELS: Record<string, string> = {
  government_id: 'Government ID',
  contract: 'Contract',
  other: 'Other',
};

const TS_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:            { label: 'Draft',            className: 'bg-slate-100 text-slate-500' },
  sent:             { label: 'Sent',             className: 'bg-blue-100 text-blue-700' },
  reviewed:         { label: 'Reviewed',         className: 'bg-blue-100 text-blue-700' },
  invoice_received: { label: 'Invoice Received', className: 'bg-purple-100 text-purple-700' },
  verified:         { label: 'Verified',         className: 'bg-green-100 text-green-700' },
};

// ─── Edit Crew Modal ──────────────────────────────────────────────────────────

interface EditModalProps {
  member: CrewDetail;
  onClose: () => void;
  onSaved: () => void;
}

type TradesData = { bectu: Record<string, string[]>; non_bectu: string[] };

function EditCrewModal({ member, onClose, onSaved }: EditModalProps) {
  const [trades, setTrades] = useState<TradesData | null>(null);
  const [allRates, setAllRates] = useState<CrewRate[]>([]);
  const [form, setForm] = useState({
    first_name:                     member.first_name,
    last_name:                      member.last_name,
    email:                          member.email ?? '',
    date_of_birth:                  member.date_of_birth ?? '',
    home_address:                   member.home_address ?? '',
    employment_status:              member.employment_status,
    crew_trade:                     member.crew_trade ?? '',
    crew_rank:                      member.crew_rank ?? '',
    paye_withholding_rate:          String(member.paye_withholding_rate ?? 20),
    company_name:                   member.company_name ?? '',
    company_registration_number:    member.company_registration_number ?? '',
    vat_registration_number:        member.vat_registration_number ?? '',
    account_name:                   member.account_name ?? '',
    account_number:                 member.account_number ?? '',
    sort_code:                      member.sort_code ?? '',
    emergency_contact_name:         member.emergency_contact_name ?? '',
    emergency_contact_relationship: member.emergency_contact_relationship ?? '',
    emergency_contact_phone:        member.emergency_contact_phone ?? '',
    is_active:                      member.is_active,
    company_utr:                    member.company_utr ?? '',
    qualifications:                 member.qualifications ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    crewApi.getTrades().then(setTrades).catch(() => setTrades({ bectu: {}, non_bectu: [] }));
    crewRatesApi.list({ current: 'true' }).then(setAllRates).catch(() => {});
  }, []);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(f => {
        const v = e.target.type === 'checkbox'
          ? (e.target as HTMLInputElement).checked
          : e.target.value;
        const updated = { ...f, [k]: v };
        if (k === 'crew_trade') updated.crew_rank = '';
        return updated;
      });
    };

  const isSE = form.employment_status === 'self_employed';

  const allTrades = trades ? [...Object.keys(trades.bectu), ...trades.non_bectu] : [];
  const rankOptions = trades && form.crew_trade ? (trades.bectu[form.crew_trade] ?? []) : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await crewApi.update(member.id, {
        first_name:                     form.first_name.trim(),
        last_name:                      form.last_name.trim(),
        email:                          form.email || null,
        date_of_birth:                  form.date_of_birth || null,
        home_address:                   form.home_address || null,
        employment_status:              form.employment_status as EmploymentStatus,
        crew_trade:                     form.crew_trade || null,
        crew_rank:                      form.crew_rank || null,
        paye_withholding_rate:          form.paye_withholding_rate ? Number(form.paye_withholding_rate) : null,
        company_name:                   isSE ? (form.company_name || null) : null,
        company_registration_number:    isSE ? (form.company_registration_number || null) : null,
        vat_registration_number:        isSE ? (form.vat_registration_number || null) : null,
        account_name:                   form.account_name || null,
        account_number:                 form.account_number || null,
        sort_code:                      form.sort_code || null,
        emergency_contact_name:         form.emergency_contact_name || null,
        emergency_contact_relationship: form.emergency_contact_relationship || null,
        emergency_contact_phone:        form.emergency_contact_phone || null,
        is_active:                      form.is_active,
        company_utr:                    isSE ? (form.company_utr || null) : null,
        qualifications:                 form.qualifications,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const lbl = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
          <h2 className="text-slate-900 font-semibold text-base">Edit Crew Member</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* Status toggle */}
          <div className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={form.is_active} onChange={set('is_active')} />
              <div className="w-9 h-5 bg-slate-300 rounded-full peer peer-checked:bg-blue-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
            </label>
            <span className="text-slate-700 text-sm font-medium">{form.is_active ? 'Active' : 'Inactive'}</span>
          </div>

          {/* Personal */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Personal Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={lbl}>First Name *</label><input className={inp} value={form.first_name} onChange={set('first_name')} /></div>
              <div><label className={lbl}>Last Name *</label><input className={inp} value={form.last_name} onChange={set('last_name')} /></div>
            </div>
            <div className="mt-4">
              <label className={lbl}>Email</label><input type="email" className={inp} value={form.email} onChange={set('email')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div><label className={lbl}>Date of Birth</label><input type="date" className={inp} value={form.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().split('T')[0]} /></div>
              <div><label className={lbl}>Home Address</label><input className={inp} value={form.home_address} onChange={set('home_address')} /></div>
            </div>
          </div>

          {/* Employment */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Employment</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Employment Status</label>
                <select className={inp} value={form.employment_status} onChange={set('employment_status')}>
                  <option value="paye">PAYE</option>
                  <option value="self_employed">Self-Employed</option>
                </select>
              </div>
              <div><label className={lbl}>Withholding Rate (%)</label><input type="number" min={0} max={100} className={inp} value={form.paye_withholding_rate} onChange={set('paye_withholding_rate')} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className={lbl}>Trade</label>
                <select className={inp} value={form.crew_trade} onChange={set('crew_trade')}>
                  <option value="">— Select trade —</option>
                  {allTrades.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Rank</label>
                {rankOptions.length > 0 ? (
                  <select className={inp} value={form.crew_rank} onChange={set('crew_rank')}>
                    <option value="">— Select rank —</option>
                    {rankOptions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <input className={inp} value={form.crew_rank} onChange={set('crew_rank')} placeholder="e.g. Senior Carpenter" />
                )}
              </div>
            </div>

            {/* Rate preview */}
            {(() => {
              const rate = allRates.find(r => r.trade === form.crew_trade && r.rank === form.crew_rank);
              if (!rate || (!rate.daily_rate && !rate.overtime_rate)) return null;
              return (
                <div className="mt-3 flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs">
                  <span className="text-blue-500 font-semibold">2026/27 Rate:</span>
                  {rate.daily_rate && <span className="text-blue-700">Daily £{parseFloat(rate.daily_rate).toFixed(2)}</span>}
                  {rate.overtime_rate && <span className="text-blue-600">· OT £{parseFloat(rate.overtime_rate).toFixed(2)}/hr</span>}
                  <span className="text-blue-400 ml-auto">(read-only reference)</span>
                </div>
              );
            })()}
          </div>

          {/* SE Company */}
          {isSE && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Company Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2"><label className={lbl}>Company Name</label><input className={inp} value={form.company_name} onChange={set('company_name')} /></div>
                <div><label className={lbl}>Company Reg. Number</label><input className={inp} value={form.company_registration_number} onChange={set('company_registration_number')} /></div>
                <div><label className={lbl}>VAT Reg. Number</label><input className={inp} value={form.vat_registration_number} onChange={set('vat_registration_number')} /></div>
                <div><label className={lbl}>Company UTR</label><input className={inp} placeholder="e.g. 12345 67890" value={form.company_utr} onChange={set('company_utr')} /></div>
              </div>
            </div>
          )}

          {/* Bank */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Bank Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className={lbl}>Account Name</label><input className={inp} value={form.account_name} onChange={set('account_name')} /></div>
              <div><label className={lbl}>Account Number</label><input className={inp} value={form.account_number} onChange={set('account_number')} /></div>
              <div><label className={lbl}>Sort Code</label><input className={inp} value={form.sort_code} onChange={set('sort_code')} /></div>
            </div>
          </div>

          {/* Qualifications */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Qualifications</p>
            <div className="flex flex-wrap gap-3">
              {['PAL', 'Forklift Certificate', 'RTITB', 'AFTT', 'First Aid'].map(qual => (
                <label key={qual} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    checked={form.qualifications.includes(qual)}
                    onChange={e => {
                      setForm(f => ({
                        ...f,
                        qualifications: e.target.checked
                          ? [...f.qualifications, qual]
                          : f.qualifications.filter(q => q !== qual),
                      }));
                    }}
                  />
                  {qual}
                </label>
              ))}
            </div>
          </div>

          {/* Emergency */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Emergency Contact</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={lbl}>Contact Name</label><input className={inp} value={form.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
              <div><label className={lbl}>Relationship</label><input className={inp} value={form.emergency_contact_relationship} onChange={set('emergency_contact_relationship')} /></div>
              <div><label className={lbl}>Contact Phone</label><input type="tel" className={inp} value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Link to Production Modal ─────────────────────────────────────────────────

interface LinkProductionModalProps {
  crewId: string;
  onClose: () => void;
  onLinked: () => void;
}

function LinkProductionModal({ crewId, onClose, onLinked }: LinkProductionModalProps) {
  const [productions, setProductions] = useState<Production[]>([]);
  const [form, setForm] = useState({ production_id: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.production_id) { setError('Please select a production.'); return; }
    setSaving(true);
    setError('');
    try {
      await crewApi.linkToProduction(crewId, {
        production_id: form.production_id,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      });
      onLinked();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to link');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-sm">Link to Production</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Production *</label>
            <select className={inp} value={form.production_id} onChange={e => setForm(f => ({ ...f, production_id: e.target.value }))}>
              <option value="">— Select production —</option>
              {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
              <input type="date" className={inp} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
              <input type="date" className={inp} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Link
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Upload Document Modal ────────────────────────────────────────────────────

interface UploadDocModalProps {
  crewId: string;
  contextType: 'crew_identity' | 'crew_contract';
  productions: Production[];
  onClose: () => void;
  onUploaded: () => void;
}

function UploadDocModal({ crewId, contextType, productions, onClose, onUploaded }: UploadDocModalProps) {
  const [productionId, setProductionId] = useState(productions.length === 1 ? productions[0].id : '');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please select a file.'); return; }
    if (contextType === 'crew_contract' && !productionId) { setError('Please select a production for this contract.'); return; }
    setSaving(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('context_type', contextType);
    if (contextType === 'crew_contract') fd.append('production_id', productionId);
    try {
      await crewApi.uploadDocument(crewId, fd);
      onUploaded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const title = contextType === 'crew_identity' ? 'Upload Identity Document' : 'Upload Contract';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {contextType === 'crew_contract' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Which production? *</label>
              <select className={inp} value={productionId} onChange={e => setProductionId(e.target.value)}>
                <option value="">— Select production —</option>
                {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">File * <span className="text-slate-400">(PDF, JPG, PNG · max 25 MB)</span></label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-lg p-5 cursor-pointer hover:border-blue-400 transition-colors">
              <Upload size={20} className="text-slate-400 mb-2" />
              <span className="text-slate-500 text-sm">{file ? file.name : 'Click to choose file'}</span>
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CrewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = true;
  const canSeeBankDetails = true;

  const [member, setMember]           = useState<CrewDetail | null>(null);
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  const [showEdit, setShowEdit]       = useState(false);
  const [showLink, setShowLink]       = useState(false);
  const [uploadContext, setUploadContext] = useState<'crew_identity' | 'crew_contract' | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const isCoordinator = true;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [m, prods] = await Promise.all([crewApi.getById(id), productionsApi.list()]);
      setMember(m);
      setProductions(prods);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const deleteDoc = async (doc: CrewDocument) => {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    setDeletingDoc(doc.id);
    try {
      await crewApi.deleteDocument(id, doc.id);
      setMember(m => m ? { ...m, documents: m.documents.filter(d => d.id !== doc.id) } : m);
    } catch {
      alert('Failed to delete document');
    } finally {
      setDeletingDoc(null);
    }
  };

  if (error) {
    return (
      <>
        <TopBar title="Crew Member" subtitle="" />
        <main className="flex-1 p-4 md:p-6">
          <p className="text-red-600 text-sm">{error}</p>
        </main>
      </>
    );
  }

  const m = member;
  const isSE = m?.employment_status === 'self_employed';

  const subtitle = m
    ? `${m.crew_number} · ${m.employment_status === 'paye' ? 'PAYE' : 'Self-Employed'}${m.crew_trade ? ` · ${m.crew_trade}` : ''}`
    : '';

  return (
    <>
      {showEdit && m && (
        <EditCrewModal member={m} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />
      )}
      {showLink && m && (
        <LinkProductionModal crewId={m.id} onClose={() => setShowLink(false)} onLinked={() => { setShowLink(false); load(); }} />
      )}
      {uploadContext && m && (
        <UploadDocModal
          crewId={m.id}
          contextType={uploadContext}
          productions={productions}
          onClose={() => setUploadContext(null)}
          onUploaded={() => { setUploadContext(null); load(); }}
        />
      )}

      <TopBar
        title={loading ? 'Loading…' : `${m?.first_name ?? ''} ${m?.last_name ?? ''}`}
        subtitle={subtitle}
      />

      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Back + actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/crew')}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm transition-colors"
          >
            <ArrowLeft size={15} />
            Back to Crew
          </button>
          {canEdit && m && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              <Pencil size={14} />
              Edit Profile
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white rounded-xl border border-slate-200 animate-pulse" />)}
          </div>
        ) : m && (
          <>
            {/* Profile overview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Left: identity */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-lg font-bold">
                      {m.first_name[0]}{m.last_name[0]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-slate-900 font-bold text-lg">{m.first_name} {m.last_name}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.employment_status === 'paye' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {m.employment_status === 'paye' ? 'PAYE' : 'Self-Employed'}
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm mt-0.5 font-mono">{m.crew_number}</p>
                    {m.crew_trade && (
                      <p className="text-slate-600 text-sm mt-1">{m.crew_trade}{m.crew_rank ? ` — ${m.crew_rank}` : ''}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pt-2 border-t border-slate-100">
                  <Detail icon={<Phone size={13} />} label="Email" value={m.email} />
                  <Detail icon={<Calendar size={13} />} label="Date of Birth" value={m.date_of_birth ? fmtDate(m.date_of_birth) : null} />
                  <Detail icon={<CreditCard size={13} />} label="Withholding Rate" value={m.paye_withholding_rate != null ? `${m.paye_withholding_rate}%` : null} />
                  {m.home_address && (
                    <Detail icon={<Building2 size={13} />} label="Home Address" value={m.home_address} />
                  )}
                </div>
              </div>

              {/* Right: bank + emergency */}
              <div className="space-y-4">
                {canSeeBankDetails ? (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Bank Details</p>
                    <div className="space-y-2">
                      <Detail icon={<CreditCard size={13} />} label="Account Name" value={m.account_name} />
                      <Detail icon={<CreditCard size={13} />} label="Account Number" value={m.account_number} />
                      <Detail icon={<CreditCard size={13} />} label="Sort Code" value={m.sort_code} />
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Bank Details</p>
                    <p className="text-xs text-slate-400 italic">Restricted — visible to Coordinator and Accountant only</p>
                  </div>
                )}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Emergency Contact</p>
                  <div className="space-y-2">
                    <Detail icon={<Phone size={13} />} label="Name" value={m.emergency_contact_name} />
                    <Detail icon={<Phone size={13} />} label="Relationship" value={m.emergency_contact_relationship} />
                    <Detail icon={<Phone size={13} />} label="Phone" value={m.emergency_contact_phone} />
                  </div>
                </div>
                {isSE && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Company</p>
                    <div className="space-y-2">
                      <Detail icon={<Building2 size={13} />} label="Company" value={m.company_name} />
                      <Detail icon={<Building2 size={13} />} label="Reg. Number" value={m.company_registration_number} />
                      <Detail icon={<Building2 size={13} />} label="VAT Number" value={m.vat_registration_number} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Productions */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-slate-900 font-semibold text-sm">Productions</h3>
                  <p className="text-slate-400 text-xs mt-0.5">{m.production_history.length} production{m.production_history.length !== 1 ? 's' : ''} linked</p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => setShowLink(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                  >
                    <Plus size={13} />
                    Link to Production
                  </button>
                )}
              </div>
              {m.production_history.length === 0 ? (
                <div className="px-5 py-8 text-center text-slate-400 text-sm">Not linked to any productions yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {m.production_history.map((ph: CrewProductionHistory) => (
                    <div key={ph.id} className="px-5 py-3.5 flex items-center justify-between">
                      <div>
                        <p className="text-slate-800 text-sm font-medium">{ph.prod_name}</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          {fmtDate(ph.start_date)} – {fmtDate(ph.end_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-xs capitalize">{ph.prod_status?.replace(/_/g, ' ')}</span>
                        <button
                          onClick={() => router.push(`/productions/${ph.prod_id}`)}
                          className="text-blue-600 text-xs hover:underline flex items-center gap-1"
                        >
                          <Link2 size={11} /> View
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Documents — two sections */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-slate-900 font-semibold text-sm">Documents</h3>
                <p className="text-slate-400 text-xs mt-0.5">{m.documents.length} document{m.documents.length !== 1 ? 's' : ''} · PDF, JPEG, PNG · max 25 MB</p>
              </div>

              {/* Identity Documents */}
              {(() => {
                const identityDocs = m.documents.filter(d => (d.context_type ?? d.document_type) !== 'crew_contract' && d.context_type !== 'crew_contract');
                return (
                  <div className="border-b border-slate-100">
                    <div className="flex items-center justify-between px-5 py-3 bg-slate-50/60">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Identity Documents</p>
                      {canEdit && (
                        <button
                          onClick={() => setUploadContext('crew_identity')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                        >
                          <Upload size={11} /> Upload
                        </button>
                      )}
                    </div>
                    {identityDocs.length === 0 ? (
                      <p className="px-5 py-5 text-center text-slate-400 text-xs">No identity documents yet.</p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {identityDocs.map(doc => (
                          <div key={doc.id} className="px-5 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <FileText size={15} className="text-slate-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-slate-800 text-sm font-medium truncate">{doc.file_name}</p>
                                <p className="text-slate-400 text-xs">Uploaded {fmtDate(doc.uploaded_at)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs hover:underline">View</a>
                              {canEdit && (
                                <button onClick={() => deleteDoc(doc)} disabled={deletingDoc === doc.id} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                                  {deletingDoc === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Contracts — grouped by production */}
              {(() => {
                const contracts = m.documents.filter(d => d.context_type === 'crew_contract' || d.document_type === 'contract');
                const byProd: Record<string, { prodName: string; docs: typeof contracts }> = {};
                contracts.forEach(doc => {
                  const key = doc.production_id ?? '__none__';
                  if (!byProd[key]) byProd[key] = { prodName: doc.production_name ?? 'Unknown Production', docs: [] };
                  byProd[key].docs.push(doc);
                });
                return (
                  <div>
                    <div className="flex items-center justify-between px-5 py-3 bg-slate-50/60">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Contracts</p>
                      {canEdit && (
                        <button
                          onClick={() => setUploadContext('crew_contract')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                        >
                          <Upload size={11} /> Upload
                        </button>
                      )}
                    </div>
                    {contracts.length === 0 ? (
                      <p className="px-5 py-5 text-center text-slate-400 text-xs">No contracts yet.</p>
                    ) : (
                      Object.entries(byProd).map(([key, { prodName, docs }]) => (
                        <div key={key}>
                          <p className="px-5 py-2 text-xs font-semibold text-slate-500 bg-slate-50/40 border-t border-slate-100">{prodName}</p>
                          <div className="divide-y divide-slate-100">
                            {docs.map(doc => (
                              <div key={doc.id} className="px-5 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-3 min-w-0">
                                  <FileText size={15} className="text-blue-400 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-slate-800 text-sm font-medium truncate">{doc.file_name}</p>
                                    <p className="text-slate-400 text-xs">Uploaded {fmtDate(doc.uploaded_at)}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                  <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs hover:underline">View</a>
                                  {isCoordinator && (
                                    <button onClick={() => deleteDoc(doc)} disabled={deletingDoc === doc.id} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                                      {deletingDoc === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Timesheet History */}
            {m.timesheet_history.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="text-slate-900 font-semibold text-sm">Timesheet History</h3>
                  <p className="text-slate-400 text-xs mt-0.5">{m.timesheet_history.length} timesheet{m.timesheet_history.length !== 1 ? 's' : ''} on record</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {m.timesheet_history.map(ts => {
                    const sc = TS_STATUS_CONFIG[ts.status] ?? TS_STATUS_CONFIG.draft;
                    return (
                      <div key={ts.id} className="px-5 py-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-slate-800 text-sm font-medium">{ts.prod_name}</p>
                          <p className="text-slate-400 text-xs">w/e {fmtDate(ts.week_ending_date)}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                          <span className="text-slate-900 text-sm font-semibold">{fmtGBP(ts.grand_total)}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}>{sc.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

// ─── Small helper ─────────────────────────────────────────────────────────────

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-slate-400 text-[10px] uppercase tracking-wide flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-slate-700 text-sm mt-0.5">{value ?? <span className="text-slate-300">—</span>}</p>
    </div>
  );
}
