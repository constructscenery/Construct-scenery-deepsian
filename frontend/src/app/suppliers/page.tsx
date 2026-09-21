'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { supplierApi, type Supplier, type SupplierPurchaseOrder } from '@/lib/api';
import {
  Plus,
  Search,
  X,
  FileText,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Archive,
  RotateCcw,
  Building2,
} from 'lucide-react';
import { EmptyStateRow } from '@/components/EmptyState';

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

type FormData = {
  name: string;
  category: string;
  primary_contact_name: string;
  email: string;
  street_name: string;
  city: string;
  county: string;
  zip_code: string;
  phone: string;
  account_number: string;
  credit_terms: string;
  payment_terms: string;
  lead_times: string;
  notes: string;
};

const EMPTY_FORM: FormData = {
  name: '',
  category: '',
  primary_contact_name: '',
  email: '',
  street_name: '',
  city: '',
  county: '',
  zip_code: '',
  phone: '',
  account_number: '',
  credit_terms: '',
  payment_terms: '',
  lead_times: '',
  notes: '',
};

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-3 bg-slate-200 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 bg-green-700 text-white text-sm rounded-xl px-4 py-3 shadow-lg animate-fade-in">
      <CheckCircle2 size={16} />
      {message}
      <button onClick={onClose} className="ml-1 text-green-200 hover:text-white">
        <X size={14} />
      </button>
    </div>
  );
}

