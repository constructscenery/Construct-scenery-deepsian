'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { materialsCatalogueApi, materialsInventoryApi, productionsApi, type MaterialsCatalogueItem, type MaterialsInventoryItem, type MaterialsInventorySummaryItem, type Production, type Supplier, supplierApi } from '@/lib/api';
import {
  Plus,
  Search,
  X,
  Loader2,
  AlertCircle,
  Upload,
  Pencil,
  Trash2,
  FileText,
  CheckCircle2,
  Download,
  Package,
  Boxes,
} from 'lucide-react';
import { EmptyStateRow } from '@/components/EmptyState';

// ─── Helpers ───────────────────────────────────────────────────────────────────
const fmtGBP = (n: number | string | null | undefined) =>
  '£' + parseFloat(String(n || 0)).toFixed(2);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

// ─── Types ─────────────────────────────────────────────────────────────────────
type FormData = {
  material_name: string;
  description: string;
  category: string;
  supplier_name: string;
  unit_of_measure: string;
  unit_price: string;
  price_updated_date: string;
  notes: string;
};

const EMPTY_FORM: FormData = {
  material_name: '',
  description: '',
  category: '',
  supplier_name: '',
  unit_of_measure: '',
  unit_price: '',
  price_updated_date: '',
  notes: '',
};

type InventoryFormData = {
  material_id: string;
  quantity: string;
  production_id: string;
  location: string;
  notes: string;
};

const EMPTY_INVENTORY_FORM: InventoryFormData = {
  material_id: '', quantity: '', production_id: '', location: '', notes: '',
};

