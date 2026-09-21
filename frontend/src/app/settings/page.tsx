'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { settingsApi, percentometerApi, dataSyncApi, DataSyncRecord, DataSyncStatus } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  Pencil, Check, X, Loader2, Plus, Trash2, AlertCircle, Info,
  Cloud, RefreshCw, Download, Database, Calendar, CheckCircle2,
  ChevronDown, ChevronUp, FileSpreadsheet,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsMap = Record<string, { value: unknown; updated_at: string }>;

type RatioRow = {
  id: string;
  cost_type: string;
  percentage: number;
  effective_from: string;
  effective_to: string | null;
};

// ─── Section 1: Handover Alert Days ──────────────────────────────────────────

interface HandoverAlertSectionProps {
  settings: SettingsMap;
  onSaved: () => void;
}

function HandoverAlertSection({ settings, onSaved }: HandoverAlertSectionProps) {
  const raw = settings['handover_alert_days'];
  const existing: number[] = Array.isArray(raw?.value) ? (raw.value as number[]) : [];
  const updatedAt = raw?.updated_at ?? null;

  const [editing, setEditing] = useState(false);
  const [thresholds, setThresholds] = useState<string[]>(existing.map(String));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Keep local state in sync if parent settings refresh
  useEffect(() => {
    if (!editing) {
      setThresholds(existing.map(String));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const startEdit = () => {
    setThresholds(existing.length > 0 ? existing.map(String) : ['14', '7']);
    setError('');
    setEditing(true);
  };

  const cancel = () => {
    setThresholds(existing.map(String));
    setError('');
    setEditing(false);
  };

  const addThreshold = () => setThresholds(t => [...t, '']);

  const removeThreshold = (idx: number) =>
    setThresholds(t => t.filter((_, i) => i !== idx));

  const updateThreshold = (idx: number, val: string) =>
    setThresholds(t => t.map((v, i) => (i === idx ? val : v)));

  const save = async () => {
    const nums = thresholds.map(v => parseInt(v, 10));
    if (nums.some(n => isNaN(n) || n <= 0)) {
      setError('All thresholds must be positive integers.');
      return;
    }
    if (new Set(nums).size !== nums.length) {
      setError('Thresholds must be unique.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await settingsApi.patch('handover_alert_days', nums.sort((a, b) => b - a));
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-slate-900 font-semibold text-sm">Handover Alert Days</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Sets in the countdown are highlighted when handover is within these many days.
          </p>
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {!editing ? (
          <>
            {existing.length === 0 ? (
              <p className="text-slate-400 text-xs italic">No thresholds configured yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {existing
                  .slice()
                  .sort((a, b) => b - a)
                  .map(d => (
                    <span
                      key={d}
                      className="inline-flex items-center px-3 py-1 bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold rounded-full"
                    >
                      {d} days
                    </span>
                  ))}
              </div>
            )}
            {updatedAt && (
              <p className="text-slate-400 text-xs">Last updated: {fmtDate(updatedAt)}</p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {thresholds.map((val, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={val}
                  onChange={e => updateThreshold(idx, e.target.value)}
                  placeholder="e.g. 14"
                  className={`${inputCls} max-w-[120px]`}
                />
                <span className="text-slate-500 text-sm">days</span>
                {thresholds.length > 1 && (
                  <button
                    onClick={() => removeThreshold(idx)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove threshold"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}

            <button
              onClick={addThreshold}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              <Plus size={12} />
              Add threshold
            </button>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <AlertCircle size={13} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save
              </button>
              <button
                onClick={cancel}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-600 hover:text-slate-800 transition-colors"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 2: Company Details ──────────────────────────────────────────────

interface CompanyDetailsSectionProps {
  settings: SettingsMap;
  onSaved: () => void;
}

function CompanyDetailsSection({ settings, onSaved }: CompanyDetailsSectionProps) {
  const rawName  = settings['company_name'];
  const rawEmail = settings['report_contact_email'];

  const initName  = () => (typeof rawName?.value  === 'string' ? rawName.value  : '');
  const initEmail = () => (typeof rawEmail?.value === 'string' ? rawEmail.value : '');

  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(initName);
  const [email,   setEmail]   = useState(initEmail);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!editing) { setName(initName()); setEmail(initEmail()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await Promise.all([
        settingsApi.patch('company_name',          name.trim()  || ''),
        settingsApi.patch('report_contact_email',  email.trim() || ''),
      ]);
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setName(initName()); setEmail(initEmail()); setError(''); setEditing(false); };

  const updatedAt = rawName?.updated_at ?? rawEmail?.updated_at ?? null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-slate-900 font-semibold text-sm">Company Details</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Shown on PDF and Excel exports.
            {updatedAt && <span className="ml-2">Last updated {fmtDate(updatedAt)}.</span>}
          </p>
        </div>
        {!editing && (
          <button
            onClick={() => { setEditing(true); setError(''); }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {error && (
        <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company Name</label>
            <input
              className={inputCls}
              placeholder="e.g. Deepsian Productions Ltd"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Report Contact Email</label>
            <input
              type="email"
              className={inputCls}
              placeholder="e.g. accounts@company.co.uk"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
            <button
              onClick={cancel}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-600 hover:text-slate-800 transition-colors"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="divide-y divide-slate-100">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-xs text-slate-500">Company Name</dt>
            <dd className="text-sm font-medium text-slate-800">
              {initName() || <span className="text-slate-400 font-normal italic">Not set</span>}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-xs text-slate-500">Report Contact Email</dt>
            <dd className="text-sm font-medium text-slate-800">
              {initEmail() || <span className="text-slate-400 font-normal italic">Not set</span>}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

// ─── Section 3: Pay Run Defaults ─────────────────────────────────────────────

interface PayRunDefaultsSectionProps {
  settings: SettingsMap;
  onSaved: () => void;
}

function PayRunDefaultsSection({ settings, onSaved }: PayRunDefaultsSectionProps) {
  const rawRate = settings['default_paye_rate'];
  const currentRate = typeof rawRate?.value === 'number' ? rawRate.value : 20;

  const [editing, setEditing] = useState(false);
  const [rate,    setRate]    = useState(String(currentRate));
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!editing) setRate(String(typeof rawRate?.value === 'number' ? rawRate.value : 20));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const save = async () => {
    const parsed = parseFloat(rate);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      setError('Rate must be a number between 0 and 100.');
      return;
    }
    setSaving(true); setError('');
    try {
      await settingsApi.patch('default_paye_rate', parsed);
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setRate(String(currentRate)); setError(''); setEditing(false); };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-slate-900 font-semibold text-sm">Pay Run Defaults</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Default values pre-filled when adding new PAYE crew members.
          </p>
        </div>
        {!editing && (
          <button
            onClick={() => { setEditing(true); setError(''); }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {error && (
        <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Default PAYE Withholding Rate (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              className={inputCls}
              placeholder="20"
              value={rate}
              onChange={e => setRate(e.target.value)}
            />
            <p className="text-slate-400 text-xs mt-1">
              Standard rate is 20%. Used as the default when creating a new PAYE crew member.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
            <button
              onClick={cancel}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-600 hover:text-slate-800 transition-colors"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="divide-y divide-slate-100">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-xs text-slate-500">Default PAYE Withholding Rate</dt>
            <dd className="text-sm font-semibold text-slate-800 tabular-nums">{currentRate}%</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

// ─── Section: Database S3 Backup & Export ─────────────────────────────────

function fmtBytes(bytes: string | number) {
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (!n || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function DataSyncBackupSection() {
  const [status, setStatus] = useState<DataSyncStatus | null>(null);
  const [history, setHistory] = useState<DataSyncRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, hRes] = await Promise.all([
        dataSyncApi.getStatus(),
        dataSyncApi.getHistory(15),
      ]);
      setStatus(sRes);
      setHistory(hRes.history || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sync status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await dataSyncApi.triggerSync();
      setSuccessMsg(`Synced ${res.sync.total_records} records across ${res.sync.tables_synced} tables to S3!`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDownload = async (item: DataSyncRecord) => {
    setDownloadingId(item.id);
    try {
      await dataSyncApi.downloadFile(item.id, item.filename);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to download file');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Cloud size={18} />
          </div>
          <div>
            <h2 className="text-slate-900 font-semibold text-sm flex items-center gap-2">
              Database S3 Backup & Export
              <span className="text-[10px] uppercase font-semibold tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                Weekly Auto-Sync
              </span>
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Multi-tab Excel snapshots uploaded to AWS S3, versioned per sync.
            </p>
          </div>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing to S3...' : 'Sync to S3 Now'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium mb-1">
            <Calendar size={13} className="text-blue-500" />
            Weekly Schedule
          </div>
          <p className="text-slate-800 font-semibold">{status?.cronScheduleHuman || 'Every Sunday at 02:00 UTC'}</p>
          <p className="text-[10px] text-emerald-600 font-medium mt-0.5">● Cron Scheduled Active</p>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium mb-1">
            <Database size={13} className="text-blue-500" />
            Target S3 Bucket
          </div>
          <p className="text-slate-800 font-semibold truncate" title={status?.bucket}>{status?.bucket || 'deepsiant-assets-prod'}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Region: {status?.region || 'eu-north-1'}</p>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium mb-1">
            <FileSpreadsheet size={13} className="text-blue-500" />
            Latest Backup
          </div>
          <p className="text-slate-800 font-semibold">{status?.latestSync ? fmtDate(status.latestSync.created_at) : 'None yet'}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {status?.latestSync ? `${status.latestSync.total_records} rows · ${fmtBytes(status.latestSync.file_size)}` : 'Ready to export'}
          </p>
        </div>
      </div>

      {/* History table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Versioned Folder Snapshots</h3>
          <span className="text-[11px] text-slate-400">{history.length} snapshot{history.length === 1 ? '' : 's'}</span>
        </div>
        {loading && history.length === 0 ? (
          <p className="text-xs text-slate-400 py-3">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400 py-3">No backups recorded yet.</p>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Version Folder</th>
                  <th className="py-2.5 px-3">Trigger</th>
                  <th className="py-2.5 px-3">Tables / Rows</th>
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {history.map((item) => {
                  const folderName = item.filename.replace(/\.xlsx$/, '');
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-slate-800 font-mono text-xs">{folderName}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{fmtDate(item.created_at)}</p>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          item.triggered_by_type === 'SCHEDULED' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {item.triggered_by_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span>{item.tables_synced} tables · {item.total_records} actual rows</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">{fmtBytes(item.file_size)}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] font-medium">
                          Synced
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleDownload(item)}
                          disabled={downloadingId === item.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold rounded text-[11px] transition-colors"
                          title="Download Backup_All_Data.xlsx master workbook"
                        >
                          <Download size={11} className={downloadingId === item.id ? 'animate-bounce' : ''} />
                          Master .xlsx
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 4: Percentometer Ratios ─────────────────────────────────────────

interface PercentometerSectionProps {
  ratios: RatioRow[];
  loading: boolean;
  onSaved: () => void;
}

function PercentometerSection({ ratios, loading, onSaved }: PercentometerSectionProps) {
  // editingId → the row currently being edited
  const [editingId, setEditingId] = useState<string | null>(null);
  // draft percentages keyed by id — only set when editing starts
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = (row: RatioRow) => {
    setEditingId(row.id);
    setDraftValues(prev => ({ ...prev, [row.id]: String(row.percentage) }));
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError('');
  };

  // Compute live sum including any draft value
  const liveSum = ratios.reduce((acc, r) => {
    const pct =
      r.id === editingId
        ? parseFloat(draftValues[r.id] ?? String(r.percentage)) || 0
        : r.percentage;
    return acc + pct;
  }, 0);

  const saveEdit = async (id: string) => {
    const raw = draftValues[id] ?? '';
    const pct = parseFloat(raw);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setError('Percentage must be a number between 0 and 100.');
      return;
    }
    // Check sum with draft applied
    const newSum = ratios.reduce((acc, r) => {
      return acc + (r.id === id ? pct : r.percentage);
    }, 0);
    if (Math.abs(newSum - 100) > 0.01) {
      setError(`Ratios must sum to 100%. Current sum with this change: ${newSum.toFixed(2)}%.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await percentometerApi.updateRatio(id, pct);
      setEditingId(null);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const sumColor =
    Math.abs(liveSum - 100) < 0.01
      ? 'text-green-600'
      : liveSum > 100
      ? 'text-red-500'
      : 'text-amber-500';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-slate-900 font-semibold text-sm">Percentometer Ratios</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Cost-type split percentages used to estimate job costs from a single known cost.
            </p>
          </div>
          {editingId && (
            <div className={`text-xs font-semibold ${sumColor} flex-shrink-0 mt-0.5`}>
              Sum: {liveSum.toFixed(2)}%{Math.abs(liveSum - 100) < 0.01 ? ' ✓' : ' (must = 100%)'}
            </div>
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
        <Info size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-blue-700 text-xs">
          Changes create a new versioned row. Historical scenarios are unaffected.
        </p>
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-100">
          <div className="flex items-center gap-2 text-red-600 text-xs">
            <AlertCircle size={12} className="flex-shrink-0" />
            {error}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Cost Type</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Current %</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Effective From</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 animate-pulse bg-slate-200 rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : ratios.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-400 text-xs">
                  No ratios configured.
                </td>
              </tr>
            ) : (
              ratios.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3 text-slate-800 font-medium text-sm">{r.cost_type}</td>
                  <td className="px-4 py-3 text-right">
                    {editingId === r.id ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={draftValues[r.id] ?? ''}
                        onChange={e =>
                          setDraftValues(prev => ({ ...prev, [r.id]: e.target.value }))
                        }
                        className="w-20 border border-blue-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    ) : (
                      <span className="text-slate-800 font-semibold tabular-nums">
                        {r.percentage.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {fmtDate(r.effective_from)}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === r.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => saveEdit(r.id)}
                          disabled={saving}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Save"
                        >
                          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Cancel"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(r)}
                        disabled={!!editingId && editingId !== r.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-40"
                      >
                        <Pencil size={11} />
                        Edit %
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && ratios.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-5 py-2.5 text-xs font-semibold text-slate-500">Total</td>
                <td className={`px-4 py-2.5 text-right text-xs font-bold tabular-nums ${sumColor}`}>
                  {liveSum.toFixed(2)}%
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const isMD = true;
  const isCoordinator = true;
  const canAccess = true;

  const [settings, setSettings] = useState<SettingsMap>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');

  const [ratios, setRatios] = useState<RatioRow[]>([]);
  const [ratiosLoading, setRatiosLoading] = useState(true);

  // Access guard
  useEffect(() => {
    if (user && !canAccess) {
      router.replace('/dashboard');
    }
  }, [user, canAccess, router]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const data = await settingsApi.get();
      setSettings(data);
    } catch (err: unknown) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadRatios = useCallback(async () => {
    setRatiosLoading(true);
    try {
      const data = await percentometerApi.getRatios(true);
      setRatios(data);
    } catch {
      // non-fatal
    } finally {
      setRatiosLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canAccess) {
      loadSettings();
      if (isMD) loadRatios();
    }
  }, [canAccess, isMD, loadSettings, loadRatios]);

  // Render guard while loading user
  if (!user) return null;
  if (!canAccess) return null;

  return (
    <>
      <TopBar title="System Settings" subtitle="Configure system-wide behaviour" />
      <main className="flex-1 p-4 md:p-6 space-y-5">

        {/* Section 1 — Handover Alert Days */}
        {settingsError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} className="flex-shrink-0" />
            {settingsError}
          </div>
        )}
        {settingsLoading ? (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
                <div className="h-4 animate-pulse bg-slate-200 rounded w-40" />
                <div className="h-3 animate-pulse bg-slate-200 rounded w-64" />
                <div className="flex gap-2 mt-3">
                  {[1, 2].map(j => (
                    <div key={j} className="h-7 w-20 animate-pulse bg-slate-200 rounded" />
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <HandoverAlertSection  settings={settings} onSaved={loadSettings} />
            <CompanyDetailsSection settings={settings} onSaved={loadSettings} />
            <PayRunDefaultsSection settings={settings} onSaved={loadSettings} />
            <DataSyncBackupSection />
          </>
        )}

      </main>
    </>
  );
}
