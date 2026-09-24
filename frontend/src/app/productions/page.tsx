'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import {
  Plus, Search, Calendar, CheckCircle2, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, X, Loader2, Archive, ArchiveRestore, Trash2, Clapperboard,
} from 'lucide-react';
import { productionsApi, Production, ProductionStatus, ContractType } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyStateRow } from '@/components/EmptyState';
import PaginationScrollIndicator from '@/components/PaginationScrollIndicator';

const PAGE_SIZE = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ProductionStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pre_production: { label: 'Pre-Production', className: 'bg-blue-100 text-blue-700',   icon: <Clock size={11} className="inline mr-1" /> },
  active_build:   { label: 'Active Build',   className: 'bg-blue-100 text-blue-700',   icon: <CheckCircle2 size={11} className="inline mr-1" /> },
  strike:         { label: 'Strike',          className: 'bg-amber-100 text-amber-700', icon: <AlertTriangle size={11} className="inline mr-1" /> },
  complete:       { label: 'Complete',        className: 'bg-slate-100 text-slate-500', icon: <CheckCircle2 size={11} className="inline mr-1" /> },
  archived:       { label: 'Archived',        className: 'bg-red-100 text-red-500',     icon: <Archive size={11} className="inline mr-1" /> },
};

const STATUS_TABS: { value: ProductionStatus | 'all'; label: string }[] = [
  { value: 'all',            label: 'All' },
  { value: 'active_build',   label: 'Active Build' },
  { value: 'pre_production', label: 'Pre-Production' },
  { value: 'strike',         label: 'Strike' },
  { value: 'complete',       label: 'Complete' },
];

const CONTRACT_TYPES: { value: ContractType; label: string }[] = [
  { value: 'on_a_price', label: 'On a Price' },
  { value: 'cost_plus',  label: 'Cost Plus' },
];

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// ─── Contract Type Selector ───────────────────────────────────────────────────

const CONTRACT_TYPE_INFO = {
  on_a_price: {
    label: 'On a Price',
    desc: 'Fixed fee agreed with production. Internal cost tracking only. Cost report is private.',
  },
  cost_plus: {
    label: 'Cost Plus',
    desc: 'All costs recharged with margin. Cost report shared with production. Weekly recharge submissions required.',
  },
} as const;

function ContractTypeSelector({
  value,
  onChange,
  locked = false,
  lockedReason,
}: {
  value: ContractType | '';
  onChange: (v: ContractType) => void;
  locked?: boolean;
  lockedReason?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-2">Contract Type *</label>
      {locked ? (
        <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <div className={`text-xs px-2.5 py-1 rounded-full font-semibold ${value === 'cost_plus' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
            {value === 'cost_plus' ? 'Cost Plus' : 'On a Price'}
          </div>
          <span className="text-slate-400 text-xs">🔒 Locked — {lockedReason ?? 'linked records exist'}</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(['on_a_price', 'cost_plus'] as ContractType[]).map(ct => (
            <button
              key={ct}
              type="button"
              onClick={() => onChange(ct)}
              className={`text-left px-3 py-2 rounded-lg border-2 transition-all ${
                value === ct
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-semibold text-slate-800">{CONTRACT_TYPE_INFO[ct].label}</span>
                {value === ct && <span className="text-[9px] text-blue-600 font-semibold bg-blue-100 px-1 py-0.5 rounded">✓</span>}
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">{CONTRACT_TYPE_INFO[ct].desc}</p>
            </button>
          ))}
        </div>
      )}
      <p className="flex items-start gap-1.5 mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
        <span className="flex-shrink-0">⚠</span>
        Contract type cannot be changed once a purchase order or timesheet has been linked to this production.
      </p>
    </div>
  );
}

// ─── New Production Modal ─────────────────────────────────────────────────────

interface NewProductionModalProps { onClose: () => void; onCreated: () => void; }

