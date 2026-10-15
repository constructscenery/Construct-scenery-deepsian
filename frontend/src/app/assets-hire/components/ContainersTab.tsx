'use client';

import React, { useState, useEffect } from 'react';
import {
  Box, Plus, Pencil, Trash2, Search, X, Calendar, FileText, AlertCircle,
  Building2, CheckCircle2, AlertTriangle, Clock, RotateCcw, Loader2, Truck,
} from 'lucide-react';
import { containersApi, Container, ContainerInput, ContainerStatus, ContainerOwnership, ContainerCondition, Production } from '@/lib/api';
import AttachedDocuments from '@/components/AttachedDocuments';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtCurrency = (v: number | null | undefined) =>
  v != null ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(v)) : '—';

const CONTAINER_TYPES = [
  '20ft Storage Container',
  '40ft Storage Container',
  '40ft High Cube Container',
  '10ft Tool Container',
  'Site Office Container',
  'Store / Workshop Container',
  'Chemical / Flammables Storage',
  'Other',
];

const STATUS_CONFIG: Record<ContainerStatus, { label: string; badgeCls: string; dotCls: string }> = {
  available:      { label: 'Available',    badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotCls: 'bg-emerald-500' },
  on_hire:        { label: 'On Hire',      badgeCls: 'bg-blue-50 text-blue-700 border-blue-200',          dotCls: 'bg-blue-500' },
  in_use:         { label: 'In Use',       badgeCls: 'bg-indigo-50 text-indigo-700 border-indigo-200',    dotCls: 'bg-indigo-500' },
  maintenance:    { label: 'Maintenance', badgeCls: 'bg-amber-50 text-amber-700 border-amber-200',       dotCls: 'bg-amber-500' },
  decommissioned: { label: 'Decommissioned', badgeCls: 'bg-slate-100 text-slate-600 border-slate-200',    dotCls: 'bg-slate-400' },
};

