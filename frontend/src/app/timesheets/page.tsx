'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import TopBar from '@/components/TopBar';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Loader2,
  Mail, Paperclip, ShieldCheck, X, Plus, ExternalLink, UserX, Send, FileText,
  ChevronDown, Download,
} from 'lucide-react';
import {
  timesheetsApi, productionsApi, crewApi,
  Timesheet, TimesheetStatus, Production, GatewayError, CrewMember,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyStateRow } from '@/components/EmptyState';

// ─── Inline API helpers ───────────────────────────────────────────────────────

const verifyTimesheet = async (id: string) => {
  const r = await fetch(`/api/timesheets/${id}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
    },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || data.error || 'Verify failed');
  return data;
};

const attachInvoice = (id: string, formData: FormData) =>
  fetch(`/api/timesheets/${id}/attach-invoice`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
    },
    body: formData,
  }).then(r => r.json());

const chaseInvoices = (production_id: string, week_ending_date: string) =>
  fetch('/api/timesheets/chase-invoices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
    },
    body: JSON.stringify({ production_id, week_ending_date }),
  }).then(r => r.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-blue-500', 'bg-pink-500', 'bg-orange-500',
  'bg-green-500', 'bg-indigo-500', 'bg-rose-500', 'bg-cyan-500', 'bg-amber-500',
];

type TSBadgeDef = { label: string; className: string };
const STATUS_BADGE: Record<TimesheetStatus, TSBadgeDef> = {
  draft:               { label: 'Draft',               className: 'bg-slate-100 text-slate-500' },
  submitted:           { label: 'Submitted',           className: 'bg-indigo-100 text-indigo-700' },
  distributed:         { label: 'Distributed',         className: 'bg-blue-100 text-blue-700' },
  amendment_requested: { label: 'Amendment Requested', className: 'bg-amber-100 text-amber-700' },
  finalised:           { label: 'Finalised',           className: 'bg-green-100 text-green-700' },
};

/** Returns the Sunday on or after the given date */
function nextSunday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = Sunday
  const diff = day === 0 ? 0 : 7 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtWeek(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(first = '', last = '') {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

const hasInvoice = (ts: { invoice_attachment_url: string | null }) =>
  ts.invoice_attachment_url != null;

// ─── Attach Invoice Modal ─────────────────────────────────────────────────────

interface AttachInvoiceModalProps {
  timesheetId: string;
  crewName: string;
  onClose: () => void;
  onAttached: () => void;
}

function AttachInvoiceModal({ timesheetId, crewName, onClose, onAttached }: AttachInvoiceModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please select a file.'); return; }
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('invoice', file);
      await attachInvoice(timesheetId, fd);
      onAttached();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-base">Attach Invoice</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <p className="text-slate-500 text-sm">Attaching invoice for <span className="font-medium text-slate-800">{crewName}</span></p>
          {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Invoice File</label>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg px-4 py-8 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-500 bg-blue-50' : file ? 'border-green-400 bg-green-50' : 'border-slate-200 hover:border-blue-400'}`}
            >
              {file ? (
                <><CheckCircle2 size={20} className="text-green-500 mx-auto mb-2" /><p className="text-slate-700 text-sm font-medium">{file.name}</p><p className="text-slate-400 text-xs mt-0.5">Click to change file</p></>
              ) : (
                <><Paperclip size={20} className="text-slate-300 mx-auto mb-2" /><p className="text-slate-600 text-sm font-medium">Drag &amp; drop or click to select</p><p className="text-slate-400 text-xs mt-0.5">PDF, JPG, PNG — max 25 MB</p></>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
            <button
              type="submit"
              disabled={uploading}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {uploading && <Loader2 size={14} className="animate-spin" />}
              Upload Invoice
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Gateway Error Banner ─────────────────────────────────────────────────────

function GatewayErrorBanner({ gatewayErr, onClose }: { gatewayErr: GatewayError; onClose: () => void }) {
  const router = useRouter();
  const crewProfileUrl = gatewayErr.crew_member_id ? `/crew/${gatewayErr.crew_member_id}` : null;
  const MESSAGES: Record<string, string> = {
    NO_PRODUCTION_ENGAGEMENT: `${gatewayErr.crew_name ?? 'This crew member'} is not engaged on this production. Add them to the production first.`,
    CREW_INACTIVE: `${gatewayErr.crew_name ?? 'This crew member'} is deactivated. Reactivate them in the Crew Database first.`,
    CREW_RECORD_INCOMPLETE: `${gatewayErr.crew_name ?? 'Crew record'} is incomplete — missing: ${gatewayErr.missing_fields?.join(', ')}.`,
    RATE_NOT_CONFIGURED: gatewayErr.error,
    CREW_NOT_FOUND: 'Crew member not found. Register them in the Crew Database.',
    PRODUCTION_NOT_ACTIVE: gatewayErr.error,
  };
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
      <UserX size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-amber-800 text-sm font-medium">Cannot create timesheet</p>
        <p className="text-amber-700 text-xs mt-0.5">{MESSAGES[gatewayErr.error_code] ?? gatewayErr.error}</p>
        {crewProfileUrl && (
          <button onClick={() => router.push(crewProfileUrl)} className="flex items-center gap-1 mt-1.5 text-xs text-blue-600 hover:underline font-medium">
            <ExternalLink size={11} /> Go to crew profile
          </button>
        )}
      </div>
      <button onClick={onClose} className="text-amber-400 hover:text-amber-600 flex-shrink-0"><X size={14} /></button>
    </div>
  );
}

// ─── New Timesheet Modal ──────────────────────────────────────────────────────

function NewTimesheetModal({ productions, weekEndingDate, onClose, onCreated }: {
  productions: Production[]; weekEndingDate: string; onClose: () => void; onCreated: () => void;
}) {
  const [productionId, setProductionId] = useState(productions[0]?.id ?? '');
  const [allCrew, setAllCrew] = useState<CrewMember[]>([]);
  const [crewId, setCrewId]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [gatewayErr, setGatewayErr] = useState<GatewayError | null>(null);

  useEffect(() => { crewApi.list({ is_active: 'true' }).then(setAllCrew).catch(() => {}); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crewId || !productionId) return;
    setSaving(true); setGatewayErr(null);
    try {
      await timesheetsApi.create({ crew_member_id: crewId, production_id: productionId, week_ending_date: weekEndingDate });
      onCreated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const codes = ['CREW_NOT_FOUND','CREW_INACTIVE','CREW_RECORD_INCOMPLETE','NO_PRODUCTION_ENGAGEMENT','RATE_NOT_CONFIGURED','PRODUCTION_NOT_ACTIVE'] as const;
      const matchCode = codes.find(k => msg.includes(k));
      const crew = allCrew.find(c => c.id === crewId);
      setGatewayErr({ error_code: matchCode ?? 'CREW_NOT_FOUND', error: msg, crew_member_id: crewId, crew_name: crew ? `${crew.first_name} ${crew.last_name}` : undefined });
    } finally { setSaving(false); }
  };

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div><h2 className="text-slate-900 font-semibold text-sm">New Timesheet</h2><p className="text-slate-400 text-xs mt-0.5">Week ending: {weekEndingDate}</p></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          {gatewayErr && <GatewayErrorBanner gatewayErr={gatewayErr} onClose={() => setGatewayErr(null)} />}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Production</label>
            <select className={inp} value={productionId} onChange={e => setProductionId(e.target.value)}>
              {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Crew Member *</label>
            <select className={inp} value={crewId} onChange={e => setCrewId(e.target.value)}>
              <option value="">— Select crew member —</option>
              {allCrew.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.crew_number}) — {c.crew_trade ?? ''}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
            <button type="submit" disabled={saving || !crewId} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TimesheetsPage() {
  const { user } = useAuth();
  const isGuest = user?.role === 'guest';
  const canAct = !isGuest;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlWeekEnding = searchParams.get('week_ending_date') ?? '';
  const urlProductionId = searchParams.get('production_id') ?? '';

  // Week state — start on current week-ending Sunday
  const [weekEnding, setWeekEnding] = useState<Date>(() => {
    if (urlWeekEnding) {
      const parsed = new Date(`${urlWeekEnding}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return nextSunday(new Date());
  });

  // Productions
  const [productions, setProductions]   = useState<Production[]>([]);
  const [selectedProd, setSelectedProd] = useState<string>(urlProductionId);

  // Timesheets
  const [sheets, setSheets]   = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Action states
  const [verifying, setVerifying]   = useState<string | null>(null);
  const [chasing, setChasing]       = useState(false);
  const [chaseMsg, setChaseMsg]     = useState('');
  const [attachModal, setAttachModal] = useState<{ id: string; name: string } | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkMsg, setBulkMsg]         = useState('');
  const [packGenerating, setPackGenerating] = useState(false);
  const [pdfPackGenerating, setPdfPackGenerating] = useState(false);
  const [packDownloadingId, setPackDownloadingId] = useState<string | null>(null);
  const [packMsg, setPackMsg]               = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Filter state (client-side, applied to the fetched week's data)
  const [statusFilter, setStatusFilter] = useState<TimesheetStatus | 'all'>('all');
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [tradeFilter, setTradeFilter] = useState('');
  const [crewSearch, setCrewSearch] = useState('');
  const [showNewTs, setShowNewTs]   = useState(false);
  const [sendingId, setSendingId]   = useState<string | null>(null);
  
  // Sorting state
  type SortKey = 'name' | 'week_ending' | 'production' | 'trade_rank' | 'days_worked' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'ot_hours' | 'ot_amount' | 'net_amount' | 'invoice' | 'status';
  const [sortConfig, setSortConfig] = useState<{ key: SortKey, direction: 'asc' | 'desc' } | null>(null);

  // Load productions once
  useEffect(() => {
    productionsApi.list()
      .then(data => {
        setProductions(data);
        if (!urlProductionId && data.length > 0) {
          const stored = localStorage.getItem('cs_last_production_id');
          if (stored && data.some(p => p.id === stored)) {
            setSelectedProd(stored);
          } else {
            setSelectedProd(data[0].id);
          }
        }
      })
      .catch(() => { /* silently ignore */ });
  }, [urlProductionId]);

  useEffect(() => {
    if (productions.length === 0) return;
    if (selectedProd) return;
    if (urlProductionId && productions.some(p => p.id === urlProductionId)) {
      setSelectedProd(urlProductionId);
      return;
    }
    const stored = localStorage.getItem('cs_last_production_id');
    if (stored && productions.some(p => p.id === stored)) {
      setSelectedProd(stored);
    } else {
      setSelectedProd(productions[0].id);
    }
  }, [productions, selectedProd, urlProductionId]);

  const weekEndingISO = toISODate(weekEnding);

  const setContextUrl = useCallback((nextWeekEndingISO: string, nextProductionId: string) => {
    const params = new URLSearchParams();
    if (nextWeekEndingISO) params.set('week_ending_date', nextWeekEndingISO);
    if (nextProductionId) params.set('production_id', nextProductionId);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router]);

  const loadSheets = useCallback(async () => {
    if (!selectedProd) return;
    setLoading(true);
    setError('');
    try {
      const data = await timesheetsApi.list({
        production_id:    selectedProd,
        week_ending_date: weekEndingISO,
      });
      setSheets(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load timesheets');
    } finally {
      setLoading(false);
    }
  }, [selectedProd, weekEndingISO]);

  useEffect(() => { loadSheets(); }, [loadSheets]);

  useEffect(() => {
    if (!selectedProd) return;
    localStorage.setItem('cs_last_production_id', selectedProd);
    setContextUrl(weekEndingISO, selectedProd);
  }, [selectedProd, weekEndingISO, setContextUrl]);

  // Auto-dismiss success messages after 3 seconds
  useEffect(() => { if (!bulkMsg)  return; const t = setTimeout(() => setBulkMsg(''),  3000); return () => clearTimeout(t); }, [bulkMsg]);
  useEffect(() => { if (!chaseMsg) return; const t = setTimeout(() => setChaseMsg(''), 3000); return () => clearTimeout(t); }, [chaseMsg]);
  useEffect(() => { if (!packMsg)  return; const t = setTimeout(() => setPackMsg(''),  3000); return () => clearTimeout(t); }, [packMsg]);

  // Week navigation
  const prevWeek = () => setWeekEnding(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  const nextWeek = () => setWeekEnding(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });

  // Available trades for this week's sheets
  const availableTrades = Array.from(new Set(sheets.map(s => s.crew_trade).filter(Boolean))) as string[];

  // Client-side filtered view
  const filteredSheets = sheets.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (invoiceFilter === 'yes' && !hasInvoice(s)) return false;
    if (invoiceFilter === 'no' && hasInvoice(s)) return false;
    if (tradeFilter && s.crew_trade !== tradeFilter) return false;
    if (crewSearch) {
      const q = crewSearch.toLowerCase();
      const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.toLowerCase();
      if (!name.includes(q) && !(s.crew_number ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedSheets = [...filteredSheets].sort((a, b) => {
    if (!sortConfig) return 0;
    let aVal: string | number = '';
    let bVal: string | number = '';

    const getAttendance = (ts: Timesheet, day: string) => {
      if (!ts.attendance_days) return false;
      const d = ts.attendance_days.find(x => x.day === day);
      return d ? d.worked : false;
    };

    switch (sortConfig.key) {
      case 'name':
        aVal = `${a.first_name ?? ''} ${a.last_name ?? ''}`.toLowerCase();
        bVal = `${b.first_name ?? ''} ${b.last_name ?? ''}`.toLowerCase();
        break;
      case 'week_ending':
        aVal = a.week_ending_date;
        bVal = b.week_ending_date;
        break;
      case 'production':
        aVal = a.prod_name ?? '';
        bVal = b.prod_name ?? '';
        break;
      case 'trade_rank':
        aVal = `${a.crew_trade ?? ''} ${a.crew_rank ?? ''}`.toLowerCase();
        bVal = `${b.crew_trade ?? ''} ${b.crew_rank ?? ''}`.toLowerCase();
        break;
      case 'days_worked':
        aVal = a.days_worked ?? 0;
        bVal = b.days_worked ?? 0;
        break;
      case 'mon': aVal = getAttendance(a, 'Monday') ? 1 : 0; bVal = getAttendance(b, 'Monday') ? 1 : 0; break;
      case 'tue': aVal = getAttendance(a, 'Tuesday') ? 1 : 0; bVal = getAttendance(b, 'Tuesday') ? 1 : 0; break;
      case 'wed': aVal = getAttendance(a, 'Wednesday') ? 1 : 0; bVal = getAttendance(b, 'Wednesday') ? 1 : 0; break;
      case 'thu': aVal = getAttendance(a, 'Thursday') ? 1 : 0; bVal = getAttendance(b, 'Thursday') ? 1 : 0; break;
      case 'fri': aVal = getAttendance(a, 'Friday') ? 1 : 0; bVal = getAttendance(b, 'Friday') ? 1 : 0; break;
      case 'sat': aVal = getAttendance(a, 'Saturday') ? 1 : 0; bVal = getAttendance(b, 'Saturday') ? 1 : 0; break;
      case 'sun': aVal = getAttendance(a, 'Sunday') ? 1 : 0; bVal = getAttendance(b, 'Sunday') ? 1 : 0; break;
      case 'ot_hours':
        aVal = a.overtime_hours_total ?? 0;
        bVal = b.overtime_hours_total ?? 0;
        break;
      case 'ot_amount':
        aVal = parseFloat(a.overtime_amount ?? '0');
        bVal = parseFloat(b.overtime_amount ?? '0');
        break;
      case 'net_amount':
        aVal = parseFloat(a.net_total_amount ?? a.gross_total ?? '0');
        bVal = parseFloat(b.net_total_amount ?? b.gross_total ?? '0');
        break;
      case 'invoice':
        aVal = hasInvoice(a) ? 1 : 0;
        bVal = hasInvoice(b) ? 1 : 0;
        break;
      case 'status':
        aVal = a.status.toLowerCase();
        bVal = b.status.toLowerCase();
        break;
      default:
        break;
    }

    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  // Stats from full unfiltered week data
  const crewOnSheet      = sheets.length;
  const invoicesReceived = sheets.filter(s => hasInvoice(s)).length;
  const nonDraftSheets   = sheets.filter(s => s.status !== 'draft');
  // Use gross_total (pre-VAT) for Net stat, grand_total (inc. VAT) for Gross stat
  const totalNet  = nonDraftSheets.reduce((acc, s) => acc + (s.gross_total ? parseFloat(s.gross_total) : (s.grand_total ? parseFloat(s.grand_total) : 0)), 0);
  const totalGross = nonDraftSheets.reduce((acc, s) => acc + (s.grand_total ? parseFloat(s.grand_total) : 0), 0);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Verify handler
  const handleVerify = async (id: string) => {
    setVerifying(id);
    try {
      await verifyTimesheet(id);
      await loadSheets();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Verify failed');
    } finally {
      setVerifying(null);
    }
  };

  // Chase invoices handler
  const handleChase = async () => {
    if (!selectedProd) return;
    setChasing(true);
    setChaseMsg('');
    try {
      const res = await chaseInvoices(selectedProd, weekEndingISO);
      setChaseMsg(res?.message ?? 'Chase emails sent.');
    } catch (err: unknown) {
      setChaseMsg(err instanceof Error ? err.message : 'Failed to send chase emails');
    } finally {
      setChasing(false);
    }
  };

  const handleBulkSend = async () => {
    if (!selectedProd) return;
    const draftCount = sheets.filter(s => s.status === 'draft').length;
    if (draftCount === 0) { setBulkMsg('No draft timesheets to send this week.'); return; }
    if (!confirm(`Send ${draftCount} timesheet${draftCount !== 1 ? 's' : ''} to crew members in one action?`)) return;
    setBulkSending(true); setBulkMsg('');
    try {
      const res = await fetch('/api/timesheets/bulk-distribute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
        },
        body: JSON.stringify({ week_ending_date: weekEndingISO, production_id: selectedProd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Bulk send failed');
      const sentCount   = data.results?.sent?.length   ?? 0;
      const failedNames = data.results?.failed          ?? [];
      const noEmail     = data.results?.no_email        ?? [];
      setStatusFilter('all');
      await loadSheets();
      let msg = `${sentCount} timesheet(s) distributed.`;
      if (noEmail.length)    msg += ` ${noEmail.length} had no email (status updated).`;
      if (failedNames.length) msg += ` Failed for: ${failedNames.join(', ')} — check status.`;
      setBulkMsg(msg);
    } catch (err: unknown) {
      setBulkMsg(err instanceof Error ? err.message : 'Bulk send failed');
    } finally {
      setBulkSending(false);
    }
  };

  const handleGeneratePack = async () => {
    if (!selectedProd) return;
    setPackGenerating(true); setPackMsg('');
    try {
      const res = await fetch('/api/timesheets/verification-pack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
        },
        body: JSON.stringify({ week_ending_date: weekEndingISO, production_id: selectedProd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const notDone = (data as { not_verified?: string[] }).not_verified;
        if (notDone?.length) {
          setPackMsg(`Not yet verified: ${notDone.join(', ')}`);
        } else {
          setPackMsg((data as { error?: string }).error ?? 'Failed to generate pack');
        }
        return;
      }
      // Trigger browser download
      const blob = await res.blob();
      const summary = res.headers.get('X-Pack-Summary');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const prodName = productions.find(p => p.id === selectedProd)?.name ?? 'Production';
      a.download = `VerificationPack_${prodName.replace(/[^a-zA-Z0-9]+/g,'_')}_w-e-${weekEndingISO}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      if (summary) {
        const s = JSON.parse(summary) as { crew_count?: number };
        setPackMsg(`Pack downloaded — ${s.crew_count} crew`);
      } else {
        setPackMsg('Verification pack downloaded');
      }
    } catch (err: unknown) {
      setPackMsg(err instanceof Error ? err.message : 'Failed to generate pack');
    } finally {
      setPackGenerating(false);
    }
  };

  const handleGeneratePdfPack = async () => {
    if (!selectedProd) return;
    setPdfPackGenerating(true); setPackMsg('');
    try {
      const res = await fetch('/api/timesheets/verification-pack-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
        },
        body: JSON.stringify({ week_ending_date: weekEndingISO, production_id: selectedProd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const notDone = (data as { not_verified?: string[] }).not_verified;
        if (notDone?.length) {
          setPackMsg(`Not yet verified: ${notDone.join(', ')}`);
        } else {
          setPackMsg((data as { error?: string }).error ?? 'Failed to generate PDF pack');
        }
        return;
      }
      // Trigger browser download
      const blob = await res.blob();
      const summary = res.headers.get('X-Pack-Summary');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const prodName = productions.find(p => p.id === selectedProd)?.name ?? 'Production';
      a.download = `VerificationPack_${prodName.replace(/[^a-zA-Z0-9]+/g,'_')}_w-e-${weekEndingISO}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      if (summary) {
        const s = JSON.parse(summary) as { crew_count?: number };
        setPackMsg(`PDF Pack downloaded — ${s.crew_count} crew`);
      } else {
        setPackMsg('PDF Verification pack downloaded');
      }
    } catch (err: unknown) {
      setPackMsg(err instanceof Error ? err.message : 'Failed to generate PDF pack');
    } finally {
      setPdfPackGenerating(false);
    }
  };

  const handleGenerateRowPack = async (ts: Timesheet) => {
    setPackDownloadingId(ts.id);
    setPackMsg('');
    try {
      const res = await fetch(`/api/timesheets/${ts.id}/verification-pack`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('cs_token')}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPackMsg((data as { error?: string }).error ?? 'Failed to generate verification pack');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const crewName = `${ts.first_name ?? ''} ${ts.last_name ?? ''}`.trim() || 'Crew';
      const prodName = ts.prod_name ?? selectedProdName ?? 'Production';
      a.download = `VerificationPack_${crewName.replace(/[^a-zA-Z0-9]+/g, '_')}_${prodName.replace(/[^a-zA-Z0-9]+/g, '_')}_w-e-${ts.week_ending_date}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPackMsg(`Verification pack downloaded for ${crewName}`);
    } catch (err: unknown) {
      setPackMsg(err instanceof Error ? err.message : 'Failed to generate verification pack');
    } finally {
      setPackDownloadingId(null);
    }
  };

  const handleDownloadDraft = async (ts: Timesheet) => {
    setPackDownloadingId(ts.id);
    setPackMsg('');
    try {
      const res = await fetch(`/api/timesheets/${ts.id}/draft-pdf`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPackMsg((data as { error?: string }).error ?? 'Failed to download draft PDF');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const crewName = `${ts.first_name ?? ''} ${ts.last_name ?? ''}`.trim() || 'Crew';
      const prodName = ts.prod_name ?? selectedProdName ?? 'Production';
      a.download = `Timesheet_Draft_${crewName.replace(/[^a-zA-Z0-9]+/g, '_')}_${prodName.replace(/[^a-zA-Z0-9]+/g, '_')}_w-e-${ts.week_ending_date}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPackMsg(`Draft PDF downloaded for ${crewName}`);
    } catch (err: unknown) {
      setPackMsg(err instanceof Error ? err.message : 'Failed to download draft PDF');
    } finally {
      setPackDownloadingId(null);
    }
  };

  const handleSendSingle = async (ts: Timesheet) => {
    setSendingId(ts.id);
    setPackMsg('');
    try {
      const res = await fetch(`/api/timesheets/${ts.id}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('cs_token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send timesheet');
      setPackMsg(data.message ?? 'Timesheet sent successfully');
      loadSheets(); // Reload to reflect status change
    } catch (err: unknown) {
      setPackMsg(err instanceof Error ? err.message : 'Failed to send timesheet');
    } finally {
      setSendingId(null);
    }
  };

  const selectedProdName = productions.find(p => p.id === selectedProd)?.name ?? '';

  const SortableHeader = ({ label, sortKey, align = 'left', title, screenReaderLabel }: { label: React.ReactNode; sortKey: SortKey; align?: 'left' | 'center' | 'right'; title?: string; screenReaderLabel?: string }) => (
    <th 
      className={`px-3 py-3 text-xs font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700 transition-colors text-${align} whitespace-nowrap`}
      onClick={() => {
        setSortConfig(current => {
          if (!current || current.key !== sortKey) return { key: sortKey, direction: 'asc' };
          if (current.direction === 'asc') return { key: sortKey, direction: 'desc' };
          return null;
        });
      }}
      title={title}
    >
      <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
        <span>{label}</span>
        {screenReaderLabel && <span className="sr-only"> ({screenReaderLabel})</span>}
        {sortConfig?.key === sortKey && (
          <span className="text-slate-400">
            {sortConfig.direction === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );

  return (
    <>
      {showNewTs && (
        <NewTimesheetModal
          productions={productions}
          weekEndingDate={weekEndingISO}
          onClose={() => setShowNewTs(false)}
          onCreated={() => { setShowNewTs(false); loadSheets(); }}
        />
      )}
      {attachModal && (
        <AttachInvoiceModal
          timesheetId={attachModal.id}
          crewName={attachModal.name}
          onClose={() => setAttachModal(null)}
          onAttached={() => { setAttachModal(null); loadSheets(); }}
        />
      )}

      <TopBar title="Timesheets & Pay Run" subtitle="Weekly timesheet review and pay run management" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Week + Production selectors */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Week selector */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-3 py-2.5 shadow-sm">
              <button
                onClick={() => { prevWeek(); }}
                className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                aria-label="Previous week"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-slate-900 font-semibold text-sm px-2 whitespace-nowrap">
                Week ending: {fmtWeek(weekEnding)}
              </span>
              <button
                onClick={() => { nextWeek(); }}
                className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                aria-label="Next week"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Production selector */}
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 shadow-sm">
              <select
                value={selectedProd}
                onChange={e => setSelectedProd(e.target.value)}
                className="text-slate-900 text-sm font-medium bg-transparent outline-none cursor-pointer pr-2"
              >
                {productions.length === 0 && <option value="">Loading…</option>}
                {productions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          {canAct && (
            <div className="flex items-center gap-2 flex-wrap">
              {(chaseMsg || bulkMsg) && (
                <span className={`text-xs rounded-lg px-3 py-1.5 border ${bulkMsg && !chaseMsg ? 'bg-green-50 border-green-200 text-green-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                  {bulkMsg || chaseMsg}
                </span>
              )}
              <button
                onClick={handleChase}
                disabled={chasing || !selectedProd}
                className="flex items-center gap-2 text-slate-600 text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 hover:bg-slate-50 shadow-sm disabled:opacity-60 transition-colors"
              >
                {chasing ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                Chase Invoices
              </button>
              <button
                onClick={handleBulkSend}
                disabled={bulkSending || !selectedProd}
                className="flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-3 py-2 hover:bg-blue-700 shadow-sm disabled:opacity-60 transition-colors font-medium"
              >
                {bulkSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send All
              </button>
              <button
                onClick={() => setShowNewTs(true)}
                disabled={!selectedProd}
                className="flex items-center gap-2 bg-teal-600 text-white text-sm rounded-lg px-3 py-2 hover:bg-teal-700 shadow-sm disabled:opacity-60 transition-colors font-medium"
              >
                <Plus size={14} /> New Timesheet
              </button>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Crew on Sheet',      value: loading ? null : crewOnSheet,                   sub: selectedProdName || 'this production' },
            { label: 'Invoices Received',  value: loading ? null : `${invoicesReceived} / ${crewOnSheet}`, sub: `${crewOnSheet - invoicesReceived} outstanding` },
            { label: 'Total Net',          value: loading ? null : `£${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: 'non-draft timesheets' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm">
              <p className="text-slate-500 text-xs font-medium">{s.label}</p>
              {s.value === null
                ? <div className="h-7 w-16 bg-slate-100 rounded animate-pulse mt-1 mb-0.5" />
                : <p className="text-slate-900 text-xl font-bold mt-1">{s.value}</p>}
              <p className="text-slate-400 text-xs mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Timesheet table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-slate-900 font-semibold text-sm">
                Timesheets — Week Ending {fmtWeek(weekEnding)}
              </h2>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status tabs */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['all', ...(canAct ? ['draft'] : []), 'distributed', 'amendment_requested', 'finalised'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s as TimesheetStatus | 'all')}
                    className={`text-sm px-3 py-1.5 rounded-md font-normal transition-colors capitalize ${
                      statusFilter === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {s === 'all' ? 'All' : s === 'amendment_requested' ? 'Amendment' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {/* Invoice toggle */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['all', 'yes', 'no'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setInvoiceFilter(v)}
                    className={`text-sm px-3 py-1.5 rounded-md font-normal transition-colors ${
                      invoiceFilter === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {v === 'all' ? 'Any Invoice' : v === 'yes' ? 'Invoice ✓' : 'No Invoice'}
                  </button>
                ))}
              </div>
              {/* Trade dropdown */}
              <select
                value={tradeFilter}
                onChange={e => setTradeFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All trades</option>
                {availableTrades.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {/* Crew search */}
              <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1.5 w-44">
                <svg className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  type="text"
                  value={crewSearch}
                  onChange={e => setCrewSearch(e.target.value)}
                  placeholder="Crew name..."
                  className="bg-transparent text-xs text-slate-700 placeholder-slate-400 outline-none w-full"
                />
                {crewSearch && <button onClick={() => setCrewSearch('')} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>}
              </div>
              {/* Clear filters */}
              {(statusFilter !== 'all' || invoiceFilter !== 'all' || tradeFilter || crewSearch) && (
                <button
                  onClick={() => { setStatusFilter('all'); setInvoiceFilter('all'); setTradeFilter(''); setCrewSearch(''); }}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="px-5 py-4 text-red-600 text-sm bg-red-50 border-b border-red-100">{error}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <SortableHeader label="Crew Member" sortKey="name" />
                  <SortableHeader label="Week Ending" sortKey="week_ending" />
                  <SortableHeader label="Production" sortKey="production" />
                  <SortableHeader label="Trade / Rank" sortKey="trade_rank" />
                  <SortableHeader label="Total Days" sortKey="days_worked" align="center" />
                  <SortableHeader label="Mon" screenReaderLabel="Monday" title="Monday" sortKey="mon" align="center" />
                  <SortableHeader label="Tue" screenReaderLabel="Tuesday" title="Tuesday" sortKey="tue" align="center" />
                  <SortableHeader label="Wed" screenReaderLabel="Wednesday" title="Wednesday" sortKey="wed" align="center" />
                  <SortableHeader label="Thu" screenReaderLabel="Thursday" title="Thursday" sortKey="thu" align="center" />
                  <SortableHeader label="Fri" screenReaderLabel="Friday" title="Friday" sortKey="fri" align="center" />
                  <SortableHeader label="Sat" screenReaderLabel="Saturday" title="Saturday" sortKey="sat" align="center" />
                  <SortableHeader label="Sun" screenReaderLabel="Sunday" title="Sunday" sortKey="sun" align="center" />
                  <SortableHeader label="OT Hrs" sortKey="ot_hours" align="right" />
                  <SortableHeader label="OT Amt" sortKey="ot_amount" align="right" />
                  <SortableHeader label="Net Amt" sortKey="net_amount" align="right" />
                  <SortableHeader label="Invoice" sortKey="invoice" align="center" />
                  <SortableHeader label="Status" sortKey="status" />
                  {canAct && <th className="px-3 py-3 text-xs font-semibold text-slate-500">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: canAct ? 18 : 17 }).map((_, j) => (
                        <td key={j} className="px-3 py-4">
                          <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedSheets.length === 0 ? (
                  sheets.length === 0 ? (
                    <EmptyStateRow
                      colSpan={canAct ? 18 : 17}
                      icon={FileText}
                      title="No timesheets yet"
                      description={
                        selectedProd
                          ? `No timesheets have been submitted or recorded for ${selectedProdName || 'this production'} in the selected week ending.`
                          : 'No production is currently selected, or no timesheets have been recorded for this period.'
                      }
                      recommendation="Select a production and assign crew members before creating the first timesheet."
                      action={canAct ? {
                        label: 'Create First Timesheet',
                        onClick: () => setShowNewTs(true),
                        icon: Plus,
                      } : undefined}
                      secondaryAction={{
                        label: 'View Crew Directory',
                        href: '/crew',
                      }}
                    />
                  ) : (
                    <EmptyStateRow
                      colSpan={canAct ? 18 : 17}
                      icon={AlertCircle}
                      title="No matching timesheets found"
                      description="No timesheets match your currently applied search criteria or filters."
                      recommendation="Try clearing active filters or resetting your search to see all timesheets for this week."
                      action={{
                        label: 'Clear Filters',
                        onClick: () => { setStatusFilter('all'); setInvoiceFilter('all'); setTradeFilter(''); setCrewSearch(''); },
                        icon: X,
                      }}
                    />
                  )
                ) : (
                  sortedSheets.map((ts, idx) => {
                    const colorClass = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                    const badge = STATUS_BADGE[ts.status] ?? STATUS_BADGE.draft;
                    const invoiced = hasInvoice(ts);
                    // Always show grand_total (full payable amount incl. VAT) in the main column
                    const grandTotalNum = ts.grand_total ? parseFloat(ts.grand_total) : null;
                    const grossTotalNum = ts.gross_total ? parseFloat(ts.gross_total) : null;
                    const firstName = ts.first_name ?? '';
                    const lastName  = ts.last_name  ?? '';
                    const fullName  = `${firstName} ${lastName}`.trim() || 'Unknown';
                    const isExpanded = expandedRows.has(ts.id);

                    const otHrs       = ts.overtime_hours_total ?? 0;
                    const otAmt       = parseFloat(ts.overtime_amount  ?? '0') || 0;
                    const netAmt      = parseFloat(ts.net_total_amount ?? ts.gross_total ?? '0') || 0;
                    const travelAmt   = parseFloat(ts.travel_amount ?? '0') || 0;
                    const mileageAmt  = parseFloat(ts.mileage_amount ?? '0') || 0;
                    const perDiemAmt  = parseFloat(ts.per_diem_amount ?? '0') || 0;
                    const adHocAmt    = parseFloat(ts.ad_hoc_amount ?? '0') || 0;
                    const foodAmt     = parseFloat(ts.food_amount ?? '0') || 0;
                    const extrasTotal = otAmt + travelAmt + mileageAmt + perDiemAmt + adHocAmt + foodAmt;
                    const colSpan     = canAct ? 18 : 17;

                    const fmtAmt = (n: number) =>
                      `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    
                    const getDayWorked = (day: string) => {
                      if (!ts.attendance_days) return false;
                      const d = ts.attendance_days.find(x => x.day === day);
                      return d ? d.worked : false;
                    };
                    
                    const DayCell = ({ day }: { day: string }) => (
                      <td className="px-3 py-3.5 text-center border-l border-slate-100">
                        {getDayWorked(day) ? <span className="text-green-500 font-bold">✓</span> : <span className="text-slate-300">-</span>}
                      </td>
                    );

                    return (
                      <Fragment key={ts.id}>
                        <tr className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-3.5 sticky left-0 bg-white z-10">
                            <div className="flex items-center gap-3">
                              {/* Expand toggle */}
                              <button
                                onClick={() => toggleRow(ts.id)}
                                className="p-0.5 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                                title={isExpanded ? 'Collapse details' : 'Show sub-amounts'}
                              >
                                <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                              <div className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center flex-shrink-0`}>
                                <span className="text-white text-xs font-bold">
                                  {getInitials(firstName, lastName)}
                                </span>
                              </div>
                              <div>
                                <p className="text-slate-900 font-medium text-sm">{fullName}</p>
                                <p className="text-slate-400 text-xs">
                                  {ts.crew_trade ?? ''}
                                  {ts.crew_rank ? ` · ${ts.crew_rank}` : ''}
                                  {ts.crew_number ? ` · ${ts.crew_number}` : ''}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-slate-600 text-xs whitespace-nowrap">{ts.week_ending_date}</td>
                          <td className="px-3 py-3.5 text-slate-600 text-xs">{ts.prod_name ?? selectedProdName ?? '—'}</td>
                          <td className="px-3 py-3.5">
                            <p className="text-slate-600 text-xs">{ts.crew_trade ?? '—'}</p>
                            {ts.crew_rank && <p className="text-slate-400 text-[10px]">{ts.crew_rank}</p>}
                          </td>
                          <td className="px-3 py-3.5 text-center text-slate-900 font-medium text-xs">{ts.days_worked ?? 0}</td>
                          <DayCell day="Monday" />
                          <DayCell day="Tuesday" />
                          <DayCell day="Wednesday" />
                          <DayCell day="Thursday" />
                          <DayCell day="Friday" />
                          <DayCell day="Saturday" />
                          <DayCell day="Sunday" />
                          <td className="px-3 py-3.5 text-right text-slate-900 text-xs">{otHrs > 0 ? otHrs : '—'}</td>
                          <td className="px-3 py-3.5 text-right text-slate-900 text-xs">{otAmt > 0 ? fmtAmt(otAmt) : '—'}</td>
                          <td className="px-3 py-3.5 text-right">
                            <p className="text-slate-900 font-semibold text-sm">
                              {fmtAmt(netAmt)}
                            </p>
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            {invoiced
                              ? <CheckCircle2 size={16} className="text-green-500 mx-auto" />
                              : <AlertCircle size={16} className="text-orange-400 mx-auto" />}
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex flex-col items-start gap-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badge.className}`}>
                                {badge.label}
                              </span>
                              {ts.amended_at && (
                                <span className="text-[10px] text-slate-400 italic whitespace-nowrap">
                                  Amended {new Date(ts.amended_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                </span>
                              )}
                            </div>
                          </td>
                          {canAct && (
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Verify — distributed or amendment_requested */}
                                {(ts.status === 'distributed' || ts.status === 'amendment_requested') && (
                                  <button
                                    onClick={() => handleVerify(ts.id)}
                                    disabled={verifying === ts.id}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors font-medium"
                                  >
                                    {verifying === ts.id
                                      ? <Loader2 size={12} className="animate-spin" />
                                      : <ShieldCheck size={12} />}
                                    Verify
                                  </button>
                                )}
                                {/* Edit entries link — not for finalised */}
                                {ts.status !== 'finalised' && (
                                  <Link
                                    href={{
                                      pathname: `/timesheets/${ts.id}`,
                                      query: { production_id: selectedProd, week_ending_date: weekEndingISO },
                                    }}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                                  >
                                    <ExternalLink size={12} />
                                    Edit Entries
                                  </Link>
                                )}
                                {/* Per-row PDF verification pack download */}
                                {ts.status !== 'draft' && (
                                  <button
                                    onClick={() => handleGenerateRowPack(ts)}
                                    disabled={packDownloadingId === ts.id}
                                    title={`Download PDF verification pack for ${fullName}`}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-medium disabled:opacity-60"
                                  >
                                    {packDownloadingId === ts.id
                                      ? <Loader2 size={12} className="animate-spin" />
                                      : <Download size={12} />}
                                    PDF Pack
                                  </button>
                                )}
                                {/* Draft PDF Button */}
                                {ts.status === 'draft' && (
                                  <button
                                    onClick={() => handleDownloadDraft(ts)}
                                    disabled={packDownloadingId === ts.id}
                                    title={`Download Draft PDF for ${fullName}`}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors font-medium disabled:opacity-60"
                                  >
                                    {packDownloadingId === ts.id
                                      ? <Loader2 size={12} className="animate-spin" />
                                      : <Download size={12} />}
                                    Draft PDF
                                  </button>
                                )}
                                {/* Send Individual Button (Available for all statuses) */}
                                <button
                                  onClick={() => handleSendSingle(ts)}
                                  disabled={sendingId === ts.id}
                                  title={`Send Timesheet to ${fullName}`}
                                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium"
                                >
                                  {sendingId === ts.id
                                    ? <Loader2 size={12} className="animate-spin" />
                                    : <Send size={12} />}
                                  Send
                                </button>
                                {/* Attach Invoice — distributed or amendment_requested */}
                                {(ts.status === 'distributed' || ts.status === 'amendment_requested') && (
                                  <button
                                    onClick={() => setAttachModal({ id: ts.id, name: fullName })}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                                  >
                                    <Paperclip size={12} />
                                    {ts.invoice_attachment_url ? 'Replace Invoice' : 'Attach Invoice'}
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>

                        {/* ── Expandable sub-amounts row ────────────────── */}
                        {isExpanded && (
                          <tr key={`${ts.id}-expand`} className="bg-slate-50/70 border-t border-slate-100">
                            <td colSpan={colSpan} className="px-6 py-3">
                              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Days</span>
                                  <span className="text-xs font-semibold text-slate-700">{ts.days_worked ?? 0}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">OT Hours</span>
                                  <span className="text-xs font-semibold text-slate-700">{ts.overtime_hours_total ?? 0}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">OT Amount</span>
                                  <span className="text-xs font-semibold text-slate-700">{fmtAmt(otAmt)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Mileage</span>
                                  <span className="text-xs font-semibold text-slate-700">{fmtAmt(mileageAmt)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Per Diem</span>
                                  <span className="text-xs font-semibold text-slate-700">{fmtAmt(perDiemAmt)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Ad Hoc</span>
                                  <span className="text-xs font-semibold text-slate-700">{fmtAmt(adHocAmt)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Food (B+L+S)</span>
                                  <span className="text-xs font-semibold text-slate-700">{fmtAmt(foodAmt)}</span>
                                </div>
                                <div className="h-3 w-px bg-slate-300" />
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">Extras Total</span>
                                  <span className="text-xs font-bold text-indigo-700">{fmtAmt(extrasTotal)}</span>
                                  <span className="text-[9px] text-slate-400">(OT + Mileage + PerDiem + AdHoc + Food)</span>
                                </div>
                                {grossTotalNum !== null && (
                                  <>
                                    <div className="h-3 w-px bg-slate-300" />
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Gross (pre-VAT)</span>
                                      <span className="text-xs font-semibold text-slate-700">{fmtAmt(grossTotalNum)}</span>
                                    </div>
                                  </>
                                )}
                                {grandTotalNum !== null && grossTotalNum !== null && Math.abs(grandTotalNum - grossTotalNum) > 0.01 && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-semibold text-green-600 uppercase tracking-wide">Grand Total (inc. VAT)</span>
                                    <span className="text-xs font-bold text-green-700">{fmtAmt(grandTotalNum)}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
            <span className="text-slate-400 text-xs">
              {loading
                ? 'Loading…'
                : filteredSheets.length === sheets.length
                  ? `${sheets.length} timesheet${sheets.length !== 1 ? 's' : ''} this week`
                  : `${filteredSheets.length} of ${sheets.length} timesheet${sheets.length !== 1 ? 's' : ''} (filtered)`}
              {!loading && sheets.length > 0 && (
                <span className="ml-2 text-slate-400">
                  · {sheets.filter(s => s.status === 'finalised').length}/{sheets.length} finalised
                </span>
              )}
            </span>
            {canAct && !loading && sheets.length > 0 && (
              <div className="flex items-center gap-2">
                {packMsg && (
                  <span className={`text-xs px-3 py-1 rounded-lg border ${packMsg.startsWith('Not yet') ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
                    {packMsg}
                  </span>
                )}
                <button
                  onClick={handleGeneratePack}
                  disabled={packGenerating || !selectedProd}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors font-medium"
                >
                  {packGenerating ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                  Generate Week Pack
                </button>
                <button
                  onClick={handleGeneratePdfPack}
                  disabled={pdfPackGenerating || !selectedProd}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-60 transition-colors font-medium"
                >
                  {pdfPackGenerating ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Generate PDF Pack
                </button>
              </div>
            )}
          </div>
        </div>

      </main>
    </>
  );
}
