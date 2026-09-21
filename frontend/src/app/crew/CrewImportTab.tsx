'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { crewImportApi, type CrewImportPreviewRow } from '@/lib/api';
import {
  Upload, CheckCircle, XCircle, AlertTriangle, ArrowLeft, FileText, Loader2,
  Users, ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

type PreviewResult = {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  preview: CrewImportPreviewRow[];
};

type ImportResult = {
  total_rows: number;
  created: number;
  skipped: number;
  created_records: Array<{ row: number; crew_number: string; first_name: string; last_name: string }>;
  skipped_records: Array<{ row: number; first_name: string; last_name: string; reason: string }>;
};

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1 as Step, label: 'Upload' },
    { n: 2 as Step, label: 'Preview' },
    { n: 3 as Step, label: 'Result' },
  ];
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                current === s.n
                  ? 'bg-blue-600 text-white'
                  : current > s.n
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {current > s.n ? <CheckCircle size={14} /> : s.n}
            </div>
            <span
              className={`text-xs font-medium hidden sm:block ${
                current === s.n ? 'text-slate-900' : current > s.n ? 'text-green-600' : 'text-slate-400'
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-10 h-0.5 mx-2 flex-shrink-0 ${current > s.n ? 'bg-green-400' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Upload ────────────────────────────────────────────────────────────

interface UploadStepProps {
  onPreview: (result: PreviewResult, file: File) => void;
}

function UploadStep({ onPreview }: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.csv')) {
      setError('Please select a CSV file (.csv).');
      return;
    }
    setFile(f);
    setError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const submit = async () => {
    if (!file) { setError('Please select a CSV file first.'); return; }
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('csv', file);
      const result = await crewImportApi.preview(fd);
      onPreview(result, file);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed. Please check your CSV and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-xl mx-auto space-y-5">
      <div>
        <h2 className="text-slate-900 font-semibold text-sm">Select CSV File</h2>
        <p className="text-slate-400 text-xs mt-0.5">
          Your CSV must include: first_name, last_name, crew_trade, crew_rank, employment_status.
        </p>
      </div>

      {/* Template download */}
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <FileText size={15} className="text-blue-500 flex-shrink-0" />
        <span className="text-blue-700 text-xs">
          Not sure of the format?{' '}
          <button
            type="button"
            className="font-semibold underline underline-offset-2 hover:text-blue-900 cursor-pointer"
            onClick={async () => {
              const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
              const res = await fetch('/api/crew/import/template', {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'crew_import_template.csv';
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

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl px-6 py-10 cursor-pointer transition-colors ${
          dragging
            ? 'border-blue-400 bg-blue-50'
            : file
            ? 'border-green-400 bg-green-50'
            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file ? (
          <>
            <CheckCircle size={28} className="text-green-500" />
            <div className="text-center">
              <p className="text-slate-800 text-sm font-medium">{file.name}</p>
              <p className="text-slate-400 text-xs mt-0.5">{(file.size / 1024).toFixed(1)} KB — click to replace</p>
            </div>
          </>
        ) : (
          <>
            <Upload size={28} className="text-slate-400" />
            <div className="text-center">
              <p className="text-slate-700 text-sm font-medium">Drop your CSV here</p>
              <p className="text-slate-400 text-xs mt-0.5">or click to browse</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <XCircle size={13} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={!file || loading}
        className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
        {loading ? 'Analysing CSV…' : 'Preview Import'}
      </button>
    </div>
  );
}

// ─── Step 2: Preview ──────────────────────────────────────────────────────────

interface PreviewStepProps {
  preview: PreviewResult;
  file: File;
  onImport: (result: ImportResult) => void;
  onReset: () => void;
}

function PreviewStep({ preview, file, onImport, onReset }: PreviewStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const duplicateCount = preview.preview.filter(r => r.is_duplicate).length;

  const doImport = async () => {
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('csv', file);
      const result = await crewImportApi.import(fd);
      onImport(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
          <CheckCircle size={15} className="text-green-600" />
          <span className="text-green-800 text-sm font-semibold">{preview.valid_rows} valid</span>
        </div>
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          <XCircle size={15} className="text-red-500" />
          <span className="text-red-700 text-sm font-semibold">{preview.invalid_rows} invalid</span>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <AlertTriangle size={15} className="text-amber-500" />
          <span className="text-amber-700 text-sm font-semibold">{duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="ml-auto text-slate-400 text-xs self-center">{preview.total_rows} total rows in file</div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <XCircle size={13} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Preview table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-slate-900 font-semibold text-sm">Row Preview</h2>
          <span className="text-slate-400 text-xs">{preview.preview.length} rows shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 w-12">Row</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">First Name</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Last Name</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Trade</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Rank</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Duplicate?</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Errors</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.preview.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-slate-400 text-xs">No rows to display.</td>
                </tr>
              ) : (
                preview.preview.map(row => (
                  <tr
                    key={row.row}
                    className={`transition-colors ${
                      !row.valid
                        ? 'bg-red-50/50 hover:bg-red-50'
                        : row.is_duplicate
                        ? 'bg-amber-50/50 hover:bg-amber-50'
                        : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{row.row}</td>
                    <td className="px-4 py-2.5 text-slate-800 text-xs">{row.first_name || <span className="text-slate-300 italic">—</span>}</td>
                    <td className="px-4 py-2.5 text-slate-800 text-xs">{row.last_name || <span className="text-slate-300 italic">—</span>}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{row.crew_trade || <span className="text-slate-300 italic">—</span>}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{row.crew_rank || <span className="text-slate-300 italic">—</span>}</td>
                    <td className="px-4 py-2.5">
                      {row.employment_status ? (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          row.employment_status === 'paye'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {row.employment_status === 'paye' ? 'PAYE' : 'Self-Employed'}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.is_duplicate ? (
                        <span className="flex items-center gap-1 text-amber-600 text-xs">
                          <AlertTriangle size={12} /> Yes
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 max-w-[200px]">
                      {row.errors.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {row.errors.map((e, i) => (
                            <span key={i} className="text-red-600 text-[10px] leading-tight">{e}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.valid ? (
                        <CheckCircle size={14} className="text-green-500" />
                      ) : (
                        <XCircle size={14} className="text-red-400" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 justify-between">
        <button
          onClick={onReset}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <ArrowLeft size={13} />
          Upload Different File
        </button>
        <button
          onClick={doImport}
          disabled={loading || preview.valid_rows === 0}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
          {loading ? 'Importing…' : `Import ${preview.valid_rows} Valid Row${preview.valid_rows !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Result ───────────────────────────────────────────────────────────

interface ResultStepProps {
  result: ImportResult;
  onComplete?: () => void;
}

function ResultStep({ result, onComplete }: ResultStepProps) {
  const router = useRouter();

  const handleDone = () => {
    if (onComplete) {
      onComplete();
    } else {
      router.push('/crew');
    }
  };

  return (
    <div className="space-y-5">
      {/* Summary card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <CheckCircle size={24} className="text-green-600" />
          </div>
          <div>
            <h2 className="text-slate-900 font-semibold text-base">Import Complete</h2>
            <p className="text-slate-500 text-sm mt-0.5">
              <span className="font-semibold text-green-700">{result.created} record{result.created !== 1 ? 's' : ''} created</span>
              {result.skipped > 0 && (
                <>, <span className="font-semibold text-amber-600">{result.skipped} skipped</span></>
              )}
              {' '}out of {result.total_rows} rows processed
            </p>
          </div>
        </div>

        <button
          onClick={handleDone}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Users size={14} />
          <span>View in Crew List</span>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Created records */}
      {result.created_records.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <CheckCircle size={14} className="text-green-500" />
            <h3 className="text-slate-900 font-semibold text-sm">Created Records ({result.created_records.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Crew No.</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">First Name</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Last Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.created_records.map(r => (
                  <tr key={`created-${r.row}`} className="hover:bg-slate-50/50">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{r.crew_number}</td>
                    <td className="px-4 py-2.5 text-slate-800 text-xs">{r.first_name}</td>
                    <td className="px-4 py-2.5 text-slate-800 text-xs">{r.last_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Skipped records */}
      {result.skipped_records.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <h3 className="text-slate-900 font-semibold text-sm">Skipped Records ({result.skipped_records.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 w-12">Row</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">First Name</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Last Name</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.skipped_records.map(r => (
                  <tr key={`skipped-${r.row}`} className="hover:bg-amber-50/30">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{r.row}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{r.first_name}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{r.last_name}</td>
                    <td className="px-4 py-2.5 text-amber-700 text-xs">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Sub-Tab Component ───────────────────────────────────────────────────

export default function CrewImportTab({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handlePreview = useCallback((result: PreviewResult, file: File) => {
    setPreviewResult(result);
    setImportFile(file);
    setStep(2);
  }, []);

  const handleImport = useCallback((result: ImportResult) => {
    setImportResult(result);
    setStep(3);
  }, []);

  const handleReset = useCallback(() => {
    setPreviewResult(null);
    setImportFile(null);
    setImportResult(null);
    setStep(1);
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Step indicator */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <StepIndicator current={step} />
        {step > 1 && step < 3 && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft size={12} />
            <span>Start over</span>
          </button>
        )}
      </div>

      {/* Step content */}
      {step === 1 && (
        <UploadStep onPreview={handlePreview} />
      )}
      {step === 2 && previewResult && importFile && (
        <PreviewStep
          preview={previewResult}
          file={importFile}
          onImport={handleImport}
          onReset={handleReset}
        />
      )}
      {step === 3 && importResult && (
        <ResultStep result={importResult} onComplete={onComplete} />
      )}
    </div>
  );
}
