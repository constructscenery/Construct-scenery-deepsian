'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import TopBar from '@/components/TopBar';
import {
  Truck, Wrench, ShieldAlert, AlertTriangle, CheckCircle2, Clock,
  Plus, Search, Filter, Pencil, Trash2, Calendar, FileText,
  Building2, ArrowRight, RefreshCw, Download, Check, X,
  ChevronRight, ExternalLink, Sparkles, User, AlertCircle
} from 'lucide-react';
import {
  vehiclesApi, hireEquipmentApi, assetsHireApi, productionsApi, suppliersApi,
  Vehicle, HireEquipment, AssetsHireSummary, Production, Supplier,
  VehicleComplianceStatus, VehicleComplianceInfo
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtCurrency = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0);

const VEHICLE_TYPES = ['Van', 'Flatbed', 'Luton', 'Car', 'Truck', 'Trailer', 'Minibus', 'Other'];
const EQUIPMENT_TYPES = [
  'Telehandler', 'Forklift', 'Scissor Lift', 'Boom Lift', 'Cherry Picker',
  'Generator', 'Compressor', 'Mini Digger', 'Excavator', 'Tower Scaffolding',
  'Dust Extractor', 'Heater / Dryer', 'Other'
];

export default function AssetsHirePage() {
  const { user } = useAuth();

  // Active sub-module tab
  const [activeTab, setActiveTab] = useState<'vehicles' | 'hire'>('vehicles');

  // Data states
  const [summary, setSummary] = useState<AssetsHireSummary | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [hireList, setHireList] = useState<HireEquipment[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states - Vehicles
  const [vSearch, setVSearch] = useState('');
  const [vTypeFilter, setVTypeFilter] = useState('');
  const [vStatusFilter, setVStatusFilter] = useState('');

  // Filter states - Hire Equipment
  const [hSearch, setHSearch] = useState('');
  const [hStatusFilter, setHStatusFilter] = useState<'all' | 'active' | 'returned'>('all');
  const [hProdFilter, setHProdFilter] = useState('');

  // Modals
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const [showHireModal, setShowHireModal] = useState(false);
  const [editingHire, setEditingHire] = useState<HireEquipment | null>(null);

  const [returnModalItem, setReturnModalItem] = useState<HireEquipment | null>(null);
  const [returnDateInput, setReturnDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [returnNotesInput, setReturnNotesInput] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'vehicle' | 'hire'; id: string; name: string } | null>(null);
  const [complianceChecking, setComplianceChecking] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isCoordinatorOrMD = true;
  const isAccountant = false;

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // ─── Fetch All Data ─────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, vehRes, hireRes, prodList, suppList] = await Promise.all([
        assetsHireApi.getSummary().catch(() => ({ summary: null })),
        vehiclesApi.getAll().catch(() => ({ vehicles: [] })),
        hireEquipmentApi.getAll().catch(() => ({ hire_equipment: [] })),
        productionsApi.list().catch(() => [] as Production[]),
        suppliersApi.list().catch(() => [] as Supplier[]),
      ]);

      if (sumRes?.summary) setSummary(sumRes.summary);
      setVehicles(vehRes?.vehicles || []);
      setHireList(hireRes?.hire_equipment || []);
      setProductions(Array.isArray(prodList) ? prodList : []);
      setSuppliers(Array.isArray(suppList) ? suppList : []);
    } catch (err: unknown) {
      console.error('Error loading assets & hire data:', err);
      showToast('error', 'Failed to load module data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Filtered Lists ─────────────────────────────────────────────────────────

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const matchesSearch = !vSearch || [
        v.registration_number, v.make, v.model, v.number_plate, v.owner_assigned_to, v.notes
      ].some(val => val?.toLowerCase().includes(vSearch.toLowerCase()));

      const matchesType = !vTypeFilter || v.vehicle_type?.toLowerCase() === vTypeFilter.toLowerCase();

      let matchesStatus = true;
      if (vStatusFilter === 'attention_needed') {
        matchesStatus = v.overall_status === 'overdue' || v.overall_status === 'due_soon';
      } else if (vStatusFilter) {
        matchesStatus = v.overall_status === vStatusFilter;
      }

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [vehicles, vSearch, vTypeFilter, vStatusFilter]);

  const filteredHireList = useMemo(() => {
    return hireList.filter(h => {
      const matchesSearch = !hSearch || [
        h.equipment_type, h.supplier_name, h.description, h.production_name, h.notes
      ].some(val => val?.toLowerCase().includes(hSearch.toLowerCase()));

      const matchesStatus = hStatusFilter === 'all' || h.status === hStatusFilter;
      const matchesProd = !hProdFilter || h.production_id === hProdFilter;

      return matchesSearch && matchesStatus && matchesProd;
    });
  }, [hireList, hSearch, hStatusFilter, hProdFilter]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleReturnEquipment = async () => {
    if (!returnModalItem) return;
    try {
      await hireEquipmentApi.return(returnModalItem.id, {
        return_date: returnDateInput,
        notes: returnNotesInput,
      });
      showToast('success', `${returnModalItem.equipment_type} marked as returned`);
      setReturnModalItem(null);
      loadData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Return failed');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'vehicle') {
        await vehiclesApi.delete(deleteTarget.id);
        showToast('success', `Vehicle ${deleteTarget.name} deleted`);
      } else {
        await hireEquipmentApi.delete(deleteTarget.id);
        showToast('success', `Hire record ${deleteTarget.name} deleted`);
      }
      setDeleteTarget(null);
      loadData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleTriggerComplianceCheck = async () => {
    setComplianceChecking(true);
    try {
      const res = await vehiclesApi.triggerComplianceCheck();
      showToast('success', `Compliance scan complete: ${res.sent} alert email(s) sent, ${res.skipped} up to date.`);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setComplianceChecking(false);
    }
  };

  const exportHireCSV = () => {
    if (!filteredHireList.length) {
      showToast('error', 'No hire records to export');
      return;
    }
    const headers = ['Equipment Type', 'Hire Company', 'Production', 'Start Date', 'Return Date', 'Status', 'Weekly Rate (£)', 'Weeks Hired', 'Total Cost (£)', 'Notes'];
    const rows = filteredHireList.map(h => [
      `"${h.equipment_type.replace(/"/g, '""')}"`,
      `"${h.supplier_name.replace(/"/g, '""')}"`,
      `"${(h.production_name || '').replace(/"/g, '""')}"`,
      h.hire_start_date,
      h.return_date || 'Active',
      h.status,
      h.weekly_hire_rate.toFixed(2),
      h.weeks_hired || 1,
      (h.total_cost || 0).toFixed(2),
      `"${(h.notes || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Hire_Equipment_Register_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-slate-50 min-h-screen text-slate-800">
      <TopBar title="Module 8 — Assets & Hire Equipment" />

      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          notification.type === 'success' ? 'bg-emerald-600 text-white shadow-emerald-600/20' : 'bg-rose-600 text-white shadow-rose-600/20'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{notification.message}</span>
        </div>
      )}

      <main className="p-4 md:p-6 space-y-4 md:space-y-5 max-w-7xl w-full mx-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-sm">
                <Truck size={22} />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Assets & Hire Equipment</h1>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Centralised company vehicle compliance register and production equipment hire tracker
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {isCoordinatorOrMD && (
              <>
                <button
                  onClick={handleTriggerComplianceCheck}
                  disabled={complianceChecking}
                  title="Scan for MOT, Insurance and Tax deadlines within 30 days and dispatch email alerts"
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition-all shadow-sm disabled:opacity-50"
                >
                  <RefreshCw size={14} className={complianceChecking ? 'animate-spin text-blue-600' : 'text-slate-500'} />
                  <span>Scan Compliance</span>
                </button>

                {activeTab === 'vehicles' ? (
                  <button
                    onClick={() => { setEditingVehicle(null); setShowVehicleModal(true); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
                  >
                    <Plus size={15} />
                    <span>Add Vehicle</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setEditingHire(null); setShowHireModal(true); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
                  >
                    <Plus size={15} />
                    <span>Record Equipment Hire</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Top KPI Metrics Bar */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Fleet Vehicles</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-slate-900">{summary?.total_vehicles ?? vehicles.length}</span>
              <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                <Truck size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">Company-owned</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Due ≤ 30 Days</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-amber-600">{summary?.deadlines_due_soon ?? 0}</span>
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-100">
                <AlertTriangle size={16} />
              </div>
            </div>
            <span className="text-[11px] text-amber-600 font-medium mt-1">MOT / Ins / Tax</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Overdue</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-rose-600">{summary?.deadlines_overdue ?? 0}</span>
              <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg border border-rose-100">
                <ShieldAlert size={16} />
              </div>
            </div>
            <span className="text-[11px] text-rose-600 font-medium mt-1">Expired items</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Hires</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold text-emerald-600">{summary?.active_hires_count ?? 0}</span>
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                <Wrench size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">On active sites</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Weekly Run Rate</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-xl font-bold text-slate-900">{fmtCurrency(summary?.active_weekly_run_rate)}</span>
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                <Clock size={16} />
              </div>
            </div>
            <span className="text-[11px] text-blue-600 font-medium mt-1">Current weekly cost</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Hire Spend</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-xl font-bold text-slate-900">{fmtCurrency(summary?.total_hire_cost_to_date)}</span>
              <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg border border-purple-100">
                <Building2 size={16} />
              </div>
            </div>
            <span className="text-[11px] text-slate-400 mt-1">Across productions</span>
          </div>
        </div>

        {/* Sub-module Tab Switcher */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-0">
          <button
            onClick={() => setActiveTab('vehicles')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all ${
              activeTab === 'vehicles'
                ? 'border-blue-600 text-blue-600 bg-blue-50/40 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <Truck size={17} />
            <span>9.2 Vehicle Asset Register</span>
            <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              activeTab === 'vehicles' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
            }`}>
              {vehicles.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('hire')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all ${
              activeTab === 'hire'
                ? 'border-blue-600 text-blue-600 bg-blue-50/40 rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <Wrench size={17} />
            <span>9.4 Hire Equipment Tracker</span>
            <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              activeTab === 'hire' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
            }`}>
              {hireList.length}
            </span>
          </button>
        </div>

        {/* ─── TAB 1: VEHICLE ASSET REGISTER ─────────────────────────────────── */}
        {activeTab === 'vehicles' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search registration, make, model, assigned person..."
                  value={vSearch}
                  onChange={e => setVSearch(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2.5 flex-wrap">
                <select
                  value={vTypeFilter}
                  onChange={e => setVTypeFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Vehicle Types</option>
                  {VEHICLE_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                <select
                  value={vStatusFilter}
                  onChange={e => setVStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Compliance States</option>
                  <option value="attention_needed">⚠️ Attention Needed (Due ≤30d / Overdue)</option>
                  <option value="compliant">🟢 Fully Compliant (&gt;30d)</option>
                  <option value="due_soon">🟡 Due Soon (≤30d)</option>
                  <option value="overdue">🔴 Expired / Overdue</option>
                </select>
              </div>
            </div>

            {/* Vehicles Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3.5">Registration & Plate</th>
                      <th className="px-4 py-3.5">Make & Model</th>
                      <th className="px-4 py-3.5">Type & Colour</th>
                      <th className="px-4 py-3.5">Assigned To</th>
                      <th className="px-4 py-3.5">MOT Expiry</th>
                      <th className="px-4 py-3.5">Insurance Renewal</th>
                      <th className="px-4 py-3.5">Tax (VED) Renewal</th>
                      <th className="px-4 py-3.5">Status</th>
                      {isCoordinatorOrMD && <th className="px-4 py-3.5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                          <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-blue-600" />
                          <span>Loading fleet vehicle register…</span>
                        </td>
                      </tr>
                    ) : filteredVehicles.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                          <Truck size={28} className="mx-auto mb-2 text-slate-300" />
                          <p className="font-semibold text-slate-700 text-sm">No vehicles found</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {vehicles.length === 0 ? 'Click "Add Vehicle" to register company-owned fleet assets.' : 'Try adjusting your search or compliance filters.'}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredVehicles.map(v => (
                        <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900 text-sm">{v.registration_number}</div>
                            {v.number_plate && v.number_plate !== v.registration_number && (
                              <div className="text-[11px] text-slate-400 font-mono">Plate: {v.number_plate}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{v.make} {v.model}</div>
                            {v.year_of_manufacture && (
                              <div className="text-[11px] text-slate-400">Year: {v.year_of_manufacture}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-800">{v.vehicle_type || '—'}</div>
                            {v.colour && <div className="text-[11px] text-slate-400">{v.colour}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 text-slate-800">
                              <User size={13} className="text-slate-400" />
                              <span>{v.owner_assigned_to || 'Unassigned'}</span>
                            </div>
                          </td>

                          {/* MOT Badge */}
                          <td className="px-4 py-3">
                            <ComplianceBadge compliance={v.mot_compliance} defaultDate={v.mot_expiry_date} />
                          </td>

                          {/* Insurance Badge */}
                          <td className="px-4 py-3">
                            <ComplianceBadge compliance={v.insurance_compliance} defaultDate={v.insurance_renewal_date} />
                          </td>

                          {/* Tax Badge */}
                          <td className="px-4 py-3">
                            <ComplianceBadge compliance={v.tax_compliance} defaultDate={v.tax_renewal_date} />
                          </td>

                          {/* Overall Status */}
                          <td className="px-4 py-3">
                            <OverallStatusBadge status={v.overall_status} />
                          </td>

                          {/* Actions */}
                          {isCoordinatorOrMD && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => { setEditingVehicle(v); setShowVehicleModal(true); }}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Edit vehicle"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => setDeleteTarget({ type: 'vehicle', id: v.id, name: `${v.make} ${v.model} (${v.registration_number})` })}
                                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  title="Delete vehicle"
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
          </div>
        )}

        {/* ─── TAB 2: HIRE EQUIPMENT TRACKER ─────────────────────────────────── */}
        {activeTab === 'hire' && (
          <div className="space-y-4">
            {/* Filter & Export Bar */}
            <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm justify-between">
              <div className="flex flex-col sm:flex-row gap-2.5 flex-1">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search equipment, supplier, production..."
                    value={hSearch}
                    onChange={e => setHSearch(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-2 flex-wrap">
                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
                    <button
                      onClick={() => setHStatusFilter('all')}
                      className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                        hStatusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      All ({hireList.length})
                    </button>
                    <button
                      onClick={() => setHStatusFilter('active')}
                      className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                        hStatusFilter === 'active' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Active ({hireList.filter(x => x.status === 'active').length})
                    </button>
                    <button
                      onClick={() => setHStatusFilter('returned')}
                      className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                        hStatusFilter === 'returned' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Returned ({hireList.filter(x => x.status === 'returned').length})
                    </button>
                  </div>

                  <select
                    value={hProdFilter}
                    onChange={e => setHProdFilter(e.target.value)}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Productions</option>
                    {productions.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={exportHireCSV}
                  className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-all shadow-sm"
                >
                  <Download size={14} className="text-slate-500" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Hire Equipment Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3.5">Equipment Type & Details</th>
                      <th className="px-4 py-3.5">Supplier / Company</th>
                      <th className="px-4 py-3.5">Production</th>
                      <th className="px-4 py-3.5">Hire Dates</th>
                      <th className="px-4 py-3.5 text-right">Weekly Rate</th>
                      <th className="px-4 py-3.5 text-center">Weeks Hired</th>
                      <th className="px-4 py-3.5 text-right">Total Cost to Date</th>
                      <th className="px-4 py-3.5">Status</th>
                      {isCoordinatorOrMD && <th className="px-4 py-3.5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                          <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-blue-600" />
                          <span>Loading equipment hire records…</span>
                        </td>
                      </tr>
                    ) : filteredHireList.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                          <Wrench size={28} className="mx-auto mb-2 text-slate-300" />
                          <p className="font-semibold text-slate-700 text-sm">No hire records found</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {hireList.length === 0 ? 'Click "Record Equipment Hire" to log plant and equipment hires.' : 'Try adjusting your search or filters.'}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredHireList.map(h => (
                        <tr key={h.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900 text-sm">{h.equipment_type}</div>
                            {h.description && (
                              <div className="text-[11px] text-slate-500 max-w-xs truncate">{h.description}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{h.supplier_name}</div>
                            {h.supplier_official_name && h.supplier_official_name !== h.supplier_name && (
                              <div className="text-[11px] text-slate-400">{h.supplier_official_name}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-blue-600">{h.production_name || '—'}</div>
                            {h.production_status && (
                              <div className="text-[10px] text-slate-400 uppercase tracking-wider">{h.production_status.replace('_', ' ')}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-800">Start: <span className="font-medium">{fmtDate(h.hire_start_date)}</span></div>
                            <div className="text-[11px] text-slate-500">
                              Return: {h.return_date ? <span className="font-medium text-slate-700">{fmtDate(h.return_date)}</span> : <span className="text-emerald-600 font-semibold">Ongoing (Active)</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">
                            {fmtCurrency(h.weekly_hire_rate)}/wk
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {h.weeks_hired || 1} wks
                              <span className="text-[10px] text-slate-400 ml-1">({h.days_hired || 0}d)</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600 text-sm">
                            {fmtCurrency(h.total_cost)}
                          </td>
                          <td className="px-4 py-3">
                            {h.status === 'active' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Active Hire
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                <CheckCircle2 size={12} className="text-slate-400" />
                                Returned
                              </span>
                            )}
                          </td>
                          {isCoordinatorOrMD && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {h.status === 'active' && (
                                  <button
                                    onClick={() => {
                                      setReturnModalItem(h);
                                      setReturnDateInput(new Date().toISOString().split('T')[0]);
                                      setReturnNotesInput(h.notes || '');
                                    }}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-colors"
                                    title="Close hire loop"
                                  >
                                    Return
                                  </button>
                                )}
                                <button
                                  onClick={() => { setEditingHire(h); setShowHireModal(true); }}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Edit hire details"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => setDeleteTarget({ type: 'hire', id: h.id, name: `${h.equipment_type} (${h.supplier_name})` })}
                                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  title="Delete record"
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
          </div>
        )}
      </main>

      {/* ─── MODAL 1: ADD / EDIT VEHICLE ──────────────────────────────────────── */}
      {showVehicleModal && (
        <VehicleFormModal
          vehicle={editingVehicle}
          onClose={() => { setShowVehicleModal(false); setEditingVehicle(null); }}
          onSaved={() => { setShowVehicleModal(false); setEditingVehicle(null); loadData(); }}
          showToast={showToast}
        />
      )}

      {/* ─── MODAL 2: RECORD / EDIT HIRE EQUIPMENT ────────────────────────────── */}
      {showHireModal && (
        <HireFormModal
          hire={editingHire}
          productions={productions}
          suppliers={suppliers}
          onClose={() => { setShowHireModal(false); setEditingHire(null); }}
          onSaved={() => { setShowHireModal(false); setEditingHire(null); loadData(); }}
          showToast={showToast}
        />
      )}

      {/* ─── MODAL 3: RETURN EQUIPMENT (CLOSE LOOP) ───────────────────────────── */}
      {returnModalItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-bold">
                <CheckCircle2 size={18} className="text-emerald-600" />
                <span>Return & Close Hire Record</span>
              </div>
              <button onClick={() => setReturnModalItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900 text-sm">{returnModalItem.equipment_type}</div>
              <div className="text-slate-600">Supplier: <span className="font-medium text-slate-800">{returnModalItem.supplier_name}</span></div>
              <div className="text-slate-600">Production: <span className="font-medium text-slate-800">{returnModalItem.production_name}</span></div>
              <div className="text-slate-600">Rate: <span className="font-medium text-slate-800">{fmtCurrency(returnModalItem.weekly_hire_rate)}/week</span></div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Return Date *</label>
                <input
                  type="date"
                  value={returnDateInput}
                  onChange={e => setReturnDateInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Off-hire Notes / Ref Code</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Off-hire code OFF-88219, collected by Nationwide driver"
                  value={returnNotesInput}
                  onChange={e => setReturnNotesInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                onClick={() => setReturnModalItem(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReturnEquipment}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm"
              >
                Confirm Return & Lock Costs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 4: DELETE CONFIRMATION ─────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-900">
            <div className="flex items-center gap-3 text-rose-600 font-bold">
              <div className="p-2 bg-rose-50 rounded-xl border border-rose-100">
                <Trash2 size={18} />
              </div>
              <span className="text-base">Delete {deleteTarget.type === 'vehicle' ? 'Vehicle' : 'Hire Record'}?</span>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to delete <span className="font-semibold text-slate-900">&ldquo;{deleteTarget.name}&rdquo;</span>?
              This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm"
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-Component: Compliance Deadline Badge ─────────────────────────────────

function ComplianceBadge({
  compliance,
  defaultDate,
}: {
  compliance?: VehicleComplianceInfo;
  defaultDate: string | null | undefined;
}) {
  if (!defaultDate) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">Not Set</span>;
  }

  const status = compliance?.status || 'compliant';
  const days = compliance?.days_remaining;

  if (status === 'overdue') {
    return (
      <div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <ShieldAlert size={11} className="text-rose-600" />
          {fmtDate(defaultDate)}
        </span>
        <div className="text-[10px] text-rose-600 font-semibold mt-0.5">
          {days !== null && days !== undefined ? `${Math.abs(days)}d OVERDUE` : 'EXPIRED'}
        </div>
      </div>
    );
  }

  if (status === 'due_soon') {
    return (
      <div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <AlertTriangle size={11} className="text-amber-600" />
          {fmtDate(defaultDate)}
        </span>
        <div className="text-[10px] text-amber-700 font-semibold mt-0.5">
          {days !== null && days !== undefined ? `${days}d remaining` : 'Due soon'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 size={11} className="text-emerald-600" />
        {fmtDate(defaultDate)}
      </span>
      {days !== null && days !== undefined && (
        <div className="text-[10px] text-slate-400 mt-0.5">
          {days}d remaining
        </div>
      )}
    </div>
  );
}

// ─── Sub-Component: Overall Vehicle Status Badge ──────────────────────────────

function OverallStatusBadge({ status }: { status?: string }) {
  if (status === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        <ShieldAlert size={12} className="text-rose-600" />
        Overdue Action
      </span>
    );
  }
  if (status === 'due_soon') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle size={12} className="text-amber-600" />
        Deadline Due
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 size={12} className="text-emerald-600" />
      Compliant
    </span>
  );
}

// ─── Modal Component: Vehicle Add / Edit Form ─────────────────────────────────

function VehicleFormModal({
  vehicle,
  onClose,
  onSaved,
  showToast,
}: {
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (type: 'success' | 'error', message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const isEdit = !!vehicle;

  const [regNumber, setRegNumber] = useState(vehicle?.registration_number || '');
  const [make, setMake] = useState(vehicle?.make || '');
  const [model, setModel] = useState(vehicle?.model || '');
  const [year, setYear] = useState<string>(vehicle?.year_of_manufacture?.toString() || '');
  const [numberPlate, setNumberPlate] = useState(vehicle?.number_plate || '');
  const [colour, setColour] = useState(vehicle?.colour || '');
  const [vehicleType, setVehicleType] = useState(vehicle?.vehicle_type || 'Van');
  const [assignedTo, setAssignedTo] = useState(vehicle?.owner_assigned_to || '');
  const [notes, setNotes] = useState(vehicle?.notes || '');

  const [motDate, setMotDate] = useState(vehicle?.mot_expiry_date || '');
  const [insDate, setInsDate] = useState(vehicle?.insurance_renewal_date || '');
  const [taxDate, setTaxDate] = useState(vehicle?.tax_renewal_date || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regNumber.trim() || !make.trim() || !model.trim()) {
      showToast('error', 'Registration number, make, and model are required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        registration_number: regNumber.trim().toUpperCase(),
        make: make.trim(),
        model: model.trim(),
        year_of_manufacture: year ? parseInt(year, 10) : undefined,
        number_plate: (numberPlate || regNumber).trim().toUpperCase(),
        colour: colour.trim() || undefined,
        vehicle_type: vehicleType.trim() || undefined,
        owner_assigned_to: assignedTo.trim() || undefined,
        notes: notes.trim() || undefined,
        mot_expiry_date: motDate || undefined,
        insurance_renewal_date: insDate || undefined,
        tax_renewal_date: taxDate || undefined,
      };

      if (isEdit && vehicle) {
        await vehiclesApi.update(vehicle.id, payload);
        showToast('success', `Vehicle ${payload.registration_number} updated`);
      } else {
        await vehiclesApi.create(payload);
        showToast('success', `Vehicle ${payload.registration_number} added to fleet`);
      }
      onSaved();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl text-slate-900 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
              <Truck size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{isEdit ? 'Edit Fleet Vehicle' : 'Add Vehicle to Asset Register'}</h2>
              <p className="text-xs text-slate-500">Track specifications, assignments and automated 30-day compliance alerts</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto text-xs flex-1">
            {/* 1. Core Specification */}
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 pb-1 border-b border-slate-100">
                1. Vehicle Identification & Specification
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Registration Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS24 HQX"
                    value={regNumber}
                    onChange={e => setRegNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono font-bold uppercase focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Make *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mercedes-Benz"
                    value={make}
                    onChange={e => setMake(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Model *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sprinter 315 Luton"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Vehicle Type</label>
                  <select
                    value={vehicleType}
                    onChange={e => setVehicleType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {VEHICLE_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Year of Manufacture</label>
                  <input
                    type="number"
                    min="1990"
                    max="2030"
                    placeholder="e.g. 2023"
                    value={year}
                    onChange={e => setYear(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Colour</label>
                  <input
                    type="text"
                    placeholder="e.g. White"
                    value={colour}
                    onChange={e => setColour(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Number Plate</label>
                  <input
                    type="text"
                    placeholder="If different"
                    value={numberPlate}
                    onChange={e => setNumberPlate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 2. Assignment */}
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 pb-1 border-b border-slate-100">
                2. Assignment & Operational Notes
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Assigned To / Keyholder</label>
                  <input
                    type="text"
                    placeholder="e.g. Warren Lever / Sian Lynn Jones"
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Notes / Features</label>
                  <input
                    type="text"
                    placeholder="e.g. 500kg tail lift, strap bars, tracker fitted"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 3. Compliance Deadlines */}
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 pb-1 border-b border-slate-100 flex items-center justify-between">
                <span>3. Compliance Deadlines & Automated Alerts</span>
                <span className="text-[10px] text-blue-600 font-normal lowercase">30-day email alerts triggered daily</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-800 font-semibold">
                    <Calendar size={13} className="text-blue-600" />
                    <span>MOT Expiry Date</span>
                  </div>
                  <input
                    type="date"
                    value={motDate}
                    onChange={e => setMotDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-800 font-semibold">
                    <Calendar size={13} className="text-amber-600" />
                    <span>Insurance Renewal</span>
                  </div>
                  <input
                    type="date"
                    value={insDate}
                    onChange={e => setInsDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-800 font-semibold">
                    <Calendar size={13} className="text-emerald-600" />
                    <span>Tax (VED) Renewal</span>
                  </div>
                  <input
                    type="date"
                    value={taxDate}
                    onChange={e => setTaxDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <RefreshCw size={12} className="animate-spin" />}
              <span>{isEdit ? 'Save Changes' : 'Add Vehicle'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Component: Hire Equipment Add / Edit Form ──────────────────────────

function HireFormModal({
  hire,
  productions,
  suppliers,
  onClose,
  onSaved,
  showToast,
}: {
  hire: HireEquipment | null;
  productions: Production[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (type: 'success' | 'error', message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const isEdit = !!hire;

  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>(suppliers);
  const [showQuickSupplierModal, setShowQuickSupplierModal] = useState(false);

  useEffect(() => {
    setLocalSuppliers(suppliers);
  }, [suppliers]);

  const [equipmentType, setEquipmentType] = useState(hire?.equipment_type || '');
  const [supplierName, setSupplierName] = useState(hire?.supplier_name || '');
  const [supplierId, setSupplierId] = useState<string>(hire?.supplier_id || '');
  const [description, setDescription] = useState(hire?.description || '');
  const [productionId, setProductionId] = useState<string>(hire?.production_id || (productions[0]?.id || ''));
  const [startDate, setStartDate] = useState(hire?.hire_start_date || new Date().toISOString().split('T')[0]);
  const [weeklyRate, setWeeklyRate] = useState<string>(hire?.weekly_hire_rate?.toString() || '');
  const [returnDate, setReturnDate] = useState(hire?.return_date || '');
  const [notes, setNotes] = useState(hire?.notes || '');

  // Live estimated cost calculation
  const calculatedMetrics = useMemo(() => {
    if (!startDate || !weeklyRate) return { weeks: 1, total: 0 };
    const start = new Date(startDate);
    const end = returnDate ? new Date(returnDate) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const weeks = diffDays === 0 ? 1 : Math.ceil(diffDays / 7);
    const rate = parseFloat(weeklyRate) || 0;
    return { weeks, total: rate * weeks, days: diffDays };
  }, [startDate, returnDate, weeklyRate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipmentType.trim() || !supplierName.trim() || !productionId || !startDate || weeklyRate === '') {
      showToast('error', 'Equipment type, supplier name, production, start date, and weekly hire rate are required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        equipment_type: equipmentType.trim(),
        supplier_name: supplierName.trim(),
        supplier_id: supplierId || undefined,
        description: description.trim() || undefined,
        production_id: productionId,
        hire_start_date: startDate,
        weekly_hire_rate: parseFloat(weeklyRate) || 0,
        return_date: returnDate || undefined,
        notes: notes.trim() || undefined,
      };

      if (isEdit && hire) {
        await hireEquipmentApi.update(hire.id, payload);
        showToast('success', `Hire record for ${payload.equipment_type} updated`);
      } else {
        await hireEquipmentApi.create(payload);
        showToast('success', `Hire recorded for ${payload.equipment_type}`);
      }
      onSaved();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl text-slate-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                <Wrench size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">{isEdit ? 'Edit Equipment Hire Record' : 'Record Plant & Equipment Hire'}</h2>
                <p className="text-xs text-slate-500">Live elapsed weeks & automatic weekly run rate calculation</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="p-6 space-y-4 overflow-y-auto text-xs flex-1">
              {/* 1. Equipment Details */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 pb-1 border-b border-slate-100">
                  1. Plant / Equipment Identification
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Equipment Type *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Telehandler 14m / Scissor Lift 10m"
                      list="equipment-type-suggestions"
                      value={equipmentType}
                      onChange={e => setEquipmentType(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    />
                    <datalist id="equipment-type-suggestions">
                      {EQUIPMENT_TYPES.map(t => <option key={t} value={t} />)}
                    </datalist>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-700 font-semibold">Hire Supplier / Company *</label>
                      <button
                        type="button"
                        onClick={() => setShowQuickSupplierModal(true)}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5 hover:underline"
                      >
                        <Plus size={12} />
                        <span>Add New Supplier</span>
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <select
                        required
                        value={supplierId || (supplierName ? `name:${supplierName}` : '')}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '__ADD_NEW__') {
                            setShowQuickSupplierModal(true);
                          } else if (val.startsWith('name:')) {
                            const customName = val.replace('name:', '');
                            setSupplierName(customName);
                            setSupplierId('');
                          } else {
                            const found = localSuppliers.find(s => s.id === val);
                            if (found) {
                              setSupplierId(found.id);
                              setSupplierName(found.name);
                            } else {
                              setSupplierId('');
                              setSupplierName('');
                            }
                          }
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                      >
                        <option value="">Select a hire supplier from list...</option>
                        <option value="__ADD_NEW__" className="text-blue-600 font-bold bg-blue-50">
                          ➕ + Add New Supplier to Database...
                        </option>
                        {localSuppliers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.city ? `(${s.city})` : ''}
                          </option>
                        ))}
                        {supplierName && !localSuppliers.some(s => s.id === supplierId || s.name.toLowerCase() === supplierName.toLowerCase()) && (
                          <option value={`name:${supplierName}`}>
                            {supplierName} (Custom)
                          </option>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowQuickSupplierModal(true)}
                        className="px-2.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors shadow-sm"
                        title="Add New Supplier to Database"
                      >
                        <Plus size={13} />
                        <span>New</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-slate-700 font-semibold mb-1">Specification / Serial / Description</label>
                  <input
                    type="text"
                    placeholder="e.g. 14m reach, non-marking tyres, generator attachment, SN: NW-99201"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* 2. Production & Financials */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 pb-1 border-b border-slate-100">
                  2. Linked Production & Hire Terms
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Allocated Production *</label>
                    <select
                      required
                      value={productionId}
                      onChange={e => setProductionId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                      {productions.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.contract_type === 'cost_plus' ? 'Cost Plus' : 'On a Price'})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Weekly Hire Rate (£ ex. VAT) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-semibold">£</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="e.g. 450.00"
                        value={weeklyRate}
                        onChange={e => setWeeklyRate(e.target.value)}
                        className="w-full pl-7 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Hire Start Date *</label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      Return Date <span className="text-slate-400 font-normal">(Leave empty if ongoing)</span>
                    </label>
                    <input
                      type="date"
                      value={returnDate}
                      onChange={e => setReturnDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Live Calculation Preview Banner */}
              <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="text-blue-700 font-semibold">Live Computed Duration & Spend</span>
                  <p className="text-blue-600 text-[11px] mt-0.5">
                    {calculatedMetrics.days} days elapsed → billed as <span className="font-bold">{calculatedMetrics.weeks} week(s)</span>
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold">Total Cost to Date</span>
                  <p className="text-base font-bold text-blue-800 font-mono">{fmtCurrency(calculatedMetrics.total)}</p>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Operational Notes / Off-hire Ref</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Delivered to stage 2 workshop. Key held with construction coordinator."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <RefreshCw size={12} className="animate-spin" />}
                <span>{isEdit ? 'Save Changes' : 'Record Equipment Hire'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Quick Add Supplier Modal Sub-dialog */}
      {showQuickSupplierModal && (
        <QuickAddSupplierModal
          onClose={() => setShowQuickSupplierModal(false)}
          onCreated={newSupp => {
            setLocalSuppliers(prev => [newSupp, ...prev.filter(s => s.id !== newSupp.id)]);
            setSupplierId(newSupp.id);
            setSupplierName(newSupp.name);
            setShowQuickSupplierModal(false);
          }}
          showToast={showToast}
        />
      )}
    </>
  );
}

// ─── Sub-Component: Quick Add Supplier Modal ─────────────────────────────────

function QuickAddSupplierModal({
  onClose,
  onCreated,
  showToast,
}: {
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
  showToast: (type: 'success' | 'error', message: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Supplier company name is required');
      return;
    }
    setSaving(true);
    try {
      const created = await suppliersApi.create({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        street_name: street.trim() || undefined,
        city: city.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      showToast('success', `Supplier "${created.name}" registered in database`);
      onCreated(created);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create supplier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
              <Building2 size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Add New Hire Supplier</h3>
              <p className="text-xs text-slate-500">Save supplier to database and immediately allocate to this hire</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Company / Supplier Name *</label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. Nationwide Platforms Ltd"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Contact Email</label>
              <input
                type="email"
                placeholder="hire@nationwideplatforms.co.uk"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Phone Number</label>
              <input
                type="tel"
                placeholder="0808 100 4882"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Street Address</label>
              <input
                type="text"
                placeholder="e.g. Central Depot, Plant Way"
                value={street}
                onChange={e => setStreet(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">City / Depot Location</label>
              <input
                type="text"
                placeholder="e.g. London / Pinewood"
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-semibold mb-1">Account Notes / Credit Terms</label>
            <input
              type="text"
              placeholder="e.g. CS Account CS-88921, 30 days net"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <RefreshCw size={12} className="animate-spin" />}
              <span>Save & Select Supplier</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
