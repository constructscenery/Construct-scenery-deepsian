'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import {
  Plus, Search, ChevronRight, X, Loader2, Users, UserCheck, Briefcase, Building2, Trash2,
} from 'lucide-react';
import { crewApi, productionsApi, crewRatesApi, settingsApi, CrewMember, CrewRate, EmploymentStatus, Production } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-blue-500', 'bg-pink-500', 'bg-orange-500',
  'bg-green-500', 'bg-indigo-500', 'bg-rose-500', 'bg-cyan-500', 'bg-amber-500',
];

type FilterTab = 'all' | 'paye' | 'self_employed' | 'active' | 'inactive';

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',           label: 'All' },
  { value: 'paye',          label: 'PAYE' },
  { value: 'self_employed', label: 'Self-Employed' },
  { value: 'active',        label: 'Active' },
  { value: 'inactive',      label: 'Inactive' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

// ─── Register Crew Modal ──────────────────────────────────────────────────────

interface RegisterCrewModalProps {
  onClose: () => void;
  onCreated: () => void;
}

type TradesData = { bectu: Record<string, string[]>; non_bectu: string[] };

function RegisterCrewModal({ onClose, onCreated }: RegisterCrewModalProps) {
  const [trades, setTrades] = useState<TradesData | null>(null);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [allRates, setAllRates] = useState<CrewRate[]>([]);

  const [defaultPayeRate, setDefaultPayeRate] = useState('20');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    employment_status: 'paye' as EmploymentStatus,
    crew_trade: '',
    crew_rank: '',
    email: '',
    date_of_birth: '',
    company_name: '',
    company_registration_number: '',
    vat_registration_number: '',
    paye_withholding_rate: '20',
    account_name: '',
    account_number: '',
    sort_code: '',
    emergency_contact_name: '',
    emergency_contact_relationship: '',
    emergency_contact_phone: '',
    company_utr: '',
    qualifications: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    crewApi.getTrades()
      .then(setTrades)
      .catch(() => setTrades({ bectu: {}, non_bectu: [] }))
      .finally(() => setTradesLoading(false));
    crewRatesApi.list({ current: 'true' }).then(setAllRates).catch(() => {});
    settingsApi.get().then(s => {
      const rate = s['default_paye_rate'];
      const val = typeof rate?.value === 'number' ? String(rate.value) : '20';
      setDefaultPayeRate(val);
      setForm(f => ({ ...f, paye_withholding_rate: val }));
    }).catch(() => {});
  }, []);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setForm(f => {
      const updated = { ...f, [k]: e.target.value };
      if (k === 'crew_trade') updated.crew_rank = '';
      if (k === 'employment_status') {
        updated.paye_withholding_rate = e.target.value === 'paye' ? defaultPayeRate : '0';
        updated.crew_trade = '';
        updated.crew_rank = '';
      }
      return updated;
    });
  };

  const isSE = form.employment_status === 'self_employed';

  const allTrades: string[] = trades
    ? [...Object.keys(trades.bectu), ...trades.non_bectu]
    : [];

  const rankOptions: string[] = (() => {
    if (!trades || !form.crew_trade) return [];
    return trades.bectu[form.crew_trade] ?? [];
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First name and last name are required.');
      return;
    }
    if (!form.crew_trade) {
      setError('Please select a trade.');
      return;
    }
    if (!form.crew_rank.trim()) {
      setError('Please enter or select a rank.');
      return;
    }
    if (form.date_of_birth && new Date(form.date_of_birth) > new Date()) {
      setError('Date of birth cannot be in the future.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await crewApi.create({
        first_name: form.first_name.trim(),
        last_name:  form.last_name.trim(),
        employment_status: form.employment_status,
        crew_trade:   form.crew_trade   || null,
        crew_rank:    form.crew_rank    || null,
        email:        form.email        || null,
        date_of_birth: form.date_of_birth || null,
        company_name:                isSE ? (form.company_name || null) : null,
        company_registration_number: isSE ? (form.company_registration_number || null) : null,
        company_utr:                 isSE ? (form.company_utr || null) : null,
        vat_registration_number:     isSE ? (form.vat_registration_number || null) : null,
        paye_withholding_rate: form.paye_withholding_rate ? Number(form.paye_withholding_rate) : null,
        account_name:   form.account_name   || null,
        account_number: form.account_number || null,
        sort_code:      form.sort_code      || null,
        emergency_contact_name:         form.emergency_contact_name         || null,
        emergency_contact_relationship: form.emergency_contact_relationship || null,
        emergency_contact_phone:        form.emergency_contact_phone        || null,
        qualifications:                 form.qualifications,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register crew member');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
          <h2 className="text-slate-900 font-semibold text-base">Register Crew Member</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          {error && (
            <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Personal */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Personal Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>First Name *</label>
                <input className={inputCls} placeholder="e.g. James" value={form.first_name} onChange={set('first_name')} />
              </div>
              <div>
                <label className={labelCls}>Last Name *</label>
                <input className={inputCls} placeholder="e.g. Hargreaves" value={form.last_name} onChange={set('last_name')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="col-span-2">
                <label className={labelCls}>Email</label>
                <input type="email" className={inputCls} placeholder="james@example.com" value={form.email} onChange={set('email')} />
              </div>
            </div>
            <div className="mt-4">
              <label className={labelCls}>Date of Birth</label>
              <input type="date" className={inputCls} value={form.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().split('T')[0]} />
            </div>
          </div>

          {/* Employment */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Employment</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Employment Status *</label>
                <select className={inputCls} value={form.employment_status} onChange={set('employment_status')}>
                  <option value="paye">PAYE</option>
                  <option value="self_employed">Self-Employed</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Withholding Rate (%)</label>
                <input type="number" min={0} max={100} className={inputCls} value={form.paye_withholding_rate} onChange={set('paye_withholding_rate')} />
              </div>
            </div>

            {tradesLoading ? (
              <div className="mt-4 h-9 bg-slate-100 rounded-lg animate-pulse" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className={labelCls}>Trade</label>
                  <select className={inputCls} value={form.crew_trade} onChange={set('crew_trade')}>
                    <option value="">— Select trade —</option>
                    {allTrades.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Rank</label>
                  {rankOptions.length > 0 ? (
                    <select className={inputCls} value={form.crew_rank} onChange={set('crew_rank')}>
                      <option value="">— Select rank —</option>
                      {rankOptions.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputCls}
                      placeholder="e.g. Senior Carpenter"
                      value={form.crew_rank}
                      onChange={set('crew_rank')}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Rate preview when trade + rank selected */}
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

          {/* Self-Employed Company */}
          {isSE && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Company Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Company Name</label>
                  <input className={inputCls} placeholder="e.g. Hargreaves Scenery Ltd" value={form.company_name} onChange={set('company_name')} />
                </div>
                <div>
                  <label className={labelCls}>Company Reg. Number</label>
                  <input className={inputCls} placeholder="e.g. 12345678" value={form.company_registration_number} onChange={set('company_registration_number')} />
                </div>
                <div>
                  <label className={labelCls}>Company UTR</label>
                  <input className={inputCls} placeholder="e.g. 12345 67890" value={form.company_utr} onChange={set('company_utr')} />
                </div>
                <div>
                  <label className={labelCls}>VAT Reg. Number</label>
                  <input className={inputCls} placeholder="e.g. GB123456789" value={form.vat_registration_number} onChange={set('vat_registration_number')} />
                </div>
              </div>
            </div>
          )}

          {/* Bank Details */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Bank Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Account Name</label>
                <input className={inputCls} placeholder="Name on account" value={form.account_name} onChange={set('account_name')} />
              </div>
              <div>
                <label className={labelCls}>Account Number</label>
                <input className={inputCls} placeholder="12345678" value={form.account_number} onChange={set('account_number')} />
              </div>
              <div>
                <label className={labelCls}>Sort Code</label>
                <input className={inputCls} placeholder="00-00-00" value={form.sort_code} onChange={set('sort_code')} />
              </div>
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

          {/* Emergency Contact */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Emergency Contact</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Contact Name</label>
                <input className={inputCls} placeholder="e.g. Sarah Hargreaves" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} />
              </div>
              <div>
                <label className={labelCls}>Relationship</label>
                <input className={inputCls} placeholder="e.g. Spouse" value={form.emergency_contact_relationship} onChange={set('emergency_contact_relationship')} />
              </div>
              <div>
                <label className={labelCls}>Contact Phone</label>
                <input type="tel" className={inputCls} placeholder="+44 7700 900000" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Register Crew Member
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isMD = user?.role === 'managing_director';
  const isCoordinator = user?.role === 'construction_coordinator';
  const isAccountant = user?.role === 'construction_accountant';
  const canWrite = true;
  const [crew, setCrew]               = useState<CrewMember[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [activeTab, setActiveTab]     = useState<FilterTab>('all');
  const [showModal, setShowModal]     = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const [productions, setProductions]       = useState<Production[]>([]);
  const [productionFilter, setProductionFilter] = useState('');
  const [tradeFilter, setTradeFilter]       = useState('');
  const [rankFilter, setRankFilter]         = useState('');
  const [tradesData, setTradesData]         = useState<{ bectu: Record<string, string[]>; non_bectu: string[] } | null>(null);

  const allTrades = tradesData
    ? [...Object.keys(tradesData.bectu), ...tradesData.non_bectu]
    : [];
  const rankOptions = tradesData && tradeFilter ? (tradesData.bectu[tradeFilter] ?? []) : [];

  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => {});
    crewApi.getTrades().then(setTradesData).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (activeTab === 'paye')          params.employment_status = 'paye';
      if (activeTab === 'self_employed') params.employment_status = 'self_employed';
      if (activeTab === 'active')        params.is_active = 'true';
      if (activeTab === 'inactive')      params.is_active = 'false';
      if (search)           params.search       = search;
      if (productionFilter) params.production_id = productionFilter;
      if (tradeFilter)      params.crew_trade   = tradeFilter;
      if (rankFilter)       params.crew_rank    = rankFilter;

      const data = await crewApi.list(Object.keys(params).length ? params : undefined);
      setCrew(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load crew');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, productionFilter, tradeFilter, rankFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (c: CrewMember, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete ${c.first_name} ${c.last_name}? If linked records exist, they will be deactivated instead.`)) return;
    setDeletingId(c.id);
    try {
      const result = await crewApi.delete(c.id);
      if (result.soft_deleted) {
        alert(result.message);
      }
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  // Stats derived from whatever the server returned
  const totalCrew  = crew.length;
  const activeCrew = crew.filter(c => c.is_active).length;
  const payeCount  = crew.filter(c => c.employment_status === 'paye').length;
  const seCount    = crew.filter(c => c.employment_status === 'self_employed').length;

  // All filtering is now server-side; just use crew directly
  const filtered = crew;

  const stats = [
    { label: 'Total Crew',    value: totalCrew,  icon: <Users size={18} className="text-blue-600" />,      bg: 'bg-blue-50' },
    { label: 'Active',        value: activeCrew, icon: <UserCheck size={18} className="text-green-600" />,  bg: 'bg-green-50' },
    { label: 'PAYE',          value: payeCount,  icon: <Briefcase size={18} className="text-blue-600" />,   bg: 'bg-blue-50' },
    { label: 'Self-Employed', value: seCount,    icon: <Building2 size={18} className="text-purple-600" />, bg: 'bg-purple-50' },
  ];

  return (
    <>
      {showModal && (
        <RegisterCrewModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
        />
      )}

      <TopBar title="Crew Database" subtitle="Register and manage your construction crew" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm flex items-center gap-4">
              <div className={`w-10 h-10 ${s.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                {s.icon}
              </div>
              <div>
                {loading
                  ? <div className="h-6 w-10 bg-slate-100 rounded animate-pulse mb-1" />
                  : <p className="text-slate-900 text-2xl font-bold">{s.value}</p>}
                <p className="text-slate-500 text-xs">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Table card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-3 border-b border-slate-100 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1 flex-wrap">
                {FILTER_TABS.map(tab => (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-52">
                  <Search size={13} className="text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="Search crew..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                  )}
                </div>
                {canWrite && (
                  <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                  >
                    <Plus size={14} />
                    Register Crew Member
                  </button>
                )}
              </div>
            </div>
            {/* Secondary filter row */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={productionFilter}
                onChange={e => setProductionFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All productions</option>
                {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                value={tradeFilter}
                onChange={e => { setTradeFilter(e.target.value); setRankFilter(''); }}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All trades</option>
                {allTrades.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={rankFilter}
                onChange={e => setRankFilter(e.target.value)}
                disabled={rankOptions.length === 0}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              >
                <option value="">All ranks</option>
                {rankOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {(productionFilter || tradeFilter || rankFilter) && (
                <button
                  onClick={() => { setProductionFilter(''); setTradeFilter(''); setRankFilter(''); }}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="px-5 py-4 text-red-600 text-sm bg-red-50 border-b border-red-100">{error}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[780px]">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 z-10">Crew Member</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Trade &amp; Rank</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Employment</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Active Production(s)</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-4">
                          <div className="h-4 bg-slate-100 rounded animate-pulse w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-400 text-sm">
                      {search ? 'No crew members match your search.' : 'No crew members found.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c, idx) => {
                    const colorClass = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => router.push(`/crew/${c.id}`)}>
                        <td className="px-5 py-3.5 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center flex-shrink-0`}>
                              <span className="text-white text-xs font-bold">
                                {getInitials(c.first_name, c.last_name)}
                              </span>
                            </div>
                            <div>
                              <p className="text-slate-900 font-medium text-sm">{c.first_name} {c.last_name}</p>
                              <p className="text-slate-400 text-xs font-mono">{c.crew_number}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="text-slate-700 text-sm">{c.crew_trade ?? '—'}</p>
                          {c.crew_rank && <p className="text-slate-400 text-xs">{c.crew_rank}</p>}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.employment_status === 'paye' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {c.employment_status === 'paye' ? 'PAYE' : 'Self-Employed'}
                          </span>
                        </td>
                        {/* Active Productions */}
                        <td className="px-4 py-3.5 max-w-[180px]">
                          {(c.active_productions && c.active_productions.length > 0)
                            ? <div className="flex flex-wrap gap-1">
                                {c.active_productions.slice(0, 2).map(p => (
                                  <span key={p} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-medium truncate max-w-[120px]">{p}</span>
                                ))}
                                {c.active_productions.length > 2 && (
                                  <span className="text-[10px] text-slate-400">+{c.active_productions.length - 2}</span>
                                )}
                              </div>
                            : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            {c.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={e => { e.stopPropagation(); router.push(`/crew/${c.id}`); }}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <ChevronRight size={15} />
                            </button>
                            {canWrite && (
                              <button
                                onClick={e => handleDelete(c, e)}
                                disabled={deletingId === c.id}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                                title="Delete crew member"
                              >
                                {deletingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={13} />}
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

          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
            <span className="text-slate-400 text-xs">
              {loading
                ? 'Loading…'
                : `${crew.length} crew member${crew.length !== 1 ? 's' : ''} found`}
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
