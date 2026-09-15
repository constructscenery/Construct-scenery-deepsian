import React, { useState, useEffect } from 'react';
import { Package, Plus, Pencil, Trash2, Search, X, AlertCircle } from 'lucide-react';
import { assetsPlantApi, Asset, Production } from '@/lib/api';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtCurrency = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0);

const ASSET_CATEGORIES = [
  'Tools',
  'Equipment',
  'Machinery',
  'Laptops & Computers',
  'IT & Peripherals',
  'Workshop Plant',
  'Vehicles',
  'Other'
];

const ASSET_CONDITIONS = [
  'Excellent',
  'Good',
  'Fair',
  'Poor',
  'Damaged / Maintenance Required'
];

export default function AssetsPlantTab({ isCoordinatorOrMD, productions }: { isCoordinatorOrMD: boolean; productions: Production[] }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Tools');
  const [description, setDescription] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [cost, setCost] = useState('');
  const [condition, setCondition] = useState('Good');
  const [assignedTo, setAssignedTo] = useState('');
  const [nextMaintenanceDate, setNextMaintenanceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [assignmentType, setAssignmentType] = useState<'production' | 'location'>('location');
  const [depreciationYears, setDepreciationYears] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await assetsPlantApi.getAll();
      setAssets(res.assets || []);
    } catch (err) {
      console.error('Failed to load assets', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingAsset(null);
    setName('');
    setCategory('Tools');
    setDescription('');
    setPurchaseDate('');
    setCost('');
    setCondition('Good');
    setAssignedTo('');
    setNextMaintenanceDate('');
    setNotes('');
    setMake(''); setModel(''); setSerialNumber(''); setAssignmentType('location'); setDepreciationYears('');
    setShowModal(true);
  };

  const openEditModal = (a: Asset) => {
    setEditingAsset(a);
    setName(a.name || '');
    setCategory(a.category || 'Tools');
    setDescription(a.description || '');
    setPurchaseDate(a.purchase_date ? a.purchase_date.split('T')[0] : '');
    setCost(a.cost ? String(a.cost) : '');
    setCondition(a.condition || 'Good');
    setAssignedTo(a.assigned_to || '');
    setNextMaintenanceDate(a.maintenance_schedule?.nextDueDate ? a.maintenance_schedule.nextDueDate.split('T')[0] : '');
    setNotes(a.notes || '');
    setMake(a.make || ''); setModel(a.model || ''); setSerialNumber(a.serial_number || '');
    setAssignmentType(a.assignment_type || 'location');
    setDepreciationYears(a.depreciation?.usefulLifeYears ? String(a.depreciation.usefulLifeYears) : '');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const payload: Partial<Asset> = {
        name: name.trim(),
        category: category || null,
        description: description.trim() || null,
        make: make.trim() || null,
        model: model.trim() || null,
        serial_number: serialNumber.trim() || null,
        purchase_date: purchaseDate || null,
        cost: cost ? parseFloat(cost) : null,
        condition: condition || null,
        assigned_to: assignedTo.trim() || null,
        assignment_type: assignmentType,
        depreciation: depreciationYears && purchaseDate && cost ? { usefulLifeYears: parseInt(depreciationYears, 10), annualAmount: parseFloat(cost) / parseInt(depreciationYears, 10) } : null,
        maintenance_schedule: nextMaintenanceDate ? { nextDueDate: nextMaintenanceDate } : null,
        notes: notes.trim() || null,
      };

      if (editingAsset) {
        await assetsPlantApi.update(editingAsset.id, payload);
      } else {
        await assetsPlantApi.create(payload);
      }

      setShowModal(false);
      await loadData();
    } catch (err) {
      console.error('Error saving asset:', err);
      alert('Failed to save asset. Please check your permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await assetsPlantApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error('Error deleting asset:', err);
      alert('Failed to delete asset.');
    } finally {
      setDeleting(false);
    }
  };

  const filteredAssets = assets.filter(a => 
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || 
    a.category?.toLowerCase().includes(search.toLowerCase()) ||
    a.assigned_to?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search assets, tools, machinery, assigned users..."
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
            <span>Add Asset</span>
          </button>
        )}
      </div>

      {/* Assets Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5">Asset Name & Category</th>
                <th className="px-4 py-3.5">Make / Model / Serial</th>
                <th className="px-4 py-3.5">Assigned To</th>
                <th className="px-4 py-3.5">Purchase Date</th>
                <th className="px-4 py-3.5">Cost</th>
                <th className="px-4 py-3.5">Condition</th>
                <th className="px-4 py-3.5">Maintenance Due</th>
                {isCoordinatorOrMD && <th className="px-4 py-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    Loading assets...
                  </td>
                </tr>
              ) : filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    <Package size={28} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-700 text-sm">No assets found</p>
                    {isCoordinatorOrMD && (
                      <button
                        onClick={openCreateModal}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        <Plus size={13} />
                        Add the first asset
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredAssets.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 text-sm">{a.name}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {a.category || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <div>{[a.make, a.model].filter(Boolean).join(' ') || '—'}</div>
                      <div className="text-[11px] text-slate-400">{a.serial_number || 'No serial number'}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {a.assigned_to || 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {fmtDate(a.purchase_date)}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">
                      {fmtCurrency(a.cost)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                        {a.condition || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {a.maintenance_schedule?.nextDueDate ? fmtDate(a.maintenance_schedule.nextDueDate) : '—'}
                    </td>
                    {isCoordinatorOrMD && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(a)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit asset"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(a)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete asset"
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

      {/* Add / Edit Asset Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Package className="text-blue-600" size={20} />
                  <span>{editingAsset ? 'Edit Asset Record' : 'Add Physical Asset / Plant'}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Record tools, machinery, computers, and physical workshop items
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
                  <label className="block text-slate-700 font-semibold mb-1">Asset Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DeWalt 12-inch Mitre Saw / MacBook Pro 16"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ASSET_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Current Condition</label>
                  <select
                    value={condition}
                    onChange={e => setCondition(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ASSET_CONDITIONS.map(cond => (
                      <option key={cond} value={cond}>{cond}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Make</label>
                  <input value={make} onChange={e => setMake(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Model</label>
                  <input value={model} onChange={e => setModel(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Serial Number</label>
                  <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg" />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={e => setPurchaseDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Purchase Cost (£)</label>
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
                  <label className="block text-slate-700 font-semibold mb-1">Assigned To</label>
                  <select value={assignmentType} onChange={e => setAssignmentType(e.target.value as 'production' | 'location')} className="w-full mb-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <option value="production">Production</option>
                    <option value="location">Location</option>
                  </select>
                  {assignmentType === 'production' ? (
                    <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                      <option value="">Select production</option>
                      {productions.map(production => <option key={production.id} value={production.id}>{production.name}</option>)}
                    </select>
                  ) : (
                  <input
                    type="text"
                    placeholder="Type a location, e.g. Workshop A"
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  )}
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Next Maintenance / Inspection Due</label>
                  <input
                    type="date"
                    value={nextMaintenanceDate}
                    onChange={e => setNextMaintenanceDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Depreciation (temporarily disabled)</label>
                  <input type="number" disabled value={depreciationYears} onChange={e => setDepreciationYears(e.target.value)} placeholder="Useful life in years" className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-500" />
                  <p className="text-[11px] text-slate-400 mt-1">Calculated depreciation will be enabled after the accounting policy is confirmed.</p>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Description & Serial Number</label>
                <input
                  type="text"
                  placeholder="e.g. Serial # DW-98214-X, 240V power cord included"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Warranty info, supplier notes, inspection history..."
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
                  {saving ? 'Saving...' : editingAsset ? 'Update Asset' : 'Create Asset'}
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
            <h4 className="text-sm font-bold text-slate-900 mb-1">Delete Asset?</h4>
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
