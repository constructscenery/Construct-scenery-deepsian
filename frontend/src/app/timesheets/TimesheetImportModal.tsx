'use client';

import { useState, useRef, useMemo } from 'react';
import {
  timesheetImportApi,
  type TimesheetImportPreviewRow,
  type TimesheetImportResult,
} from '@/lib/api';
import {
  Upload,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  FileText,
  Loader2,
  ChevronRight,
  Download,
  X,
  Clock,
  Layers,
} from 'lucide-react';

type Step = 1 | 2 | 3;

interface ProductionOption {
  id: string;
  name: string;
}

interface TimesheetImportModalProps {
  productions: ProductionOption[];
  defaultProductionId?: string;
  defaultWeekEndingDate?: string;
  onClose: () => void;
  onComplete: (info?: { productionId?: string; weekEndingDate?: string }) => void;
}

// ─── Step Indicator ───────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1 as Step, label: 'Upload CSV' },
    { n: 2 as Step, label: 'Review & Preview' },
    { n: 3 as Step, label: 'Import Results' },
  ];
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                current === s.n
                  ? 'bg-blue-600 text-white shadow-sm'
                  : current > s.n
                  ? 'bg-green-600 text-white'
                  : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}
            >
              {current > s.n ? <CheckCircle size={14} /> : s.n}
            </div>
            <span
              className={`text-xs font-medium hidden sm:inline ${
                current === s.n ? 'text-slate-900 font-semibold' : current > s.n ? 'text-green-700' : 'text-slate-400'
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-6 sm:w-10 h-0.5 mx-2 flex-shrink-0 ${current > s.n ? 'bg-green-500' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Upload Component ─────────────────────────────────────────────────
interface UploadStepProps {
  productions: ProductionOption[];
  defaultProductionId?: string;
  defaultWeekEndingDate?: string;
  onPreview: (
    result: { total_rows: number; valid_rows: number; invalid_rows: number; preview: TimesheetImportPreviewRow[] },
    file: File,
    productionId: string,
    weekEnding: string
  ) => void;
}

function UploadStep({
  productions,
  defaultProductionId,
  defaultWeekEndingDate,
  onPreview,
}: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [productionId, setProductionId] = useState(defaultProductionId || (productions[0]?.id ?? ''));
  const [weekEnding, setWeekEnding] = useState(defaultWeekEndingDate || '');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a valid CSV file (.csv).');
      return;
    }
    setFile(f);
    setError('');
  };

  const submit = async () => {
    if (!file) {
      setError('Please select a CSV file first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('csv', file);
      if (productionId) fd.append('production_id', productionId);
      if (weekEnding) fd.append('week_ending_date', weekEnding);

      const result = await timesheetImportApi.preview(fd);
      onPreview(result, file, productionId, weekEnding);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed. Please check the CSV structure.');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    fetch('/api/timesheets/import/template', {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'timesheets_import_template.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError('Failed to download template.'));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Default Production (Optional Fallback)
          </label>
          <select
            value={productionId}
            onChange={e => setProductionId(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- Let CSV specify per row --</option>
            {productions.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">
            Used if the row does not contain a &quot;Production&quot; column.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Default Week Ending Sunday (Optional Fallback)
          </label>
          <input
            type="date"
            value={weekEnding}
            onChange={e => setWeekEnding(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Must be a Sunday. Used if rows omit &quot;Week Ending Date&quot;.
          </p>
        </div>
      </div>

      {/* Drag & drop upload box */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-blue-500 bg-blue-50/50'
            : file
            ? 'border-green-400 bg-green-50/30'
            : 'border-slate-200 hover:border-slate-300 bg-slate-50/60'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3">
          <Upload size={22} />
        </div>

        {file ? (
          <div>
            <p className="text-sm font-semibold text-slate-800 flex items-center justify-center gap-1.5">
              <FileText size={16} className="text-green-600" />
              {file.name}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {(file.size / 1024).toFixed(1)} KB — Click or drag to replace
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-slate-700">
              Drag &amp; drop your timesheet CSV here, or <span className="text-blue-600 underline">browse</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Supports standard Excel export (.csv) with crew days worked, OT, and allowances
            </p>
          </div>
        )}
      </div>

      {/* Helper actions & instructions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-600 space-y-0.5">
          <p className="font-semibold text-slate-800">Need the official format?</p>
          <p className="text-slate-500">
            Download our pre-formatted spreadsheet template with instructions and sample rows.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 px-3 py-2 rounded-lg shadow-sm transition-colors"
        >
          <Download size={14} />
          Download CSV Template
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={!file || loading}
          onClick={submit}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
          Review &amp; Preview Import
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Preview Component ────────────────────────────────────────────────
interface PreviewStepProps {
  data: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    preview: TimesheetImportPreviewRow[];
  };
  file: File;
  productionId: string;
  weekEnding: string;
  onBack: () => void;
  onSuccess: (result: TimesheetImportResult) => void;
}

function PreviewStep({
  data,
  file,
  productionId,
  weekEnding,
  onBack,
  onSuccess,
}: PreviewStepProps) {
  const [filter, setFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');

  const filteredRows = useMemo(() => {
    if (filter === 'valid') return data.preview.filter(r => r.valid);
    if (filter === 'invalid') return data.preview.filter(r => !r.valid);
    return data.preview;
  }, [data.preview, filter]);

  const commit = async () => {
    setCommitting(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('csv', file);
      if (productionId) fd.append('production_id', productionId);
      if (weekEnding) fd.append('week_ending_date', weekEnding);

      const res = await timesheetImportApi.import(fd);
      onSuccess(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setCommitting(false);
    }
  };

  const updatesCount = data.preview.filter(r => r.valid && r.action === 'update').length;
  const newCount = data.preview.filter(r => r.valid && r.action === 'create').length;

  return (
    <div className="space-y-4">
      {/* Top statistics cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-xs text-slate-500 font-medium">Total Rows</p>
          <p className="text-lg font-bold text-slate-900 mt-0.5">{data.total_rows}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-xs text-green-700 font-medium">Valid Ready to Import</p>
          <p className="text-lg font-bold text-green-800 mt-0.5">
            {data.valid_rows}{' '}
            <span className="text-xs font-normal text-green-600">
              ({newCount} new, {updatesCount} updates)
            </span>
          </p>
        </div>
        <div className={`rounded-lg p-3 border ${data.invalid_rows > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
          <p className={`text-xs font-medium ${data.invalid_rows > 0 ? 'text-red-700' : 'text-slate-500'}`}>
            Errors / Skipped
          </p>
          <p className={`text-lg font-bold mt-0.5 ${data.invalid_rows > 0 ? 'text-red-800' : 'text-slate-400'}`}>
            {data.invalid_rows}
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-700 font-medium">Est. Gross Labour</p>
          <p className="text-lg font-bold text-blue-900 mt-0.5">
            £{data.preview.filter(r => r.valid).reduce((s, r) => s + (r.gross_total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex gap-2">
          {(['all', 'valid', 'invalid'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                filter === tab
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab === 'all' && `All (${data.total_rows})`}
              {tab === 'valid' && `Valid (${data.valid_rows})`}
              {tab === 'invalid' && `Errors (${data.invalid_rows})`}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          Showing {filteredRows.length} of {data.total_rows}
        </span>
      </div>

      {/* Preview Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm max-h-[360px] overflow-y-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 font-semibold z-10">
            <tr>
              <th className="py-2.5 px-3">Row</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Action</th>
              <th className="py-2.5 px-3">Crew Member</th>
              <th className="py-2.5 px-3">Production</th>
              <th className="py-2.5 px-3">Week Ending</th>
              <th className="py-2.5 px-3 text-center">Days</th>
              <th className="py-2.5 px-3 text-center">OT Hrs</th>
              <th className="py-2.5 px-3 text-right">Gross Total</th>
              <th className="py-2.5 px-3">Issues / Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  No rows matching filter.
                </td>
              </tr>
            ) : (
              filteredRows.map(r => (
                <tr key={r.row} className={!r.valid ? 'bg-red-50/40' : 'hover:bg-slate-50/80'}>
                  <td className="py-2 px-3 font-mono text-slate-400">{r.row}</td>
                  <td className="py-2 px-3">
                    {r.valid ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-100/70 px-2 py-0.5 rounded-full">
                        <CheckCircle size={11} /> Valid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                        <XCircle size={11} /> Invalid
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {r.action === 'update' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full" title="Will update existing timesheet">
                        Update
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                        New
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <p className="font-semibold text-slate-800">{r.crew_name}</p>
                    <p className="text-[11px] text-slate-400">
                      {r.crew_number ? `${r.crew_number} • ` : ''}{r.crew_trade || 'Trade'} {r.crew_rank ? `(${r.crew_rank})` : ''}
                    </p>
                  </td>
                  <td className="py-2 px-3 text-slate-700 font-medium truncate max-w-[140px]" title={r.production_name}>
                    {r.production_name || '—'}
                  </td>
                  <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                    {r.week_ending_date}
                  </td>
                  <td className="py-2 px-3 text-center font-medium text-slate-800">
                    {r.days_worked}
                  </td>
                  <td className="py-2 px-3 text-center text-slate-600">
                    {r.overtime_hours > 0 ? `${r.overtime_hours}h` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                    {r.valid ? `£${r.gross_total.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2 px-3">
                    {r.errors.length > 0 ? (
                      <div className="space-y-0.5">
                        {r.errors.map((err, ei) => (
                          <p key={ei} className="text-[11px] text-red-600 font-medium">
                            • {err}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">Ready</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          <AlertTriangle size={15} className="flex-shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={committing}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 px-3 py-2 rounded-lg transition-colors"
        >
          <ArrowLeft size={14} /> Back to CSV Upload
        </button>

        <button
          type="button"
          disabled={data.valid_rows === 0 || committing}
          onClick={commit}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors"
        >
          {committing ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
          Import {data.valid_rows} Timesheet{data.valid_rows === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Result Component ─────────────────────────────────────────────────
interface ResultStepProps {
  result: TimesheetImportResult;
  onDone: () => void;
}

function ResultStep({ result, onDone }: ResultStepProps) {
  return (
    <div className="space-y-5 text-center py-2">
      <div className="w-14 h-14 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
        <CheckCircle size={28} />
      </div>

      <div>
        <h3 className="text-base font-bold text-slate-900">Import Complete</h3>
        <p className="text-xs text-slate-500 mt-1">
          Timesheet entries have been processed and saved to the database.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 text-left max-w-md mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
          <p className="text-xs text-green-700 font-semibold">Created New</p>
          <p className="text-xl font-bold text-green-900 mt-0.5">{result.created}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
          <p className="text-xs text-amber-700 font-semibold">Updated</p>
          <p className="text-xl font-bold text-amber-900 mt-0.5">{result.updated}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-500 font-semibold">Skipped</p>
          <p className="text-xl font-bold text-slate-700 mt-0.5">{result.skipped}</p>
        </div>
      </div>

      {/* Detailed skipped or created breakdown */}
      {result.skipped_records.length > 0 && (
        <div className="text-left bg-red-50 border border-red-200 rounded-xl p-4 max-h-40 overflow-y-auto">
          <p className="text-xs font-bold text-red-900 mb-2">Skipped Records:</p>
          <div className="space-y-1.5 text-xs text-red-700">
            {result.skipped_records.map((s, idx) => (
              <p key={idx}>
                <span className="font-semibold">Row {s.row} ({s.crew_name}):</span> {s.reason}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={onDone}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors"
        >
          View Timesheets
        </button>
      </div>
    </div>
  );
}

// ─── Main Modal Wrapper ───────────────────────────────────────────────────────
export default function TimesheetImportModal({
  productions,
  defaultProductionId,
  defaultWeekEndingDate,
  onClose,
  onComplete,
}: TimesheetImportModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [previewData, setPreviewData] = useState<{
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    preview: TimesheetImportPreviewRow[];
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedProd, setSelectedProd] = useState(defaultProductionId || '');
  const [selectedWed, setSelectedWed] = useState(defaultWeekEndingDate || '');
  const [importResult, setImportResult] = useState<TimesheetImportResult | null>(null);

  const handlePreviewReady = (
    result: { total_rows: number; valid_rows: number; invalid_rows: number; preview: TimesheetImportPreviewRow[] },
    uploadedFile: File,
    prodId: string,
    wed: string
  ) => {
    setPreviewData(result);
    setFile(uploadedFile);
    setSelectedProd(prodId);
    setSelectedWed(wed);
    setStep(2);
  };

  const handleImportSuccess = (result: TimesheetImportResult) => {
    setImportResult(result);
    setStep(3);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
              <Clock size={18} />
            </div>
            <div>
              <h2 className="text-slate-900 font-bold text-sm">Import Timesheets from CSV / Excel</h2>
              <p className="text-slate-400 text-xs">
                Bulk create or update weekly crew timesheet records
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Wizard progress bar */}
        <div className="px-6 py-3 border-b border-slate-100 bg-white">
          <StepIndicator current={step} />
        </div>

        {/* Wizard content */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && (
            <UploadStep
              productions={productions}
              defaultProductionId={defaultProductionId}
              defaultWeekEndingDate={defaultWeekEndingDate}
              onPreview={handlePreviewReady}
            />
          )}

          {step === 2 && previewData && file && (
            <PreviewStep
              data={previewData}
              file={file}
              productionId={selectedProd}
              weekEnding={selectedWed}
              onBack={() => setStep(1)}
              onSuccess={handleImportSuccess}
            />
          )}

          {step === 3 && importResult && (
            <ResultStep
              result={importResult}
              onDone={() => {
                const firstValid = previewData?.preview.find(r => r.valid);
                const targetProdId = firstValid?.production_id || selectedProd;
                const targetWed = firstValid?.week_ending_date || selectedWed;

                onComplete({
                  productionId: targetProdId || undefined,
                  weekEndingDate: targetWed || undefined,
                });
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