const CONDITION_CONFIG: Record<ContainerCondition, { label: string; cls: string }> = {
  good:         { label: 'Good',         cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  fair:         { label: 'Fair',         cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  damaged:      { label: 'Damaged',      cls: 'text-rose-700 bg-rose-50 border-rose-200' },
  needs_repair: { label: 'Needs Repair', cls: 'text-red-700 bg-red-50 border-red-200' },
};

interface ContainersTabProps {
  isCoordinatorOrMD: boolean;
  productions: Production[];
}

export default function ContainersTab({ isCoordinatorOrMD, productions }: ContainersTabProps) {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<string>('all');
  const [productionFilter, setProductionFilter] = useState<string>('');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingContainer, setEditingContainer] = useState<Container | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Container | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [documentContainer, setDocumentContainer] = useState<Container | null>(null);
  const [formError, setFormError] = useState('');

  // Form states
  const [form, setForm] = useState<ContainerInput>({
    container_number: '',
    container_type: '20ft Storage Container',
    size: '20ft',
    status: 'available',
    ownership_status: 'owned',
    location: '',
    assigned_production_id: null,
    supplier: '',
    hire_start_date: null,
    hire_end_date: null,
    weekly_cost: null,
    condition: 'good',
    contents_description: '',
    notes: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await containersApi.getAll({
        include_archived: includeArchived,
      });
      setContainers(res || []);
    } catch (err) {
      console.error('Failed to load containers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [includeArchived]);

  const openCreateModal = () => {
    setEditingContainer(null);
    setFormError('');
    setForm({
      container_number: '',
      container_type: '20ft Storage Container',
      size: '20ft',
      status: 'available',
      ownership_status: 'owned',
      location: 'Main Yard',
      assigned_production_id: null,
      supplier: '',
      hire_start_date: null,
      hire_end_date: null,
      weekly_cost: null,
      condition: 'good',
      contents_description: '',
      notes: '',
    });
    setShowModal(true);
  };

  const openEditModal = (c: Container) => {
    setEditingContainer(c);
    setFormError('');
    setForm({
      container_number: c.container_number || '',
      container_type: c.container_type || '20ft Storage Container',
      size: c.size || '20ft',
      status: c.status || 'available',
      ownership_status: c.ownership_status || 'owned',
      location: c.location || '',
      assigned_production_id: c.assigned_production_id || null,
      supplier: c.supplier || '',
      hire_start_date: c.hire_start_date ? c.hire_start_date.split('T')[0] : null,
      hire_end_date: c.hire_end_date ? c.hire_end_date.split('T')[0] : null,
      weekly_cost: c.weekly_cost,
      condition: c.condition || 'good',
      contents_description: c.contents_description || '',
      notes: c.notes || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.container_number?.trim()) {
      setFormError('Container number / reference is required');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const payload: ContainerInput = {
        ...form,
        container_number: form.container_number.trim(),
        container_type: form.container_type || '20ft Storage Container',
        location: form.location?.trim() || null,
        supplier: form.ownership_status === 'hired' ? (form.supplier?.trim() || null) : null,
        hire_start_date: form.ownership_status === 'hired' ? (form.hire_start_date || null) : null,
        hire_end_date: form.ownership_status === 'hired' ? (form.hire_end_date || null) : null,
        weekly_cost: form.ownership_status === 'hired' && form.weekly_cost !== null ? Number(form.weekly_cost) : null,
        assigned_production_id: form.assigned_production_id || null,
        contents_description: form.contents_description?.trim() || null,
        notes: form.notes?.trim() || null,
      };

      if (editingContainer) {
        await containersApi.update(editingContainer.id, payload);
      } else {
        await containersApi.create(payload);
      }

      setShowModal(false);
      loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save container');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (hard = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await containersApi.delete(deleteTarget.id, hard);
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      console.error('Failed to delete container', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await containersApi.restore(id);
      loadData();
    } catch (err) {
      console.error('Failed to restore container', err);
    }
  };

  // Filter logic
  const filtered = containers.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (ownershipFilter !== 'all' && c.ownership_status !== ownershipFilter) return false;
    if (productionFilter && c.assigned_production_id !== productionFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match = [
        c.container_number,
        c.container_type,
        c.location,
        c.supplier,
        c.production_name,
        c.contents_description,
        c.notes,
      ].some(v => v?.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  // KPI Metrics
  const totalCount = containers.length;
  const availableCount = containers.filter(c => c.status === 'available').length;
  const inUseCount = containers.filter(c => c.status === 'in_use' || c.status === 'on_hire').length;
  const hiredCount = containers.filter(c => c.ownership_status === 'hired').length;
  const ownedCount = containers.filter(c => c.ownership_status === 'owned').length;

  const inputClass = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Total Containers</p>
          <p className="text-lg font-bold text-slate-800 mt-1">{totalCount}</p>
          <p className="text-xs text-slate-400 mt-0.5">{ownedCount} Owned · {hiredCount} Hired</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Available in Yard</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-lg font-bold text-emerald-600">{availableCount}</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Ready for deployment</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">On Site / In Use</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-lg font-bold text-blue-600">{inUseCount}</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Allocated to productions</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Hired Equipment</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            <span className="text-lg font-bold text-purple-600">{hiredCount}</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">External supplier containers</p>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by container number, type, location, contents..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isCoordinatorOrMD && (
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
              >
                <Plus size={14} />
                <span>Add Container</span>
              </button>
            )}
          </div>
        </div>

        {/* Secondary Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="in_use">In Use</option>
              <option value="on_hire">On Hire</option>
              <option value="maintenance">Maintenance</option>
              <option value="decommissioned">Decommissioned</option>
            </select>

            <select
              value={ownershipFilter}
              onChange={e => setOwnershipFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="all">All Ownership</option>
              <option value="owned">Owned</option>
              <option value="hired">Hired</option>
            </select>

            {productions.length > 0 && (
              <select
                value={productionFilter}
                onChange={e => setProductionFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All Productions</option>
                {productions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={e => setIncludeArchived(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-400 h-3.5 w-3.5"
              />
              <span>Include Archived</span>
            </label>

            {(search || statusFilter !== 'all' || ownershipFilter !== 'all' || productionFilter || includeArchived) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setOwnershipFilter('all');
                  setProductionFilter('');
                  setIncludeArchived(false);
                }}
                className="text-xs text-red-500 hover:text-red-700 font-medium px-2"
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="text-xs text-slate-400">
            {filtered.length} container{filtered.length === 1 ? '' : 's'} found
          </div>
        </div>
      </div>

      {/* Containers Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold">
              <tr>
                <th className="px-4 py-3">Container #</th>
                <th className="px-4 py-3">Type &amp; Size</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ownership</th>
                <th className="px-4 py-3">Location / Production</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">Contents / Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 size={20} className="animate-spin text-blue-600" />
                      <span>Loading containers...</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Box size={28} className="text-slate-300 mb-1" />
                      <p className="font-semibold text-slate-700 text-sm">No containers found</p>
                      <p className="text-xs text-slate-400">
                        {containers.length
                          ? 'Try adjusting your filters or search term'
                          : 'Get started by adding your first site or storage container'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(c => {
                  const statusInfo = STATUS_CONFIG[c.status] || STATUS_CONFIG.available;
                  const condInfo = CONDITION_CONFIG[c.condition] || CONDITION_CONFIG.good;

                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        c.is_archived ? 'opacity-60 bg-slate-50/40' : ''
                      }`}
                    >
                      {/* Container Number */}
                      <td className="px-4 py-3 font-semibold text-slate-900 min-w-32">
                        <div className="flex items-center gap-2">
                          <Box size={15} className="text-slate-400 flex-shrink-0" />
                          <span>{c.container_number}</span>
                        </div>
                        {c.is_archived && (
                          <span className="text-xs text-amber-600 font-normal">Archived</span>
                        )}
                      </td>

                      {/* Type & Size */}
                      <td className="px-4 py-3 min-w-40">
                        <p className="text-slate-800 font-medium">{c.container_type}</p>
                        {c.size && <p className="text-xs text-slate-400">Size: {c.size}</p>}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.badgeCls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotCls}`} />
                          {statusInfo.label}
                        </span>
                      </td>

                      {/* Ownership */}
                      <td className="px-4 py-3 min-w-32">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${
                          c.ownership_status === 'hired' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {c.ownership_status}
                        </span>
                        {c.ownership_status === 'hired' && (
                          <div className="mt-0.5 space-y-0.5 text-xs text-slate-500">
                            {c.supplier && <p className="font-medium truncate max-w-36">{c.supplier}</p>}
                            {c.weekly_cost != null && <p>{fmtCurrency(c.weekly_cost)} / wk</p>}
                          </div>
                        )}
                      </td>

                      {/* Location & Production */}
                      <td className="px-4 py-3 min-w-36 max-w-56">
                        <p className="text-slate-800 font-medium truncate">{c.location || '—'}</p>
                        {c.production_name && (
                          <div className="flex items-center gap-1 text-xs text-blue-600 mt-0.5">
                            <Building2 size={11} className="flex-shrink-0" />
                            <span className="truncate">{c.production_name}</span>
                          </div>
                        )}
                      </td>

                      {/* Condition */}
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${condInfo.cls}`}>
                          {condInfo.label}
                        </span>
                      </td>

                      {/* Contents / Notes */}
                      <td className="px-4 py-3 min-w-44 max-w-64">
                        {c.contents_description ? (
                          <p className="text-slate-700 line-clamp-1" title={c.contents_description}>
                            {c.contents_description}
                          </p>
                        ) : (
                          <p className="text-slate-400 italic">Empty / no description</p>
                        )}
                        {c.notes && (
                          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5" title={c.notes}>
                            {c.notes}
                          </p>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Attached Documents"
                            onClick={() => setDocumentContainer(c)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            <FileText size={15} />
                          </button>

                          {isCoordinatorOrMD && (
                            <>
                              <button
                                type="button"
                                title="Edit Container"
                                onClick={() => openEditModal(c)}
                                className="p-1.5 text-slate-500 hover:bg-slate-100 rounded transition-colors"
                              >
                                <Pencil size={15} />
                              </button>

                              {c.is_archived ? (
                                <button
                                  type="button"
                                  title="Restore Container"
                                  onClick={() => handleRestore(c.id)}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                                >
                                  <RotateCcw size={15} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  title="Archive / Delete Container"
                                  onClick={() => setDeleteTarget(c)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </>
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
      </div>

      {/* Add / Edit Container Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Box size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-lg">
                    {editingContainer ? 'Edit Container' : 'Add New Container'}
                  </h3>
                  <p className="text-xs text-slate-500">Site storage &amp; workshop container registry</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Container Number / Ref <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CONT-001 or 20FT-CS01"
                    value={form.container_number || ''}
                    onChange={e => setForm(f => ({ ...f, container_number: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Container Type</label>
                  <select
                    value={form.container_type || '20ft Storage Container'}
                    onChange={e => setForm(f => ({ ...f, container_type: e.target.value }))}
                    className={inputClass}
                  >
                    {CONTAINER_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Size</label>
                  <input
                    type="text"
                    placeholder="e.g. 20ft, 40ft"
                    value={form.size || ''}
                    onChange={e => setForm(f => ({ ...f, size: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={form.status || 'available'}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as ContainerStatus }))}
                    className={inputClass}
                  >
                    <option value="available">Available</option>
                    <option value="in_use">In Use</option>
                    <option value="on_hire">On Hire</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="decommissioned">Decommissioned</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Condition</label>
                  <select
                    value={form.condition || 'good'}
                    onChange={e => setForm(f => ({ ...f, condition: e.target.value as ContainerCondition }))}
                    className={inputClass}
                  >
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="damaged">Damaged</option>
                    <option value="needs_repair">Needs Repair</option>
                  </select>
                </div>
              </div>

              {/* Ownership Toggle */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Ownership Status</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, ownership_status: 'owned' }))}
                    className={`py-2 text-xs font-medium rounded-lg border transition-all ${
                      form.ownership_status === 'owned'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Company Owned
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, ownership_status: 'hired' }))}
                    className={`py-2 text-xs font-medium rounded-lg border transition-all ${
                      form.ownership_status === 'hired'
                        ? 'border-purple-600 bg-purple-50 text-purple-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Hired from Supplier
                  </button>
                </div>
              </div>

              {/* Hired Details (Conditional) */}
              {form.ownership_status === 'hired' && (
                <div className="p-3 bg-purple-50/50 border border-purple-100 rounded-xl space-y-3">
                  <p className="text-xs font-semibold text-purple-800 flex items-center gap-1.5">
                    <Truck size={13} /> Hire Supplier Information
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Supplier / Hire Company</label>
                      <input
                        type="text"
                        placeholder="e.g. Mobile Mini, Willbox, Elliott"
                        value={form.supplier || ''}
                        onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Weekly Cost (£)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 45.00"
                        value={form.weekly_cost ?? ''}
                        onChange={e => setForm(f => ({ ...f, weekly_cost: e.target.value ? Number(e.target.value) : null }))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Hire Start Date</label>
                      <input
                        type="date"
                        value={form.hire_start_date || ''}
                        onChange={e => setForm(f => ({ ...f, hire_start_date: e.target.value || null }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Hire End / Off-hire Date</label>
                      <input
                        type="date"
                        value={form.hire_end_date || ''}
                        onChange={e => setForm(f => ({ ...f, hire_end_date: e.target.value || null }))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Location & Production */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Current Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Main Yard, Longcross Lot 2, Stage 5"
                    value={form.location || ''}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Production</label>
                  <select
                    value={form.assigned_production_id || ''}
                    onChange={e => setForm(f => ({ ...f, assigned_production_id: e.target.value || null }))}
                    className={inputClass}
                  >
                    <option value="">— Unassigned (In Yard) —</option>
                    {productions.map(p => (
                      <option key={p.id} value={p.id}>{p.name} {p.production_code ? `(${p.production_code})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Contents description */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Contents Description</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Scenic painter stock, timber offcuts, rigging gear, mouldings..."
                  value={form.contents_description || ''}
                  onChange={e => setForm(f => ({ ...f, contents_description: e.target.value }))}
                  className={`${inputClass} resize-y`}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes &amp; Lock / Key Details</label>
                <textarea
                  rows={2}
                  placeholder="Padlock code, access notes, repair history..."
                  value={form.notes || ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className={`${inputClass} resize-y`}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving && <Loader2 size={13} className="animate-spin" />}
                  {saving ? 'Saving...' : editingContainer ? 'Save Changes' : 'Create Container'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Archive Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <AlertTriangle size={20} />
              </div>
              <h3 className="font-semibold text-slate-900 text-lg">Remove Container</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Are you sure you want to remove container <strong className="text-slate-900">{deleteTarget.container_number}</strong>?
              You can archive it (keeps history and records) or permanently delete it.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(false)}
                disabled={deleting}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
              >
                {deleting ? 'Archiving...' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(true)}
                disabled={deleting}
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents Modal */}
      {documentContainer && (
        <AttachedDocuments
          owner="containers"
          ownerId={documentContainer.id}
          name={`Container ${documentContainer.container_number}`}
          onClose={() => setDocumentContainer(null)}
        />
      )}
    </div>
  );
}
