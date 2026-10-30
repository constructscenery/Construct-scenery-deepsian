'use client';

import React, { useState, useMemo } from 'react';
import {
  X, Send, Search, Check, CheckSquare, Square, CheckCheck, Loader2,
  Mail, AlertTriangle, User,
} from 'lucide-react';
import { Timesheet } from '@/lib/api';

interface SendTimesheetsChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheets: Timesheet[];
  weekEndingDate: string;
  productionName: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectDrafts: () => void;
  onSend: (targetIds: string[]) => Promise<void>;
  sending: boolean;
}

export default function SendTimesheetsChecklistModal({
  isOpen,
  onClose,
  sheets,
  weekEndingDate,
  productionName,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onSelectDrafts,
  onSend,
  sending,
}: SendTimesheetsChecklistModalProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'drafts' | 'selected'>('all');

  // Eligible timesheets to distribute (drafts, submitted, amendment requested, or already distributed for resending)
  const eligibleSheets = useMemo(() => {
    return sheets.filter(s => s.status !== 'finalised');
  }, [sheets]);

  const filteredSheets = useMemo(() => {
    return eligibleSheets.filter(ts => {
      const isDraft = ts.status === 'draft' || ts.status === 'submitted';
      if (filterType === 'drafts' && !isDraft) return false;
      if (filterType === 'selected' && !selectedIds.has(ts.id)) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const fullName = `${ts.first_name || ''} ${ts.last_name || ''}`.toLowerCase();
        const crewNo = (ts.crew_number || '').toLowerCase();
        const trade = (ts.crew_trade || '').toLowerCase();
        const rank = (ts.crew_rank || '').toLowerCase();
        if (!fullName.includes(q) && !crewNo.includes(q) && !trade.includes(q) && !rank.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [eligibleSheets, filterType, selectedIds, search]);

  if (!isOpen) return null;

  const totalEligible = eligibleSheets.length;
  const draftCount = eligibleSheets.filter(s => s.status === 'draft' || s.status === 'submitted').length;
  const selectedCount = eligibleSheets.filter(s => selectedIds.has(s.id)).length;

  const handleSendSelected = async () => {
    if (selectedCount === 0 || sending) return;
    const idsToSend = eligibleSheets.filter(s => selectedIds.has(s.id)).map(s => s.id);
    await onSend(idsToSend);
    onClose();
  };

  const fmtCurrency = (n: string | number | null | undefined) =>
    `£${parseFloat(String(n || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-send-checklist-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                <CheckSquare size={16} />
              </span>
              <h2 id="modal-send-checklist-title" className="text-lg font-normal text-slate-900 tracking-tight">
                Send Timesheets Checklist
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Week Ending {weekEndingDate} · {productionName || 'All Productions'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar: Selection toggles + filters */}
        <div className="px-6 py-3 border-b border-slate-100 space-y-3 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Quick buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={sending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded-lg transition-colors font-normal disabled:opacity-50"
              >
                <CheckCheck size={13} className="text-slate-500" />
                Select All ({totalEligible})
              </button>
              <button
                type="button"
                onClick={onSelectDrafts}
                disabled={sending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs rounded-lg transition-colors font-normal border border-blue-100 disabled:opacity-50"
              >
                <Check size={13} className="text-blue-600" />
                Drafts Only ({draftCount})
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                disabled={sending || selectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-lg transition-colors font-normal disabled:opacity-50"
              >
                <X size={13} className="text-slate-400" />
                Deselect All
              </button>
            </div>

            {/* Selected count pill */}
            <div className="text-xs text-slate-600">
              <span className="font-normal text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md">
                {selectedCount} of {totalEligible} selected
              </span>
            </div>
          </div>

          {/* Search & Filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter crew name, trade, or rank..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* View filter buttons */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              {(
                [
                  { key: 'all', label: `All (${totalEligible})` },
                  { key: 'drafts', label: `Drafts (${draftCount})` },
                  { key: 'selected', label: `Selected (${selectedCount})` },
                ] as const
              ).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterType(tab.key)}
                  className={`text-xs px-2.5 py-1 rounded-md font-normal transition-colors ${
                    filterType === tab.key
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Checklist Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-2 divide-y divide-slate-100">
          {filteredSheets.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <CheckSquare size={32} className="mx-auto mb-2 text-slate-300 stroke-1" />
              <p>No timesheets match your active filter.</p>
            </div>
          ) : (
            filteredSheets.map(ts => {
              const isSelected = selectedIds.has(ts.id);
              const fullName = `${ts.first_name || ''} ${ts.last_name || ''}`.trim() || 'Crew member';
              const daysWorked = ts.days_worked ?? 0;
              const grossTotal = ts.grand_total || ts.gross_total || '0';
              const hasEmail = Boolean(ts.email);

              return (
                <div
                  key={ts.id}
                  onClick={() => onToggleSelect(ts.id)}
                  className={`pt-2.5 first:pt-0 pb-2.5 flex items-center justify-between gap-3 px-3 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-50/50 hover:bg-blue-50'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(ts.id)}
                      onClick={e => e.stopPropagation()}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer align-middle"
                      aria-label={`Select ${fullName}`}
                    />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-normal text-slate-900 truncate">
                          {fullName}
                        </span>
                        {ts.crew_number && (
                          <span className="text-xs text-slate-400 font-mono">
                            {ts.crew_number}
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full capitalize bg-slate-100 text-slate-600 border border-slate-200">
                          {ts.status === 'draft' ? 'Draft' : ts.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                        <span>{[ts.crew_trade, ts.crew_rank].filter(Boolean).join(' · ') || '—'}</span>
                        <span>·</span>
                        <span>{daysWorked} day{daysWorked !== 1 ? 's' : ''} worked</span>
                        <span>·</span>
                        {hasEmail ? (
                          <span className="text-slate-500 flex items-center gap-1">
                            <Mail size={11} className="text-slate-400" />
                            {ts.email}
                          </span>
                        ) : (
                          <span className="text-amber-600 flex items-center gap-1 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 text-xs">
                            <AlertTriangle size={10} />
                            No email (auto-distributed)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-normal text-slate-900">
                      {fmtCurrency(grossTotal)}
                    </p>
                    <p className="text-xs text-slate-400">Total amount</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {selectedCount > 0 ? (
              <span>Ready to distribute <span className="text-slate-800 font-normal">{selectedCount}</span> timesheet{selectedCount !== 1 ? 's' : ''}.</span>
            ) : (
              <span className="text-amber-600">Select at least one timesheet to proceed.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 text-xs font-normal text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSendSelected}
              disabled={selectedCount === 0 || sending}
              className="flex items-center gap-2 px-4 py-2 text-xs font-normal text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {sending ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Distributing...</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Send {selectedCount} Timesheet{selectedCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
