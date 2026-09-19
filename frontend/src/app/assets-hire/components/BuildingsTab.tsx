import React, { useState, useEffect } from 'react';
import { Building2, Plus, Pencil, Trash2, MapPin, Search, X, Calendar, Key, User, FileText, AlertCircle } from 'lucide-react';
import { buildingsApi, Building } from '@/lib/api';
import AttachedDocuments from '@/components/AttachedDocuments';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function BuildingsTab({ isCoordinatorOrMD }: { isCoordinatorOrMD: boolean }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [documentBuilding, setDocumentBuilding] = useState<Building | null>(null);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Building | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [ownershipStatus, setOwnershipStatus] = useState<'owned' | 'leased'>('leased');
  const [leaseExpiry, setLeaseExpiry] = useState('');
  const [landlordContact, setLandlordContact] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [notes, setNotes] = useState('');
  const [utilities, setUtilities] = useState([{ provider: '', accountNumber: '', cost: '', renewalDate: '' }]);
  const [insurancePolicies, setInsurancePolicies] = useState([{ type: '', provider: '', policyNumber: '', coverage: '', expiryDate: '' }]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await buildingsApi.getAll();
      setBuildings(res.buildings || []);
    } catch (err) {
      console.error('Failed to load buildings', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingBuilding(null);
    setName('');
    setAddress('');
    setOwnershipStatus('leased');
    setLeaseExpiry('');
    setLandlordContact('');
    setAccessCode('');
    setNotes('');
    setUtilities([{ provider: '', accountNumber: '', cost: '', renewalDate: '' }]);
    setInsurancePolicies([{ type: '', provider: '', policyNumber: '', coverage: '', expiryDate: '' }]);
    setShowModal(true);
  };

  const openEditModal = (b: Building) => {
    setEditingBuilding(b);
    setName(b.name || '');
    setAddress(b.address || '');
    setOwnershipStatus((b.ownership_status as 'owned' | 'leased') || 'leased');
    setLeaseExpiry(b.lease_expiry ? b.lease_expiry.split('T')[0] : '');
    setLandlordContact(b.landlord_contact || '');
    setAccessCode(b.access_code || '');
    setNotes(b.notes || '');
    setUtilities(Array.isArray(b.utilities) && b.utilities.length ? b.utilities : [{ provider: '', accountNumber: '', cost: '', renewalDate: '' }]);
    setInsurancePolicies(Array.isArray(b.insurance_policies) && b.insurance_policies.length ? b.insurance_policies : [{ type: '', provider: '', policyNumber: '', coverage: '', expiryDate: '' }]);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const payload: Partial<Building> = {
        name: name.trim(),
        address: address.trim() || null,
        ownership_status: ownershipStatus,
        lease_expiry: ownershipStatus === 'leased' && leaseExpiry ? leaseExpiry : null,
        landlord_contact: landlordContact.trim() || null,
        access_code: accessCode.trim() || null,
        utilities: utilities.filter(u => u.provider || u.accountNumber || u.cost || u.renewalDate),
        insurance_policies: insurancePolicies.filter(p => p.type || p.provider || p.policyNumber || p.coverage || p.expiryDate),
        notes: notes.trim() || null,
      };

      if (editingBuilding) {
        await buildingsApi.update(editingBuilding.id, payload);
      } else {
        await buildingsApi.create(payload);
      }

      setShowModal(false);
      await loadData();
    } catch (err) {
      console.error('Error saving building:', err);
      alert('Failed to save building. Please check your permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await buildingsApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error('Error deleting building:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete building.');
    } finally {
      setDeleting(false);
    }
  };

  const filteredBuildings = buildings.filter(b => 
    !search || b.name.toLowerCase().includes(search.toLowerCase()) || 
    b.address?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search buildings by name or address..."
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
            <span>Add Building</span>
          </button>
        )}
      </div>

      {/* Buildings Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5">Property Name & Address</th>
                <th className="px-4 py-3.5">Ownership Status</th>
                <th className="px-4 py-3.5">Lease Expiry</th>
                <th className="px-4 py-3.5">Key Contact / Landlord</th>
                <th className="px-4 py-3.5">Access Codes</th>
                <th className="px-4 py-3.5">Documents</th>
                {isCoordinatorOrMD && <th className="px-4 py-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    Loading buildings...
                  </td>
                </tr>
              ) : filteredBuildings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <Building2 size={28} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-700 text-sm">No buildings found</p>
                    {isCoordinatorOrMD && (
                      <button
                        onClick={openCreateModal}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        <Plus size={13} />
                        Add the first property
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredBuildings.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 text-sm">{b.name}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
                        <MapPin size={10} />
                        {b.address || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${b.ownership_status === 'owned' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                        {b.ownership_status === 'owned' ? 'Owned' : 'Leased'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {b.ownership_status === 'owned' ? <span className="text-slate-400">N/A (Owned)</span> : fmtDate(b.lease_expiry)}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {b.landlord_contact || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {b.access_code || '—'}
                    </td>
                    <td className="px-4 py-3"><button type="button" onClick={() => setDocumentBuilding(b)} className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800"><FileText size={15} /> Documents</button></td>
                    {isCoordinatorOrMD && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(b)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit building"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(b)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete building"
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

      {/* Add / Edit Building Modal */}
      {documentBuilding && <AttachedDocuments owner="buildings" ownerId={documentBuilding.id} name={documentBuilding.name} onClose={() => setDocumentBuilding(null)} />}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="text-blue-600" size={20} />
                  <span>{editingBuilding ? 'Edit Building Record' : 'Register New Property'}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Record property details, lease information, and emergency contacts
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
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Property / Building Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Construct Scenery Main Workshop / Unit 4"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Address</label>
                <input
                  type="text"
                  placeholder="e.g. Unit 4, Riverside Industrial Park, London E16"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Ownership Status *</label>
                  <select
                    value={ownershipStatus}
                    onChange={e => setOwnershipStatus(e.target.value as 'owned' | 'leased')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="leased">Leased</option>
                    <option value="owned">Owned</option>
                  </select>
                </div>

                {ownershipStatus === 'leased' && (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Lease Expiry Date</label>
                    <input
                      type="date"
                      value={leaseExpiry}
                      onChange={e => setLeaseExpiry(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Landlord / Key Contact</label>
                  <input
                    type="text"
                    placeholder="e.g. John Smith (07700 900123)"
                    value={landlordContact}
                    onChange={e => setLandlordContact(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Access Codes / Keybox</label>
                  <input
                    type="text"
                    placeholder="e.g. Gate: 4592, Alarm: 1024"
                    value={accessCode}
                    onChange={e => setAccessCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-slate-700 font-semibold">Utility Accounts</label>
                  <button type="button" onClick={() => setUtilities([...utilities, { provider: '', accountNumber: '', cost: '', renewalDate: '' }])} className="text-blue-600 font-semibold">+ Add utility</button>
                </div>
                {utilities.map((utility, index) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    {(['provider', 'accountNumber', 'cost', 'renewalDate'] as const).map(field => (
                      <input key={field} type={field === 'cost' ? 'number' : field === 'renewalDate' ? 'date' : 'text'} placeholder={field === 'accountNumber' ? 'Account number' : field === 'renewalDate' ? 'Renewal date' : field === 'cost' ? 'Cost' : 'Provider'} value={utility[field]} onChange={e => setUtilities(utilities.map((u, i) => i === index ? { ...u, [field]: e.target.value } : u))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    ))}
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-slate-700 font-semibold">Insurance Policies</label>
                  <button type="button" onClick={() => setInsurancePolicies([...insurancePolicies, { type: '', provider: '', policyNumber: '', coverage: '', expiryDate: '' }])} className="text-blue-600 font-semibold">+ Add policy</button>
                </div>
                {insurancePolicies.map((policy, index) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(['type', 'provider', 'policyNumber', 'coverage', 'expiryDate'] as const).map(field => (
                      <input key={field} type={field === 'expiryDate' ? 'date' : 'text'} placeholder={field === 'policyNumber' ? 'Policy number' : field === 'expiryDate' ? 'Expiry date' : field[0].toUpperCase() + field.slice(1)} value={policy[field]} onChange={e => setInsurancePolicies(insurancePolicies.map((p, i) => i === index ? { ...p, [field]: e.target.value } : p))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                    ))}
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">Active policies are checked daily and emailed when their expiry is within the configured reminder window.</p>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Property Notes & Details</label>
                <textarea
                  rows={2}
                  placeholder="Additional access instructions, parking rules, insurance policies..."
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
                  {saving ? 'Saving...' : editingBuilding ? 'Update Building' : 'Create Building'}
                </button>
              </div>
            </form>
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
            <h4 className="text-sm font-bold text-slate-900 mb-1">Delete Building?</h4>
            <p className="text-xs text-slate-500 mb-4">
              Are you sure you want to remove <span className="font-semibold text-slate-800">{deleteTarget.name}</span>? This action cannot be undone.
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
