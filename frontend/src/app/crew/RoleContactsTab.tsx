'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FileText, Loader2, Mail, Pencil, Phone, PhoneCall, PhoneOff, Plus,
  Search, Star, Trash2, X, Building2, Clapperboard, Check,
} from 'lucide-react';
import AttachedDocuments from '@/components/AttachedDocuments';
import {
  crewRoleContactsApi,
  type CrewRoleType,
  type CrewRoleContact,
  type CrewRoleContactInput,
  type FreelancerCallPriority,
  type Production,
} from '@/lib/api';

const PRIORITIES = [
  { value: 'first_call', label: 'First call', icon: PhoneCall, colour: 'border-emerald-600 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
  { value: 'backup',     label: 'Backup',     icon: Phone,     colour: 'border-amber-500 bg-amber-50 text-amber-800',     dot: 'bg-amber-500' },
  { value: 'never_call', label: 'Never call', icon: PhoneOff,  colour: 'border-red-600 bg-red-50 text-red-800',         dot: 'bg-red-600' },
] as const;

export const ROLE_CONFIG: Record<CrewRoleType, { label: string; fullTitle: string; singular: string }> = {
  designer:    { label: 'DESIGNER',    fullTitle: 'Production Designer',         singular: 'Designer' },
  supv_art:    { label: 'SUPV. ART',   fullTitle: 'Supervising Art Director',    singular: 'Supervising Art Director' },
  art_dir:     { label: 'ART DIR.',    fullTitle: 'Art Director',                singular: 'Art Director' },
  fin_control: { label: 'FIN. CONTROL',fullTitle: 'Financial Controller',       singular: 'Financial Controller' },
  producer:    { label: 'PRODUCER',    fullTitle: 'Producer',                    singular: 'Producer' },
  upm:         { label: 'UPM',         fullTitle: 'Unit Production Manager',     singular: 'UPM' },
  line_prod:   { label: 'LINE PROD',   fullTitle: 'Line Producer',               singular: 'Line Producer' },
};

function CallPriority({
  value,
  onChange,
  disabled = false,
}: {
  value: FreelancerCallPriority;
  onChange: (value: FreelancerCallPriority) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Call priority" className="grid grid-cols-3 gap-1 w-[282px] max-w-full">
      {PRIORITIES.map(priority => (
        <button
          key={priority.value}
          type="button"
          aria-pressed={value === priority.value}
          disabled={disabled}
          onClick={() => onChange(priority.value)}
          title={priority.label}
          className={`flex min-h-9 items-center justify-center gap-1 border rounded text-xs font-medium transition-colors disabled:opacity-50 ${
            value === priority.value
              ? priority.colour
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${priority.dot}`} aria-hidden="true" />
          {priority.label}
        </button>
      ))}
    </div>
  );
}

interface ContactEditorProps {
  contact: CrewRoleContact | null;
  roleType: CrewRoleType;
  productions: Production[];
  onClose: () => void;
  onSave: (input: CrewRoleContactInput) => Promise<void>;
}

function ContactEditor({ contact, roleType, productions, onClose, onSave }: ContactEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cfg = ROLE_CONFIG[roleType];

  const [form, setForm] = useState<CrewRoleContactInput>({
    role_type: roleType,
    full_name: contact?.full_name || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    company_or_production: contact?.company_or_production || '',
    notes: contact?.notes || '',
    is_favourite: contact?.is_favourite || false,
    call_priority: contact?.call_priority || 'backup',
  });
  const [selectedProd, setSelectedProd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const handleProdSelect = (prodName: string) => {
    setSelectedProd(prodName);
    if (prodName) {
      setForm(f => ({ ...f, company_or_production: prodName }));
    }
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.full_name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        role_type: roleType,
        full_name: form.full_name.trim(),
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        company_or_production: form.company_or_production?.trim() || null,
        notes: form.notes?.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to save ${cfg.singular}.`);
      setSaving(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="role-contact-editor-title"
      onCancel={event => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-100 pb-3">
        <div>
          <h2 id="role-contact-editor-title" className="text-base font-semibold text-slate-900">
            {contact ? `Edit ${cfg.singular}` : `Add New ${cfg.singular}`}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{cfg.fullTitle} Directory</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          title="Close"
          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <form onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              autoFocus
              required
              maxLength={200}
              placeholder="e.g. Sarah Jenkins"
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Email Address</label>
              <input
                type="email"
                maxLength={254}
                placeholder="name@example.com"
                value={form.email || ''}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Phone / Mobile</label>
              <input
                type="tel"
                maxLength={80}
                placeholder="+44 7..."
                value={form.phone || ''}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">
                Production / Company
              </label>
              {productions.length > 0 && (
                <span className="text-[11px] text-slate-400">or pick from current productions</span>
              )}
            </div>
            {productions.length > 0 && (
              <select
                value={selectedProd}
                onChange={e => handleProdSelect(e.target.value)}
                className="mb-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select an active production (optional) —</option>
                {productions.map(p => (
                  <option key={p.id} value={p.name}>{p.name} {p.production_code ? `(${p.production_code})` : ''}</option>
                ))}
              </select>
            )}
            <input
              maxLength={200}
              placeholder="e.g. Warner Bros / The Batman, Netflix, Freelance..."
              value={form.company_or_production || ''}
              onChange={e => setForm({ ...form, company_or_production: e.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Notes &amp; Details</label>
            <textarea
              rows={3}
              maxLength={10000}
              placeholder="Agency details, past show credits, day rate, preferred contact hours..."
              value={form.notes || ''}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className={`${inputClass} resize-y`}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700 mb-1.5">Call Priority</p>
            <CallPriority
              value={form.call_priority}
              onChange={call_priority => setForm({ ...form, call_priority })}
              disabled={saving}
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={form.is_favourite}
              onChange={e => setForm({ ...form, is_favourite: e.target.checked })}
              className="rounded border-slate-300 text-amber-500 focus:ring-amber-400 h-4 w-4"
            />
            <Star size={15} className={form.is_favourite ? 'fill-amber-400 text-amber-500' : 'text-slate-400'} />
            Mark as key favourite contact
          </label>

          {error && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Saving...' : contact ? 'Save Changes' : `Save ${cfg.singular}`}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}

interface RoleContactsTabProps {
  roleType: CrewRoleType;
  productions?: Production[];
}

export default function RoleContactsTab({ roleType, productions = [] }: RoleContactsTabProps) {
  const [contacts, setContacts] = useState<CrewRoleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<FreelancerCallPriority | ''>('');
  const [productionFilter, setProductionFilter] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [editor, setEditor] = useState<{ contact: CrewRoleContact | null } | null>(null);
  const [documentContact, setDocumentContact] = useState<CrewRoleContact | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const cfg = ROLE_CONFIG[roleType] || { label: roleType.toUpperCase(), fullTitle: roleType, singular: 'Contact' };

  useEffect(() => {
    let active = true;
    setLoading(true);
    crewRoleContactsApi
      .list({ role_type: roleType })
      .then(data => {
        if (active) setContacts(data);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : `Unable to load ${cfg.fullTitle} contacts.`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleType, reloadKey, cfg.fullTitle]);

  const query = search.trim().toLowerCase();
  const visible = contacts.filter(contact => {
    if (favouritesOnly && !contact.is_favourite) return false;
    if (priorityFilter && contact.call_priority !== priorityFilter) return false;
    if (productionFilter && !contact.company_or_production?.toLowerCase().includes(productionFilter.toLowerCase())) return false;
    if (query) {
      const match = [
        contact.full_name,
        contact.email,
        contact.phone,
        contact.company_or_production,
        contact.notes,
      ].some(v => v?.toLowerCase().includes(query));
      if (!match) return false;
    }
    return true;
  }).sort((a, b) => Number(b.is_favourite) - Number(a.is_favourite) || a.full_name.localeCompare(b.full_name));

  async function updateContact(contact: CrewRoleContact, changes: Partial<CrewRoleContactInput>) {
    setBusyId(contact.id);
    setError('');
    try {
      const updated = await crewRoleContactsApi.update(contact.id, changes);
      setContacts(curr => curr.map(item => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update contact.');
    } finally {
      setBusyId(null);
    }
  }

  async function removeContact(contact: CrewRoleContact) {
    if (!window.confirm(`Delete ${contact.full_name} from ${cfg.label}? This cannot be undone.`)) return;
    setBusyId(contact.id);
    setError('');
    try {
      await crewRoleContactsApi.delete(contact.id);
      setContacts(curr => curr.filter(item => item.id !== contact.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete contact.');
    } finally {
      setBusyId(null);
    }
  }

  async function saveContact(input: CrewRoleContactInput) {
    if (editor?.contact) {
      const saved = await crewRoleContactsApi.update(editor.contact.id, input);
      setContacts(curr => curr.map(item => (item.id === saved.id ? saved : item)));
    } else {
      const saved = await crewRoleContactsApi.create(input);
      setContacts(curr => [...curr, saved]);
    }
    setEditor(null);
  }

  const firstCallCount = contacts.filter(c => c.call_priority === 'first_call').length;
  const backupCount = contacts.filter(c => c.call_priority === 'backup').length;

  return (
    <section aria-label={cfg.fullTitle}>
      {/* Sub-tab Toolbar */}
      <div className="flex flex-col gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800 tracking-tight flex items-center gap-1.5">
              <span>{cfg.label}</span>
              <span className="text-xs font-normal text-slate-500">({cfg.fullTitle})</span>
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              {contacts.length} {contacts.length === 1 ? 'Contact' : 'Contacts'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setEditor({ contact: null })}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Plus size={14} />
              <span>Add {cfg.singular}</span>
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          <div className="flex items-center gap-2 flex-1 max-w-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              aria-label={`Search ${cfg.label}`}
              placeholder={`Search ${cfg.singular.toLowerCase()} by name, email, production...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by call priority"
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value as FreelancerCallPriority | '')}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
            >
              <option value="">All call priorities</option>
              {PRIORITIES.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            {productions.length > 0 && (
              <select
                aria-label="Filter by production"
                value={productionFilter}
                onChange={e => setProductionFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
              >
                <option value="">All productions</option>
                {productions.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            )}

            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer select-none bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg shadow-sm">
              <input
                type="checkbox"
                checked={favouritesOnly}
                onChange={e => setFavouritesOnly(e.target.checked)}
                className="rounded text-amber-500 focus:ring-amber-400 h-3.5 w-3.5"
              />
              <Star size={13} className="text-amber-500" />
              <span>Favourites</span>
            </label>

            {(search || priorityFilter || productionFilter || favouritesOnly) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPriorityFilter('');
                  setProductionFilter('');
                  setFavouritesOnly(false);
                }}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium px-1.5"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between px-5 py-3 bg-red-50 text-xs text-red-700 border-b border-red-100">
          <span>{error}</span>
          <button
            disabled={Boolean(busyId)}
            onClick={() => {
              setError('');
              setReloadKey(k => k + 1);
            }}
            className="underline font-medium hover:text-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[950px] text-xs">
          <thead className="bg-slate-50 text-left text-slate-500 border-b border-slate-100 font-semibold">
            <tr>
              <th scope="col" className="w-12 px-4 py-3">Fav</th>
              <th scope="col" className="px-4 py-3">{cfg.singular}</th>
              <th scope="col" className="px-4 py-3">Production / Company</th>
              <th scope="col" className="px-4 py-3">Contact Details</th>
              <th scope="col" className="px-4 py-3">Notes</th>
              <th scope="col" className="px-4 py-3">Call Priority</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin text-blue-600" />
                    <span className="text-xs">Loading {cfg.label.toLowerCase()} contacts...</span>
                  </div>
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <Clapperboard size={26} className="text-slate-300 mb-1" />
                    <p className="text-sm font-medium text-slate-700">
                      {contacts.length ? `No ${cfg.label} contacts match your filters.` : `No ${cfg.fullTitle} contacts added yet.`}
                    </p>
                    <p className="text-xs text-slate-400">
                      {contacts.length
                        ? 'Try clearing the search or filters to see all contacts.'
                        : `Click "+ Add ${cfg.singular}" above to record contact info, phone, and deal notes.`}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              visible.map(contact => {
                const neverCall = contact.call_priority === 'never_call';
                const disabled = Boolean(busyId);
                const PriorityIcon = PRIORITIES.find(p => p.value === contact.call_priority)!.icon;

                return (
                  <tr
                    key={contact.id}
                    className={`transition-colors ${
                      neverCall
                        ? 'bg-red-50/20 hover:bg-red-50/40'
                        : contact.is_favourite
                        ? 'bg-amber-50/20 hover:bg-amber-50/40'
                        : 'hover:bg-slate-50/60'
                    }`}
                  >
                    {/* Favourite */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        title={contact.is_favourite ? 'Remove favourite' : 'Add favourite'}
                        disabled={disabled}
                        onClick={() => updateContact(contact, { is_favourite: !contact.is_favourite })}
                        className="p-1 rounded hover:bg-amber-100/50 transition-colors disabled:opacity-50"
                      >
                        <Star
                          size={15}
                          className={contact.is_favourite ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-slate-400'}
                        />
                      </button>
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3 min-w-44 max-w-64">
                      <p className="font-semibold text-slate-900">{contact.full_name}</p>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wider">{cfg.singular}</p>
                    </td>

                    {/* Production / Company */}
                    <td className="px-4 py-3 min-w-36 max-w-56">
                      {contact.company_or_production ? (
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Building2 size={13} className="text-slate-400 flex-shrink-0" />
                          <span className="font-medium truncate">{contact.company_or_production}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Contact (Email + Phone) */}
                    <td className="px-4 py-3 min-w-44 max-w-64 space-y-0.5">
                      {contact.email ? (
                        <p className="text-slate-700 truncate" title={contact.email}>{contact.email}</p>
                      ) : (
                        <p className="text-slate-400 text-[11px]">No email</p>
                      )}
                      {contact.phone ? (
                        <p className="text-slate-600 font-mono text-[11px]">{contact.phone}</p>
                      ) : (
                        <p className="text-slate-400 text-[11px]">No phone</p>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-3 min-w-44 max-w-64">
                      <p className="text-slate-600 whitespace-pre-wrap line-clamp-2 text-[11px]" title={contact.notes || ''}>
                        {contact.notes || '—'}
                      </p>
                    </td>

                    {/* Call Priority */}
                    <td className="px-4 py-3">
                      <CallPriority
                        value={contact.call_priority}
                        disabled={disabled}
                        onChange={call_priority => updateContact(contact, { call_priority })}
                      />
                      <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-400">
                        <PriorityIcon size={11} className={neverCall ? 'text-red-600' : 'text-slate-400'} />
                        <span className={neverCall ? 'text-red-600 font-medium' : ''}>
                          {neverCall ? 'Do not call' : 'Enabled'}
                        </span>
                        {busyId === contact.id && <Loader2 size={11} className="animate-spin text-blue-500 ml-1" />}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Attached Documents"
                          disabled={disabled}
                          onClick={() => setDocumentContact(contact)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          <FileText size={15} />
                        </button>

                        {contact.phone && !neverCall ? (
                          <a
                            href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
                            title={`Call ${contact.full_name}`}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                          >
                            <Phone size={15} />
                          </a>
                        ) : (
                          <button type="button" disabled title="No phone or contact disabled" className="p-1.5 text-slate-300">
                            <Phone size={15} />
                          </button>
                        )}

                        {contact.email && !neverCall ? (
                          <a
                            href={`mailto:${encodeURIComponent(contact.email)}`}
                            title={`Email ${contact.full_name}`}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          >
                            <Mail size={15} />
                          </a>
                        ) : (
                          <button type="button" disabled title="No email or contact disabled" className="p-1.5 text-slate-300">
                            <Mail size={15} />
                          </button>
                        )}

                        <button
                          type="button"
                          title={`Edit ${cfg.singular}`}
                          disabled={disabled}
                          onClick={() => setEditor({ contact })}
                          className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Pencil size={15} />
                        </button>

                        <button
                          type="button"
                          title={`Delete ${cfg.singular}`}
                          disabled={disabled}
                          onClick={() => removeContact(contact)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 size={15} />
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

      {/* Footer stats */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500 bg-slate-50/30">
        <div>
          Showing {visible.length} of {contacts.length} {cfg.label.toLowerCase()} contact{contacts.length === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> First call: {firstCallCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Backup: {backupCount}
          </span>
        </div>
      </div>

      {/* Editor Modal */}
      {editor && (
        <ContactEditor
          contact={editor.contact}
          roleType={roleType}
          productions={productions}
          onClose={() => setEditor(null)}
          onSave={saveContact}
        />
      )}

      {/* Documents Modal */}
      {documentContact && (
        <AttachedDocuments
          owner="role_contacts"
          ownerId={documentContact.id}
          name={documentContact.full_name}
          onClose={() => setDocumentContact(null)}
        />
      )}
    </section>
  );
}
