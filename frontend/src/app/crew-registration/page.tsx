'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Building2,
  User,
  ShieldCheck,
  Phone,
  FileText,
  CreditCard,
  AlertCircle,
  Loader2,
  HardHat,
  Sparkles,
} from 'lucide-react';
import { crewApi, EmploymentStatus } from '@/lib/api';

const COMMON_QUALIFICATIONS = [
  'CSCS Card',
  'IPAF (Scissor / Cherry Picker)',
  'PASMA (Mobile Access Towers)',
  'First Aid at Work',
  'Manual Handling',
  'Asbestos Awareness',
  'Working at Height',
  'Telehandler / Forklift',
  'SSSTS / SMSTS',
];

function CrewRegistrationForm() {
  const searchParams = useSearchParams();

  // Pre-fill from invite query params
  const prefillEmail = searchParams.get('email') || '';
  const prefillName = searchParams.get('name') || '';
  const nameParts = prefillName.split(' ');

  const [tradesData, setTradesData] = useState<{ bectu: Record<string, string[]>; non_bectu: string[] } | null>(null);
  const [loadingTrades, setLoadingTrades] = useState(true);

  const [form, setForm] = useState({
    first_name: nameParts[0] || '',
    last_name: nameParts.slice(1).join(' ') || '',
    date_of_birth: '',
    home_address: '',
    email: prefillEmail,
    phone: '',
    employment_status: 'paye' as EmploymentStatus,
    crew_trade: '',
    company_name: '',
    company_registration_number: '',
    vat_registration_number: '',
    company_utr: '',
    account_name: '',
    account_number: '',
    sort_code: '',
    emergency_contact_name: '',
    emergency_contact_relationship: '',
    emergency_contact_phone: '',
    qualifications: [] as string[],
    other_qualifications: '',
    notes: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    crewApi
      .getPublicTrades()
      .then(setTradesData)
      .catch(() => {
        // Fallback reference data if network or API error
        setTradesData({
          bectu: {
            Carpenters: ['Carpenter'],
            Machinists: ['Machinist'],
            Stagehands: ['Stagehand'],
            Riggers: ['Rigger'],
            Plasterers: ['Plasterer'],
            'Scenic Painters': ['Painter'],
            Sculptors: ['Sculptor'],
            'Metal Workers': ['Metal Worker'],
          },
          non_bectu: ['Construction Accountant', 'Construction Coordinator', 'Construction Manager', 'Luton Driver'],
        });
      })
      .finally(() => setLoadingTrades(false));
  }, []);

  const allTrades = tradesData
    ? [...Object.keys(tradesData.bectu), ...tradesData.non_bectu]
    : [];

  const setField = (k: keyof typeof form, val: any) => {
    setForm(f => ({ ...f, [k]: val }));
    if (error) setError('');
  };

  const toggleQualification = (q: string) => {
    setForm(f => ({
      ...f,
      qualifications: f.qualifications.includes(q)
        ? f.qualifications.filter(x => x !== q)
        : [...f.qualifications, q],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Basic client validations
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Please provide your first and last name.');
      return;
    }
    if (!form.email.trim() || !form.email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    if (!form.crew_trade) {
      setError('Please select your primary trade / department.');
      return;
    }
    if (!form.account_name.trim() || !form.account_number.trim() || !form.sort_code.trim()) {
      setError('Please provide your bank account details for payroll.');
      return;
    }
    if (!form.emergency_contact_name.trim() || !form.emergency_contact_phone.trim()) {
      setError('Please provide emergency contact details.');
      return;
    }

    setSubmitting(true);
    try {
      const combinedQualifications = [...form.qualifications];
      if (form.other_qualifications.trim()) {
        combinedQualifications.push(form.other_qualifications.trim());
      }

      await crewApi.submitPublicRegistration({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        date_of_birth: form.date_of_birth || undefined,
        home_address: form.home_address.trim() || undefined,
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        employment_status: form.employment_status,
        crew_trade: form.crew_trade,
        company_name: form.employment_status === 'self_employed' ? form.company_name.trim() : undefined,
        company_registration_number: form.employment_status === 'self_employed' ? form.company_registration_number.trim() : undefined,
        vat_registration_number: form.employment_status === 'self_employed' ? form.vat_registration_number.trim() : undefined,
        company_utr: form.employment_status === 'self_employed' ? form.company_utr.trim() : undefined,
        account_name: form.account_name.trim(),
        account_number: form.account_number.trim(),
        sort_code: form.sort_code.trim(),
        emergency_contact_name: form.emergency_contact_name.trim(),
        emergency_contact_relationship: form.emergency_contact_relationship.trim() || undefined,
        emergency_contact_phone: form.emergency_contact_phone.trim(),
        qualifications: combinedQualifications,
        notes: form.notes.trim() || undefined,
      });

      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit registration. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8 sm:p-12 text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600 shadow-inner">
            <CheckCircle2 size={44} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Registration Submitted!
            </h2>
            <p className="text-slate-600 max-w-md mx-auto text-sm sm:text-base leading-relaxed">
              Thank you, <strong className="text-slate-900">{form.first_name} {form.last_name}</strong>. Your details have been securely submitted to Construct Scenery for management review.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 text-left text-xs sm:text-sm text-slate-600 space-y-2 max-w-md mx-auto">
            <div className="flex justify-between py-1 border-b border-slate-200/60">
              <span className="text-slate-500">Email:</span>
              <span className="font-semibold text-slate-800">{form.email}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200/60">
              <span className="text-slate-500">Trade:</span>
              <span className="font-semibold text-slate-800">{form.crew_trade}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Classification:</span>
              <span className="font-semibold text-slate-800 capitalize">{form.employment_status.replace('_', ' ')}</span>
            </div>
          </div>

          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Once management approves your registration and assigns your rank, you will receive confirmation and your unique Construct Scenery Crew Number.
          </p>

          <button
            onClick={() => {
              setSubmitted(false);
              setForm(f => ({
                ...f,
                first_name: '',
                last_name: '',
                email: '',
                phone: '',
                home_address: '',
                date_of_birth: '',
                account_name: '',
                account_number: '',
                sort_code: '',
                emergency_contact_name: '',
                emergency_contact_phone: '',
                notes: '',
              }));
            }}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium transition-colors"
          >
            Submit Another Registration
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 rounded-2xl p-6 sm:p-8 text-white shadow-lg mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-40 h-40 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-sm">
            <HardHat size={22} className="text-blue-300" />
          </div>
          <span className="text-xs font-semibold tracking-wider uppercase text-blue-200">
            Construct Scenery Limited
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          Crew Onboarding & Registration
        </h1>
        <p className="text-sm sm:text-base text-blue-100/90 max-w-xl leading-relaxed">
          Please complete your details below to join our construction crew database. All personal, contact, and banking information is encrypted and held strictly in confidence.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3.5 rounded-xl text-sm flex items-start gap-3 mb-6 shadow-sm">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">Please review the form</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Personal Details */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 text-slate-900 font-semibold text-sm sm:text-base">
            <User size={18} className="text-blue-600 flex-shrink-0" />
            <span>1. Personal Information</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={e => setField('first_name', e.target.value)}
                placeholder="e.g. James"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={e => setField('last_name', e.target.value)}
                placeholder="e.g. Wilson"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setField('email', e.target.value)}
                placeholder="name@example.com"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setField('phone', e.target.value)}
                placeholder="e.g. 07700 900077"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Date of Birth
              </label>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={e => setField('date_of_birth', e.target.value)}
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Home Address
              </label>
              <input
                type="text"
                value={form.home_address}
                onChange={e => setField('home_address', e.target.value)}
                placeholder="Street address, City, Postcode"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Trade & Classification */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 text-slate-900 font-semibold text-base">
            <Building2 size={18} className="text-blue-600" />
            <span>2. Trade Specialism & Employment Status</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Employment Status <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setField('employment_status', 'paye')}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-all ${
                    form.employment_status === 'paye'
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  PAYE
                </button>
                <button
                  type="button"
                  onClick={() => setField('employment_status', 'self_employed')}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-all ${
                    form.employment_status === 'self_employed'
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Self-Employed
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Trade / Department <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={form.crew_trade}
                onChange={e => setField('crew_trade', e.target.value)}
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white text-slate-900"
              >
                <option value="">{loadingTrades ? 'Loading trades...' : 'Select your trade...'}</option>
                {allTrades.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Company Assignment Notice */}
          <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 flex items-start gap-3 text-amber-900 text-xs sm:text-sm">
            <Sparkles size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-950">Company Evaluation: </span>
              Your <strong>Crew Rank</strong> (e.g. HOD, Supervisor, Chargehand, Carpenter) and <strong>withholding rate</strong> will be evaluated and assigned by Construct Scenery upon reviewing your application.
            </div>
          </div>

          {/* Self-Employed Extra Fields */}
          {form.employment_status === 'self_employed' && (
            <div className="bg-slate-50 rounded-xl p-3.5 sm:p-4 border border-slate-200/80 space-y-3 pt-3 animate-in fade-in duration-200">
              <p className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Limited Company / Sole Trader Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Company Name</label>
                  <input
                    type="text"
                    value={form.company_name}
                    onChange={e => setField('company_name', e.target.value)}
                    placeholder="e.g. JW Scenic Creations Ltd"
                    className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 bg-white text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Company Reg Number</label>
                  <input
                    type="text"
                    value={form.company_registration_number}
                    onChange={e => setField('company_registration_number', e.target.value)}
                    placeholder="e.g. 12345678"
                    className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 bg-white text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">VAT Number (if applicable)</label>
                  <input
                    type="text"
                    value={form.vat_registration_number}
                    onChange={e => setField('vat_registration_number', e.target.value)}
                    placeholder="e.g. GB 123 4567 89"
                    className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 bg-white text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">UTR / Unique Tax Reference</label>
                  <input
                    type="text"
                    value={form.company_utr}
                    onChange={e => setField('company_utr', e.target.value)}
                    placeholder="10-digit UTR"
                    className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 bg-white text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Bank Details */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm sm:text-base">
              <CreditCard size={18} className="text-blue-600 flex-shrink-0" />
              <span>3. Bank Details (For Direct Payroll)</span>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 self-start sm:self-auto">
              <ShieldCheck size={13} />
              <span>AES-256 Encrypted</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Account Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.account_name}
                onChange={e => setField('account_name', e.target.value)}
                placeholder="e.g. J WILSON"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Sort Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.sort_code}
                onChange={e => setField('sort_code', e.target.value)}
                placeholder="e.g. 20-40-71"
                maxLength={8}
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Account Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.account_number}
                onChange={e => setField('account_number', e.target.value)}
                placeholder="e.g. 12345678"
                maxLength={12}
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Emergency Contact */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 text-slate-900 font-semibold text-sm sm:text-base">
            <Phone size={18} className="text-blue-600 flex-shrink-0" />
            <span>4. Emergency Contact</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contact Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.emergency_contact_name}
                onChange={e => setField('emergency_contact_name', e.target.value)}
                placeholder="e.g. Sarah Wilson"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Relationship
              </label>
              <input
                type="text"
                value={form.emergency_contact_relationship}
                onChange={e => setField('emergency_contact_relationship', e.target.value)}
                placeholder="e.g. Spouse / Partner"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Emergency Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                value={form.emergency_contact_phone}
                onChange={e => setField('emergency_contact_phone', e.target.value)}
                placeholder="e.g. 07700 900099"
                className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Section 5: Qualifications & Tickets */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 text-slate-900 font-semibold text-sm sm:text-base">
            <FileText size={18} className="text-blue-600 flex-shrink-0" />
            <span>5. Qualifications & Tickets</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {COMMON_QUALIFICATIONS.map(q => {
              const isChecked = form.qualifications.includes(q);
              return (
                <button
                  type="button"
                  key={q}
                  onClick={() => toggleQualification(q)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-xs transition-all ${
                    isChecked
                      ? 'bg-blue-50 border-blue-400 text-blue-900 font-medium'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${
                      isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isChecked && <CheckCircle2 size={12} />}
                  </div>
                  <span className="truncate">{q}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Other Tickets / Certifications / Notes
            </label>
            <input
              type="text"
              value={form.other_qualifications}
              onChange={e => setField('other_qualifications', e.target.value)}
              placeholder="e.g. HGV Class 2, IPAF 3a/3b, etc."
              className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Additional Notes or Availability
            </label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="Any additional information you'd like to share with management..."
              className="w-full text-base sm:text-sm border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900"
            />
          </div>
        </div>

        {/* Submit Section */}
        <div className="pt-2 pb-12">
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>Submitting Registration...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={20} />
                <span>Submit Crew Registration</span>
              </>
            )}
          </button>
          <p className="text-center text-xs text-slate-400 mt-3">
            By submitting, you certify that the provided information is true and accurate.
          </p>
        </div>
      </form>
    </div>
  );
}

export default function CrewRegistrationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 size={32} className="animate-spin text-blue-600" />
        </div>
      }
    >
      <CrewRegistrationForm />
    </Suspense>
  );
}
