'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  RefreshCw,
  Download,
  Calendar,
  CheckCircle2,
  AlertCircle,
  X,
  FileSpreadsheet,
  Clock,
  Database,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { dataSyncApi, DataSyncRecord, DataSyncStatus } from '@/lib/api';

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtBytes(bytes: string | number) {
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (!n || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SyncModal({ open, onClose }: SyncModalProps) {
  const [status, setStatus] = useState<DataSyncStatus | null>(null);
  const [history, setHistory] = useState<DataSyncRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expandedSyncId, setExpandedSyncId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, histRes] = await Promise.all([
        dataSyncApi.getStatus(),
        dataSyncApi.getHistory(30),
      ]);
      setStatus(statusRes);
      setHistory(histRes.history || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sync data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadData();
      setSyncSuccessMsg(null);
    }
  }, [open, loadData]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    setSyncSuccessMsg(null);
    try {
      const res = await dataSyncApi.triggerSync();
      setSyncSuccessMsg(
        `Successfully synced ${res.sync.total_records} records across ${res.sync.tables_synced} tables to S3!`
      );
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDownload = async (record: DataSyncRecord, specificFile?: string) => {
    const downloadKey = specificFile ? `${record.id}-${specificFile}` : record.id;
    setDownloadingId(downloadKey);
    try {
      const filename = specificFile || (record.filename.endsWith('.xlsx') ? record.filename : 'Backup_All_Data.xlsx');
      await dataSyncApi.downloadFile(record.id, filename, specificFile);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to download file');
    } finally {
      setDownloadingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Cloud size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-tight text-white flex items-center gap-2">
                Database S3 Sync & Export
                <span className="text-[11px] font-normal uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full">
                  Automated Weekly
                </span>
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Versioned Excel folder snapshots saved in AWS S3 (Backup_Suppliers.xlsx, Backup_Productions.xlsx, etc.)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Status Banners */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-sm">
              <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Sync Error</p>
                <p className="text-xs text-red-700 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {syncSuccessMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-800 text-sm">
              <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Sync Successful</p>
                <p className="text-xs text-emerald-700 mt-0.5">{syncSuccessMsg}</p>
              </div>
            </div>
          )}

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Weekly Schedule */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-slate-600 text-xs font-medium uppercase tracking-wider mb-2">
                <Calendar size={15} className="text-blue-600" />
                Weekly Schedule
              </div>
              <div>
                <p className="text-slate-900 font-semibold text-sm">
                  {status?.cronScheduleHuman || 'Every Sunday at 02:00 UTC'}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-medium text-emerald-700">Cron Active</span>
                </div>
              </div>
            </div>

            {/* Card 2: S3 Destination */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-slate-600 text-xs font-medium uppercase tracking-wider mb-2">
                <Database size={15} className="text-blue-600" />
                S3 Bucket Destination
              </div>
              <div>
                <p className="text-slate-900 font-semibold text-sm truncate" title={status?.bucket}>
                  {status?.bucket || 'deepsiant-assets-prod'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Region: {status?.region || 'eu-north-1'}</p>
              </div>
            </div>

            {/* Card 3: Latest Version */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-slate-600 text-xs font-medium uppercase tracking-wider mb-2">
                <Clock size={15} className="text-blue-600" />
                Latest Snapshot
              </div>
              <div>
                <p className="text-slate-900 font-semibold text-sm">
                  {status?.latestSync ? fmtDate(status.latestSync.created_at) : 'No sync recorded yet'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {status?.latestSync
                    ? `${status.latestSync.total_records} rows · ${fmtBytes(status.latestSync.file_size)}`
                    : 'Ready to sync'}
                </p>
              </div>
            </div>
          </div>

          {/* Trigger Sync Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-500/20">
                <FileSpreadsheet size={24} />
              </div>
              <div>
                <h3 className="text-slate-900 font-semibold text-sm sm:text-base">
                  Export & Sync Database Now
                </h3>
                <p className="text-slate-600 text-xs mt-0.5">
                  Creates version folder in S3 with clean files (<code className="bg-blue-100/70 text-blue-900 px-1 py-0.5 rounded text-[11px]">Backup_Suppliers.xlsx</code>, <code className="bg-blue-100/70 text-blue-900 px-1 py-0.5 rounded text-[11px]">Backup_Productions.xlsx</code>, etc.) populated with actual records.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                id="btn-sync-database-now"
                onClick={handleSyncNow}
                disabled={syncing}
                className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Exporting & Syncing...' : 'Sync to S3 Now'}
              </button>
            </div>
          </div>

          {/* Versioned Sync History */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-slate-700" />
                <h3 className="font-semibold text-slate-900 text-sm">Versioned Folder Backups</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {history.length} snapshot{history.length === 1 ? '' : 's'} in S3
              </span>
            </div>

            {loading && history.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-slate-200">
                <RefreshCw size={20} className="animate-spin mx-auto text-blue-600 mb-2" />
                Loading history...
              </div>
            ) : history.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-slate-200">
                No database sync snapshots recorded yet. Click &quot;Sync to S3 Now&quot; above to create the first versioned backup.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Version Folder</th>
                      <th className="py-3 px-4">Trigger</th>
                      <th className="py-3 px-4">Tables / Rows</th>
                      <th className="py-3 px-4">Size</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {history.map((item) => {
                      const isExpanded = expandedSyncId === item.id;
                      const isDownloadingMaster = downloadingId === item.id;
                      const folderName = item.filename.replace(/\.xlsx$/, '');

                      // Extract file list from metadata if available
                      const metaFiles: Array<{ name: string; key: string; size: number; records: number; isMaster?: boolean }> =
                        (item.metadata as { files?: Array<{ name: string; key: string; size: number; records: number; isMaster?: boolean }> })?.files || [];

                      const metaTables: Record<string, number | string> =
                        ((item.metadata as { tables?: Record<string, number | string> })?.tables) ||
                        ((item.metadata as Record<string, number | string>) || {});

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900 font-mono flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              {folderName}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(item.created_at)}</p>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase ${
                                item.triggered_by_type === 'SCHEDULED'
                                  ? 'bg-purple-100 text-purple-700 border border-purple-200'
                                  : 'bg-blue-100 text-blue-700 border border-blue-200'
                              }`}
                            >
                              {item.triggered_by_type}
                            </span>
                            {item.triggered_by_user_name && (
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {item.triggered_by_user_name}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1 font-medium text-slate-800">
                              <span>{item.tables_synced} tables</span>
                              <span className="text-slate-300">·</span>
                              <span>{item.total_records} actual rows</span>
                            </div>
                            <button
                              onClick={() => setExpandedSyncId(isExpanded ? null : item.id)}
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 mt-0.5"
                            >
                              {isExpanded ? 'Hide files' : 'View individual files'}
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">
                            {fmtBytes(item.file_size)}
                          </td>
                          <td className="py-3 px-4">
                            {item.status === 'SUCCESS' ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px] font-medium">
                                <CheckCircle2 size={12} className="text-emerald-500" />
                                Synced
                              </span>
                            ) : item.status === 'IN_PROGRESS' ? (
                              <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[11px] font-medium">
                                <RefreshCw size={12} className="animate-spin text-amber-500" />
                                In Progress
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full text-[11px] font-medium">
                                <AlertCircle size={12} className="text-red-500" />
                                Failed
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                id={`download-sync-${item.id}`}
                                onClick={() => handleDownload(item, 'Backup_All_Data.xlsx')}
                                disabled={isDownloadingMaster || item.status !== 'SUCCESS'}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-900 border border-blue-200 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
                                title="Download All Data combined workbook"
                              >
                                <Download size={13} className={isDownloadingMaster ? 'animate-bounce' : ''} />
                                <span>Master .xlsx</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Expanded Individual Files Drawer */}
            {expandedSyncId && (() => {
              const activeItem = history.find((h) => h.id === expandedSyncId);
              if (!activeItem) return null;

              const metaFiles =
                (activeItem.metadata as { files?: Array<{ name: string; key: string; size: number; records: number; isMaster?: boolean }> })?.files || [];

              const metaTables =
                ((activeItem.metadata as { tables?: Record<string, number | string> })?.tables) ||
                ((activeItem.metadata as Record<string, number | string>) || {});

              return (
                <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                        <FileSpreadsheet size={15} className="text-blue-600" />
                        Files in <code className="text-blue-700 bg-blue-50 px-1 py-0.5 rounded font-mono">{activeItem.filename}</code>
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Download individual tables directly or grab the complete multi-tab master workbook.
                      </p>
                    </div>
                    <button
                      onClick={() => setExpandedSyncId(null)}
                      className="text-xs text-slate-500 hover:text-slate-800 font-medium px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                    >
                      Close
                    </button>
                  </div>

                  {metaFiles.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {metaFiles.map((file) => {
                        const isThisDownloading = downloadingId === `${activeItem.id}-${file.name}`;

                        return (
                          <div
                            key={file.name}
                            className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 text-xs transition-colors ${
                              file.isMaster
                                ? 'bg-blue-50/70 border-blue-200'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-800 truncate" title={file.name}>
                                {file.name}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {file.records} row{file.records === 1 ? '' : 's'} · {fmtBytes(file.size)}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDownload(activeItem, file.name)}
                              disabled={isThisDownloading}
                              className={`flex-shrink-0 p-1.5 rounded-md border text-slate-600 hover:text-slate-900 transition-colors ${
                                file.isMaster
                                  ? 'bg-blue-600 text-white hover:bg-blue-700 border-blue-700'
                                  : 'bg-slate-100 hover:bg-slate-200 border-slate-200'
                              }`}
                              title={`Download ${file.name}`}
                            >
                              <Download size={13} className={isThisDownloading ? 'animate-bounce' : ''} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                      {Object.entries(metaTables).map(([table, val]) => (
                        <div
                          key={table}
                          className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between"
                        >
                          <span className="font-medium text-slate-700 truncate pr-1" title={table}>
                            {table}
                          </span>
                          <span className="text-slate-500 font-mono text-[11px] flex-shrink-0">
                            {String(val)} rows
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            <span>Encrypted cloud backup with AWS S3 AES-256</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
