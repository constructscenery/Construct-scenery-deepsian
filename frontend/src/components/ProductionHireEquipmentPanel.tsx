'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Wrench, Plus, CheckCircle2, Clock, ExternalLink, Calendar, Trash2, Pencil, AlertCircle } from 'lucide-react';
import { hireEquipmentApi, HireEquipment, suppliersApi, Supplier } from '@/lib/api';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtCurrency = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0);

const EQUIPMENT_TYPES = [
  'Telehandler', 'Forklift', 'Scissor Lift', 'Boom Lift', 'Cherry Picker',
  'Generator', 'Compressor', 'Mini Digger', 'Excavator', 'Tower Scaffolding',
  'Dust Extractor', 'Heater / Dryer', 'Other'
];

interface ProductionHireEquipmentPanelProps {
  productionId: string;
  productionName: string;
  canManage: boolean;
}

export default function ProductionHireEquipmentPanel({
  productionId,
  productionName,
  canManage,
}: ProductionHireEquipmentPanelProps) {
  const [hires, setHires] = useState<HireEquipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [showQuickSupplierModal, setShowQuickSupplierModal] = useState(false);
  const [returnItem, setReturnItem] = useState<HireEquipment | null>(null);
  const [returnDateInput, setReturnDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [returnNotesInput, setReturnNotesInput] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHires = useCallback(async () => {
    setLoading(true);
    try {
      const [res, suppList] = await Promise.all([
        hireEquipmentApi.getAll({ production_id: productionId }),
        suppliersApi.list().catch(() => [] as Supplier[]),
      ]);
      setHires(res.hire_equipment || []);
      setSuppliers(Array.isArray(suppList) ? suppList : []);
    } catch (err) {
      console.error('Failed to load production hire equipment:', err);
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => {
    loadHires();
  }, [loadHires]);

  const activeHires = hires.filter(h => h.status === 'active');
  const returnedHires = hires.filter(h => h.status === 'returned');
  const totalCost = hires.reduce((acc, h) => acc + (h.total_cost || 0), 0);
  const weeklyRunRate = activeHires.reduce((acc, h) => acc + (h.weekly_hire_rate || 0), 0);

  const handleSaveHire = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const supplierId = fd.get('supplier_id') as string;
    const selectedSupplier = suppliers.find(s => s.id === supplierId);
    const supplierName = (fd.get('supplier_name') as string) || selectedSupplier?.name || '';

    try {
      await hireEquipmentApi.create({
        equipment_type: fd.get('equipment_type') as string,
        supplier_id: supplierId || undefined,
        supplier_name: supplierName,
        description: (fd.get('description') as string) || undefined,
        production_id: productionId,
        hire_start_date: fd.get('hire_start_date') as string,
        weekly_hire_rate: parseFloat(fd.get('weekly_hire_rate') as string) || 0,
        notes: (fd.get('notes') as string) || undefined,
      });
      setShowAddModal(false);
      loadHires();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to record hire');
    }
  };

  const handleReturnConfirm = async () => {
    if (!returnItem) return;
    try {
      await hireEquipmentApi.return(returnItem.id, {
        return_date: returnDateInput,
        notes: returnNotesInput || undefined,
      });
      setReturnItem(null);
      loadHires();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Return failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this equipment hire record?')) return;
    setDeletingId(id);
    try {
      await hireEquipmentApi.delete(id);
      loadHires();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
            <Wrench size={16} />
          </div>
          <div>
            <h2 className="text-slate-900 font-semibold text-sm">Hire Equipment Tracker (Module 8)</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {activeHires.length} active on-hire · {hires.length} total records · Total Cost: <strong className="text-slate-700">{fmtCurrency(totalCost)}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/assets-hire"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 hover:underline font-medium mr-2"
          >
            <span>Assets & Hire Hub</span>
            <ExternalLink size={11} />
          </a>

          {canManage && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus size={12} />
              <span>Record Hire</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Strip */}
      {hires.length > 0 && (
        <div className="grid grid-cols-3 bg-slate-50 border-b border-slate-100 divide-x divide-slate-100 text-center text-xs py-2.5 px-4">
          <div>
            <span className="text-slate-500 text-xs">Active Equipment</span>
            <p className="font-bold text-slate-800 mt-0.5">{activeHires.length}</p>
          </div>
          <div>
            <span className="text-slate-500 text-xs">Weekly Run Rate</span>
            <p className="font-bold text-slate-800 mt-0.5">{fmtCurrency(weeklyRunRate)}/wk</p>
          </div>
          <div>
            <span className="text-slate-500 text-xs">Total Hire Cost</span>
            <p className="font-bold text-emerald-600 mt-0.5">{fmtCurrency(totalCost)}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="px-5 py-8 text-center text-slate-400 text-xs">
            Loading hire equipment records…
          </div>
        ) : hires.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-xs">
            <Wrench size={24} className="mx-auto mb-2 text-slate-300" />
            <p className="font-medium text-slate-600">No equipment hired for this production yet.</p>
            {canManage && (
              <p className="text-slate-400 text-xs mt-1">Click &ldquo;Record Hire&rdquo; to add plant / equipment.</p>
            )}
          </div>
        ) : (
          <table className="w-full text-xs text-left text-slate-600">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-xs border-b border-slate-100">
              <tr>
                <th className="px-4 py-2.5">Equipment Type & Spec</th>
                <th className="px-4 py-2.5">Supplier / Company</th>
                <th className="px-4 py-2.5">Start Date</th>
                <th className="px-4 py-2.5">Rate (£/wk)</th>
                <th className="px-4 py-2.5">Weeks</th>
                <th className="px-4 py-2.5">Cost to Date</th>
                <th className="px-4 py-2.5">Status</th>
                {canManage && <th className="px-4 py-2.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hires.map(h => (
                <tr key={h.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    <div>{h.equipment_type}</div>
                    {h.description && <div className="text-xs text-slate-400 truncate max-w-xs">{h.description}</div>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                    {h.supplier_name}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-slate-600">
                    {fmtDate(h.hire_start_date)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono">
                    {fmtCurrency(h.weekly_hire_rate)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                      {h.weeks_hired ?? 1}w
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono font-bold text-emerald-600">
                    {fmtCurrency(h.total_cost)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {h.status === 'active' ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                        Active On-Hire
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        Returned {fmtDate(h.return_date)}
                      </span>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {h.status === 'active' && (
                          <button
                            onClick={() => {
                              setReturnItem(h);
                              setReturnDateInput(new Date().toISOString().split('T')[0]);
                              setReturnNotesInput(h.notes || '');
                            }}
                            className="px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 rounded transition-colors"
                          >
                            Return
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(h.id)}
                          disabled={deletingId === h.id}
                          className="p-1 text-slate-400 hover:text-red-600 rounded"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── ADD MODAL ─── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-lg">Record Equipment Hire</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveHire} className="space-y-3">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Equipment Type *</label>
                <select name="equipment_type" required className="w-full px-3 py-1.5 border border-slate-200 rounded-lg">
                  {EQUIPMENT_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-600 font-medium">Supplier / Hire Company *</label>
                  <button
                    type="button"
                    onClick={() => setShowQuickSupplierModal(true)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5 hover:underline"
                  >
                    <Plus size={12} />
                    <span>Add New</span>
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <select
                    name="supplier_id"
                    required
                    value={selectedSupplierId}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '__ADD_NEW__') {
                        setShowQuickSupplierModal(true);
                      } else {
                        setSelectedSupplierId(val);
                      }
                    }}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 bg-white"
                  >
                    <option value="">Select a supplier from list...</option>
                    <option value="__ADD_NEW__" className="text-blue-600 font-bold bg-blue-50">
                      ➕ + Add New Supplier to Database...
                    </option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.city ? `(${s.city})` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowQuickSupplierModal(true)}
                    className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0"
                    title="Add New Supplier to Database"
                  >
                    <Plus size={13} />
                    <span>New</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Start Date *</label>
                  <input
                    type="date"
                    name="hire_start_date"
                    required
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Weekly Rate (£) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="weekly_hire_rate"
                    required
                    placeholder="0.00"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Specification / Description</label>
                <input
                  type="text"
                  name="description"
                  placeholder="e.g. 14m Telehandler"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Operational Notes</label>
                <input
                  type="text"
                  name="notes"
                  placeholder="e.g. Stage 2 workshop"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-slate-600 border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
                >
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Supplier Modal Sub-dialog */}
      {showQuickSupplierModal && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 text-lg">Add New Supplier</h3>
            <p className="text-slate-500">Register supplier and select for this hire</p>

            <form
              onSubmit={async e => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const sName = (fd.get('name') as string)?.trim();
                if (!sName) return;
                try {
                  const created = await suppliersApi.create({
                    name: sName,
                    email: (fd.get('email') as string)?.trim() || undefined,
                    phone: (fd.get('phone') as string)?.trim() || undefined,
                    city: (fd.get('city') as string)?.trim() || undefined,
                  });
                  setSuppliers(prev => [created, ...prev.filter(s => s.id !== created.id)]);
                  setSelectedSupplierId(created.id);
                  setShowQuickSupplierModal(false);
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Failed to create supplier');
                }
              }}
              className="space-y-2.5"
            >
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Company / Supplier Name *</label>
                <input
                  type="text"
                  name="name"
                  required
                  autoFocus
                  placeholder="e.g. Nationwide Platforms Ltd"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Email Address</label>
                <input
                  type="email"
                  name="email"
                  placeholder="hire@supplier.co.uk"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    placeholder="0800 123 4567"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">City / Depot</label>
                  <input
                    type="text"
                    name="city"
                    placeholder="London"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowQuickSupplierModal(false)}
                  className="px-3 py-1.5 text-slate-600 border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
                >
                  Create & Select
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── RETURN MODAL ─── */}
      {returnItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 text-lg">Return Equipment</h3>
            <p className="text-slate-600">
              Close hire for <strong>{returnItem.equipment_type}</strong> ({returnItem.supplier_name})
            </p>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Return Date *</label>
              <input
                type="date"
                value={returnDateInput}
                onChange={e => setReturnDateInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Notes / Off-Hire Ref</label>
              <input
                type="text"
                value={returnNotesInput}
                onChange={e => setReturnNotesInput(e.target.value)}
                placeholder="e.g. Returned via driver #4"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReturnItem(null)}
                className="px-3 py-1.5 text-slate-600 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReturnConfirm}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
