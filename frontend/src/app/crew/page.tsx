'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import FreelancersTab from './FreelancersTab';
import CrewImportTab from './CrewImportTab';
import {
  Plus, Search, ChevronRight, X, Loader2, Users, UserCheck, Briefcase, Building2, Trash2,
  Share2, Copy, Check, Send, Mail, Inbox, AlertCircle, Eye, ShieldCheck, Sparkles, CheckCircle2,
  Upload, Archive, RotateCcw,
} from 'lucide-react';
import {
  crewApi, productionsApi, crewRatesApi, settingsApi,
  CrewMember, CrewRate, EmploymentStatus, Production, CrewRegistrationRequest,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyStateRow } from '@/components/EmptyState';

// ─── Constants ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-blue-500', 'bg-pink-500', 'bg-orange-500',
  'bg-green-500', 'bg-indigo-500', 'bg-rose-500', 'bg-cyan-500', 'bg-amber-500',
];

type FilterTab = 'all' | 'paye' | 'self_employed' | 'active' | 'inactive' | 'archived' | 'requests' | 'freelancers' | 'import';

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',           label: 'All' },
  { value: 'paye',          label: 'PAYE' },
  { value: 'self_employed', label: 'Self-Employed' },
  { value: 'freelancers',   label: 'Freelancers' },
  { value: 'active',        label: 'Active' },
  { value: 'inactive',      label: 'Inactive' },
  { value: 'archived',      label: 'Archived' },
  { value: 'requests',      label: 'Registration Requests' },
  { value: 'import',        label: 'Import Crew' },
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

// ─── Share Registration Modal ─────────────────────────────────────────────────

interface ShareRegistrationModalProps {
  onClose: () => void;
}

