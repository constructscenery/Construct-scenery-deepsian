'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mail, Pencil, Phone, PhoneCall, PhoneOff, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { freelancersApi, type FreelancerCallPriority, type FreelancerContact, type FreelancerInput } from '@/lib/api';

const PRIORITIES = [
  { value: 'first_call', label: 'First call', icon: PhoneCall, colour: 'border-emerald-600 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
  { value: 'backup', label: 'Backup', icon: Phone, colour: 'border-amber-500 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  { value: 'never_call', label: 'Never call', icon: PhoneOff, colour: 'border-red-600 bg-red-50 text-red-800', dot: 'bg-red-600' },
] as const;

function CallPriority({ value, onChange, disabled = false }: { value: FreelancerCallPriority; onChange: (value: FreelancerCallPriority) => void; disabled?: boolean }) {
  return <div role="group" aria-label="Call priority" className="grid grid-cols-3 gap-1 w-[282px] max-w-full">
    {PRIORITIES.map(priority => <button key={priority.value} type="button" aria-pressed={value === priority.value} disabled={disabled} onClick={() => onChange(priority.value)} title={priority.label} className={`flex min-h-10 items-center justify-center gap-1 border rounded text-xs font-medium disabled:opacity-50 ${value === priority.value ? priority.colour : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${priority.dot}`} aria-hidden="true" />{priority.label}
    </button>)}
  </div>;
}

function ContactEditor({ contact, onClose, onSave }: { contact: FreelancerContact | null; onClose: () => void; onSave: (input: FreelancerInput) => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<FreelancerInput>({
    full_name: contact?.full_name || '', email: contact?.email || '', phone: contact?.phone || '',
    skills: contact?.skills || '', notes: contact?.notes || '', is_favourite: contact?.is_favourite || false,
    call_priority: contact?.call_priority || 'backup',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.full_name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, full_name: form.full_name.trim(), email: form.email?.trim() || null, phone: form.phone?.trim() || null, skills: form.skills?.trim() || null, notes: form.notes?.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save freelancer.');
      setSaving(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500';
  return <dialog ref={dialogRef} aria-labelledby="freelancer-editor-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl backdrop:bg-black/40">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 id="freelancer-editor-title" className="font-semibold text-slate-900">{contact ? 'Edit freelancer' : 'Add freelancer'}</h2>
      <button type="button" onClick={onClose} disabled={saving} title="Close" aria-label="Close freelancer form" className="p-2 text-slate-500 disabled:opacity-50"><X size={18} /></button>
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
        <label className="block text-xs font-medium text-slate-600">Name *<input autoFocus required maxLength={200} autoComplete="name" value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} className={inputClass} /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-xs font-medium text-slate-600">Email<input type="email" maxLength={254} autoComplete="email" value={form.email || ''} onChange={event => setForm({ ...form, email: event.target.value })} className={inputClass} /></label>
          <label className="block text-xs font-medium text-slate-600">Phone<input type="tel" maxLength={80} autoComplete="tel" value={form.phone || ''} onChange={event => setForm({ ...form, phone: event.target.value })} className={inputClass} /></label>
        </div>
        <label className="block text-xs font-medium text-slate-600">Trade / skills<input maxLength={500} value={form.skills || ''} onChange={event => setForm({ ...form, skills: event.target.value })} className={inputClass} /></label>
        <label className="block text-xs font-medium text-slate-600">Notes<textarea rows={4} maxLength={10000} value={form.notes || ''} onChange={event => setForm({ ...form, notes: event.target.value })} className={`${inputClass} resize-y`} /></label>
        <div><p className="text-xs font-medium text-slate-600 mb-2">Call priority</p><CallPriority value={form.call_priority} onChange={call_priority => setForm({ ...form, call_priority })} disabled={saving} /></div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.is_favourite} onChange={event => setForm({ ...form, is_favourite: event.target.checked })} /><Star size={15} className="text-amber-600" /> Favourite</label>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
          <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">{saving && <Loader2 size={15} className="animate-spin" />}{saving ? 'Saving...' : 'Save freelancer'}</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}

export default function FreelancersTab() {
  const [contacts, setContacts] = useState<FreelancerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<FreelancerCallPriority | ''>('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [editor, setEditor] = useState<{ contact: FreelancerContact | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    freelancersApi.list().then(data => { if (active) setContacts(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load freelancers.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const query = search.trim().toLowerCase();
  const visible = contacts.filter(contact => (!favouritesOnly || contact.is_favourite)
    && (!priorityFilter || contact.call_priority === priorityFilter)
    && (!query || [contact.full_name, contact.email, contact.phone, contact.skills, contact.notes].some(value => value?.toLowerCase().includes(query))))
    .sort((left, right) => Number(right.is_favourite) - Number(left.is_favourite) || left.full_name.localeCompare(right.full_name));

  async function updateContact(contact: FreelancerContact, changes: Partial<FreelancerInput>) {
    setBusyId(contact.id);
    setError('');
    try {
      const updated = await freelancersApi.update(contact.id, changes);
      setContacts(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update freelancer.'); }
    finally { setBusyId(null); }
  }

  async function removeContact(contact: FreelancerContact) {
    if (!window.confirm(`Delete ${contact.full_name} from Freelancers? This cannot be undone.`)) return;
    setBusyId(contact.id);
    setError('');
    try {
      await freelancersApi.delete(contact.id);
      setContacts(current => current.filter(item => item.id !== contact.id));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to delete freelancer.'); }
    finally { setBusyId(null); }
  }

  async function saveContact(input: FreelancerInput) {
    const saved = editor?.contact ? await freelancersApi.update(editor.contact.id, input) : await freelancersApi.create(input);
    setContacts(current => editor?.contact ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]);
    setEditor(null);
  }

  return <section aria-label="Freelancers">
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between border-b border-slate-100">
      <div className="flex items-center gap-2 min-w-0 rounded-lg bg-slate-100 px-3 py-2 sm:w-64"><Search size={15} className="flex-shrink-0 text-slate-400" /><input aria-label="Search freelancers" placeholder="Search freelancers..." value={search} onChange={event => setSearch(event.target.value)} className="w-full min-w-0 bg-transparent text-sm outline-none" /></div>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Filter by call priority" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as FreelancerCallPriority | '')} className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-700"><option value="">All call priorities</option>{PRIORITIES.map(priority => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={favouritesOnly} onChange={event => setFavouritesOnly(event.target.checked)} /> Favourites only</label>
        <button type="button" disabled={Boolean(busyId)} onClick={() => setEditor({ contact: null })} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Plus size={15} /> Add freelancer</button>
      </div>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 px-5 py-3 bg-red-50 text-sm text-red-700"><span>{error}</span><button disabled={Boolean(busyId)} onClick={() => { setError(''); setLoading(true); setReloadKey(current => current + 1); }} className="underline">Retry</button></div>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>{['Favourite', 'Freelancer', 'Contact', 'Notes', 'Call priority', 'Actions'].map(label => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? <tr><td colSpan={6} className="py-10 text-center text-slate-400" role="status">Loading freelancers...</td></tr> : visible.length === 0 ? <tr><td colSpan={6} className="py-10 text-center text-slate-400">{contacts.length ? 'No freelancers match these filters.' : 'No freelancers added yet.'}</td></tr> : visible.map(contact => {
            const neverCall = contact.call_priority === 'never_call';
            const disabled = Boolean(busyId);
            const PriorityIcon = PRIORITIES.find(priority => priority.value === contact.call_priority)!.icon;
            return <tr key={contact.id} className={neverCall ? 'bg-red-50/30' : 'hover:bg-slate-50/50'}>
              <td className="px-4 py-4"><button type="button" aria-label={`${contact.is_favourite ? 'Remove' : 'Add'} ${contact.full_name} ${contact.is_favourite ? 'from' : 'to'} favourites`} title={contact.is_favourite ? 'Remove favourite' : 'Add favourite'} aria-pressed={contact.is_favourite} disabled={disabled} onClick={() => updateContact(contact, { is_favourite: !contact.is_favourite })} className="flex h-9 w-9 items-center justify-center rounded hover:bg-amber-50 disabled:opacity-50"><Star size={18} className={contact.is_favourite ? 'fill-amber-400 text-amber-600' : 'text-slate-400'} /></button></td>
              <td className="px-4 py-4 min-w-44 max-w-64"><p className="font-medium text-slate-800 break-words">{contact.full_name}</p><p className="mt-1 text-xs text-slate-500 break-words">{contact.skills || 'No trade specified'}</p></td>
              <td className="px-4 py-4 max-w-64"><p className="text-slate-700 break-words">{contact.email || 'No email'}</p><p className="mt-1 text-xs text-slate-500 break-words">{contact.phone || 'No phone'}</p></td>
              <td className="px-4 py-4 min-w-44 max-w-72"><p className="whitespace-pre-wrap break-words text-xs text-slate-600">{contact.notes || '-'}</p></td>
              <td className="px-4 py-4"><CallPriority value={contact.call_priority} disabled={disabled} onChange={call_priority => updateContact(contact, { call_priority })} /><p className={`flex items-center gap-1 mt-2 text-xs ${neverCall ? 'text-red-700' : 'text-slate-500'}`}><PriorityIcon size={12} />{neverCall ? 'Contact disabled' : 'Contact enabled'}{busyId === contact.id && <Loader2 size={12} className="animate-spin" />}</p></td>
              <td className="px-4 py-4"><div className="flex items-center gap-1">
                {neverCall || !contact.phone ? <button type="button" disabled title={neverCall ? 'Never call: calling disabled' : 'No phone number'} aria-label={`Call ${contact.full_name}`} className="p-2 text-slate-300"><Phone size={16} /></button> : <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} title={`Call ${contact.full_name}`} aria-label={`Call ${contact.full_name}`} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Phone size={16} /></a>}
                {neverCall || !contact.email ? <button type="button" disabled title={neverCall ? 'Never call: email disabled' : 'No email address'} aria-label={`Email ${contact.full_name}`} className="p-2 text-slate-300"><Mail size={16} /></button> : <a href={`mailto:${encodeURIComponent(contact.email)}`} title={`Email ${contact.full_name}`} aria-label={`Email ${contact.full_name}`} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Mail size={16} /></a>}
                <button type="button" title="Edit freelancer" aria-label={`Edit ${contact.full_name}`} disabled={disabled} onClick={() => setEditor({ contact })} className="p-2 text-slate-500 hover:bg-slate-100 rounded disabled:opacity-50"><Pencil size={16} /></button>
                <button type="button" title="Delete freelancer" aria-label={`Delete ${contact.full_name}`} disabled={disabled} onClick={() => removeContact(contact)} className="p-2 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"><Trash2 size={16} /></button>
              </div></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <p className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500">{visible.length} freelancer{visible.length === 1 ? '' : 's'}</p>
    {editor && <ContactEditor contact={editor.contact} onClose={() => setEditor(null)} onSave={saveContact} />}
  </section>;
}