export default function SuppliersPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isGuest = role === 'guest';
  const canWrite = !isGuest;

  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'suppliers' | 'history'>('suppliers');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<SupplierPurchaseOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyCategory, setHistoryCategory] = useState('');
  const [historyLocation, setHistoryLocation] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Supplier | null>(null);
  const [permanentDeleteLoading, setPermanentDeleteLoading] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');

  async function openHistory(item: Supplier) {
    setSelectedSupplier(item);
    setActiveTab('history');
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setHistoryLoading(true);
      const [itemList, historyList] = await Promise.all([
        supplierApi.list({ include_archived: 'true' }),
        supplierApi.getAllHistory()
      ]);
      setItems(itemList);
      setHistory(historyList);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = items
    .filter((item) => {
      const q = search.toLowerCase();
      const searchableText = [
        item.name,
        item.email,
        item.phone,
        item.category,
        item.primary_contact_name,
        item.street_name,
        item.city,
        item.county,
        item.zip_code,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !q || searchableText.includes(q);
      const matchesCategory = !categoryFilter || item.category === categoryFilter;
      const location = [item.street_name, item.city, item.county, item.zip_code].filter(Boolean).join(' ').toLowerCase();
      const matchesLocation = !locationFilter || location.includes(locationFilter.toLowerCase());
      const matchesArchive =
        archiveFilter === 'all'
          ? true
          : archiveFilter === 'archived'
            ? Boolean(item.is_archived)
            : !item.is_archived;
      return matchesSearch && matchesCategory && matchesLocation && matchesArchive;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const supplierCategories = Array.from(new Set(items.map(item => item.category).filter((value): value is string => !!value))).sort();
  const supplierLocations = Array.from(new Set(items
    .map(item => [item.city, item.county].filter(Boolean).join(', '))
    .filter(Boolean))).sort();

  const hasSupplierFilters = Boolean(search || categoryFilter || locationFilter || archiveFilter !== 'active');

  function clearSupplierFilters() {
    setSearch('');
    setCategoryFilter('');
    setLocationFilter('');
    setArchiveFilter('active');
  }

  const historyCategories = Array.from(new Set(history.map(row => row.supplier_category).filter((value): value is string => !!value))).sort();
  const historyRows = history.filter(row => {
    const q = historySearch.toLowerCase();
    const matchesSearch = !q || [row.supplier_name, row.po_number, row.title || '', row.production_name].some(value => value.toLowerCase().includes(q));
    const matchesCategory = !historyCategory || row.supplier_category === historyCategory;
    const matchesLocation = !historyLocation || (row.supplier_location || '').toLowerCase().includes(historyLocation.toLowerCase());
    const matchesSupplier = !selectedSupplier || row.supplier_name.toLowerCase() === selectedSupplier.name.toLowerCase();
    return matchesSearch && matchesCategory && matchesLocation && matchesSupplier;
  });

  function openAdd() {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  }

  function openEdit(item: Supplier) {
    setEditItem(item);
    setForm({
      name: item.name,
      category: item.category ?? '',
      primary_contact_name: item.primary_contact_name ?? '',
      email: item.email ?? '',
      street_name: item.street_name ?? '',
      city: item.city ?? '',
      county: item.county ?? '',
      zip_code: item.zip_code ?? '',
      phone: item.phone ?? '',
      account_number: item.account_number ?? '',
      credit_terms: item.credit_terms ?? '',
      payment_terms: item.payment_terms ?? '',
      lead_times: item.lead_times ?? '',
      notes: item.notes ?? '',
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    if (!form.name.trim()) { setFormError('Supplier name is required.'); return; }

    setFormLoading(true);
    try {
      const payload: Partial<Supplier> = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        primary_contact_name: form.primary_contact_name.trim() || null,
        email: form.email.trim() || null,
        street_name: form.street_name.trim() || null,
        city: form.city.trim() || null,
        county: form.county.trim() || null,
        zip_code: form.zip_code.trim() || null,
        phone: form.phone.trim() || null,
        account_number: form.account_number.trim() || null,
        credit_terms: form.credit_terms.trim() || null,
        payment_terms: form.payment_terms.trim() || null,
        lead_times: form.lead_times.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (editItem) {
        await supplierApi.update(editItem.id, payload);
        setToast('Supplier updated successfully.');
      } else {
        await supplierApi.create(payload);
        setToast('Supplier added successfully.');
      }

      setShowModal(false);
      await loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await supplierApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      setToast('Supplier archived successfully.');
      await loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Archive failed.');
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handlePermanentDelete() {
    if (!permanentDeleteTarget) return;
    setPermanentDeleteLoading(true);
    try {
      const res = await supplierApi.delete(permanentDeleteTarget.id, true);
      setToast(res.message || `Supplier "${permanentDeleteTarget.name}" permanently deleted.`);
      setPermanentDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : 'Permanent delete failed.');
      setPermanentDeleteTarget(null);
    } finally {
      setPermanentDeleteLoading(false);
    }
  }

  async function handleRestore(supplier: Supplier) {
    try {
      await supplierApi.restore(supplier.id);
      setToast(`${supplier.name} has been restored successfully.`);
      await loadData();
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : 'Restore failed.');
    }
  }

  return (
    <>
      <TopBar
        title="Supplier Database"
        subtitle={
          loading
            ? 'Loading suppliers…'
            : `${items.length} ${items.length === 1 ? 'supplier' : 'suppliers'}`
        }
      />

      <main className="flex-1 p-4 md:p-6 space-y-4">
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}

        <div className="flex items-center gap-1 border-b border-slate-200">
          <button onClick={() => setActiveTab('suppliers')} className={`px-4 py-2.5 text-sm font-normal border-b-2 ${activeTab === 'suppliers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600'}`}>Supplier Database</button>
          <button onClick={() => setActiveTab('history')} className={`px-4 py-2.5 text-sm font-normal border-b-2 ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600'}`}>PO History & Production Links</button>
        </div>

        {activeTab === 'history' ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div><h2 className="text-slate-800 font-semibold text-base">PO History & Production Links</h2><p className="text-slate-400 text-xs mt-0.5">All purchase orders connected to suppliers and productions{selectedSupplier ? ` — filtered to ${selectedSupplier.name}` : ''}.</p></div>
              {selectedSupplier && <button onClick={() => setSelectedSupplier(null)} className="text-sm text-blue-600 hover:text-blue-800">Show all suppliers</button>}
            </div>
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap gap-2">
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-64"><Search size={14} className="text-slate-400" /><input value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="Search supplier, PO, production..." className="bg-transparent text-sm outline-none w-full" /></div>
              <select value={historyCategory} onChange={e => setHistoryCategory(e.target.value)} className={inputCls + ' sm:w-48'}><option value="">All categories</option>{historyCategories.map(category => <option key={category} value={category}>{category}</option>)}</select>
              <input value={historyLocation} onChange={e => setHistoryLocation(e.target.value)} placeholder="Filter location" className={inputCls + ' sm:w-48'} />
            </div>
            {historyLoading ? <div className="px-5 py-12 text-center text-slate-400">Loading PO history…</div> : historyRows.length === 0 ? <div className="px-5 py-12 text-center text-slate-500">No purchase order connections match these filters.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[1000px]"><thead><tr className="bg-slate-50 text-left border-b border-slate-100">{['Supplier', 'Category', 'Location', 'PO Number', 'Title', 'Production', 'Date', 'Status', 'Net', 'Gross'].map(h => <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{historyRows.map(po => <tr key={po.id}><td className="px-4 py-3 text-slate-800 font-medium">{po.supplier_name}</td><td className="px-4 py-3 text-slate-600">{po.supplier_category || '—'}</td><td className="px-4 py-3 text-slate-600">{po.supplier_location || '—'}</td><td className="px-4 py-3 text-slate-800 font-medium">{po.po_number}</td><td className="px-4 py-3 text-slate-600">{po.title || '—'}</td><td className="px-4 py-3 text-slate-700"><Link href={`/productions/${po.production_id}`} className="text-blue-600 hover:underline">{po.production_name}</Link><div className="text-xs text-slate-400">{po.production_status}</div></td><td className="px-4 py-3 text-slate-600">{new Date(po.date_of_po).toLocaleDateString('en-GB')}</td><td className="px-4 py-3 text-slate-600 capitalize">{po.status.replace(/_/g, ' ')}</td><td className="px-4 py-3 text-slate-700">£{Number(po.net_amount).toFixed(2)}</td><td className="px-4 py-3 text-slate-700">£{Number(po.gross_amount).toFixed(2)}</td></tr>)}</tbody></table></div>
            )}
          </div>
        ) : <>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1fr)_220px_220px_auto] items-center gap-3">
                <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 min-w-0">
                  <Search size={14} className="text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, email…"
                    className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All categories</option>
                  {supplierCategories.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All locations</option>
                  {supplierLocations.map(location => <option key={location} value={location}>{location}</option>)}
                </select>
                <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setArchiveFilter('active')}
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${archiveFilter === 'active' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setArchiveFilter('archived')}
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${archiveFilter === 'archived' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Archived
                  </button>
                  <button
                    type="button"
                    onClick={() => setArchiveFilter('all')}
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${archiveFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    All
                  </button>
                </div>
                {hasSupplierFilters && (
                  <button
                    onClick={clearSupplierFilters}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium px-2 py-2"
                  >
                    <X size={12} /> Clear filters
                  </button>
                )}
              </div>

              {canWrite && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    onClick={openAdd}
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-5 py-2.5 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                  >
                    <Plus size={14} />
                    Add Supplier
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 text-left border-b border-slate-100">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Supplier Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Category</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Contact</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Address</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Notes</th>
                    {canWrite && (
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading
                    ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                    : filtered.length === 0
                      ? (
                        items.length === 0 ? (
                          <EmptyStateRow
                            colSpan={canWrite ? 6 : 5}
                            icon={Building2}
                            title="No suppliers registered"
                            description="There are no suppliers currently in your database."
                            recommendation="Register your key material suppliers, subcontractors, and trade vendors to link them directly to purchase orders."
                            action={canWrite ? {
                              label: 'Add First Supplier',
                              onClick: openAdd,
                              icon: Plus,
                            } : undefined}
                          />
                        ) : (
                          <EmptyStateRow
                            colSpan={canWrite ? 6 : 5}
                            icon={AlertCircle}
                            title={archiveFilter === 'archived' ? 'No archived suppliers' : 'No matching suppliers'}
                            description={
                              archiveFilter === 'archived'
                                ? 'No suppliers are currently marked as archived.'
                                : 'No suppliers match your active search and filter criteria.'
                            }
                            recommendation="Try clearing your search query or switching your active filters."
                            action={{
                              label: 'Clear Filters',
                              onClick: clearSupplierFilters,
                              icon: X,
                            }}
                          />
                        )
                      )
                      : filtered.map((item) => (
                        <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors ${item.is_archived ? 'bg-slate-50/70 opacity-80' : ''}`}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <p className="text-slate-800 font-semibold text-sm">{item.name}</p>
                              {item.is_archived && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                                  Archived
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 text-sm">{item.category || '—'}</td>
                          <td className="px-4 py-3.5 text-slate-700 text-sm">
                            {item.email && <div className="text-blue-600">{item.email}</div>}
                            {item.phone && <div className="text-slate-500 text-xs">{item.phone}</div>}
                            {!item.email && !item.phone && <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3.5 text-slate-700 text-sm">
                            {[item.street_name, item.city, item.zip_code].filter(Boolean).join(', ') || <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 text-xs max-w-[200px] truncate">
                            {item.notes ?? <span className="text-slate-300">—</span>}
                          </td>
                          {canWrite && (
                            <td className="px-4 py-3.5">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => openHistory(item)}
                                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium border border-blue-100"
                                >
                                  PO History
                                </button>
                                <button
                                  onClick={() => openEdit(item)}
                                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors font-medium border border-slate-200"
                                >
                                  <Pencil size={11} /> Edit
                                </button>
                                {item.is_archived ? (
                                  <>
                                    <button
                                      onClick={() => handleRestore(item)}
                                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors font-medium border border-emerald-200"
                                    >
                                      <RotateCcw size={11} /> Restore
                                    </button>
                                    <button
                                      onClick={() => setPermanentDeleteTarget(item)}
                                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors font-medium border border-rose-200"
                                      title="Permanently Delete Supplier"
                                    >
                                      <Trash2 size={11} /> Delete Permanently
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setDeleteTarget(item)}
                                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors font-medium border border-amber-200"
                                  >
                                    <Archive size={11} /> Archive
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        </>}
      </main>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            onClick={() => { if (!formLoading) setShowModal(false); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-lg font-semibold text-slate-800">
                {editItem ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                disabled={formLoading}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <p>{formError}</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Supplier Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. Acme Build Supplies"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Category</label><input type="text" value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className={inputCls} placeholder="e.g. timber merchant" /></div>
                <div><label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Primary Contact</label><input type="text" value={form.primary_contact_name} onChange={(e) => setForm(f => ({ ...f, primary_contact_name: e.target.value }))} className={inputCls} placeholder="Contact name" /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                    className={inputCls}
                    placeholder="contact@acme.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    className={inputCls}
                    placeholder="020 1234 5678"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Account Number</label><input type="text" value={form.account_number} onChange={(e) => setForm(f => ({ ...f, account_number: e.target.value }))} className={inputCls} /></div>
                <div><label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Lead Times</label><input type="text" value={form.lead_times} onChange={(e) => setForm(f => ({ ...f, lead_times: e.target.value }))} className={inputCls} placeholder="e.g. 3–5 working days" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Credit Terms</label><input type="text" value={form.credit_terms} onChange={(e) => setForm(f => ({ ...f, credit_terms: e.target.value }))} className={inputCls} placeholder="e.g. 30 days" /></div>
                <div><label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Payment Terms</label><input type="text" value={form.payment_terms} onChange={(e) => setForm(f => ({ ...f, payment_terms: e.target.value }))} className={inputCls} /></div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Street Address
                </label>
                <input
                  type="text"
                  value={form.street_name}
                  onChange={(e) => setForm(f => ({ ...f, street_name: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    City
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Postcode
                  </label>
                  <input
                    type="text"
                    value={form.zip_code}
                    onChange={(e) => setForm(f => ({ ...f, zip_code: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Notes (Optional)
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  className={`${inputCls} resize-none min-h-[80px]`}
                  placeholder="Any additional information…"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2 sticky bottom-0 z-10">
              <button
                onClick={() => setShowModal(false)}
                disabled={formLoading}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={formLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors min-w-[100px] flex justify-center disabled:opacity-50"
              >
                {formLoading ? <span className="animate-pulse">Saving…</span> : 'Save Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ──────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Archive Supplier?</h3>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              Are you sure you want to archive <strong>{deleteTarget.name}</strong>? The supplier will be hidden from active lists and new purchase orders, but historical transactions and accounting reports remain preserved. You can restore them anytime.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {deleteLoading && <div className="animate-spin w-3 h-3 border-2 border-white/20 border-t-white rounded-full" />}
                Archive Supplier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Permanent Delete Confirm Modal ────────────────────────────────────── */}
      {permanentDeleteTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-rose-200 w-full max-w-md p-6 relative space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 rounded-xl border border-rose-200">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Permanently Delete Supplier?</h3>
                <p className="text-[11px] text-rose-600 font-medium">This action cannot be undone</p>
              </div>
            </div>
            <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                Are you sure you want to permanently delete <strong>{permanentDeleteTarget.name}</strong>?
                This record will be completely erased from the database.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px]">
                <strong>Integrity Safeguard:</strong> If this supplier has any associated purchase orders, deletion will be blocked by the server to protect accounting integrity.
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setPermanentDeleteTarget(null)}
                disabled={permanentDeleteLoading}
                className="px-4 py-2 text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={permanentDeleteLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {permanentDeleteLoading && <div className="animate-spin w-3 h-3 border-2 border-white/20 border-t-white rounded-full" />}
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