function ShareRegistrationModal({ onClose }: ShareRegistrationModalProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'link' | 'email'>('link');
  const [emailForm, setEmailForm] = useState({ email: '', name: '', message: '' });
  const [sending, setSending] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailError, setEmailError] = useState('');

  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const shareUrl = `${origin}/crew-registration`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    if (!emailForm.email.trim() || !emailForm.email.includes('@')) {
      setEmailError('Please enter a valid recipient email address.');
      return;
    }

    setSending(true);
    try {
      const res = await crewApi.sendInvite({
        email: emailForm.email.trim(),
        name: emailForm.name.trim() || undefined,
        message: emailForm.message.trim() || undefined,
      });
      setEmailSuccess(res.message || 'Invitation sent successfully!');
      setEmailForm({ email: '', name: '', message: '' });
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send invitation email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-lg">
            <Share2 size={20} className="text-blue-600" />
            <span>Share Crew Registration Form</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-slate-200 gap-4">
          <button
            onClick={() => setActiveTab('link')}
            className={`pb-2 text-sm font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'link' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Copy size={15} />
            <span>Copy Form Link</span>
          </button>
          <button
            onClick={() => setActiveTab('email')}
            className={`pb-2 text-sm font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'email' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Mail size={15} />
            <span>Send via Email</span>
          </button>
        </div>

        {activeTab === 'link' ? (
          <div className="space-y-4 py-2">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Share this link directly with prospective crew members. They can complete their details on mobile or desktop without needing a CS-HQ user account.
            </p>
            <div className="flex items-center gap-2 p-1.5 border border-slate-300 rounded-xl bg-slate-50">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="w-full bg-transparent text-xs sm:text-sm text-slate-800 font-mono px-3 py-1 outline-none"
              />
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all flex-shrink-0 ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy Link'}</span>
              </button>
            </div>
            <div className="bg-blue-50 border border-blue-200/80 rounded-xl p-3 text-xs text-blue-900 leading-relaxed">
              <strong>Tip:</strong> You can paste this link into WhatsApp groups, text messages, or direct emails. Submissions arrive under your <strong>Registration Requests</strong> tab for approval.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendEmail} className="space-y-3.5 py-1">
            {emailSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                <span>{emailSuccess}</span>
              </div>
            )}
            {emailError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
                <span>{emailError}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recipient Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={emailForm.email}
                onChange={e => setEmailForm(f => ({ ...f, email: e.target.value }))}
                placeholder="candidate@example.com"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recipient Name (Optional)
              </label>
              <input
                type="text"
                value={emailForm.name}
                onChange={e => setEmailForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. John Smith"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Custom Message (Optional)
              </label>
              <textarea
                rows={2}
                value={emailForm.message}
                onChange={e => setEmailForm(f => ({ ...f, message: e.target.value }))}
                placeholder="e.g. Please fill this out so we can onboard you for next week's shoot."
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-60"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                <span>{sending ? 'Sending...' : 'Send Invitation'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Review Candidate Modal ───────────────────────────────────────────────────

interface ReviewCandidateModalProps {
  request: CrewRegistrationRequest;
  tradesData: TradesData | null;
  defaultPayeRate: string;
  onClose: () => void;
  onApproved: () => void;
  onRejected: () => void;
}

function ReviewCandidateModal({
  request,
  tradesData,
  defaultPayeRate,
  onClose,
  onApproved,
  onRejected,
}: ReviewCandidateModalProps) {
  const tradeRanks = tradesData?.bectu[request.crew_trade] || ['HOD', 'Supervisor', 'Chargehand', request.crew_trade];

  const [rank, setRank] = useState(tradeRanks[tradeRanks.length - 1] || '');
  const [withholdingRate, setWithholdingRate] = useState(
    request.employment_status === 'paye' ? defaultPayeRate : '0'
  );

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');

  const handleApprove = async () => {
    if (!rank) {
      setError('Please assign a Crew Rank to approve this candidate.');
      return;
    }
    setApproving(true);
    setError('');
    try {
      await crewApi.approveRequest(request.id, {
        crew_rank: rank,
        paye_withholding_rate: parseFloat(withholdingRate || '0'),
      });
      alert('Candidate approved and added to Crew Database.');
      onApproved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve request.');
      setApproving(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    setError('');
    try {
      await crewApi.rejectRequest(request.id, { reason: rejectReason.trim() || undefined });
      alert('Registration request marked as rejected.');
      onRejected();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject request.');
      setRejecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-slate-100 space-y-5">
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">
                {request.first_name} {request.last_name}
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                request.status === 'pending'
                  ? 'bg-amber-100 text-amber-800'
                  : request.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {request.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Applied on {new Date(request.created_at).toLocaleDateString()} · Trade: <strong>{request.crew_trade}</strong>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Candidate Details */}
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-2">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Candidate Details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block">Email</span>
                <span className="font-semibold text-slate-800">{request.email}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Phone</span>
                <span className="font-semibold text-slate-800">{request.phone || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Date of Birth</span>
                <span className="font-semibold text-slate-800">{request.date_of_birth ? new Date(request.date_of_birth).toLocaleDateString() : '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Employment Status</span>
                <span className="font-semibold text-slate-800 uppercase">{request.employment_status.replace('_', ' ')}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block">Home Address</span>
                <span className="font-semibold text-slate-800">{request.home_address || '—'}</span>
              </div>
            </div>

            {request.employment_status === 'self_employed' && (
              <div className="pt-2 border-t border-slate-200/60 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 block">Company Name</span>
                  <span className="font-semibold text-slate-800">{request.company_name || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Reg Number</span>
                  <span className="font-semibold text-slate-800">{request.company_registration_number || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">VAT Number</span>
                  <span className="font-semibold text-slate-800">{request.vat_registration_number || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Company UTR</span>
                  <span className="font-semibold text-slate-800">{request.company_utr || '—'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Section: Bank Details */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Payroll &amp; Bank Details</p>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                <ShieldCheck size={12} /> Decrypted for Review
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block">Account Name</span>
                <span className="font-semibold text-slate-800 font-mono">{request.account_name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Sort Code</span>
                <span className="font-semibold text-slate-800 font-mono">{request.sort_code || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Account Number</span>
                <span className="font-semibold text-slate-800 font-mono">{request.account_number || '—'}</span>
              </div>
            </div>
          </div>

          {/* Section: Emergency & Qualifications */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-1.5">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Emergency Contact</p>
              <div>
                <span className="text-slate-400 block">Name &amp; Relation</span>
                <span className="font-semibold text-slate-800">
                  {request.emergency_contact_name || '—'} {request.emergency_contact_relationship ? `(${request.emergency_contact_relationship})` : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Emergency Phone</span>
                <span className="font-semibold text-slate-800 font-mono">{request.emergency_contact_phone || '—'}</span>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-1.5">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Qualifications &amp; Tickets</p>
              {request.qualifications && request.qualifications.length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {request.qualifications.map(q => (
                    <span key={q} className="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[11px] font-medium">
                      {q}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 text-xs">None listed</p>
              )}
            </div>
          </div>

          {request.notes && (
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 text-xs text-slate-700">
              <span className="font-semibold text-slate-500 block mb-0.5">Candidate Notes:</span>
              <p className="italic">{request.notes}</p>
            </div>
          )}

          {/* Section: Management Assignment (Required for Approval) */}
          {request.status === 'pending' && (
            <div className="bg-blue-50/70 border-2 border-blue-400 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-blue-900 font-bold text-sm">
                <Sparkles size={16} className="text-blue-600" />
                <span>Assign Rank &amp; Withholding Rate (Required)</span>
              </div>
              <p className="text-xs text-blue-800 leading-relaxed">
                As the reviewing manager, assign the candidate's formal Crew Rank and PAYE withholding percentage. Upon clicking approve, a permanent <strong className="font-mono">CSC-XXXX</strong> crew number will be generated and added to the Crew Database.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Crew Rank <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={rank}
                    onChange={e => setRank(e.target.value)}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 outline-none focus:border-blue-500"
                  >
                    <option value="">Select rank...</option>
                    {tradeRanks.map(r => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Withholding Rate (%)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      value={withholdingRate}
                      onChange={e => setWithholdingRate(e.target.value)}
                      className="w-full text-xs font-medium border border-slate-300 rounded-lg px-3 py-2 pr-7 bg-white text-slate-900 outline-none focus:border-blue-500"
                    />
                    <span className="absolute right-2.5 top-2 text-xs text-slate-400">%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Rejection input box if triggered */}
          {showRejectForm && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-2 text-xs">
              <label className="block font-semibold text-red-900">Rejection Reason</label>
              <input
                type="text"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Does not hold required certifications for this project."
                className="w-full text-xs border border-red-300 rounded-lg px-3 py-2 bg-white text-slate-900 outline-none focus:border-red-500"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowRejectForm(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-white text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={rejecting}
                  onClick={handleReject}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  {rejecting ? <Loader2 size={12} className="animate-spin" /> : null}
                  <span>Confirm Rejection</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div>
            {request.status === 'pending' && !showRejectForm && (
              <button
                type="button"
                onClick={() => setShowRejectForm(true)}
                className="px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Reject Request...
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            {request.status === 'pending' && (
              <button
                type="button"
                disabled={approving || !rank}
                onClick={handleApprove}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
              >
                {approving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>{approving ? 'Approving...' : 'Approve & Add to Crew'}</span>
              </button>
            )}
          </div>
        </div>
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
  const isGuest = user?.role === 'guest';
  const canWrite = !isGuest;

  const [crew, setCrew]               = useState<CrewMember[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [activeTab, setActiveTab]     = useState<FilterTab>('all');
  const [showModal, setShowModal]     = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [permanentDeleteCrew, setPermanentDeleteCrew] = useState<CrewMember | null>(null);
  const [permanentDeletingCrew, setPermanentDeletingCrew] = useState(false);

  const [productions, setProductions]       = useState<Production[]>([]);
  const [productionFilter, setProductionFilter] = useState('');
  const [tradeFilter, setTradeFilter]       = useState('');
  const [rankFilter, setRankFilter]         = useState('');
  const [tradesData, setTradesData]         = useState<{ bectu: Record<string, string[]>; non_bectu: string[] } | null>(null);

  // Registration requests state
  const [requests, setRequests]             = useState<CrewRegistrationRequest[]>([]);
  const [requestCounts, setRequestCounts]   = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<CrewRegistrationRequest | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [defaultPayeRate, setDefaultPayeRate] = useState('20');

  const allTrades = tradesData
    ? [...Object.keys(tradesData.bectu), ...tradesData.non_bectu]
    : [];
  const rankOptions = tradesData && tradeFilter ? (tradesData.bectu[tradeFilter] ?? []) : [];

  useEffect(() => {
    productionsApi.list().then(setProductions).catch(() => {});
    crewApi.getTrades().then(setTradesData).catch(() => {});
    settingsApi.get().then(s => {
      const rate = s['default_paye_rate'];
      const val = typeof rate?.value === 'number' ? String(rate.value) : '20';
      setDefaultPayeRate(val);
    }).catch(() => {});
  }, []);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await crewApi.listRequests(requestStatusFilter);
      setRequests(res.requests || []);
      if (res.counts) setRequestCounts(res.counts);
    } catch (err) {
      console.error('Failed to load requests:', err);
    } finally {
      setLoadingRequests(false);
    }
  }, [requestStatusFilter]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (activeTab === 'paye')          params.employment_status = 'paye';
      if (activeTab === 'self_employed') params.employment_status = 'self_employed';
      if (activeTab === 'active')        params.is_active = 'true';
      if (activeTab === 'inactive')      params.is_active = 'false';
      if (activeTab === 'archived')      params.is_archived = 'true';
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

  useEffect(() => {
    if (activeTab !== 'requests' && activeTab !== 'freelancers' && activeTab !== 'import') {
      load();
    }
  }, [load, activeTab]);

  const handleDelete = async (c: CrewMember, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Archive ${c.first_name} ${c.last_name}? They will be hidden from active rosters and timesheets, while historical payroll and timesheet records remain preserved.`)) return;
    setDeletingId(c.id);
    try {
      const result = await crewApi.delete(c.id);
      if (result.message) {
        alert(result.message);
      }
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestore = async (c: CrewMember, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await crewApi.restore(c.id);
      if (result.message) {
        alert(result.message);
      }
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Restore failed');
    }
  };

  const handlePermanentDeleteCrew = async () => {
    if (!permanentDeleteCrew) return;
    setPermanentDeletingCrew(true);
    try {
      const result = await crewApi.delete(permanentDeleteCrew.id, true);
      alert(result.message || `${permanentDeleteCrew.first_name} ${permanentDeleteCrew.last_name} has been permanently deleted.`);
      setPermanentDeleteCrew(null);
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to permanently delete crew member');
    } finally {
      setPermanentDeletingCrew(false);
    }
  };

  const handleDeleteRequest = async (r: CrewRegistrationRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete registration request from ${r.first_name} ${r.last_name}?`)) return;
    try {
      await crewApi.deleteRequest(r.id);
      await loadRequests();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete request');
    }
  };

  // Stats derived from whatever the server returned
  const totalCrew  = crew.length;
  const activeCrew = crew.filter(c => c.is_active).length;
  const payeCount  = crew.filter(c => c.employment_status === 'paye').length;
  const seCount    = crew.filter(c => c.employment_status === 'self_employed').length;

  const stats = [
    { label: 'Total Crew',       value: totalCrew,              icon: <Users size={18} className="text-blue-600" />,      bg: 'bg-blue-50',   tab: 'all' as FilterTab },
    { label: 'Active',           value: activeCrew,             icon: <UserCheck size={18} className="text-green-600" />,  bg: 'bg-green-50',  tab: 'active' as FilterTab },
    { label: 'PAYE',             value: payeCount,              icon: <Briefcase size={18} className="text-blue-600" />,   bg: 'bg-blue-50',   tab: 'paye' as FilterTab },
    { label: 'Self-Employed',    value: seCount,                icon: <Building2 size={18} className="text-purple-600" />, bg: 'bg-purple-50', tab: 'self_employed' as FilterTab },
    { label: 'Pending Requests', value: requestCounts.pending,  icon: <Inbox size={18} className="text-amber-600" />,     bg: 'bg-amber-50',  tab: 'requests' as FilterTab, highlight: requestCounts.pending > 0 },
  ];

  const filteredRequests = requests.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.first_name.toLowerCase().includes(q) ||
      r.last_name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.crew_trade.toLowerCase().includes(q) ||
      (r.phone && r.phone.toLowerCase().includes(q))
    );
  });

  return (
    <>
      {showModal && (
        <RegisterCrewModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
        />
      )}

      {showShareModal && (
        <ShareRegistrationModal onClose={() => setShowShareModal(false)} />
      )}

      {selectedRequest && (
        <ReviewCandidateModal
          request={selectedRequest}
          tradesData={tradesData}
          defaultPayeRate={defaultPayeRate}
          onClose={() => setSelectedRequest(null)}
          onApproved={() => {
            setSelectedRequest(null);
            loadRequests();
            load();
          }}
          onRejected={() => {
            setSelectedRequest(null);
            loadRequests();
          }}
        />
      )}

      <TopBar title="Crew Database" subtitle="Register and manage your construction crew" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          {stats.map(s => (
            <div
              key={s.label}
              onClick={() => setActiveTab(s.tab)}
              className={`bg-white rounded-xl border ${
                s.highlight ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-200'
              } px-4 py-3.5 shadow-sm flex items-center gap-3 cursor-pointer hover:shadow-md transition-all`}
            >
              <div className={`w-10 h-10 ${s.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                {s.icon}
              </div>
              <div>
                {(loading && s.tab !== 'requests') || (loadingRequests && s.tab === 'requests') ? (
                  <div className="h-6 w-10 bg-slate-100 rounded animate-pulse mb-1" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-slate-900 text-2xl font-bold">{s.value}</p>
                    {s.highlight && (
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    )}
                  </div>
                )}
                <p className="text-slate-500 text-xs font-medium">{s.label}</p>
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
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                      activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.value === 'requests' && requestCounts.pending > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                        activeTab === 'requests' ? 'bg-white text-blue-700' : 'bg-amber-500 text-white'
                      }`}>
                        {requestCounts.pending}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {activeTab !== 'freelancers' && activeTab !== 'import' && <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-52">
                  <Search size={13} className="text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder={activeTab === 'requests' ? 'Search requests...' : 'Search crew...'}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                  )}
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowShareModal(true)}
                      className="flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm rounded-lg px-3.5 py-2 transition-colors font-medium whitespace-nowrap shadow-sm"
                    >
                      <Share2 size={14} className="text-blue-600" />
                      <span>Share Form Link</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('import')}
                      className="flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm rounded-lg px-3.5 py-2 transition-colors font-medium whitespace-nowrap shadow-sm"
                    >
                      <Upload size={14} className="text-slate-600" />
                      <span>Import Crew</span>
                    </button>
                    <button
                      onClick={() => setShowModal(true)}
                      className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap shadow-sm"
                    >
                      <Plus size={14} />
                      <span>Register Crew Member</span>
                    </button>
                  </div>
                )}
              </div>}
            </div>

            {/* Secondary filter row */}
            {activeTab === 'freelancers' || activeTab === 'import' ? null : activeTab === 'requests' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 font-medium">Status Filter:</span>
                {(['all', 'pending', 'approved', 'rejected'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setRequestStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium capitalize transition-colors ${
                      requestStatusFilter === st
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st} {st === 'pending' && requestCounts.pending > 0 ? `(${requestCounts.pending})` : ''}
                  </button>
                ))}
              </div>
            ) : (
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
            )}
          </div>

          {error && activeTab !== 'freelancers' && activeTab !== 'import' && (
            <div className="px-5 py-4 text-red-600 text-sm bg-red-50 border-b border-red-100">{error}</div>
          )}

          {/* Table content depending on activeTab */}
          {activeTab === 'import' ? (
            <CrewImportTab onComplete={() => { setActiveTab('all'); load(); }} />
          ) : activeTab === 'freelancers' ? (
            <FreelancersTab />
          ) : activeTab === 'requests' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[780px]">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 z-10">Candidate</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Trade &amp; Employment</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Contact &amp; Address</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Submitted</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingRequests ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="px-4 py-4">
                            <div className="h-4 bg-slate-100 rounded animate-pulse w-24" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-sm">
                        <div className="max-w-sm mx-auto space-y-2">
                          <Inbox size={32} className="mx-auto text-slate-300" />
                          <p className="text-slate-600 font-medium">No registration requests found</p>
                          <p className="text-xs text-slate-400">
                            Share your public form link with crew candidates. Submissions will appear here for review and rank assignment.
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowShareModal(true)}
                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition-colors"
                          >
                            <Share2 size={13} />
                            <span>Share Form Link</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((r, idx) => {
                      const colorClass = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                      return (
                        <tr
                          key={r.id}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          onClick={() => setSelectedRequest(r)}
                        >
                          <td className="px-5 py-3.5 sticky left-0 bg-white z-10">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center flex-shrink-0`}>
                                <span className="text-white text-xs font-bold">
                                  {getInitials(r.first_name, r.last_name)}
                                </span>
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">
                                  {r.first_name} {r.last_name}
                                </p>
                                <p className="text-slate-400 text-xs font-mono">{r.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="text-slate-800 text-sm font-medium">{r.crew_trade}</p>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                              r.employment_status === 'paye' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {r.employment_status === 'paye' ? 'PAYE' : 'Self-Employed'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-600">
                            <p className="font-mono">{r.phone || '—'}</p>
                            <p className="text-slate-400 truncate max-w-[160px]">{r.home_address || '—'}</p>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                            {new Date(r.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize inline-flex items-center gap-1 ${
                              r.status === 'pending'
                                ? 'bg-amber-100 text-amber-800'
                                : r.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {r.status === 'pending' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                              {r.status === 'approved' && <CheckCircle2 size={12} className="text-emerald-600" />}
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => setSelectedRequest(r)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${
                                  r.status === 'pending'
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                              >
                                <Eye size={13} />
                                <span>{r.status === 'pending' ? 'Review' : 'View'}</span>
                              </button>
                              <button
                                onClick={e => handleDeleteRequest(r, e)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete registration request"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
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
                  ) : crew.length === 0 ? (
                    activeTab === 'archived' ? (
                      <EmptyStateRow
                        colSpan={6}
                        icon={Archive}
                        title="No archived crew members"
                        description="There are currently no archived crew members in the system."
                        recommendation="Crew members who have moved on can be archived to keep your active roster uncluttered while retaining all historical payroll records."
                        action={{
                          label: 'View Active Crew',
                          onClick: () => setActiveTab('all'),
                        }}
                      />
                    ) : (search || productionFilter || tradeFilter || rankFilter) ? (
                      <EmptyStateRow
                        colSpan={6}
                        icon={AlertCircle}
                        title="No matching crew members"
                        description="No crew members match your active search and filter criteria."
                        recommendation="Try clearing your search term or resetting the production and trade filters."
                        action={{
                          label: 'Clear Filters',
                          onClick: () => { setSearch(''); setProductionFilter(''); setTradeFilter(''); setRankFilter(''); },
                          icon: X,
                        }}
                      />
                    ) : (
                      <EmptyStateRow
                        colSpan={6}
                        icon={Users}
                        title="No crew members found"
                        description="Your crew directory is currently empty."
                        recommendation="Register your crew members or invite freelancers to join productions and submit timesheets."
                        action={canWrite ? {
                          label: 'Add Crew Member',
                          onClick: () => setShowModal(true),
                          icon: Plus,
                        } : undefined}
                        secondaryAction={canWrite ? {
                          label: 'Import Crew',
                          href: '/crew/import',
                        } : undefined}
                      />
                    )
                  ) : (
                    crew.map((c, idx) => {
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
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              c.is_archived
                                ? 'bg-amber-100 text-amber-800'
                                : c.is_active
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-600'
                            }`}>
                              {c.is_archived ? 'Archived' : c.is_active ? 'Active' : 'Inactive'}
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
                                c.is_archived ? (
                                  <>
                                    <button
                                      onClick={e => handleRestore(c, e)}
                                      className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                                      title="Restore crew member"
                                    >
                                      <RotateCcw size={13} />
                                    </button>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setPermanentDeleteCrew(c);
                                      }}
                                      className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                                      title="Permanently delete crew member"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={e => handleDelete(c, e)}
                                    disabled={deletingId === c.id}
                                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40"
                                    title="Archive crew member"
                                  >
                                    {deletingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Archive size={13} />}
                                  </button>
                                )
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
          )}

          {activeTab !== 'freelancers' && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
            <span className="text-slate-400 text-xs">
              {activeTab === 'requests'
                ? loadingRequests
                  ? 'Loading requests…'
                  : `${filteredRequests.length} request${filteredRequests.length !== 1 ? 's' : ''} listed`
                : loading
                ? 'Loading…'
                : `${crew.length} crew member${crew.length !== 1 ? 's' : ''} found`}
            </span>
          </div>}
        </div>
      </main>

      {/* ─── PERMANENT DELETE CREW MODAL ────────────────────────────────────── */}
      {permanentDeleteCrew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-rose-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 rounded-xl border border-rose-200">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Permanently Delete Crew Member?</h3>
                <p className="text-[11px] text-rose-600 font-medium">This action cannot be undone</p>
              </div>
            </div>
            <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                Are you sure you want to permanently delete <strong className="text-slate-900">{permanentDeleteCrew.first_name} {permanentDeleteCrew.last_name}</strong>?
                This will wipe this record and all associated documents completely from the database.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px]">
                <strong>Integrity Safeguard:</strong> If this crew member has any timesheet or payroll records, the database will strictly prevent permanent deletion to preserve financial history.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPermanentDeleteCrew(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePermanentDeleteCrew}
                disabled={permanentDeletingCrew}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {permanentDeletingCrew && <Loader2 size={12} className="animate-spin" />}
                <span>Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
