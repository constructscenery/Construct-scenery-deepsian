import React, { useState, useEffect } from 'react';
import { Monitor, Plus, Pencil, Trash2, Search, Key, X, AlertCircle, Eye, Copy, Check } from 'lucide-react';
import { itResourcesApi, ITResource } from '@/lib/api';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtCurrency = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0);

const IT_RESOURCE_TYPES = [
  'Software / SaaS',
  'Cloud Subscription',
  'Hardware & Computers',
  'Domain & Hosting',
  'Network / Telecom',
  'Security & Antivirus',
  'Other'
];

export default function ITResourcesTab({ isCoordinatorOrMD }: { isCoordinatorOrMD: boolean }) {
  const [resources, setResources] = useState<ITResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingResource, setEditingResource] = useState<ITResource | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ITResource | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Credentials viewer modal
  const [credentialsModal, setCredentialsModal] = useState<{ name: string; creds: string } | null>(null);
  const [loadingCreds, setLoadingCreds] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [type, setType] = useState('Software / SaaS');
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState('');
  const [subscriptionStart, setSubscriptionStart] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [credentialsInput, setCredentialsInput] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual' | 'one_time' | 'free'>('annual');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDays, setReminderDays] = useState('30');
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await itResourcesApi.getAll();
      setResources(res.it_resources || []);
    } catch (err) {
      console.error('Failed to load IT resources', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingResource(null);
    setName('');
    setType('Software / SaaS');
    setVendor('');
    setCost('');
    setSubscriptionStart('');
    setRenewalDate('');
    setCredentialsInput('');
    setUsername(''); setEmail(''); setPassword(''); setBillingCycle('annual'); setReminderEnabled(true); setReminderDays('30');
    setNotes('');
    setShowModal(true);
  };

  const openEditModal = (r: ITResource) => {
    setEditingResource(r);
    setName(r.name || '');
    setType(r.type || 'Software / SaaS');
    setVendor(r.vendor || '');
    setCost(r.cost ? String(r.cost) : '');
    setSubscriptionStart(r.subscription_start ? r.subscription_start.split('T')[0] : '');
    setRenewalDate(r.renewal_date ? r.renewal_date.split('T')[0] : '');
    setCredentialsInput(''); // Keep blank unless user wants to change
    setUsername(''); setEmail(''); setPassword(''); setBillingCycle(r.billing_cycle || 'annual'); setReminderEnabled(r.reminder_enabled !== false); setReminderDays(String(r.reminder_days || 30));
    setNotes(r.notes || '');
    setShowModal(true);
  };

  const handleViewCredentials = async (r: ITResource) => {
    setLoadingCreds(r.id);
    try {
      const res = await itResourcesApi.getCredentials(r.id);
      let displayedCredentials = res.credentials || 'No credentials stored for this resource.';
      try {
        const parsed = JSON.parse(displayedCredentials);
        displayedCredentials = Object.entries(parsed).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join('\n');
      } catch { /* legacy free-text credentials */ }
      setCredentialsModal({
        name: r.name,
        creds: displayedCredentials,
      });
      setCopied(false);
    } catch (err) {
      alert('Failed to retrieve credentials or unauthorized.');
    } finally {
      setLoadingCreds(null);
    }
  };

  const handleCopyCredentials = () => {
    if (!credentialsModal?.creds) return;
    navigator.clipboard.writeText(credentialsModal.creds);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const payload: Partial<ITResource> = {
        name: name.trim(),
        type: type || null,
        vendor: vendor.trim() || null,
        cost: cost ? parseFloat(cost) : null,
        billing_cycle: billingCycle,
        reminder_enabled: billingCycle !== 'free' && reminderEnabled,
        reminder_days: parseInt(reminderDays, 10) || 30,
        subscription_start: subscriptionStart || null,
        renewal_date: renewalDate || null,
        notes: notes.trim() || null,
      };

      if (credentialsInput.trim()) {
        payload.credentials = JSON.stringify({ username: username.trim(), email: email.trim(), password: password.trim(), notes: credentialsInput.trim() });
      }

      if (editingResource) {
        await itResourcesApi.update(editingResource.id, payload);
      } else {
        await itResourcesApi.create(payload);
      }

      setShowModal(false);
      await loadData();
    } catch (err) {
      console.error('Error saving IT resource:', err);
      alert('Failed to save IT resource. Please check your permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await itResourcesApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error('Error deleting IT resource:', err);
      alert('Failed to delete IT resource.');
    } finally {
      setDeleting(false);
    }
  };

  const filteredResources = resources.filter(r => 
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || 
    r.vendor?.toLowerCase().includes(search.toLowerCase()) ||
    r.type?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search software, hardware, vendors, subscriptions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {isCoordinatorOrMD && (
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
          >
            <Plus size={15} />
            <span>Add IT Resource</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5">Name & Type</th>
                <th className="px-4 py-3.5">Vendor</th>
                <th className="px-4 py-3.5">Cost</th>
                <th className="px-4 py-3.5">Billing</th>
                <th className="px-4 py-3.5">Renewal Date</th>
                <th className="px-4 py-3.5 text-center">Credentials</th>
                {isCoordinatorOrMD && <th className="px-4 py-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    Loading IT resources...
                  </td>
                </tr>
              ) : filteredResources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <Monitor size={28} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-700 text-sm">No IT resources found</p>
                    {isCoordinatorOrMD && (
                      <button
                        onClick={openCreateModal}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        <Plus size={13} />
                        Add the first IT resource
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredResources.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 text-sm">{r.name}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {r.type || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {r.vendor || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">
                      {fmtCurrency(r.cost)}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <div>{r.billing_cycle === 'free' ? 'Free' : r.billing_cycle === 'monthly' ? 'Monthly' : r.billing_cycle === 'one_time' ? 'One-time' : 'Annual'}</div>
                      {r.billing_cycle !== 'free' && r.reminder_enabled && <div className="text-[11px] text-slate-400">Email {r.reminder_days}d before</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {fmtDate(r.renewal_date)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleViewCredentials(r)}
                        disabled={loadingCreds === r.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-slate-200"
                        title="View credentials"
                      >
                        <Key size={12} className="text-amber-500" />
                        <span>{loadingCreds === r.id ? 'Loading...' : 'View'}</span>
                      </button>
                    </td>
                    {isCoordinatorOrMD && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(r)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit IT resource"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(r)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete IT resource"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit IT Resource Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Monitor className="text-blue-600" size={20} />
                  <span>{editingResource ? 'Edit IT Resource Record' : 'Register New IT Resource'}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Record software subscriptions, hardware licenses, and encrypted credentials
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-slate-700 font-semibold mb-1">Resource Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. AutoCAD Architecture / Google Workspace / Slack Pro"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Resource Type</label>
                  <select
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {IT_RESOURCE_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Vendor / Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. Autodesk, Microsoft, Google, AWS"
                    value={vendor}
                    onChange={e => setVendor(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Renewal / Expiry Date</label>
                  <input
                    type="date"
                    value={renewalDate}
                    onChange={e => setRenewalDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Annual / Monthly Cost (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={cost}
                    onChange={e => setCost(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Billing Cycle</label>
                  <select value={billingCycle} onChange={e => setBillingCycle(e.target.value as typeof billingCycle)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <option value="monthly">Monthly subscription</option>
                    <option value="annual">Annual subscription</option>
                    <option value="one_time">One-time purchase</option>
                    <option value="free">Free / no fee</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Reminder</label>
                  <div className="flex gap-2">
                    <input type="number" min="1" disabled={billingCycle === 'free'} value={reminderDays} onChange={e => setReminderDays(e.target.value)} className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    <label className="flex items-center gap-2"><input type="checkbox" checked={billingCycle !== 'free' && reminderEnabled} disabled={billingCycle === 'free'} onChange={e => setReminderEnabled(e.target.checked)} /> Email before renewal</label>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Login Details (encrypted)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                  <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                  <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                </div>
                <textarea
                  rows={2}
                  placeholder={editingResource ? "Leave blank to keep existing credentials, or add license/login notes..." : "License key or login notes..."}
                  value={credentialsInput}
                  onChange={e => setCredentialsInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Number of seats, account manager details, renewal conditions..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingResource ? 'Update IT Resource' : 'Create IT Resource'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Credentials Modal */}
      {credentialsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Key className="text-amber-500" size={16} />
                <span>Credentials: {credentialsModal.name}</span>
              </h4>
              <button
                onClick={() => setCredentialsModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-xs whitespace-pre-wrap break-all select-all mb-4 border border-slate-800">
              {credentialsModal.creds}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCopyCredentials}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
              </button>
              <button
                onClick={() => setCredentialsModal(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-100 text-center">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <AlertCircle size={22} />
            </div>
            <h4 className="text-sm font-bold text-slate-900 mb-1">Delete IT Resource?</h4>
            <p className="text-xs text-slate-500 mb-4">
              Are you sure you want to delete <span className="font-semibold text-slate-800">{deleteTarget.name}</span>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