function NewProductionModal({ onClose, onCreated }: NewProductionModalProps) {
  const [form, setForm] = useState({
    name: '', production_code: '', production_company: '', production_designer: '', production_type: '',
    start_date: '', end_date: '',
    contract_type: '' as ContractType | '',
    status: 'pre_production' as ProductionStatus,
    supervising_art_director: '',
    supervising_art_director_mobile: '',
    supervising_art_director_email: '',
    financial_controller: '',
    financial_controller_mobile: '',
    financial_controller_email: '',
    art_dept_coordinator: '',
    art_dept_coordinator_mobile: '',
    art_dept_coordinator_email: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Production name is required.'); return; }
    if (!form.contract_type) { setError('Please select a contract type.'); return; }
    if (form.start_date && form.end_date && new Date(form.end_date) < new Date(form.start_date)) {
      setError('End date cannot be before start date.');
      return;
    }
    setSaving(true); setError('');
    try {
      await productionsApi.create({
        ...form,
        contract_type:                  form.contract_type as ContractType,
        start_date:                     form.start_date || null,
        end_date:                       form.end_date   || null,
        production_code:                form.production_code || null,
        production_company:             form.production_company  || null,
        production_designer:            form.production_designer || null,
        production_type:                form.production_type     || null,
        supervising_art_director:        form.supervising_art_director || null,
        supervising_art_director_mobile: form.supervising_art_director_mobile || null,
        supervising_art_director_email:  form.supervising_art_director_email || null,
        financial_controller:           form.financial_controller || null,
        financial_controller_mobile:    form.financial_controller_mobile || null,
        financial_controller_email:     form.financial_controller_email || null,
        art_dept_coordinator:           form.art_dept_coordinator || null,
        art_dept_coordinator_mobile:    form.art_dept_coordinator_mobile || null,
        art_dept_coordinator_email:     form.art_dept_coordinator_email || null,
        notes:                          form.notes || null,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create production');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-slate-900 font-semibold text-sm">New Production</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Production Name *</label>
              <input className={inputCls} placeholder="e.g. Meridian" value={form.name} onChange={set('name')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Production Code</label>
              <input className={inputCls} placeholder="e.g. 129" value={form.production_code} onChange={set('production_code')} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Production Company</label>
              <input className={inputCls} placeholder="e.g. Lionsgate UK" value={form.production_company} onChange={set('production_company')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Production Designer</label>
              <input className={inputCls} placeholder="e.g. Helena Portman" value={form.production_designer} onChange={set('production_designer')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Production Type</label>
              <input className={inputCls} placeholder="e.g. Feature Film" value={form.production_type} onChange={set('production_type')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Initial Status</label>
              <select className={inputCls} value={form.status} onChange={set('status')}>
                <option value="pre_production">Pre-Production</option>
                <option value="active_build">Active Build</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
              <input type="date" className={inputCls} value={form.start_date} onChange={set('start_date')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
              <input type="date" className={inputCls} value={form.end_date} onChange={set('end_date')} />
            </div>
          </div>
          <ContractTypeSelector
            value={form.contract_type as ContractType | ''}
            onChange={v => setForm(f => ({ ...f, contract_type: v }))}
          />

          {/* Key Contacts */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Key Contacts</h3>
            
            {/* Supervising Art Director */}
            <div className="space-y-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <label className="block text-xs font-medium text-slate-700">Supervising Art Director</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input className={inputCls} placeholder="Full Name" value={form.supervising_art_director} onChange={set('supervising_art_director')} />
                <input className={inputCls} placeholder="Mobile / Phone" value={form.supervising_art_director_mobile} onChange={set('supervising_art_director_mobile')} />
                <input className={inputCls} type="email" placeholder="Email Address" value={form.supervising_art_director_email} onChange={set('supervising_art_director_email')} />
              </div>
            </div>

            {/* Financial Controller */}
            <div className="space-y-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <label className="block text-xs font-medium text-slate-700">Financial Controller</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input className={inputCls} placeholder="Full Name" value={form.financial_controller} onChange={set('financial_controller')} />
                <input className={inputCls} placeholder="Mobile / Phone" value={form.financial_controller_mobile} onChange={set('financial_controller_mobile')} />
                <input className={inputCls} type="email" placeholder="Email Address" value={form.financial_controller_email} onChange={set('financial_controller_email')} />
              </div>
            </div>

            {/* Art Dept Co-ordinator */}
            <div className="space-y-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <label className="block text-xs font-medium text-slate-700">Art Dept Co-ordinator</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input className={inputCls} placeholder="Full Name" value={form.art_dept_coordinator} onChange={set('art_dept_coordinator')} />
                <input className={inputCls} placeholder="Mobile / Phone" value={form.art_dept_coordinator_mobile} onChange={set('art_dept_coordinator_mobile')} />
                <input className={inputCls} type="email" placeholder="Email Address" value={form.art_dept_coordinator_email} onChange={set('art_dept_coordinator_email')} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-medium text-slate-600 mb-1">Production Notes</label>
            <textarea
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder="Additional production notes, stage/studio locations, special build requirements..."
              value={form.notes}
              onChange={set('notes')}
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Create Production
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Archive Confirm Modal ────────────────────────────────────────────────────

type ArchivePreview = { production_name: string; po_count: number; timesheet_weeks: number; crew_count: number };

interface ArchiveModalProps {
  preview: ArchivePreview;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
  error?: string;
}

function ArchiveModal({ preview, onConfirm, onClose, loading, error }: ArchiveModalProps) {
  const [typed, setTyped] = useState('');
  const confirmed = typed.toLowerCase() === preview.production_name.toLowerCase();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
            <Archive size={18} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-slate-900 font-semibold text-base">Archive this production?</h2>
            <p className="text-slate-500 text-sm mt-1">
              Archiving <span className="font-bold text-slate-800">{preview.production_name}</span> will
              hide it from all active views. All data, documents, and reports will be preserved in full and
              accessible from the archived productions list.
            </p>
          </div>
        </div>

        <div className="mx-6 my-4 bg-slate-50 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">This production has</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-slate-800">{preview.po_count}</p>
              <p className="text-xs text-slate-500 mt-0.5">purchase orders</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{preview.crew_count}</p>
              <p className="text-xs text-slate-500 mt-0.5">crew members</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{preview.timesheet_weeks}</p>
              <p className="text-xs text-slate-500 mt-0.5">weeks of timesheets</p>
            </div>
          </div>
        </div>

        <div className="px-6 pb-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Type the production name to confirm:</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder={preview.production_name}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoFocus
          />
          {error && <p className="text-red-600 text-xs mt-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg transition-colors">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={!confirmed || loading}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              Archive production
            </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductionsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isGuest       = user?.role === 'guest';
  const isCoordinator = !isGuest;
  const canArchive    = !isGuest;
  const canEdit       = !isGuest;

  const [productions, setProductions]     = useState<Production[]>([]);
  const [archived, setArchived]           = useState<Production[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [page, setPage]                   = useState(1);
  const [search, setSearch]               = useState('');
  const [activeTab, setActiveTab]         = useState<ProductionStatus | 'all'>('all');
  const [showArchived, setShowArchived]   = useState(false);
  const [showModal, setShowModal]         = useState(false);

  // Archive flow state
  const [archivePreview, setArchivePreview]   = useState<ArchivePreview | null>(null);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading]   = useState(false);
  const [archiveError, setArchiveError]       = useState('');
  const [unarchiveLoading, setUnarchiveLoading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async (production: Production) => {
    if (!confirm(`Delete "${production.name}" from archived productions? Linked business records and files will be retained. Its Finance reports will remain unless deleted separately.`)) return;
    setDeletingId(production.id);
    setDeleteError('');
    try {
      await productionsApi.delete(production.id);
      setArchived(current => current.filter(item => item.id !== production.id));
    } catch (err) { setDeleteError(err instanceof Error ? err.message : 'Unable to delete production.'); }
    finally { setDeletingId(null); }
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [active, all] = await Promise.all([
        productionsApi.list(),
        productionsApi.listArchived(),
      ]);
      setProductions(active);
      setArchived(all);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load productions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openArchiveModal = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const preview = await productionsApi.archivePreview(id);
      setArchivePreview(preview);
      setArchiveTargetId(id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Cannot archive this production');
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTargetId) return;
    setArchiveLoading(true); setArchiveError('');
    try {
      const { production } = await productionsApi.archive(archiveTargetId);
      setProductions(prev => prev.filter(p => p.id !== archiveTargetId));
      setArchived(prev => [production, ...prev]);
      setArchivePreview(null);
      setArchiveTargetId(null);
    } catch {
      setArchiveError('Archive failed. Please try again.');
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleUnarchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Unarchive this production? It will reappear across all active views.')) return;
    setUnarchiveLoading(id);
    try {
      const { production } = await productionsApi.unarchive(id);
      setArchived(prev => prev.filter(p => p.id !== id));
      setProductions(prev => [production, ...prev]);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Unarchive failed');
    } finally {
      setUnarchiveLoading(null);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [search, activeTab]);

  const filtered = productions.filter(p => {
    const matchesTab    = activeTab === 'all' || p.status === activeTab;
    const q = search.toLowerCase();
    const matchesSearch = !q || [
      p.name,
      p.production_code,
      p.production_company,
      p.production_designer,
      p.production_type,
      p.supervising_art_director,
      p.supervising_art_director_mobile,
      p.supervising_art_director_email,
      p.financial_controller,
      p.financial_controller_mobile,
      p.financial_controller_email,
      p.art_dept_coordinator,
      p.art_dept_coordinator_mobile,
      p.art_dept_coordinator_email,
      p.notes,
      p.contract_type === 'cost_plus' ? 'cost plus' : 'on a price',
      p.status,
    ].some(v => v != null && String(v).toLowerCase().includes(q));
    return matchesTab && matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedProductions = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const counts = {
    active_build:   productions.filter(p => p.status === 'active_build').length,
    pre_production: productions.filter(p => p.status === 'pre_production').length,
    strike:         productions.filter(p => p.status === 'strike').length,
    complete:       productions.filter(p => p.status === 'complete').length,
  };

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <>
      {showModal && canEdit && (
        <NewProductionModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
        />
      )}

      {archivePreview && (
        <ArchiveModal
          preview={archivePreview}
          onConfirm={handleArchiveConfirm}
          onClose={() => { setArchivePreview(null); setArchiveTargetId(null); setArchiveError(''); }}
          loading={archiveLoading}
          error={archiveError}
        />
      )}

      <TopBar title="Productions" subtitle="Manage active, upcoming and archived productions" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Active Build',   count: counts.active_build,   color: 'bg-blue-500',   tab: 'active_build'   as ProductionStatus },
            { label: 'Pre-Production', count: counts.pre_production, color: 'bg-blue-500',   tab: 'pre_production' as ProductionStatus },
            { label: 'Strike',         count: counts.strike,         color: 'bg-amber-500',  tab: 'strike'         as ProductionStatus },
            { label: 'Complete',       count: counts.complete,       color: 'bg-slate-400',  tab: 'complete'       as ProductionStatus },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => setActiveTab(t => t === s.tab ? 'all' : s.tab)}
              className={`bg-white rounded-xl border px-5 py-4 shadow-sm flex items-center gap-3 text-left transition-colors ${activeTab === s.tab ? 'border-blue-400 ring-1 ring-blue-400' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <div className={`w-2.5 h-2.5 rounded-full ${s.color} flex-shrink-0`} />
              <div>
                {loading ? <div className="h-6 w-6 bg-slate-100 rounded animate-pulse mb-1" /> : <p className="text-slate-800 text-sm font-normal">{s.count}</p>}
                <p className="text-slate-500 text-xs font-normal">{s.label}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Active Productions Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 border-b border-slate-100 gap-3">
            <div className="flex items-center gap-1">
              {STATUS_TABS.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-3 py-1.5 text-sm font-normal rounded-lg transition-colors ${activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-56">
                <Search size={13} className="text-slate-400 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Search productions, team, notes..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                />
              </div>
              {canEdit && (
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                >
                  <Plus size={14} />
                  New Production
                </button>
              )}
            </div>
          </div>

          {error && <div className="px-5 py-4 text-red-600 text-sm bg-red-50 border-b border-red-100">{error}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 z-10">Production</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Type</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Contract</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Dates</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Sets Progress</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-4"><div className="h-4 bg-slate-100 rounded animate-pulse w-24" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  productions.length === 0 ? (
                    <EmptyStateRow
                      colSpan={7}
                      icon={Clapperboard}
                      title="No active productions"
                      description="There are currently no active productions in your workspace."
                      recommendation="Create your first production to begin managing set builds, tracking live cost reports, assigning crew, and generating purchase orders."
                      action={isCoordinator ? {
                        label: 'Create First Production',
                        onClick: () => setShowModal(true),
                        icon: Plus,
                      } : undefined}
                    />
                  ) : (
                    <EmptyStateRow
                      colSpan={7}
                      icon={AlertTriangle}
                      title="No matching productions"
                      description="No productions match your active search or filter criteria."
                      recommendation="Try clearing your search term or resetting the status and contract filters."
                      action={{
                        label: 'Clear Filters',
                        onClick: () => { setSearch(''); setActiveTab('all'); },
                        icon: X,
                      }}
                    />
                  )
                ) : (
                  pagedProductions.map(p => {
                    const sc = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.pre_production;
                    const donePct = p.total_sets > 0 ? Math.round((p.completed_sets / p.total_sets) * 100) : 0;
                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                        onClick={() => router.push(`/productions/${p.id}`)}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            {p.production_code && (
                              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
                                #{p.production_code}
                              </span>
                            )}
                            <p className="text-slate-900 font-semibold">{p.name}</p>
                          </div>
                          {p.production_company && <p className="text-slate-400 text-xs mt-0.5">{p.production_company}</p>}
                        </td>
                        <td className="px-4 py-4 text-slate-600 text-xs whitespace-nowrap">{p.production_type ?? '—'}</td>
                        <td className="px-4 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.contract_type === 'cost_plus' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                            {p.contract_type === 'cost_plus' ? 'Cost Plus' : 'On a Price'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${sc.className}`}>
                            {sc.icon}{sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-slate-500 text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={11} className="text-slate-400" />
                            {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${donePct}%` }} />
                            </div>
                            <span className="text-xs text-slate-500">{p.completed_sets}/{p.total_sets}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => router.push(`/productions/${p.id}`)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <ChevronRight size={15} />
                            </button>
                            {canArchive && p.status === 'complete' && (
                              <button
                                onClick={e => openArchiveModal(e, p.id)}
                                className="p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 rounded-lg transition-colors"
                                title="Archive production"
                              >
                                <Archive size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

            {/* Pagination */}
            <PaginationScrollIndicator
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              totalItems={filtered.length}
              pageSize={PAGE_SIZE}
              itemName="productions"
            />
          </div>

        {/* Archived Productions Section */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowArchived(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Archive size={15} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Archived Productions</span>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{archived.length}</span>
            </div>
            <ChevronRight size={15} className={`text-slate-400 transition-transform ${showArchived ? 'rotate-90' : ''}`} />
          </button>

          {showArchived && (
            <div className="overflow-x-auto border-t border-slate-100">
              {deleteError && <p role="alert" className="m-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{deleteError}</p>}
              {archived.length === 0 ? (
                <p className="px-5 py-8 text-center text-slate-400 text-sm">No archived productions.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500">Production</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Contract</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Dates</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Archived</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {archived.map(p => (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                        onClick={() => router.push(`/productions/${p.id}`)}
                      >
                        <td className="px-5 py-4">
                          <p className="text-slate-700 font-medium">{p.name}</p>
                          {p.production_company && <p className="text-slate-400 text-xs mt-0.5">{p.production_company}</p>}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.contract_type === 'cost_plus' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                            {p.contract_type === 'cost_plus' ? 'Cost Plus' : 'On a Price'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-slate-500 text-xs whitespace-nowrap">
                          {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
                        </td>
                        <td className="px-4 py-4 text-slate-400 text-xs whitespace-nowrap">
                          {p.archived_at ? fmtDate(p.archived_at) : '—'}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => router.push(`/productions/${p.id}`)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <ChevronRight size={15} />
                            </button>
                            {isCoordinator && (
                              <button
                                onClick={e => handleUnarchive(e, p.id)}
                                disabled={unarchiveLoading === p.id || deletingId === p.id}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium disabled:opacity-50"
                                title="Unarchive production"
                              >
                                {unarchiveLoading === p.id
                                  ? <Loader2 size={12} className="animate-spin" />
                                  : <ArchiveRestore size={12} />}
                                Unarchive
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(p)}
                              disabled={deletingId !== null || unarchiveLoading === p.id}
                              title={`Delete ${p.name}`}
                              aria-label={`Delete ${p.name}`}
                              className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

      </main>
    </>
  );
}