// ─── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100 animate-pulse">
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-3 bg-slate-200 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
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

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function MaterialsCataloguePage() {
  const { user } = useAuth();
  const role = user?.role ?? '';

  const isGuest = role === 'guest';
  const isCoordinator = role === 'construction_coordinator';
  const canWrite = !isGuest;
  const isReadOnly = isGuest;

  // ── Data state ──
  const [items, setItems] = useState<MaterialsCatalogueItem[]>([]);
  const [inventory, setInventory] = useState<MaterialsInventoryItem[]>([]);
  const [inventorySummary, setInventorySummary] = useState<MaterialsInventorySummaryItem[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filter state ──
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierOptions, setShowSupplierOptions] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalogue' | 'inventory'>('catalogue');

  // ── Add/Edit modal ──
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<MaterialsCatalogueItem | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [editInventory, setEditInventory] = useState<MaterialsInventoryItem | null>(null);
  const [inventoryForm, setInventoryForm] = useState<InventoryFormData>(EMPTY_INVENTORY_FORM);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // ── Delete state ──
  const [deleteTarget, setDeleteTarget] = useState<MaterialsCatalogueItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── CSV Import modal ──
  const [showImport, setShowImport] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Toast ──
  const [toast, setToast] = useState<string | null>(null);

  // ── Load data ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        materialsCatalogueApi.list(),
        supplierApi.list(),
        materialsInventoryApi.list(),
        productionsApi.list(),
        materialsInventoryApi.summary(),
      ]);
      if (results[0].status === 'fulfilled') setItems(results[0].value);
      if (results[1].status === 'fulfilled') setSuppliers(results[1].value);
      if (results[2].status === 'fulfilled') setInventory(results[2].value);
      if (results[3].status === 'fulfilled') setProductions(results[3].value);
      if (results[4].status === 'fulfilled') setInventorySummary(results[4].value);
    } catch {
      // silently fail — table shows empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Filtered + sorted items ──
  const filtered = items
    .filter((item) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        (item.material_name || item.product_description).toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q) ||
        (item.supplier_name || '').toLowerCase().includes(q);
      const matchSupplier =
        !supplierFilter || item.supplier_name === supplierFilter;
      const matchCategory = !categoryFilter || item.category === categoryFilter;
      return matchSearch && matchSupplier && matchCategory;
    })
    .sort((a, b) => (a.material_name || a.product_description).localeCompare(b.material_name || b.product_description));

  const categories = Array.from(new Set(items.map(item => item.category).filter((value): value is string => !!value))).sort();
  const stockTotalsFor = (materialId: string) => inventorySummary
    .filter(row => row.material_id === materialId)
    .reduce((totals, row) => ({
      bought: totals.bought + Number(row.total_bought || 0),
      remaining: totals.remaining + Number(row.remaining_stock || 0),
    }), { bought: 0, remaining: 0 });

  async function handleRestock(item: MaterialsInventoryItem) {
    const value = window.prompt(`How much ${item.unit_of_measure} would you like to add to ${item.material_name}?`);
    if (value === null) return;
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setToast('Enter a restock quantity greater than zero.');
      return;
    }
    try {
      await materialsInventoryApi.restock(item.id, quantity);
      setToast('Stock restocked successfully.');
      await loadData();
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : 'Restock failed.');
    }
  }

  // ── Open add modal ──
  function openAdd() {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setSupplierSearch('');
    setFormError('');
    setShowModal(true);
  }

  // ── Open edit modal ──
  function openEdit(item: MaterialsCatalogueItem) {
    setEditItem(item);
    setForm({
      material_name: item.material_name || item.product_description,
      description: item.description || item.product_description,
      category: item.category || '',
      supplier_name: item.supplier_name || '',
      unit_of_measure: item.unit_of_measure || '',
      unit_price: String(item.unit_price),
      price_updated_date: item.price_updated_date || '',
      notes: item.notes ?? '',
    });
    setSupplierSearch(item.supplier_name || '');
    setFormError('');
    setShowModal(true);
  }

  // ── Save (create or update) ──
  async function handleSave() {
    setFormError('');
    if (!form.material_name.trim()) { setFormError('Material name is required.'); return; }
    if (!form.description.trim()) { setFormError('Description is required.'); return; }
    if (!form.supplier_name.trim()) { setFormError('Supplier is required.'); return; }
    if (!form.unit_of_measure.trim()) { setFormError('Unit of measure is required.'); return; }
    if (!form.unit_price || isNaN(parseFloat(form.unit_price)) || parseFloat(form.unit_price) < 0) {
      setFormError('A valid unit price is required.');
      return;
    }

    setFormLoading(true);
    try {
      const payload: Partial<MaterialsCatalogueItem> = {
        material_name: form.material_name.trim(),
        description: form.description.trim(),
        category: form.category.trim() || null,
        supplier_name: form.supplier_name.trim() || null,
        product_description: form.description.trim(),
        unit_of_measure: form.unit_of_measure.trim(),
        unit_price: parseFloat(form.unit_price),
        price_updated_date: form.price_updated_date || null,
        notes: form.notes.trim() || null,
      };

      if (editItem) {
        await materialsCatalogueApi.update(editItem.id, payload);
        setToast('Entry updated successfully.');
      } else {
        await materialsCatalogueApi.create(payload);
        setToast('Entry added to catalogue.');
      }

      setShowModal(false);
      await loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setFormLoading(false);
    }
  }

  function openInventoryAdd() {
    setEditInventory(null);
    setInventoryForm(EMPTY_INVENTORY_FORM);
    setInventoryError('');
    setShowInventoryModal(true);
  }

  function openInventoryEdit(item: MaterialsInventoryItem) {
    setEditInventory(item);
    setInventoryForm({
      material_id: item.material_id,
      quantity: String(item.quantity),
      production_id: item.production_id || '',
      location: item.location || '',
      notes: item.notes || '',
    });
    setInventoryError('');
    setShowInventoryModal(true);
  }

  async function handleInventorySave() {
    setInventoryError('');
    if (!inventoryForm.material_id) { setInventoryError('Select a catalogue material.'); return; }
    if (!inventoryForm.quantity || Number(inventoryForm.quantity) < 0) { setInventoryError('Enter a non-negative quantity.'); return; }
    setInventoryLoading(true);
    try {
      const payload = {
        material_id: inventoryForm.material_id,
        quantity: parseFloat(inventoryForm.quantity),
        production_id: inventoryForm.production_id || null,
        location: inventoryForm.location.trim() || null,
        notes: inventoryForm.notes.trim() || null,
      };
      if (editInventory) await materialsInventoryApi.update(editInventory.id, payload);
      else await materialsInventoryApi.create(payload);
      setShowInventoryModal(false);
      setToast(editInventory ? 'Inventory record updated.' : 'Inventory record added.');
      await loadData();
    } catch (err: unknown) {
      setInventoryError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setInventoryLoading(false);
    }
  }

  async function handleInventoryDelete(item: MaterialsInventoryItem) {
    if (!window.confirm(`Remove ${item.material_name} from current held stock?`)) return;
    await materialsInventoryApi.delete(item.id);
    setToast('Inventory record removed.');
    await loadData();
  }

  // ── Delete ──
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await materialsCatalogueApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      setToast('Entry removed from catalogue.');
      await loadData();
    } catch {
      // ignore — item might already be gone
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── CSV Import ──
  async function handleImport() {
    if (!csvFile) { setImportError('Please select a CSV file.'); return; }
    setImportLoading(true);
    setImportError('');
    try {
      const fd = new FormData();
      fd.append('csv', csvFile);
      const result = await materialsCatalogueApi.importCSV(fd);
      setImportResult(result);
      await loadData();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImportLoading(false);
    }
  }

  function closeImportModal() {
    setShowImport(false);
    setCsvFile(null);
    setImportError('');
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <TopBar
        title="Materials Catalogue"
        subtitle={
          loading
            ? 'Loading catalogue…'
            : `${items.length} ${items.length === 1 ? 'entry' : 'entries'} in catalogue`
        }
      />

      <main className="flex-1 p-4 md:p-6 space-y-4">

        <div className="flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('catalogue')}
            className={`px-4 py-2.5 text-sm font-normal border-b-2 ${activeTab === 'catalogue' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600'}`}
          >
            Materials Catalogue
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2.5 text-sm font-normal border-b-2 ${activeTab === 'inventory' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600'}`}
          >
            Current Held Stock
          </button>
        </div>

        {activeTab === 'catalogue' && <>

          {/* Filter bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 gap-3">

              {/* Left: search + supplier filter */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-64">
                  <Search size={14} className="text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, category, supplier…"
                    className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Supplier filter dropdown */}
                <select
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All suppliers</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All categories</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>

                {/* Read-only badge for non-coordinators */}
                {isReadOnly && (
                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full font-medium">
                    Read-only
                  </span>
                )}
              </div>

              {/* Right: action buttons */}
              {canWrite && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => { setShowImport(true); setImportResult(null); setImportError(''); setCsvFile(null); }}
                    className="flex items-center justify-center gap-2 text-sm border border-slate-200 text-slate-600 rounded-lg px-4 py-2 hover:bg-slate-50 transition-colors font-medium whitespace-nowrap"
                  >
                    <Upload size={14} />
                    Import CSV
                  </button>
                  <button
                    onClick={openAdd}
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                  >
                    <Plus size={14} />
                    Add Entry
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Table card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 text-left border-b border-slate-100">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Material Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Description</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Category</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Supplier</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Unit of Measure</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right whitespace-nowrap">Current Unit Price (£)</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Price Updated</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Total Bought</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Remaining Stock</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Notes</th>
                    {canWrite && (
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading
                    ? Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)
                    : filtered.length === 0
                      ? (
                        items.length === 0 ? (
                          <EmptyStateRow
                            colSpan={canWrite ? 11 : 10}
                            icon={Package}
                            title="No catalogue materials yet"
                            description="The master materials price book is currently empty."
                            recommendation="Add standard stock materials, sheet goods, timber, steel, or import a supplier price list via CSV."
                            action={canWrite ? {
                              label: 'Add Material',
                              onClick: openAdd,
                              icon: Plus,
                            } : undefined}
                            secondaryAction={canWrite ? {
                              label: 'Import CSV',
                              onClick: () => setShowImport(true),
                            } : undefined}
                          />
                        ) : (
                          <EmptyStateRow
                            colSpan={canWrite ? 11 : 10}
                            icon={AlertCircle}
                            title="No matching materials"
                            description="No materials match your current category, supplier, or text search."
                            recommendation="Try clearing your search query or selecting 'All categories'."
                            action={{
                              label: 'Clear Filters',
                              onClick: () => { setSearch(''); setSupplierFilter(''); setCategoryFilter(''); },
                              icon: X,
                            }}
                          />
                        )
                      )
                      : filtered.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <p className="text-slate-800 font-semibold text-sm">{item.material_name || item.product_description}</p>
                            <p className="text-slate-400 text-[10px] mt-0.5">Updated {fmtDate(item.updated_at)}</p>
                          </td>
                          <td className="px-4 py-3.5 text-slate-700 text-sm max-w-[220px]">
                            {item.description || item.product_description}
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 text-sm">
                            {item.category || '—'}
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 text-sm">
                            {item.supplier_name || '—'}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="inline-block text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-medium">
                              {item.unit_of_measure}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-900 font-semibold text-sm text-right whitespace-nowrap">
                            {fmtGBP(item.unit_price)}
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 text-sm whitespace-nowrap">
                            {item.price_updated_date ? fmtDate(item.price_updated_date) : '—'}
                          </td>
                          <td className="px-4 py-3.5 text-slate-700 text-sm whitespace-nowrap">
                            {stockTotalsFor(item.id).bought || '—'} {stockTotalsFor(item.id).bought ? item.unit_of_measure : ''}
                          </td>
                          <td className="px-4 py-3.5 text-slate-700 text-sm whitespace-nowrap">
                            {stockTotalsFor(item.id).remaining || '—'} {stockTotalsFor(item.id).remaining ? item.unit_of_measure : ''}
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 text-xs max-w-[200px] truncate">
                            {item.notes ?? <span className="text-slate-300">—</span>}
                          </td>
                          {canWrite && (
                            <td className="px-4 py-3.5">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => openEdit(item)}
                                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors font-medium border border-slate-200"
                                >
                                  <Pencil size={11} />
                                  Edit
                                </button>
                                <button
                                  onClick={() => setDeleteTarget(item)}
                                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium border border-red-100"
                                >
                                  <Trash2 size={11} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {/* Footer count */}
            {!loading && filtered.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
                <p className="text-slate-400 text-xs">
                  Showing {filtered.length} of {items.length} {items.length === 1 ? 'entry' : 'entries'}
                  {(search || supplierFilter || categoryFilter) ? ' — filtered' : ''}
                </p>
              </div>
            )}
          </div>
        </>}

        {activeTab === 'inventory' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-800 font-semibold text-base">Current Held Stock</h2>
                <p className="text-slate-400 text-xs mt-0.5">Materials physically held by Construct Scenery.</p>
              </div>
              {canWrite && <button onClick={openInventoryAdd} className="flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 font-medium"><Plus size={14} /> Add Stock</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead><tr className="bg-slate-50 text-left border-b border-slate-100">
                  {['Material', 'Description', 'Category', 'Total Bought', 'Remaining', 'Unit', 'Production', 'Location', 'Notes', 'Actions'].map(header => <th key={header} className="px-4 py-3 text-xs font-semibold text-slate-500">{header}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {inventory.length === 0 ? (
                    <EmptyStateRow
                      colSpan={10}
                      icon={Boxes}
                      title="No physical stock recorded"
                      description="No inventory items are currently tracked in workshop storage."
                      recommendation="Log stored timber, steel, hardware, or paints returned from builds to track asset valuation."
                      action={canWrite ? {
                        label: 'Add Stock Item',
                        onClick: () => setShowInventoryModal(true),
                        icon: Plus,
                      } : undefined}
                    />
                  ) : inventory.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-slate-800 font-medium">{item.material_name}</td>
                      <td className="px-4 py-3 text-slate-600">{item.description || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{item.category || '—'}</td>
                      <td className="px-4 py-3 text-slate-800">{item.quantity_purchased}</td>
                      <td className="px-4 py-3 text-slate-800">{item.quantity}</td>
                      <td className="px-4 py-3 text-slate-600">{item.unit_of_measure}</td>
                      <td className="px-4 py-3 text-slate-600">{item.production_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{item.location || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate">{item.notes || '—'}</td>
                      <td className="px-4 py-3"><div className="flex gap-1"><button onClick={() => handleRestock(item)} className="p-1.5 text-slate-500 hover:text-emerald-600" title="Restock"><Plus size={14} /></button><button onClick={() => openInventoryEdit(item)} className="p-1.5 text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={14} /></button><button onClick={() => handleInventoryDelete(item)} className="p-1.5 text-slate-500 hover:text-red-600" title="Delete"><Trash2 size={14} /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            onClick={() => { if (!formLoading) setShowModal(false); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">
                  {editItem ? 'Edit Catalogue Entry' : 'Add Catalogue Entry'}
                </h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  {editItem
                    ? `Editing: ${editItem.material_name || editItem.product_description}`
                    : 'Add a material to the living price catalogue'}
                </p>
              </div>
              <button
                onClick={() => { if (!formLoading) setShowModal(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">

              {/* Material name and description */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Material Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.material_name}
                  onChange={(e) => setForm((f) => ({ ...f, material_name: e.target.value }))}
                  placeholder="e.g. 18mm Birch Plywood Sheet"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe the material and specification" className={inputCls + ' resize-none'} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                  <input type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. timber, paint, fixings" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Supplier <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input
                      type="search"
                      value={supplierSearch}
                      onFocus={() => setShowSupplierOptions(true)}
                      onChange={(e) => { setSupplierSearch(e.target.value); setForm((f) => ({ ...f, supplier_name: e.target.value })); setShowSupplierOptions(true); }}
                      placeholder="Search suppliers..."
                      className={inputCls}
                    />
                    {showSupplierOptions && (
                      <>
                        <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setShowSupplierOptions(false)} aria-label="Close supplier list" />
                        <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                          {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                            <button
                              type="button"
                              key={s.id}
                              onClick={() => { setSupplierSearch(s.name); setForm((f) => ({ ...f, supplier_name: s.name })); setShowSupplierOptions(false); }}
                              className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50"
                            >
                              <span className="block">{s.name}</span>
                              {s.category && <span className="block text-xs text-slate-400">{s.category}</span>}
                            </button>
                          ))}
                          {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No suppliers found.</p>}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Unit of Measure + Unit Price side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Unit of Measure <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.unit_of_measure}
                    onChange={(e) => setForm((f) => ({ ...f, unit_of_measure: e.target.value }))}
                    placeholder="e.g. sheet, m², litre"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Current Unit Price (£) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unit_price}
                    onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date Price Last Updated</label>
                <input type="date" value={form.price_updated_date} onChange={(e) => setForm((f) => ({ ...f, price_updated_date: e.target.value }))} className={inputCls} />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional — e.g. price valid until Dec 2025, minimum order 10 units"
                  className={inputCls + ' resize-none'}
                />
              </div>

              {/* Error */}
              {formError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} />
                  {formError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button
                onClick={() => { if (!formLoading) setShowModal(false); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={formLoading}
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60"
              >
                {formLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : editItem
                    ? <Pencil size={14} />
                    : <Plus size={14} />}
                {editItem ? 'Save Changes' : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInventoryModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => { if (!inventoryLoading) setShowInventoryModal(false); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">{editInventory ? 'Edit Held Stock' : 'Add Held Stock'}</h2>
                <p className="text-slate-400 text-xs mt-0.5">Select a catalogue material to populate its details.</p>
              </div>
              <button onClick={() => { if (!inventoryLoading) setShowInventoryModal(false); }} className="p-2 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Material <span className="text-red-500">*</span></label>
                <select value={inventoryForm.material_id} onChange={(e) => setInventoryForm((f) => ({ ...f, material_id: e.target.value }))} className={inputCls}>
                  <option value="">Select a catalogue material</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.material_name || item.product_description}</option>)}
                </select>
              </div>
              {(() => {
                const selected = items.find(item => item.id === inventoryForm.material_id);
                if (!selected) return null;
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div><span className="block text-[10px] uppercase text-slate-400">Description</span><span className="text-sm text-slate-700">{selected.description || selected.product_description}</span></div>
                    <div><span className="block text-[10px] uppercase text-slate-400">Category</span><span className="text-sm text-slate-700">{selected.category || '—'}</span></div>
                    <div><span className="block text-[10px] uppercase text-slate-400">Unit</span><span className="text-sm text-slate-700">{selected.unit_of_measure || '—'}</span></div>
                  </div>
                );
              })()}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Quantity currently held *</label><input type="number" min="0" step="0.01" value={inventoryForm.quantity} onChange={(e) => setInventoryForm((f) => ({ ...f, quantity: e.target.value }))} className={inputCls} /></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Production purchased for</label><select value={inventoryForm.production_id} onChange={(e) => setInventoryForm((f) => ({ ...f, production_id: e.target.value }))} className={inputCls}><option value="">Not production-specific</option>{productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{productions.length === 0 && <p className="text-xs text-amber-600 mt-1">No active productions are available.</p>}</div>
              </div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Location held</label><input type="text" value={inventoryForm.location} onChange={(e) => setInventoryForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Main workshop, Bay 2" className={inputCls} /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1">Notes</label><textarea rows={2} value={inventoryForm.notes} onChange={(e) => setInventoryForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls + ' resize-none'} /></div>
              {inventoryError && <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2"><AlertCircle size={13} />{inventoryError}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl"><button onClick={() => { if (!inventoryLoading) setShowInventoryModal(false); }} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg">Cancel</button><button disabled={inventoryLoading} onClick={handleInventorySave} className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">{inventoryLoading && <Loader2 size={14} className="animate-spin" />}{editInventory ? 'Save Changes' : 'Add Stock'}</button></div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            onClick={() => { if (!deleteLoading) setDeleteTarget(null); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={18} className="text-red-600" />
                </div>
                <div>
                  <h2 className="text-slate-900 font-semibold text-base">Delete Entry</h2>
                  <p className="text-slate-500 text-xs mt-0.5">This action cannot be undone.</p>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <p className="text-slate-800 font-medium text-sm">{deleteTarget.supplier_name}</p>
                <p className="text-slate-500 text-xs mt-0.5">{deleteTarget.product_description}</p>
                <p className="text-slate-400 text-xs mt-0.5">{fmtGBP(deleteTarget.unit_price)} per {deleteTarget.unit_of_measure}</p>
              </div>
              <p className="text-slate-500 text-xs">
                Are you sure you want to remove this entry from the catalogue?
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button
                onClick={() => { if (!deleteLoading) setDeleteTarget(null); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={deleteLoading}
                onClick={handleDelete}
                className="flex items-center gap-2 px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-60"
              >
                {deleteLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import Modal ─────────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            onClick={() => { if (!importLoading) closeImportModal(); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">Import Catalogue CSV</h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Upload a CSV to bulk-import supplier price entries
                </p>
              </div>
              <button
                onClick={() => { if (!importLoading) closeImportModal(); }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">

              {importResult ? (
                /* Success state */
                <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-green-600" />
                    <p className="text-green-800 font-semibold text-sm">Import complete</p>
                  </div>
                  <p className="text-green-700 text-sm pl-6">
                    <span className="font-bold">{importResult.imported}</span>{' '}
                    {importResult.imported === 1 ? 'item' : 'items'} imported successfully.
                  </p>
                </div>
              ) : (
                <>
                  {/* Template download link */}
                  <div className="flex items-center gap-2 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                    <Download size={13} className="text-blue-500 flex-shrink-0" />
                    <span>
                      Need the correct format?{' '}
                      <button
                        type="button"
                        className="text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer"
                        onClick={async () => {
                          const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
                          const res = await fetch('/api/materials-catalogue/template', {
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                          });
                          if (!res.ok) return;
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'materials_catalogue_template.csv';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Download CSV template
                      </button>
                    </span>
                  </div>

                  {/* File drop zone */}
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                    <Upload size={22} className="text-slate-400 mb-2" />
                    <span className="text-slate-600 text-sm font-medium">
                      {csvFile ? csvFile.name : 'Click to select a CSV file'}
                    </span>
                    {csvFile ? (
                      <span className="text-slate-400 text-xs mt-0.5">
                        {(csvFile.size / 1024).toFixed(1)} KB
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs mt-0.5">CSV files only</span>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setCsvFile(f);
                        setImportError('');
                      }}
                    />
                  </label>

                  {importError && (
                    <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <AlertCircle size={13} />
                      {importError}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              {importResult ? (
                <button
                  onClick={closeImportModal}
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { if (!importLoading) closeImportModal(); }}
                    className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!csvFile || importLoading}
                    onClick={handleImport}
                    className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60"
                  >
                    {importLoading
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Upload size={14} />}
                    Import
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toast notification ───────────────────────────────────────────────── */}
      {toast && (
        <Toast message={toast} onClose={() => setToast(null)} />
      )}
    </>
  );
}
