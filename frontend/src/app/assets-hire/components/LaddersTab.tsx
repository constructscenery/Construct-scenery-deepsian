'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Barcode, Plus, Pencil, Trash2, Search, X, Calendar, User,
  AlertCircle, CheckCircle2, Clock, ShieldAlert, Check, RotateCcw,
  Tag, MapPin, Eye, Wrench, RefreshCw
} from 'lucide-react';
import { laddersApi, Ladder, LadderReminder } from '@/lib/api';
import { EmptyStateRow } from '@/components/EmptyState';

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const LADDER_TYPES = [
  'Step Ladder',
  'Extension Ladder',
  'Podium Steps',
  'Combination Ladder',
  'Roof Ladder',
  'Telescopic Ladder',
  'Platform Ladder',
  'Warehouse Mobile Steps',
  'Other'
];

const CONDITIONS = [
  { label: 'Good (Pass)', value: 'Good' },
  { label: 'Excellent', value: 'Excellent' },
  { label: 'Pass with Minor Wear', value: 'Pass' },
  { label: 'Minor Defect (Monitor)', value: 'Minor Defect' },
  { label: 'Damaged / Failed (Out of Service)', value: 'Damaged' },
];

export default function LaddersTab({ isCoordinatorOrMD }: { isCoordinatorOrMD: boolean }) {
  const [ladders, setLadders] = useState<Ladder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [reminderFilter, setReminderFilter] = useState<'all' | 'overdue' | 'due_soon' | 'valid'>('all');
  const [showArchived, setShowArchived] = useState(false);

  // Add / Edit Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingLadder, setEditingLadder] = useState<Ladder | null>(null);
  const [saving, setSaving] = useState(false);

  // Quick Inspection Modal state
  const [showInspectModal, setShowInspectModal] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<Ladder | null>(null);
  const [inspectDate, setInspectDate] = useState('');
  const [inspectCondition, setInspectCondition] = useState('Good');
  const [inspectNextDue, setInspectNextDue] = useState('');
  const [inspectInspector, setInspectInspector] = useState('');
  const [inspectNotes, setInspectNotes] = useState('');
  const [savingInspect, setSavingInspect] = useState(false);

  // Archive / Delete state
  const [deleteTarget, setDeleteTarget] = useState<Ladder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Ladder | null>(null);
  const [permanentDeleting, setPermanentDeleting] = useState(false);

  // Form states for Add / Edit
  const [barcode, setBarcode] = useState('');
  const [ladderType, setLadderType] = useState('Step Ladder');
  const [inspectionDate, setInspectionDate] = useState('');
  const [condition, setCondition] = useState('Good');
  const [nextInspectionDue, setNextInspectionDue] = useState('');
  const [location, setLocation] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [reminderDays, setReminderDays] = useState(14);
  const [notes, setNotes] = useState('');

  // Notification toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (showArchived) params.include_archived = 'true';
      const res = await laddersApi.getAll(params);
      setLadders(res.ladders || []);
    } catch (err) {
      console.error('Failed to load ladders', err);
      showToast('error', 'Failed to load ladder registry');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Helper to add 6 months to a date string
  const calculateNextDue = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().split('T')[0];
  };

  const openCreateModal = () => {
    const today = new Date().toISOString().split('T')[0];
    setEditingLadder(null);
    setBarcode('');
    setLadderType('Step Ladder');
    setInspectionDate(today);
    setCondition('Good');
    setNextInspectionDue(calculateNextDue(today));
    setLocation('');
    setInspectorName('');
    setReminderDays(14);
    setNotes('');
    setShowModal(true);
  };

  const openEditModal = (ladder: Ladder) => {
    setEditingLadder(ladder);
    setBarcode(ladder.barcode || '');
    setLadderType(ladder.ladder_type || 'Step Ladder');
    setInspectionDate(ladder.inspection_date ? ladder.inspection_date.split('T')[0] : '');
    setCondition(ladder.condition || 'Good');
    setNextInspectionDue(ladder.next_inspection_due ? ladder.next_inspection_due.split('T')[0] : '');
    setLocation(ladder.location || '');
    setInspectorName(ladder.inspector_name || '');
    setReminderDays(ladder.reminder_days ?? 14);
    setNotes(ladder.notes || '');
    setShowModal(true);
  };

  const openInspectModal = (ladder: Ladder) => {
    const today = new Date().toISOString().split('T')[0];
    setInspectTarget(ladder);
    setInspectDate(today);
    setInspectCondition(ladder.condition || 'Good');
    setInspectNextDue(calculateNextDue(today));
    setInspectInspector(ladder.inspector_name || '');
    setInspectNotes(ladder.notes || '');
    setShowInspectModal(true);
  };

  const handleInspectionDateChange = (val: string) => {
    setInspectionDate(val);
    if (val && !editingLadder) {
      setNextInspectionDue(calculateNextDue(val));
    }
  };

  const handleInspectDateChange = (val: string) => {
    setInspectDate(val);
    if (val) {
      setInspectNextDue(calculateNextDue(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim()) {
      showToast('error', 'Barcode number is required');
      return;
    }
    if (!inspectionDate) {
      showToast('error', 'Inspection date is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<Ladder> = {
        barcode: barcode.trim(),
        ladder_type: ladderType,
        inspection_date: inspectionDate,
        condition,
        next_inspection_due: nextInspectionDue || calculateNextDue(inspectionDate),
        location: location.trim() || null,
        inspector_name: inspectorName.trim() || null,
        reminder_days: Number(reminderDays) || 14,
        notes: notes.trim() || null,
      };

      if (editingLadder) {
        await laddersApi.update(editingLadder.id, payload);
        showToast('success', `Ladder ${barcode} updated`);
      } else {
        await laddersApi.create(payload);
        showToast('success', `Ladder ${barcode} added to register`);
      }

      setShowModal(false);
      await loadData();
    } catch (err: unknown) {
      console.error('Error saving ladder:', err);
      const msg = err instanceof Error ? err.message : 'Failed to save ladder. Please check permissions.';
      showToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectTarget) return;
    if (!inspectDate) {
      showToast('error', 'Inspection date is required');
      return;
    }

    setSavingInspect(true);
    try {
      const payload: Partial<Ladder> = {
        inspection_date: inspectDate,
        condition: inspectCondition,
        next_inspection_due: inspectNextDue || calculateNextDue(inspectDate),
        inspector_name: inspectInspector.trim() || null,
        notes: inspectNotes.trim() || null,
      };

      await laddersApi.update(inspectTarget.id, payload);
      showToast('success', `Logged inspection for Ladder ${inspectTarget.barcode}`);
      setShowInspectModal(false);
      await loadData();
    } catch (err: unknown) {
      console.error('Error recording inspection:', err);
      const msg = err instanceof Error ? err.message : 'Failed to record inspection';
      showToast('error', msg);
    } finally {
      setSavingInspect(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await laddersApi.delete(deleteTarget.id);
      showToast('success', `Ladder ${deleteTarget.barcode} archived`);
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      console.error('Error archiving ladder:', err);
      const msg = err instanceof Error ? err.message : 'Failed to archive ladder';
      showToast('error', msg);
    } finally {
      setDeleting(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!permanentDeleteTarget) return;
    setPermanentDeleting(true);
    try {
      await laddersApi.delete(permanentDeleteTarget.id, true);
      showToast('success', `Ladder ${permanentDeleteTarget.barcode} permanently deleted`);
      setPermanentDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      console.error('Error permanently deleting ladder:', err);
      const msg = err instanceof Error ? err.message : 'Failed to permanently delete ladder';
      showToast('error', msg);
    } finally {
      setPermanentDeleting(false);
    }
  };

  const handleRestore = async (ladder: Ladder) => {
    try {
      await laddersApi.restore(ladder.id);
      showToast('success', `Ladder ${ladder.barcode} restored to active register`);
      await loadData();
    } catch (err: unknown) {
      console.error('Error restoring ladder:', err);
      const msg = err instanceof Error ? err.message : 'Failed to restore ladder';
      showToast('error', msg);
    }
  };

  // Metrics summary
  const metrics = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    let valid = 0;

    ladders.forEach(ladder => {
      if (ladder.is_archived) return;
      if (ladder.reminder?.status === 'overdue') overdue++;
      else if (ladder.reminder?.status === 'due_soon') dueSoon++;
      else valid++;
    });

    return {
      total: ladders.filter(l => !l.is_archived).length,
      overdue,
      dueSoon,
      valid,
    };
  }, [ladders]);

  // Filtered ladder list
  const filteredLadders = useMemo(() => {
    return ladders.filter(l => {
      // Archived filter
      if (!showArchived && l.is_archived) return false;
      if (showArchived && !l.is_archived) return false;

      // Text search
      const q = search.toLowerCase();
      const matchesSearch =
        !search ||
        l.barcode?.toLowerCase().includes(q) ||
        l.ladder_type?.toLowerCase().includes(q) ||
        l.location?.toLowerCase().includes(q) ||
        l.inspector_name?.toLowerCase().includes(q) ||
        l.notes?.toLowerCase().includes(q);

      // Condition filter
      const matchesCondition = !conditionFilter || l.condition === conditionFilter;

      // Reminder filter
      let matchesReminder = true;
      if (reminderFilter !== 'all') {
        matchesReminder = l.reminder?.status === reminderFilter;
      }

      return matchesSearch && matchesCondition && matchesReminder;
    });
  }, [ladders, search, conditionFilter, reminderFilter, showArchived]);

  const renderConditionBadge = (cond: string) => {
    const c = cond?.toLowerCase() || '';
    if (c.includes('damaged') || c.includes('fail') || c.includes('out of service')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <ShieldAlert size={12} className="text-rose-600" />
          {cond}
        </span>
      );
    }
    if (c.includes('minor') || c.includes('defect') || c.includes('fair')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <Clock size={12} className="text-amber-600" />
          {cond}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 size={12} className="text-emerald-600" />
        {cond || 'Good'}
      </span>
    );
  };

  const renderReminderBadge = (reminder?: LadderReminder) => {
    if (!reminder) {
      return <span className="text-slate-400 text-xs">—</span>;
    }
    if (reminder.status === 'overdue') {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200 shadow-sm animate-pulse">
          <ShieldAlert size={13} className="text-rose-600 shrink-0" />
          <span>{reminder.label}</span>
        </div>
      );
    }
    if (reminder.status === 'due_soon') {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-sm">
          <Clock size={13} className="text-amber-700 shrink-0" />
          <span>{reminder.label}</span>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
        <span>{reminder.label}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Registered Ladders</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-slate-900">{metrics.total}</span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <Barcode size={18} />
            </div>
          </div>
          <span className="text-[11px] text-slate-400 mt-1">Active workshop & site plant</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Overdue Inspection</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className={`text-2xl font-bold ${metrics.overdue > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {metrics.overdue}
            </span>
            <div className={`p-1.5 rounded-lg ${metrics.overdue > 0 ? 'bg-rose-100 text-rose-600 border border-rose-200' : 'bg-slate-100 text-slate-500'}`}>
              <ShieldAlert size={18} />
            </div>
          </div>
          <span className={`text-[11px] font-medium mt-1 ${metrics.overdue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
            {metrics.overdue > 0 ? 'Immediate action required' : 'All up to date'}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Due ≤ 14 Days</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className={`text-2xl font-bold ${metrics.dueSoon > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {metrics.dueSoon}
            </span>
            <div className={`p-1.5 rounded-lg ${metrics.dueSoon > 0 ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-500'}`}>
              <Clock size={18} />
            </div>
          </div>
          <span className={`text-[11px] font-medium mt-1 ${metrics.dueSoon > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
            Inspection window open
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Compliant</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-emerald-600">{metrics.valid}</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <span className="text-[11px] text-emerald-600 font-medium mt-1">Valid safety certificates</span>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-col md:flex-row gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2.5 flex-1 w-full">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search barcode (e.g. 100987), type, location, inspector..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Condition Filter */}
          <select
            value={conditionFilter}
            onChange={e => setConditionFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Conditions</option>
            {CONDITIONS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          {/* Reminder Status Filter */}
          <select
            value={reminderFilter}
            onChange={e => setReminderFilter(e.target.value as 'all' | 'overdue' | 'due_soon' | 'valid')}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Reminders</option>
            <option value="overdue">Overdue Only</option>
            <option value="due_soon">Due Soon (≤ 14d)</option>
            <option value="valid">Compliant</option>
          </select>

          {/* Archived Toggle */}
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
              showArchived
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {showArchived ? 'Viewing Archived' : 'Show Archived'}
          </button>
        </div>

        {/* Action Button */}
        {isCoordinatorOrMD && (
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm shrink-0"
          >
            <Plus size={15} />
            <span>Add Ladder</span>
          </button>
        )}
      </div>

      {/* Ladders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5">Ladder / Barcode</th>
                <th className="px-4 py-3.5">Type & Location</th>
                <th className="px-4 py-3.5">Inspection Date</th>
                <th className="px-4 py-3.5">Condition</th>
                <th className="px-4 py-3.5">Next Inspection Due</th>
                <th className="px-4 py-3.5">Reminder Status</th>
                <th className="px-4 py-3.5">Inspector / Notes</th>
                {isCoordinatorOrMD && <th className="px-4 py-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-blue-600" />
                    <p className="font-semibold text-slate-700 text-sm">Loading ladder registry...</p>
                  </td>
                </tr>
              ) : filteredLadders.length === 0 ? (
                ladders.length === 0 ? (
                  <EmptyStateRow
                    colSpan={8}
                    icon={Barcode}
                    title="No ladders registered"
                    description="No workshop or site ladders are currently catalogued in the safety register."
                    recommendation="Register your company ladders with barcode numbers to manage 6-monthly safety inspections and compliance reminders."
                    action={isCoordinatorOrMD ? {
                      label: 'Add First Ladder',
                      onClick: openCreateModal,
                      icon: Plus,
                    } : undefined}
                  />
                ) : (
                  <EmptyStateRow
                    colSpan={8}
                    icon={AlertCircle}
                    title="No matching ladders found"
                    description="No ladders match your current search, condition, or reminder filters."
                    recommendation="Try adjusting or clearing your search filters to view registered ladders."
                    action={{
                      label: 'Clear Filters',
                      onClick: () => {
                        setSearch('');
                        setConditionFilter('');
                        setReminderFilter('all');
                        setShowArchived(false);
                      },
                      icon: RotateCcw,
                    }}
                  />
                )
              ) : (
                filteredLadders.map(l => (
                  <tr
                    key={l.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      l.reminder?.status === 'overdue' ? 'bg-rose-50/30' : ''
                    } ${l.is_archived ? 'opacity-60 bg-slate-50/60' : ''}`}
                  >
                    {/* Barcode / ID */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200">
                          <Barcode size={16} />
                        </div>
                        <div>
                          <div className="font-mono font-bold text-slate-900 text-sm tracking-wide">
                            {l.barcode}
                          </div>
                          {l.is_archived && (
                            <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">
                              Archived
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Type & Location */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{l.ladder_type || 'Step Ladder'}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={11} className="text-slate-400" />
                        <span>{l.location || 'Workshop Bay'}</span>
                      </div>
                    </td>

                    {/* Inspection Date */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-slate-800 font-medium">
                        <Calendar size={13} className="text-slate-400" />
                        <span>{fmtDate(l.inspection_date)}</span>
                      </div>
                    </td>

                    {/* Condition */}
                    <td className="px-4 py-3">
                      {renderConditionBadge(l.condition)}
                    </td>

                    {/* Next Inspection Due */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <Calendar size={13} className={l.reminder?.is_overdue ? 'text-rose-500' : 'text-slate-400'} />
                        <span className={l.reminder?.is_overdue ? 'text-rose-700 font-bold' : ''}>
                          {fmtDate(l.next_inspection_due)}
                        </span>
                      </div>
                    </td>

                    {/* Reminder Status */}
                    <td className="px-4 py-3">
                      {renderReminderBadge(l.reminder)}
                    </td>

                    {/* Inspector / Notes */}
                    <td className="px-4 py-3 max-w-[200px]">
                      {l.inspector_name && (
                        <div className="text-[11px] text-slate-700 flex items-center gap-1">
                          <User size={11} className="text-slate-400" />
                          <span>{l.inspector_name}</span>
                        </div>
                      )}
                      {l.notes && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5" title={l.notes}>
                          {l.notes}
                        </p>
                      )}
                      {!l.inspector_name && !l.notes && <span className="text-slate-400">—</span>}
                    </td>

                    {/* Actions */}
                    {isCoordinatorOrMD && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!l.is_archived ? (
                            <>
                              {/* Quick Inspect Button */}
                              <button
                                type="button"
                                onClick={() => openInspectModal(l)}
                                title="Record New Inspection"
                                className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors"
                              >
                                <Check size={15} />
                              </button>
                              {/* Edit Button */}
                              <button
                                type="button"
                                onClick={() => openEditModal(l)}
                                title="Edit Ladder Details"
                                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                              {/* Archive Button */}
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(l)}
                                title="Archive Ladder"
                                className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleRestore(l)}
                                title="Restore Ladder"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-200"
                              >
                                <RotateCcw size={13} />
                                <span>Restore</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setPermanentDeleteTarget(l)}
                                title="Permanently Delete Ladder"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors border border-rose-200"
                              >
                                <Trash2 size={13} />
                                <span>Delete Permanently</span>
                              </button>
                            </div>
                          )}
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

      {/* ─── MODAL 1: ADD / EDIT LADDER ────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <Barcode size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {editingLadder ? `Edit Ladder — ${editingLadder.barcode}` : 'Add New Ladder'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Register ladder barcode, condition, and 6-month safety inspection interval
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Barcode and Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Ladder ID / Barcode <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. 100987"
                      value={barcode}
                      onChange={e => setBarcode(e.target.value)}
                      className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Ladder Type
                  </label>
                  <select
                    value={ladderType}
                    onChange={e => setLadderType(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {LADDER_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Inspection Date & Condition */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Inspection Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={inspectionDate}
                    onChange={e => handleInspectionDateChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Condition <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={condition}
                    onChange={e => setCondition(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CONDITIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Next Inspection Due & Reminder Days */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Next Inspection Due <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={nextInspectionDue}
                    onChange={e => setNextInspectionDue(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">Standard 6-monthly cycle</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Reminder Notice (Days Ahead)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="90"
                      value={reminderDays}
                      onChange={e => setReminderDays(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">days</span>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 block">Flag as Due Soon before expiry</span>
                </div>
              </div>

              {/* Location & Inspector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Location / Workshop Bay
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Workshop Bay 3 / Pinewood Van"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Inspector Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Dave Miller"
                    value={inspectorName}
                    onChange={e => setInspectorName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Inspection Notes / Comments
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Non-slip feet intact, rungs secure, barcode label refreshed..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <RefreshCw size={14} className="animate-spin" />}
                  <span>{editingLadder ? 'Save Changes' : 'Register Ladder'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: QUICK INSPECTION LOG ─────────────────────────────────── */}
      {showInspectModal && inspectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Record Inspection</h2>
                  <p className="text-xs text-slate-500 font-mono">Barcode #{inspectTarget.barcode}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInspectModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveInspection} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Inspection Date
                </label>
                <input
                  type="date"
                  required
                  value={inspectDate}
                  onChange={e => handleInspectDateChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Condition Rating
                </label>
                <select
                  value={inspectCondition}
                  onChange={e => setInspectCondition(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CONDITIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Next Inspection Due
                </label>
                <input
                  type="date"
                  required
                  value={inspectNextDue}
                  onChange={e => setInspectNextDue(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Auto-bumped +6 months</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Inspector Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dave Miller"
                  value={inspectInspector}
                  onChange={e => setInspectInspector(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Inspection notes..."
                  value={inspectNotes}
                  onChange={e => setInspectNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowInspectModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingInspect}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {savingInspect && <RefreshCw size={14} className="animate-spin" />}
                  <span>Save Inspection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: DELETE / ARCHIVE CONFIRMATION ───────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                <AlertCircle size={22} />
              </div>
              <h3 className="font-bold text-slate-900 text-base">Archive Ladder?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to archive Ladder barcode <strong className="font-mono text-slate-900">#{deleteTarget.barcode}</strong>?
              It will be hidden from the active register and safety reminder alerts, but can be restored anytime from the Archived view.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleting && <RefreshCw size={12} className="animate-spin" />}
                <span>Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 4: PERMANENT DELETE CONFIRMATION ────────────────────────── */}
      {permanentDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-rose-200 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 rounded-xl border border-rose-200">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Permanently Delete?</h3>
                <p className="text-[11px] text-rose-600 font-medium">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Permanently delete Ladder barcode <strong className="font-mono text-slate-900">#{permanentDeleteTarget.barcode}</strong>?
              This will completely wipe this ladder and all its inspection records from the database.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPermanentDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePermanentDelete}
                disabled={permanentDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {permanentDeleting && <RefreshCw size={12} className="animate-spin" />}
                <span>Delete Permanently</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
