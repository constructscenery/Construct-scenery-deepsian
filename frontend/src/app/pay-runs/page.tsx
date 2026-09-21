'use client';

import { useState, useEffect, useCallback } from 'react';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import RequireRole from '@/components/RequireRole';
import {
  payRunsApi,
  productionsApi,
  type PayRun,
  type PayRunPreview,
  type PayRunItem,
  type Production,
} from '@/lib/api';
import {
  Loader2,
  Download,
  Play,
  Eye,
  X,
  AlertTriangle,
  ShieldOff,
  CheckCircle2,
  Calendar,
  Banknote,
} from 'lucide-react';
import { EmptyStateRow } from '@/components/EmptyState';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

function fmtGBP(n: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

type BadgeStatus = 'draft' | 'processed' | 'not_started';

function StatusBadge({ status }: { status: BadgeStatus }) {
  const map: Record<BadgeStatus, { label: string; cls: string }> = {
    not_started: { label: 'Not Started', cls: 'bg-slate-100 text-slate-500' },
    draft:       { label: 'Draft',       cls: 'bg-amber-100 text-amber-700' },
    processed:   { label: 'Processed',   cls: 'bg-green-100 text-green-700' },
  };
  const { label, cls } = map[status] ?? map.not_started;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

// ─── Employment type badge ────────────────────────────────────────────────────

function EmploymentBadge({ type }: { type: PayRunItem['employment_type'] }) {
  return type === 'paye' ? (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">PAYE</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">Self-Employed</span>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-4">
              <div className="animate-pulse bg-slate-200 rounded h-4 w-24" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Preview Modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  productionId: string;
  weekEndingDate: string;
  existingPayRunId: string | null;
  existingPayRunStatus: string | null;
  canWrite: boolean;
  onClose: () => void;
  onPayRunCreatedOrProcessed: () => void;
}

function PreviewModal({
  productionId,
  weekEndingDate,
  existingPayRunId,
  existingPayRunStatus,
  canWrite,
  onClose,
  onPayRunCreatedOrProcessed,
}: PreviewModalProps) {
  const [preview, setPreview] = useState<PayRunPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState('');

  // Track the pay run that exists (either pre-existing or just created)
  const [payRunId, setPayRunId] = useState<string | null>(existingPayRunId);
  const [payRunStatus, setPayRunStatus] = useState<string | null>(existingPayRunStatus);

  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    (async () => {
      setLoadingPreview(true);
      setPreviewError('');
      try {
        const data = await payRunsApi.getPreview(productionId, weekEndingDate);
        setPreview(data);
      } catch (err: unknown) {
        setPreviewError(err instanceof Error ? err.message : 'Failed to load preview');
      } finally {
        setLoadingPreview(false);
      }
    })();
  }, [productionId, weekEndingDate]);

  const handleCreate = async () => {
    setCreating(true);
    setActionError('');
    setCreateSuccess(false);
    try {
      const res = await payRunsApi.create({ production_id: productionId, week_ending_date: weekEndingDate });
      setPayRunId(res.pay_run.id);
      setPayRunStatus(res.pay_run.status);
      setCreateSuccess(true);
      onPayRunCreatedOrProcessed();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to create pay run');
    } finally {
      setCreating(false);
    }
  };

  const handleProcess = async () => {
    if (!payRunId) return;
    setProcessing(true);
    setActionError('');
    try {
      const res = await payRunsApi.process(payRunId);
      setPayRunStatus(res.pay_run.status);
      onPayRunCreatedOrProcessed();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to process pay run');
    } finally {
      setProcessing(false);
    }
  };

  const handleSync = async () => {
    if (!payRunId) return;
    setSyncing(true);
    setSyncSuccess(false);
    setActionError('');
    try {
      await payRunsApi.syncLabour(payRunId);
      setSyncSuccess(true);
      onPayRunCreatedOrProcessed();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to sync labour costs');
    } finally {
      setSyncing(false);
    }
  };

  const handleExportCsv = async () => {
    if (!payRunId) return;
    setExporting(true);
    setActionError('');
    try {
      const res = await payRunsApi.exportCsv(payRunId);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pay-run-${weekEndingDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportSuccess(true);
      onPayRunCreatedOrProcessed();
      setTimeout(() => { onClose(); }, 2000);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const isProcessed = payRunStatus === 'processed';
  const isDraft = payRunStatus === 'draft';

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-slate-900 font-semibold text-base">Pay Run Preview</h2>
            {preview && (
              <p className="text-slate-400 text-xs mt-0.5">
                {preview.production_name} — Week ending {fmtDate(weekEndingDate)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loadingPreview ? (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          ) : previewError ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
              <AlertTriangle size={16} className="flex-shrink-0" />
              {previewError}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {/* Totals summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-lg px-4 py-3">
                  <p className="text-slate-500 text-xs font-medium">Crew Members</p>
                  <p className="text-slate-900 text-xl font-bold mt-1">{preview.items.length}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-4 py-3">
                  <p className="text-slate-500 text-xs font-medium">Total Gross</p>
                  <p className="text-slate-900 text-xl font-bold mt-1">{fmtGBP(preview.total_gross)}</p>
                </div>
                <div className="bg-green-50 rounded-lg px-4 py-3">
                  <p className="text-green-600 text-xs font-medium">Total Net</p>
                  <p className="text-green-800 text-xl font-bold mt-1">{fmtGBP(preview.total_net)}</p>
                </div>
              </div>

              {/* Items table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Crew</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Type</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Gross</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Withholding</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Net</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Account Name</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.items.map(item => (
                        <tr key={item.timesheet_id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="text-slate-900 font-medium text-sm">{item.crew_name}</p>
                            <p className="text-slate-400 text-xs">{item.crew_number}</p>
                          </td>
                          <td className="px-4 py-3">
                            <EmploymentBadge type={item.employment_type} />
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700 font-medium text-sm">
                            {fmtGBP(item.gross_amount)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-500 text-sm">
                            {item.withholding_amount > 0 ? fmtGBP(item.withholding_amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-green-700 font-semibold text-sm">
                            {fmtGBP(item.net_amount)}
                          </td>
                          <td className="px-4 py-3 text-slate-600 text-xs">
                            {item.account_name ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                            {item.payment_reference}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td colSpan={2} className="px-4 py-3 text-xs font-semibold text-slate-600">
                          Totals ({preview.items.length} members)
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800 font-bold text-sm">
                          {fmtGBP(preview.total_gross)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 font-semibold text-sm">
                          {fmtGBP(preview.total_gross - preview.total_net)}
                        </td>
                        <td className="px-4 py-3 text-right text-green-700 font-bold text-sm">
                          {fmtGBP(preview.total_net)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100">
          {createSuccess && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm mb-3">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              Pay run created successfully. Click <strong>Process Pay Run</strong> to finalise.
            </div>
          )}

          {syncSuccess && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm mb-3">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              New timesheets synced to Cost Report successfully.
            </div>
          )}

          {exportSuccess && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm mb-3">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              Successfully processed and exported. Closing…
            </div>
          )}

          {actionError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm mb-3">
              <AlertTriangle size={15} className="flex-shrink-0" />
              {actionError}
            </div>
          )}

          {/* Pay run status indicator */}
          {payRunStatus && (
            <p className="text-xs text-slate-500 mb-3">
              Pay run status:{' '}
              <StatusBadge status={payRunStatus as BadgeStatus} />
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>

            {/* No pay run yet → Create (Accountant only — MD is view-only) */}
            {canWrite && !payRunId && !loadingPreview && !previewError && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {creating && <Loader2 size={14} className="animate-spin" />}
                Create Pay Run
              </button>
            )}

            {/* Draft → Process (Accountant only — MD is view-only) */}
            {canWrite && isDraft && payRunId && (
              <button
                onClick={handleProcess}
                disabled={processing}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                {processing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Process Pay Run
              </button>
            )}

            {/* Processed → Sync new timesheets + Export CSV */}
            {isProcessed && payRunId && canWrite && (
              <button
                onClick={handleSync}
                disabled={syncing}
                title="Pick up any timesheets finalised after this pay run was processed"
                className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 text-sm font-medium rounded-lg hover:bg-amber-100 disabled:opacity-60 transition-colors"
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Sync to Cost Report
              </button>
            )}
            {isProcessed && payRunId && (
              <button
                onClick={handleExportCsv}
                disabled={exporting}
                className="flex items-center gap-2 px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-60 transition-colors"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export CSV
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Available Weeks Tab ──────────────────────────────────────────────────────

type AvailableWeek = {
  week_ending_date: string;
  timesheet_count: number;
  pay_run_id: string | null;
  pay_run_status: string | null;
  processed_at: string | null;
};

interface AvailableWeeksTabProps {
  productionId: string;
  refreshSignal: number;
  canWrite: boolean;
  onOpenPreview: (week: AvailableWeek) => void;
}

function AvailableWeeksTab({ productionId, refreshSignal, canWrite, onOpenPreview }: AvailableWeeksTabProps) {
  const [weeks, setWeeks] = useState<AvailableWeek[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!productionId) return;
    setLoading(true);
    setError('');
    try {
      const data = await payRunsApi.getAvailableWeeks(productionId);
      setWeeks(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load available weeks');
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  if (!productionId) {
    return (
      <div className="py-16 text-center text-slate-400 text-sm">
        Select a production to view available weeks.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h2 className="text-slate-900 font-semibold text-sm">Available Weeks</h2>
        <p className="text-slate-400 text-xs mt-0.5">Weeks with finalised timesheets eligible for pay runs</p>
      </div>

      {error && (
        <div className="px-5 py-3 text-red-600 text-sm bg-red-50 border-b border-red-100 flex items-center gap-2">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-slate-500">Week Ending</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-center">Timesheets</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Pay Run Status</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Processed At</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <SkeletonRows cols={5} />
            ) : weeks.length === 0 ? (
              <EmptyStateRow
                colSpan={5}
                icon={Calendar}
                title="No finalised timesheet weeks found"
                description="Payroll runs require submitted and verified crew timesheets before a payroll batch can be generated."
                recommendation="Ensure crew members have recorded hours and timesheets are approved under Timesheets for this production."
                action={{
                  label: 'Go to Timesheets',
                  href: '/timesheets',
                }}
                secondaryAction={{
                  label: 'View Crew Roster',
                  href: '/crew',
                }}
              />
            ) : (
              weeks.map(week => {
                const badgeStatus: BadgeStatus = !week.pay_run_id
                  ? 'not_started'
                  : (week.pay_run_status as BadgeStatus) ?? 'draft';

                return (
                  <tr key={week.week_ending_date} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-slate-900 font-medium text-sm">
                        {fmtDate(week.week_ending_date)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center bg-slate-100 text-slate-700 text-xs font-semibold rounded-full w-7 h-7">
                        {week.timesheet_count}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={badgeStatus} />
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs">
                      {week.processed_at ? fmtDate(week.processed_at) : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => onOpenPreview(week)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                      >
                        <Eye size={12} />
                        {canWrite ? 'Preview & Create' : 'Preview'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50">
        <span className="text-slate-400 text-xs">
          {loading ? 'Loading…' : `${weeks.length} week${weeks.length !== 1 ? 's' : ''} available`}
        </span>
      </div>
    </div>
  );
}

// ─── Pay Run History Tab ──────────────────────────────────────────────────────

interface HistoryTabProps {
  productionId: string;
  refreshSignal: number;
  canWrite: boolean;
  onRefresh: () => void;
  onSwitchToWeeks?: () => void;
}

function HistoryTab({ productionId, refreshSignal, canWrite, onRefresh, onSwitchToWeeks }: HistoryTabProps) {
  const [payRuns, setPayRuns] = useState<PayRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!productionId) return;
    setLoading(true);
    setError('');
    try {
      const data = await payRunsApi.list({ production_id: productionId });
      setPayRuns(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pay runs');
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  const handleProcess = async (id: string) => {
    setProcessingId(id);
    setActionError('');
    try {
      await payRunsApi.process(id);
      await load();
      onRefresh();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to process pay run');
    } finally {
      setProcessingId(null);
    }
  };

  const handleExportCsv = async (id: string, weekEndingDate: string) => {
    setExportingId(id);
    setActionError('');
    try {
      const res = await payRunsApi.exportCsv(id);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pay-run-${weekEndingDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportingId(null);
    }
  };

  if (!productionId) {
    return (
      <div className="py-16 text-center text-slate-400 text-sm">
        Select a production to view pay run history.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h2 className="text-slate-900 font-semibold text-sm">Pay Run History</h2>
        <p className="text-slate-400 text-xs mt-0.5">All pay runs for the selected production</p>
      </div>

      {error && (
        <div className="px-5 py-3 text-red-600 text-sm bg-red-50 border-b border-red-100 flex items-center gap-2">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {actionError && (
        <div className="px-5 py-2 text-red-600 text-xs bg-red-50 border-b border-red-100">
          {actionError}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-slate-500">Week Ending</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Processed At</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <SkeletonRows cols={4} />
            ) : payRuns.length === 0 ? (
              <EmptyStateRow
                colSpan={4}
                icon={Banknote}
                title="No pay runs generated yet"
                description="No formal payroll batches have been generated or processed for this production."
                recommendation="Select 'Timesheet Weeks' tab above and click 'Generate Pay Run' on any finalised week."
                action={onSwitchToWeeks ? {
                  label: 'View Timesheet Weeks',
                  onClick: onSwitchToWeeks,
                } : undefined}
              />
            ) : (
              payRuns.map(pr => (
                <tr key={pr.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="text-slate-900 font-medium text-sm">
                      {fmtDate(pr.week_ending_date)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={pr.status as BadgeStatus} />
                  </td>
                  <td className="px-4 py-3.5 text-slate-500 text-xs">
                    {pr.processed_at ? fmtDate(pr.processed_at) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      {canWrite && pr.status === 'draft' && (
                        <button
                          onClick={() => handleProcess(pr.id)}
                          disabled={processingId === pr.id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors font-medium"
                        >
                          {processingId === pr.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Play size={12} />}
                          Process
                        </button>
                      )}
                      {pr.status === 'processed' && (
                        <button
                          onClick={() => handleExportCsv(pr.id, pr.week_ending_date)}
                          disabled={exportingId === pr.id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors font-medium"
                        >
                          {exportingId === pr.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Download size={12} />}
                          Export CSV
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50">
        <span className="text-slate-400 text-xs">
          {loading ? 'Loading…' : `${payRuns.length} pay run${payRuns.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'available' | 'history';

export default function PayRunsPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator', 'guest']}>
      <PayRunsContent />
    </RequireRole>
  );
}

function PayRunsContent() {
  const { user } = useAuth();
  const isGuest = user?.role === 'guest';

  const canAccess = true;
  const canWrite = !isGuest;

  const [productions, setProductions] = useState<Production[]>([]);
  const [selectedProd, setSelectedProd] = useState('');
  const [loadingProds, setLoadingProds] = useState(true);
  const [prodsError, setProdsError] = useState('');

  const [activeTab, setActiveTab] = useState<Tab>('available');

  // Increment to signal child tabs to refresh
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Preview modal state
  const [previewWeek, setPreviewWeek] = useState<AvailableWeek | null>(null);

  // Load productions on mount
  useEffect(() => {
    (async () => {
      setLoadingProds(true);
      setProdsError('');
      try {
        const data = await productionsApi.list();
        setProductions(data);
        if (data.length > 0) setSelectedProd(data[0].id);
      } catch (err: unknown) {
        setProdsError(err instanceof Error ? err.message : 'Failed to load productions');
      } finally {
        setLoadingProds(false);
      }
    })();
  }, []);

  const handlePayRunCreatedOrProcessed = useCallback(() => {
    setRefreshSignal(s => s + 1);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewWeek(null);
  }, []);

  // 403 guard
  if (user && !canAccess) {
    return (
      <>
        <TopBar title="Pay Runs" subtitle="Weekly pay run management" />
        <main className="flex-1 p-4 md:p-6">
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <ShieldOff size={40} className="text-slate-300" />
            <div>
              <p className="text-slate-700 font-semibold text-base">Access Restricted</p>
              <p className="text-slate-400 text-sm mt-1">
                Pay runs are only accessible to Managing Directors and Construction Accountants.
              </p>
            </div>
          </div>
        </main>
      </>
    );
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'available', label: 'Available Weeks' },
    { value: 'history',   label: 'Pay Run History' },
  ];

  return (
    <>
      {previewWeek && (
        <PreviewModal
          productionId={selectedProd}
          weekEndingDate={previewWeek.week_ending_date}
          existingPayRunId={previewWeek.pay_run_id}
          existingPayRunStatus={previewWeek.pay_run_status}
          canWrite={canWrite}
          onClose={handleClosePreview}
          onPayRunCreatedOrProcessed={handlePayRunCreatedOrProcessed}
        />
      )}

      <TopBar title="Pay Runs" subtitle="Weekly pay run management and processing" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Production selector */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-slate-600 text-sm font-medium whitespace-nowrap">
            Production
          </label>
          {loadingProds ? (
            <div className="animate-pulse bg-slate-200 rounded-lg h-9 w-48" />
          ) : prodsError ? (
            <p className="text-red-500 text-sm">{prodsError}</p>
          ) : (
            <select
              value={selectedProd}
              onChange={e => setSelectedProd(e.target.value)}
              className={`${inputCls} w-auto min-w-[200px]`}
            >
              {productions.length === 0 && (
                <option value="">No productions found</option>
              )}
              {productions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`text-sm px-4 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'available' ? (
          <AvailableWeeksTab
            productionId={selectedProd}
            refreshSignal={refreshSignal}
            canWrite={canWrite}
            onOpenPreview={week => setPreviewWeek(week)}
          />
        ) : (
          <HistoryTab
            productionId={selectedProd}
            refreshSignal={refreshSignal}
            canWrite={canWrite}
            onRefresh={() => setRefreshSignal(s => s + 1)}
            onSwitchToWeeks={() => setActiveTab('available')}
          />
        )}

      </main>
    </>
  );
}
