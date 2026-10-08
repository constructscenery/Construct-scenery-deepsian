'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar from '@/components/TopBar';
import RequireRole from '@/components/RequireRole';
import { useAuth } from '@/contexts/AuthContext';
import {
  productionsApi,
  unitListsApi,
  type Production,
  type UnitList,
} from '@/lib/api';
import {
  FileText,
  Search,
  Upload,
  Download,
  ExternalLink,
  Trash2,
  Pencil,
  X,
  Loader2,
  Calendar,
  Building2,
  User,
  Mail,
  Phone,
  Filter,
  RefreshCw,
  Plus,
  FileCheck,
  Eye,
} from 'lucide-react';

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d;
  }
};

const fmtBytes = (bytes: number | string | null) => {
  if (!bytes) return '';
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(n) || n === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export default function UnitListsPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator', 'guest']}>
      <UnitListsContent />
    </RequireRole>
  );
}

function UnitListsContent() {
  const { user } = useAuth();
  const isGuest = user?.role === 'guest';
  const canEdit = !isGuest;

  // Data states
  const [unitLists, setUnitLists] = useState<UnitList[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter states
  const [globalSearch, setGlobalSearch] = useState('');
  const [filterPdfName, setFilterPdfName] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [filterNumber, setFilterNumber] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterProductionId, setFilterProductionId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Modal states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingItem, setEditingItem] = useState<UnitList | null>(null);
  const [previewItem, setPreviewItem] = useState<UnitList | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [lists, prods] = await Promise.all([
        unitListsApi.list(),
        productionsApi.list().catch(() => []),
      ]);
      setUnitLists(lists);
      setProductions(prods);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load unit lists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Client-side filtering across all filter criteria
  const filteredList = useMemo(() => {
    return unitLists.filter(item => {
      // Global search
      if (globalSearch.trim()) {
        const q = globalSearch.toLowerCase();
        const matches =
          (item.file_name && item.file_name.toLowerCase().includes(q)) ||
          (item.name && item.name.toLowerCase().includes(q)) ||
          (item.email && item.email.toLowerCase().includes(q)) ||
          (item.phone_number && item.phone_number.toLowerCase().includes(q)) ||
          (item.company_name && item.company_name.toLowerCase().includes(q)) ||
          (item.production_name && item.production_name.toLowerCase().includes(q)) ||
          (item.notes && item.notes.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // Name of PDF
      if (filterPdfName.trim()) {
        if (!item.file_name.toLowerCase().includes(filterPdfName.toLowerCase().trim())) {
          return false;
        }
      }

      // Contact Name
      if (filterName.trim()) {
        if (!item.name || !item.name.toLowerCase().includes(filterName.toLowerCase().trim())) {
          return false;
        }
      }

      // Email
      if (filterEmail.trim()) {
        if (!item.email || !item.email.toLowerCase().includes(filterEmail.toLowerCase().trim())) {
          return false;
        }
      }

      // Number / Phone
      if (filterNumber.trim()) {
        if (!item.phone_number || !item.phone_number.toLowerCase().includes(filterNumber.toLowerCase().trim())) {
          return false;
        }
      }

      // Company name
      if (filterCompany.trim()) {
        if (!item.company_name || !item.company_name.toLowerCase().includes(filterCompany.toLowerCase().trim())) {
          return false;
        }
      }

      // Production
      if (filterProductionId) {
        if (item.production_id !== filterProductionId) return false;
      }

      // Date range
      if (filterDateFrom && item.date && item.date < filterDateFrom) return false;
      if (filterDateTo && item.date && item.date > filterDateTo) return false;

      return true;
    });
  }, [
    unitLists,
    globalSearch,
    filterPdfName,
    filterName,
    filterEmail,
    filterNumber,
    filterCompany,
    filterProductionId,
    filterDateFrom,
    filterDateTo,
  ]);

  const hasActiveFilters = Boolean(
    globalSearch ||
    filterPdfName ||
    filterName ||
    filterEmail ||
    filterNumber ||
    filterCompany ||
    filterProductionId ||
    filterDateFrom ||
    filterDateTo
  );

  const clearFilters = () => {
    setGlobalSearch('');
    setFilterPdfName('');
    setFilterName('');
    setFilterEmail('');
    setFilterNumber('');
    setFilterCompany('');
    setFilterProductionId('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const handleDelete = async (id: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete unit list "${fileName}"?`)) return;
    setDeletingId(id);
    try {
      await unitListsApi.delete(id);
      setUnitLists(prev => prev.filter(u => u.id !== id));
      if (previewItem?.id === id) setPreviewItem(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenPdf = (item: UnitList) => {
    setPreviewItem(item);
  };

  const handleOpenPdfNewTab = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const url = unitListsApi.viewUrl(id);
    window.open(url, '_blank');
  };

  return (
    <>
      <TopBar
        title="Unit Lists"
        subtitle="Production-supplied crew contact directories and unit list PDF archives"
      />

      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">
        {/* Header / Summary / Action Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <FileText size={20} />
                </span>
                <h1 className="text-lg font-bold text-slate-900">Unit Lists Directory</h1>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Upload production unit lists to refer back to at any stage and maintain contact details of external crew and production contacts.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                title="Refresh list"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>

              {canEdit && (
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors"
                >
                  <Plus size={16} />
                  <span>Upload Unit List</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
            <div className="bg-slate-50 rounded-lg p-2.5">
              <span className="text-slate-400 block font-medium">Total Unit Lists</span>
              <span className="text-base font-bold text-slate-800">{unitLists.length}</span>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <span className="text-slate-400 block font-medium">Filtered Results</span>
              <span className="text-base font-bold text-blue-600">{filteredList.length}</span>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <span className="text-slate-400 block font-medium">Productions</span>
              <span className="text-base font-bold text-slate-800">
                {new Set(unitLists.map(u => u.production_name).filter(Boolean)).size}
              </span>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <span className="text-slate-400 block font-medium">Named Contacts</span>
              <span className="text-base font-bold text-emerald-600">
                {unitLists.filter(u => u.name || u.phone_number || u.email).length}
              </span>
            </div>
          </div>
        </div>

        {/* Filters Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            {/* Quick search input */}
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                placeholder="Search across PDF names, contacts, emails, numbers, companies..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {globalSearch && (
                <button
                  onClick={() => setGlobalSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Production dropdown */}
            <select
              value={filterProductionId}
              onChange={e => setFilterProductionId(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Productions</option>
              {productions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {/* Toggle advanced filters */}
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                showAdvancedFilters || hasActiveFilters
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Filter size={14} />
              <span>{showAdvancedFilters ? 'Hide Specific Filters' : 'Filter by Fields'}</span>
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-blue-600" />
              )}
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-slate-500 hover:text-rose-600 underline font-medium whitespace-nowrap"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Specific Filters Row (Date, PDF Name, Name, Email, Number, Company) */}
          {showAdvancedFilters && (
            <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Name of PDF</label>
                <input
                  type="text"
                  value={filterPdfName}
                  onChange={e => setFilterPdfName(e.target.value)}
                  placeholder="e.g. Dyson_Unit_List.pdf"
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={filterName}
                  onChange={e => setFilterName(e.target.value)}
                  placeholder="e.g. John Carpenter"
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Email</label>
                <input
                  type="text"
                  value={filterEmail}
                  onChange={e => setFilterEmail(e.target.value)}
                  placeholder="e.g. john@dyson.com"
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={filterNumber}
                  onChange={e => setFilterNumber(e.target.value)}
                  placeholder="e.g. +44 7700..."
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Company Name</label>
                <input
                  type="text"
                  value={filterCompany}
                  onChange={e => setFilterCompany(e.target.value)}
                  placeholder="e.g. Stunt Riggers Ltd"
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={e => setFilterDateFrom(e.target.value)}
                    className="w-full px-1.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    title="From date"
                  />
                  <span className="text-slate-300">–</span>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={e => setFilterDateTo(e.target.value)}
                    className="w-full px-1.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    title="To date"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')}><X size={16} /></button>
          </div>
        )}

        {/* Unit Lists Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Unit List PDF</th>
                  <th className="px-4 py-3">Production</th>
                  <th className="px-4 py-3">Contact Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone Number</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3.5">
                          <div className="h-4 bg-slate-100 rounded w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-14 text-center">
                      <FileText size={40} className="mx-auto text-slate-300 mb-3" />
                      <p className="text-slate-700 text-sm font-semibold">
                        {hasActiveFilters ? 'No matching unit lists found' : 'No unit lists uploaded yet'}
                      </p>
                      <p className="text-slate-400 text-xs mt-1 max-w-md mx-auto">
                        {hasActiveFilters
                          ? 'Try clearing or adjusting your search filters to find what you need.'
                          : 'Upload your first production unit list PDF to keep track of external crew contacts and production directories.'}
                      </p>
                      {hasActiveFilters ? (
                        <button
                          onClick={clearFilters}
                          className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                        >
                          Clear Filters
                        </button>
                      ) : canEdit && (
                        <button
                          onClick={() => setShowUploadModal(true)}
                          className="mt-3.5 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                        >
                          <Plus size={14} /> Upload Unit List
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredList.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors group">
                      {/* Date */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600 font-medium">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={13} className="text-slate-400" />
                          <span>{fmtDate(item.date)}</span>
                        </div>
                      </td>

                      {/* PDF File */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-2 max-w-xs">
                          <span className="p-1.5 bg-rose-50 text-rose-600 rounded mt-0.5 shrink-0">
                            <FileText size={15} />
                          </span>
                          <div className="min-w-0">
                            <button
                              onClick={() => handleOpenPdf(item)}
                              className="font-medium text-slate-800 hover:text-blue-600 text-xs truncate block text-left transition-colors"
                              title="Click to view PDF"
                            >
                              {item.file_name}
                            </button>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                              {item.file_size && <span>{fmtBytes(item.file_size)}</span>}
                              {item.notes && (
                                <span className="truncate max-w-[140px]" title={item.notes}>
                                  • {item.notes}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Production */}
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        {item.production_name ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-medium text-[11px]">
                            {item.production_name}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Contact Name */}
                      <td className="px-4 py-3.5 text-xs font-medium text-slate-800">
                        {item.name ? (
                          <div className="flex items-center gap-1.5">
                            <User size={13} className="text-slate-400 shrink-0" />
                            <span>{item.name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        {item.email ? (
                          <a
                            href={`mailto:${item.email}`}
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <Mail size={12} className="shrink-0" />
                            <span className="truncate max-w-[150px]">{item.email}</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Phone Number */}
                      <td className="px-4 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {item.phone_number ? (
                          <a
                            href={`tel:${item.phone_number}`}
                            className="inline-flex items-center gap-1 text-slate-700 hover:text-blue-600"
                          >
                            <Phone size={12} className="text-slate-400 shrink-0" />
                            <span>{item.phone_number}</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Company Name */}
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        {item.company_name ? (
                          <div className="flex items-center gap-1">
                            <Building2 size={12} className="text-slate-400 shrink-0" />
                            <span className="truncate max-w-[140px]">{item.company_name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenPdf(item)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition-colors"
                            title="Preview PDF"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={(e) => handleOpenPdfNewTab(item.id, e)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition-colors"
                            title="Open in new window"
                          >
                            <ExternalLink size={15} />
                          </button>
                          <button
                            onClick={() => unitListsApi.download(item.id, item.file_name)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 rounded transition-colors"
                            title="Download PDF"
                          >
                            <Download size={15} />
                          </button>

                          {canEdit && (
                            <>
                              <button
                                onClick={() => setEditingItem(item)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 rounded transition-colors"
                                title="Edit details"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(item.id, item.file_name)}
                                disabled={deletingId === item.id}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition-colors disabled:opacity-50"
                                title="Delete unit list"
                              >
                                {deletingId === item.id ? (
                                  <Loader2 size={15} className="animate-spin text-rose-600" />
                                ) : (
                                  <Trash2 size={15} />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <UnitListUploadModal
          productions={productions}
          onClose={() => setShowUploadModal(false)}
          onCreated={(created) => {
            setShowUploadModal(false);
            setUnitLists(prev => [created, ...prev]);
          }}
        />
      )}

      {/* Edit Modal */}
      {editingItem && (
        <UnitListEditModal
          item={editingItem}
          productions={productions}
          onClose={() => setEditingItem(null)}
          onUpdated={(updated) => {
            setEditingItem(null);
            setUnitLists(prev => prev.map(u => (u.id === updated.id ? updated : u)));
          }}
        />
      )}

      {/* PDF Preview Modal */}
      {previewItem && (
        <UnitListPdfViewerModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface UnitListUploadModalProps {
  productions: Production[];
  onClose: () => void;
  onCreated: (item: UnitList) => void;
}

function UnitListUploadModal({ productions, onClose, onCreated }: UnitListUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [productionId, setProductionId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [company, setCompany] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (!selected.name.toLowerCase().endsWith('.pdf') && selected.type !== 'application/pdf') {
        setError('Please select a valid PDF file.');
        return;
      }
      setFile(selected);
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a PDF file to upload.');
      return;
    }

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);
    if (date) formData.append('date', date);
    if (productionId) formData.append('production_id', productionId);
    if (name.trim()) formData.append('name', name.trim());
    if (email.trim()) formData.append('email', email.trim());
    if (phone.trim()) formData.append('number', phone.trim());
    if (company.trim()) formData.append('company_name', company.trim());
    if (notes.trim()) formData.append('notes', notes.trim());

    try {
      const created = await unitListsApi.upload(formData);
      onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-slate-900 font-semibold text-base flex items-center gap-2">
              <Upload size={17} className="text-blue-600" />
              Upload Unit List PDF
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Attach a unit list PDF with optional crew contact details</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg p-3">{error}</p>}

          {/* File Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Unit List PDF File <span className="text-rose-500">*</span>
            </label>
            <input
              type="file"
              ref={fileInputRef}
              accept="application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                file
                  ? 'border-emerald-300 bg-emerald-50/40 text-emerald-800'
                  : 'border-slate-300 hover:border-blue-400 bg-slate-50 text-slate-600'
              }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-xs font-medium text-emerald-700">
                  <FileCheck size={18} className="text-emerald-600" />
                  <span className="truncate max-w-xs">{file.name}</span>
                  <span className="text-emerald-500 text-[10px]">({fmtBytes(file.size)})</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload size={20} className="mx-auto text-slate-400" />
                  <p className="text-xs font-medium text-slate-700">Click to choose or drag & drop Unit List PDF</p>
                  <p className="text-[11px] text-slate-400">PDF up to 25 MB</p>
                </div>
              )}
            </div>
          </div>

          {/* Row: Date & Production */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Production (optional)</label>
              <select
                value={productionId}
                onChange={e => setProductionId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Unassigned —</option>
                {productions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Optional Contact Details (Nullable)
            </span>

            {/* Row: Contact Name & Company */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Company Name</label>
                <input
                  type="text"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="e.g. Pinewood Rigging"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Row: Email & Phone Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="e.g. sarah@production.co.uk"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="e.g. +44 7700 900456"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="mt-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes / Roles</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Production office contact, art director phone number..."
                rows={2}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm"
            >
              {uploading && <Loader2 size={15} className="animate-spin" />}
              <span>{uploading ? 'Uploading...' : 'Save Unit List'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface UnitListEditModalProps {
  item: UnitList;
  productions: Production[];
  onClose: () => void;
  onUpdated: (item: UnitList) => void;
}

function UnitListEditModal({ item, productions, onClose, onUpdated }: UnitListEditModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState<string>(item.date || '');
  const [productionId, setProductionId] = useState<string>(item.production_id || '');
  const [name, setName] = useState<string>(item.name || '');
  const [email, setEmail] = useState<string>(item.email || '');
  const [phone, setPhone] = useState<string>(item.phone_number || '');
  const [company, setCompany] = useState<string>(item.company_name || '');
  const [notes, setNotes] = useState<string>(item.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (!selected.name.toLowerCase().endsWith('.pdf') && selected.type !== 'application/pdf') {
        setError('Please select a valid PDF file.');
        return;
      }
      setFile(selected);
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const formData = new FormData();
    if (file) formData.append('file', file);
    formData.append('date', date);
    formData.append('production_id', productionId);
    formData.append('name', name.trim());
    formData.append('email', email.trim());
    formData.append('number', phone.trim());
    formData.append('company_name', company.trim());
    formData.append('notes', notes.trim());

    try {
      const updated = await unitListsApi.update(item.id, formData);
      onUpdated(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-slate-900 font-semibold text-base flex items-center gap-2">
              <Pencil size={16} className="text-blue-600" />
              Edit Unit List Details
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-sm">{item.file_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg p-3">{error}</p>}

          {/* Replace File (Optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Replace PDF File <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="file"
              ref={fileInputRef}
              accept="application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-slate-300 rounded-lg p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <FileText size={16} className="text-slate-400" />
                <span className="truncate max-w-[220px]">
                  {file ? file.name : `Current: ${item.file_name}`}
                </span>
              </div>
              <span className="text-[11px] font-medium text-blue-600">Choose new PDF</span>
            </div>
          </div>

          {/* Date & Production */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Production</label>
              <select
                value={productionId}
                onChange={e => setProductionId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Unassigned —</option>
                {productions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Contact Details */}
          <div className="pt-2 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Contact Details (Nullable)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Company Name</label>
                <input
                  type="text"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="e.g. Pinewood Rigging"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="e.g. sarah@production.co.uk"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="e.g. +44 7700 900456"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes / Roles</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Production office contact, art director phone number..."
                rows={2}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              <span>{saving ? 'Saving...' : 'Update Details'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF VIEWER MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface UnitListPdfViewerModalProps {
  item: UnitList;
  onClose: () => void;
}

function UnitListPdfViewerModal({ item, onClose }: UnitListPdfViewerModalProps) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let active = true;
    let url = '';
    setLoading(true);
    setError('');

    unitListsApi.viewBlob(item.id)
      .then(blob => {
        if (!active) return;
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        url = URL.createObjectURL(pdfBlob);
        setBlobUrl(url);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load PDF document.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id]);

  const handleOpenNewTab = () => {
    const url = unitListsApi.viewUrl(item.id);
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 md:p-6" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-white shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-rose-50 text-rose-600 rounded">
                <FileText size={16} />
              </span>
              <h2 className="text-sm font-bold text-slate-900 truncate">{item.file_name}</h2>
              {item.production_name && (
                <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full shrink-0">
                  {item.production_name}
                </span>
              )}
            </div>
            {(item.name || item.company_name || item.email || item.phone_number) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-1">
                {item.name && <span className="font-medium text-slate-700">{item.name}</span>}
                {item.company_name && <span>• {item.company_name}</span>}
                {item.phone_number && <span>• {item.phone_number}</span>}
                {item.email && <span>• {item.email}</span>}
                {item.date && <span>• {fmtDate(item.date)}</span>}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleOpenNewTab}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              title="Open in new window"
            >
              <ExternalLink size={13} />
              <span className="hidden sm:inline">New Tab</span>
            </button>
            <button
              onClick={() => unitListsApi.download(item.id, item.file_name)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
              title="Download PDF"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors ml-1"
              title="Close viewer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Viewer Content */}
        <div className="flex-1 min-h-0 bg-slate-100 p-2 sm:p-4">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 size={28} className="animate-spin text-blue-600" />
              <p className="text-sm font-medium text-slate-600">Loading PDF document...</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
              <div className="p-3 bg-red-50 text-red-600 rounded-full">
                <FileText size={32} />
              </div>
              <p className="text-sm font-semibold text-slate-800">{error}</p>
              <button
                onClick={handleOpenNewTab}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                <ExternalLink size={14} /> Open Directly in Browser
              </button>
            </div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              title={item.file_name}
              className="w-full h-full rounded-xl border border-slate-200 bg-white shadow-sm"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
