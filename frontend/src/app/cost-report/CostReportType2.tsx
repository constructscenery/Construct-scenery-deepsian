'use client';

import { useState, useCallback, useEffect } from 'react';
import { TrendingUp, TrendingDown, Plus, Trash2, Save, RotateCcw, Loader2, Pencil, Check } from 'lucide-react';
import { costReportExtApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductionSet = { id: string; set_number: string; set_name: string | null };

type BudgetLine = {
  id?: string;
  account_code: string | null;
  description: string;
  weekly_cost: number;
  weeks: number;
  total: number;
  sort_order: number;
  bectu_rate: number | null;
  agreed_rate: number | null;
  line_margin_rate: number | null;
  is_above_line: boolean;
  set_id: string | null;
  notes: string | null;
  line_type: string;
};

type MainCostRow = {
  account_code: string | null; description: string;
  weekly_cost: number; margin_pct: number; sub_total: number;
  weeks: number; budget: number;
  labour_costs_to_date: number; materials_costs_to_date: number;
  total_costs_to_date: number; over_under_budget: number;
};

type POBillingRow = {
  source_id: string; po_number: string | null;
  cs_invoice_number: string | null; po_value: number;
  amount_invoiced: number; amount_still_to_invoice: number;
  is_omitted: boolean;
};

type WeeklyInvoiceRow = {
  week_number: number; week_ending_date: string;
  above_line_labour_charged: number; labour_charged: number;
  materials: number; released_advance: number; charged_so_far: number;
  cs_invoice_number: string | null; po_reference: string | null;
};

type LabourRow = {
  entry_id: string;
  week_ending_date: string; transaction_description: string;
  account_code: string | null; account_description: string;
  net_amount_charged: number; margin_amount: number;
  cost_to_production: number; crew_name: string; crew_number: string;
};

type MaterialRow = {
  entry_id: string;
  week_ending_date: string; po_number: string | null;
  invoice_date: string; supplier: string;
  account_code: string | null; account_description: string;
  transaction_description: string; net_amount: number;
  margin_amount: number; recharge_to_production: number; set_code: string | null;
};

type OmittedRow = {
  entry_id: string; type: 'labour' | 'material';
  week_ending_date: string;
  crew_name?: string; crew_number?: string; supplier?: string; po_number?: string | null;
  set_code: string | null; account_code: string | null; description: string;
  net_amount?: number; margin_amount?: number; cost_to_production?: number;
  recharge_to_production?: number;
  omit_reason: string | null; created_at: string | null;
};

type PLRow = {
  week_ending_date: string;
  margin_from_recharged_costs: number;
  warrens_salary: number; weekly_profit: number; running_total_profit: number;
};

export type Type2Report = {
  production: { id: string; name: string; contract_type: string; status: string };
  budget: { id: string; margin_rate: number; contracted_weeks: number; notes: string | null; budget_lines: BudgetLine[] } | null;
  main_cost_report: MainCostRow[];
  summary: {
    margin_rate: number; margin_pct: string;
    total_labour_ctp: number; total_materials_ctp: number;
    grand_total_ctp: number; total_invoiced_to_production: number;
  };
  pos_and_billing: POBillingRow[];
  weekly_invoice_summary: WeeklyInvoiceRow[];
  labour_to_send: LabourRow[];
  materials_to_send: MaterialRow[];
  omitted_entries: Array<{ id: string; entry_id: string; omit_reason: string | null; created_at: string }>;
  omitted_labour: OmittedRow[];
  omitted_materials: OmittedRow[];
  production_sets: ProductionSet[];
  margins_reference: { items: string[]; notes: string | null } | null;
  weekly_pl: PLRow[];
  invoices_to_production: Array<{ id: string; amount: string; date: string; invoice_number: string | null }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n || 0);

const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const ABOVE_LINE_ROLES = [
  'Construction Manager', 'Construction Accountant', 'Construction Coordinator',
  'HOD (Head of Department)', 'Box Rental', 'Luton (Van)',
  'Assistant Construction Manager', 'Draftsman',
];

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'main',      label: 'Main Cost Report' },
  { id: 'pos',       label: 'POs & Amount to Bill' },
  { id: 'labour',    label: 'Labour to Send' },
  { id: 'materials', label: 'Materials to Send' },
  { id: 'weekly',    label: 'Weekly Invoice Summary' },
  { id: 'budget',    label: 'Master Budget' },
  { id: 'pl',        label: "Warren's P&L" },
  { id: 'omitted',   label: 'Omitted Entries' },
  { id: 'margins',   label: 'Margins Reference' },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── Table helpers ────────────────────────────────────────────────────────────

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold text-slate-500 bg-slate-50 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({ children, right, bold, green, red, mono }: {
  children: React.ReactNode; right?: boolean; bold?: boolean;
  green?: boolean; red?: boolean; mono?: boolean;
}) {
  return (
    <td className={[
      'px-4 py-3 text-sm whitespace-nowrap border-b border-slate-100',
      right ? 'text-right' : '',
      bold ? 'font-semibold text-slate-900' : 'text-slate-700',
      green ? '!text-green-700 font-semibold' : '',
      red ? '!text-red-600 font-semibold' : '',
      mono ? 'font-mono text-xs' : '',
    ].filter(Boolean).join(' ')}>
      {children}
    </td>
  );
}

function EmptyRow({ cols, label = 'No data' }: { cols: number; label?: string }) {
  return (
    <tr><td colSpan={cols} className="px-4 py-8 text-center text-slate-400 text-sm">{label}</td></tr>
  );
}

// ─── Input helpers ────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400';
const numCls   = `${inputCls} text-right tabular-nums`;

// ─── Summary banner ───────────────────────────────────────────────────────────

function SummaryBanner({ summary }: { summary: Type2Report['summary'] }) {
  const balance = summary.grand_total_ctp - summary.total_invoiced_to_production;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[
        { label: 'Margin Rate',         value: summary.margin_pct,              sub: 'overall rate' },
        { label: 'Total Labour CTP',    value: fmt(summary.total_labour_ctp),    sub: 'inc. margin' },
        { label: 'Total Materials CTP', value: fmt(summary.total_materials_ctp), sub: 'inc. margin' },
        { label: 'Grand Total CTP',     value: fmt(summary.grand_total_ctp),
          sub: `Invoiced: ${fmt(summary.total_invoiced_to_production)}`, over: balance > 0 },
      ].map(s => (
        <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
          <p className="text-slate-500 text-xs font-medium">{s.label}</p>
          <p className={`text-xl font-bold mt-0.5 ${s.over ? 'text-red-600' : 'text-slate-900'}`}>{s.value}</p>
          <p className="text-slate-400 text-xs mt-0.5">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Tab: Main Cost Report ────────────────────────────────────────────────────

function TabMainCostReport({ rows }: { rows: MainCostRow[] }) {
  const totals = rows.reduce((acc, r) => ({
    budget: acc.budget + r.budget, labour: acc.labour + r.labour_costs_to_date,
    materials: acc.materials + r.materials_costs_to_date,
    total: acc.total + r.total_costs_to_date, over_under: acc.over_under + r.over_under_budget,
  }), { budget: 0, labour: 0, materials: 0, total: 0, over_under: 0 });

  return (
    <TableWrap>
      <thead><tr>
        <Th>Account Code</Th><Th>Description</Th>
        <Th right>Weekly Cost</Th><Th right>Margin %</Th><Th right>Sub Total</Th>
        <Th right>Weeks</Th><Th right>Budget</Th>
        <Th right>Labour CTD</Th><Th right>Materials CTD</Th>
        <Th right>Total CTD</Th><Th right>Over/Under</Th>
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={11} label="No budget lines — set up the Master Budget first" /> : rows.map((r, i) => {
          const over = r.over_under_budget < 0;
          return (
            <tr key={i} className="hover:bg-slate-50/50">
              <Td mono>{r.account_code ?? '—'}</Td>
              <Td>{r.description}</Td>
              <Td right>{fmt(r.weekly_cost)}</Td>
              <Td right>{r.margin_pct.toFixed(0)}%</Td>
              <Td right>{fmt(r.sub_total)}</Td>
              <Td right>{r.weeks}</Td>
              <Td right bold>{fmt(r.budget)}</Td>
              <Td right>{fmt(r.labour_costs_to_date)}</Td>
              <Td right>{fmt(r.materials_costs_to_date)}</Td>
              <Td right bold>{fmt(r.total_costs_to_date)}</Td>
              <Td right green={!over} red={over}>{over ? '-' : '+'}{fmt(Math.abs(r.over_under_budget))}</Td>
            </tr>
          );
        })}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-200">
            <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Totals</td>
            <Td right bold>{fmt(totals.budget)}</Td>
            <Td right bold>{fmt(totals.labour)}</Td>
            <Td right bold>{fmt(totals.materials)}</Td>
            <Td right bold>{fmt(totals.total)}</Td>
            <Td right bold green={totals.over_under >= 0} red={totals.over_under < 0}>
              {totals.over_under < 0 ? '-' : '+'}{fmt(Math.abs(totals.over_under))}
            </Td>
          </tr>
        </tfoot>
      )}
    </TableWrap>
  );
}

// ─── Tab: POs & Amount to Bill ────────────────────────────────────────────────

type POEdit = { cs_invoice_number: string; amount_invoiced: string };

function TabPOsBilling({ rows, productionId, onRefresh }: {
  rows: POBillingRow[];
  productionId: string;
  onRefresh: () => void;
}) {
  const [edits,       setEdits]       = useState<Record<string, POEdit>>({});
  const [saving,      setSaving]      = useState<Record<string, boolean>>({});
  const [saveErr,     setSaveErr]     = useState<Record<string, string>>({});
  const [generating,  setGenerating]  = useState(false);
  const [generateErr, setGenerateErr] = useState('');

  const generateInvoiceNumber = async (sourceId: string) => {
    setGenerating(true);
    setGenerateErr('');
    try {
      const { next_invoice_number } = await costReportExtApi.getNextInvoiceNumber(productionId);
      setEdits(e => ({ ...e, [sourceId]: { ...(e[sourceId] ?? { cs_invoice_number: '', amount_invoiced: '' }), cs_invoice_number: next_invoice_number } }));
    } catch (err) {
      setGenerateErr(err instanceof Error ? err.message : 'Failed to generate invoice number');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    setEdits(Object.fromEntries(rows.map(r => [r.source_id, {
      cs_invoice_number: r.cs_invoice_number ?? '',
      amount_invoiced:   r.amount_invoiced > 0 ? String(r.amount_invoiced) : '',
    }])));
  }, [rows]);

  const upd = (sid: string, field: keyof POEdit, val: string) =>
    setEdits(e => ({ ...e, [sid]: { ...(e[sid] ?? { cs_invoice_number: '', amount_invoiced: '' }), [field]: val } }));

  const save = async (r: POBillingRow) => {
    const edit = edits[r.source_id] ?? { cs_invoice_number: '', amount_invoiced: '' };
    setSaving(s  => ({ ...s,  [r.source_id]: true }));
    setSaveErr(e => ({ ...e, [r.source_id]: '' }));
    try {
      await costReportExtApi.updatePoBilling(productionId, r.source_id, {
        cs_invoice_number: edit.cs_invoice_number || undefined,
        amount_invoiced:   parseFloat(edit.amount_invoiced || '0') || 0,
      });
      onRefresh();
    } catch (err) {
      setSaveErr(e => ({ ...e, [r.source_id]: err instanceof Error ? err.message : 'Save failed' }));
    } finally {
      setSaving(s => ({ ...s, [r.source_id]: false }));
    }
  };

  const totalValue = rows.reduce((s, r) => s + r.po_value, 0);
  const totalInvoiced = rows.reduce((s, r) => {
    const e = edits[r.source_id];
    return s + (e ? parseFloat(e.amount_invoiced || '0') || 0 : r.amount_invoiced);
  }, 0);
  const totalStill = totalValue - totalInvoiced;

  return (
    <div>
      {generateErr && (
        <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{generateErr}</div>
      )}
    <TableWrap>
      <thead><tr>
        <Th>PO Number</Th><Th>CS Invoice #</Th>
        <Th right>PO Value</Th><Th right>Amount Invoiced</Th><Th right>Still to Invoice</Th>
        <Th>Status</Th><Th>Save</Th>
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={7} label="No POs on this production" /> : rows.map((r, i) => {
          const edit = edits[r.source_id] ?? { cs_invoice_number: r.cs_invoice_number ?? '', amount_invoiced: String(r.amount_invoiced) };
          const localAmt  = parseFloat(edit.amount_invoiced || '0') || 0;
          const still     = r.po_value - localAmt;
          const isSaving  = saving[r.source_id]  || false;
          const err       = saveErr[r.source_id] || '';
          return (
            <tr key={i} className={`hover:bg-slate-50/50 ${r.is_omitted ? 'opacity-50' : ''}`}>
              <Td mono>{r.po_number ?? '—'}</Td>
              <td className="px-4 py-2 border-b border-slate-100">
                <div className="flex items-center gap-1">
                  <input type="text" value={edit.cs_invoice_number}
                    onChange={e => upd(r.source_id, 'cs_invoice_number', e.target.value)}
                    placeholder="CS invoice #"
                    className="w-24 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-slate-800" />
                  <button
                    onClick={() => generateInvoiceNumber(r.source_id)}
                    disabled={generating}
                    title="Auto-generate next CS invoice number"
                    className="flex items-center gap-1 text-[10px] px-1.5 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded hover:bg-slate-200 font-medium whitespace-nowrap disabled:opacity-50">
                    {generating ? <Loader2 size={9} className="animate-spin" /> : null}
                    Generate
                  </button>
                </div>
              </td>
              <Td right bold>{fmt(r.po_value)}</Td>
              <td className="px-4 py-2 border-b border-slate-100 text-right">
                <input type="number" min="0" step="0.01" value={edit.amount_invoiced}
                  onChange={e => upd(r.source_id, 'amount_invoiced', e.target.value)}
                  placeholder="0.00"
                  className="w-24 text-xs text-right border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums" />
              </td>
              <Td right red={still > 0}>{fmt(still)}</Td>
              <Td>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.is_omitted ? 'bg-slate-100 text-slate-500' : still <= 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {r.is_omitted ? 'Omitted' : still <= 0 ? 'Fully billed' : 'Pending'}
                </span>
              </Td>
              <td className="px-4 py-2 border-b border-slate-100">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => save(r)} disabled={isSaving}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 font-medium">
                    {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    Save
                  </button>
                  {err && <span className="text-red-500 text-[10px]">{err}</span>}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-200">
            <td colSpan={2} className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Totals</td>
            <Td right bold>{fmt(totalValue)}</Td>
            <Td right bold>{fmt(totalInvoiced)}</Td>
            <Td right bold red={totalStill > 0}>{fmt(totalStill)}</Td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
    </TableWrap>
    </div>
  );
}

// ─── Tab: Labour to Send ──────────────────────────────────────────────────────

function TabLabour({ rows, productionId, onOmitted }: {
  rows: LabourRow[]; productionId: string; onOmitted: () => void;
}) {
  const [omitting,  setOmitting]  = useState<string | null>(null);
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});
  const [omitError, setOmitError] = useState<string | null>(null);

  const omit = async (row: LabourRow) => {
    if (!row.week_ending_date) {
      setOmitError('Cannot omit: week ending date is missing on this entry');
      return;
    }
    setOmitting(row.entry_id);
    setOmitError(null);
    try {
      await costReportExtApi.omitEntry(productionId, {
        entry_id:        row.entry_id,
        week_ending_date: row.week_ending_date,
        omit_reason:     reasonMap[row.entry_id] || undefined,
      });
      onOmitted();
    } catch (e) {
      setOmitError(e instanceof Error ? e.message : 'Failed to omit entry');
    } finally { setOmitting(null); }
  };

  const totalNet    = rows.reduce((s, r) => s + r.net_amount_charged, 0);
  const totalMargin = rows.reduce((s, r) => s + r.margin_amount, 0);
  const totalCTP    = rows.reduce((s, r) => s + r.cost_to_production, 0);

  return (
    <div className="space-y-2">
      {omitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-700 text-xs font-medium">{omitError}</div>
      )}
      <TableWrap>
      <thead><tr>
        <Th>Week Ending</Th><Th>Crew Member</Th>
        <Th>Account / Set</Th><Th>Description</Th>
        <Th right>Net Amount</Th><Th right>Margin</Th><Th right>Cost to Production</Th>
        <Th>Reason (optional)</Th><Th>Omit</Th>
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={9} label="No approved labour this period" /> : rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50/50">
            <Td>{fmtDate(r.week_ending_date)}</Td>
            <Td><span className="font-medium text-slate-900">{r.crew_name}</span><span className="text-slate-400 text-xs ml-1">{r.crew_number}</span></Td>
            <Td mono>{r.account_code ?? '—'}</Td>
            <Td>{r.account_description}</Td>
            <Td right>{fmt(r.net_amount_charged)}</Td>
            <Td right>{fmt(r.margin_amount)}</Td>
            <Td right bold>{fmt(r.cost_to_production)}</Td>
            <td className="px-4 py-2 border-b border-slate-100">
              <input type="text" placeholder="Hold for next week…"
                value={reasonMap[r.entry_id] ?? ''}
                onChange={e => setReasonMap(m => ({ ...m, [r.entry_id]: e.target.value }))}
                className="w-40 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </td>
            <td className="px-4 py-2 border-b border-slate-100">
              <button onClick={() => omit(r)} disabled={omitting === r.entry_id}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 font-medium whitespace-nowrap">
                {omitting === r.entry_id ? <Loader2 size={11} className="animate-spin" /> : null}
                Omit week
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-200">
            <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Totals</td>
            <Td right bold>{fmt(totalNet)}</Td>
            <Td right bold>{fmt(totalMargin)}</Td>
            <Td right bold>{fmt(totalCTP)}</Td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
      </TableWrap>
    </div>
  );
}

// ─── Tab: Materials to Send ───────────────────────────────────────────────────

function TabMaterials({ rows, productionId, onOmitted }: {
  rows: MaterialRow[]; productionId: string; onOmitted: () => void;
}) {
  const [omitting,  setOmitting]  = useState<string | null>(null);
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});
  const [omitError, setOmitError] = useState<string | null>(null);

  const omit = async (row: MaterialRow) => {
    if (!row.week_ending_date) {
      setOmitError('Cannot omit: week ending date is missing on this entry');
      return;
    }
    setOmitting(row.entry_id);
    setOmitError(null);
    try {
      await costReportExtApi.omitEntry(productionId, {
        entry_id:        row.entry_id,
        week_ending_date: row.week_ending_date,
        omit_reason:     reasonMap[row.entry_id] || undefined,
      });
      onOmitted();
    } catch (e) {
      setOmitError(e instanceof Error ? e.message : 'Failed to omit entry');
    } finally { setOmitting(null); }
  };

  const totalNet    = rows.reduce((s, r) => s + r.net_amount, 0);
  const totalMargin = rows.reduce((s, r) => s + r.margin_amount, 0);
  const totalCTP    = rows.reduce((s, r) => s + r.recharge_to_production, 0);

  return (
    <div className="space-y-2">
      {omitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-700 text-xs font-medium">{omitError}</div>
      )}
      <TableWrap>
      <thead><tr>
        <Th>Week Ending</Th><Th>PO Number</Th><Th>Supplier</Th>
        <Th>Account Code</Th><Th>Set</Th>
        <Th right>Net Amount</Th><Th right>Margin</Th><Th right>Recharge to Production</Th>
        <Th>Reason (optional)</Th><Th>Omit</Th>
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={10} label="No approved materials this period" /> : rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50/50">
            <Td>{fmtDate(r.week_ending_date)}</Td>
            <Td mono>{r.po_number ?? '—'}</Td>
            <Td bold>{r.supplier}</Td>
            <Td mono>{r.account_code ?? '—'}</Td>
            <Td>{r.set_code ?? '—'}</Td>
            <Td right>{fmt(r.net_amount)}</Td>
            <Td right>{fmt(r.margin_amount)}</Td>
            <Td right bold>{fmt(r.recharge_to_production)}</Td>
            <td className="px-4 py-2 border-b border-slate-100">
              <input type="text" placeholder="Hold for next week…"
                value={reasonMap[r.entry_id] ?? ''}
                onChange={e => setReasonMap(m => ({ ...m, [r.entry_id]: e.target.value }))}
                className="w-40 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </td>
            <td className="px-4 py-2 border-b border-slate-100">
              <button onClick={() => omit(r)} disabled={omitting === r.entry_id}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 font-medium whitespace-nowrap">
                {omitting === r.entry_id ? <Loader2 size={11} className="animate-spin" /> : null}
                Omit week
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-200">
            <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Totals</td>
            <Td right bold>{fmt(totalNet)}</Td>
            <Td right bold>{fmt(totalMargin)}</Td>
            <Td right bold>{fmt(totalCTP)}</Td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
      </TableWrap>
    </div>
  );
}

// ─── Tab: Weekly Invoice Summary ──────────────────────────────────────────────

function TabWeeklyInvoice({ rows, productionId, onRefresh }: {
  rows: WeeklyInvoiceRow[];
  productionId: string;
  onRefresh: () => void;
}) {
  const [poRefs,   setPoRefs]   = useState<Record<string, string>>({});
  const [saving,   setSaving]   = useState<Record<string, boolean>>({});
  const [saveErr,  setSaveErr]  = useState<Record<string, string>>({});

  useEffect(() => {
    setPoRefs(Object.fromEntries(rows.map(r => [r.week_ending_date ?? '', r.po_reference ?? ''])));
  }, [rows]);

  const save = async (r: WeeklyInvoiceRow) => {
    if (!r.week_ending_date) return;
    const key = r.week_ending_date;
    setSaving(s  => ({ ...s,  [key]: true }));
    setSaveErr(e => ({ ...e, [key]: '' }));
    try {
      await costReportExtApi.upsertWeeklyPL(productionId, key, {
        po_reference: poRefs[key] || undefined,
      });
      onRefresh();
    } catch (err) {
      setSaveErr(e => ({ ...e, [key]: err instanceof Error ? err.message : 'Save failed' }));
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const totalCharged = rows.reduce((s, r) => s + r.charged_so_far, 0);
  const totalLabour  = rows.reduce((s, r) => s + r.labour_charged, 0);
  const totalMat     = rows.reduce((s, r) => s + r.materials, 0);

  return (
    <TableWrap>
      <thead><tr>
        <Th>Wk #</Th><Th>Week Ending</Th>
        <Th right>Above Line Labour</Th><Th right>Labour Charged</Th>
        <Th right>Materials</Th><Th right>Released Advance</Th>
        <Th right>Charged So Far</Th><Th>CS Invoice #</Th><Th>PO Reference</Th><Th>Save</Th>
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={10} label="No weekly data yet" /> : rows.map((r, i) => {
          const key      = r.week_ending_date ?? '';
          const isSaving = saving[key]  || false;
          const err      = saveErr[key] || '';
          return (
            <tr key={i} className="hover:bg-slate-50/50">
              <Td><span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{r.week_number}</span></Td>
              <Td bold>{fmtDate(r.week_ending_date)}</Td>
              <Td right>{fmt(r.above_line_labour_charged)}</Td>
              <Td right>{fmt(r.labour_charged)}</Td>
              <Td right>{fmt(r.materials)}</Td>
              <Td right>{fmt(r.released_advance)}</Td>
              <Td right bold>{fmt(r.charged_so_far)}</Td>
              <td className="px-4 py-2 border-b border-slate-100">
                {r.cs_invoice_number
                  ? <span className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{r.cs_invoice_number}</span>
                  : <span className="text-slate-400 italic text-xs">Set in POs tab</span>}
              </td>
              <td className="px-4 py-2 border-b border-slate-100">
                <input type="text" value={poRefs[key] ?? ''}
                  onChange={e => setPoRefs(p => ({ ...p, [key]: e.target.value }))}
                  placeholder="PO ref"
                  className="w-28 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-slate-800" />
              </td>
              <td className="px-4 py-2 border-b border-slate-100">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => save(r)} disabled={isSaving || !r.week_ending_date}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 font-medium">
                    {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    Save
                  </button>
                  {err && <span className="text-red-500 text-[10px]">{err}</span>}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-200">
            <td colSpan={2} className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Totals</td>
            <td className="px-4 py-3" />
            <Td right bold>{fmt(totalLabour)}</Td>
            <Td right bold>{fmt(totalMat)}</Td>
            <td className="px-4 py-3" />
            <Td right bold>{fmt(totalCharged)}</Td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      )}
    </TableWrap>
  );
}

// ─── Master Budget — editable line types ─────────────────────────────────────

type EditLine = {
  _key: number;
  account_code: string;
  description: string;
  bectu_rate: string;
  agreed_rate: string;
  weekly_cost: string;
  line_margin_rate: string;
  weeks: string;
  set_id: string;
  notes: string;
  is_above_line: boolean;
  line_type: string;
};

let _lineKey = 0;
const newKey = () => ++_lineKey;

const blankAbove = (role = ''): EditLine => ({
  _key: newKey(), account_code: '', description: role, bectu_rate: '', agreed_rate: '',
  weekly_cost: '', line_margin_rate: '', weeks: '', set_id: '', notes: '',
  is_above_line: true, line_type: 'above_line',
});

const blankSet = (setId = ''): EditLine => ({
  _key: newKey(), account_code: '', description: '', bectu_rate: '', agreed_rate: '',
  weekly_cost: '', line_margin_rate: '', weeks: '', set_id: setId, notes: '',
  is_above_line: false, line_type: 'set',
});

const fromApi = (bl: BudgetLine): EditLine => ({
  _key: newKey(),
  account_code:     bl.account_code ?? '',
  description:      bl.description ?? '',
  bectu_rate:       bl.bectu_rate != null ? String(bl.bectu_rate) : '',
  agreed_rate:      bl.agreed_rate != null ? String(bl.agreed_rate) : '',
  weekly_cost:      bl.weekly_cost != null ? String(bl.weekly_cost) : '',
  line_margin_rate: bl.line_margin_rate != null ? String(parseFloat(String(bl.line_margin_rate)) * 100) : '',
  weeks:            bl.weeks != null ? String(bl.weeks) : '',
  set_id:           bl.set_id ?? '',
  notes:            bl.notes ?? '',
  is_above_line:    bl.is_above_line ?? false,
  line_type:        bl.line_type ?? 'set',
});

function calcWeeklyTotal(l: EditLine, globalMarginPct: string): number {
  const mr = l.line_margin_rate !== '' ? parseFloat(l.line_margin_rate) / 100 : parseFloat(globalMarginPct || '0') / 100;
  return l.is_above_line ? parseFloat(l.agreed_rate || '0') * (1 + mr) : parseFloat(l.weekly_cost || '0');
}

function calcTotal(l: EditLine, globalMarginPct: string): number {
  return calcWeeklyTotal(l, globalMarginPct) * parseFloat(l.weeks || '0');
}

// ─── Tab: Master Budget ───────────────────────────────────────────────────────

function TabMasterBudget({ budget, productionId, productionSets, globalMarginRate, onSaved }: {
  budget: Type2Report['budget'];
  productionId: string;
  productionSets: ProductionSet[];
  globalMarginRate: number;
  onSaved: () => void;
}) {
  const initAbove = useCallback(() =>
    (budget?.budget_lines ?? []).filter(l => l.is_above_line).map(fromApi), [budget]);
  const initSet = useCallback(() =>
    (budget?.budget_lines ?? []).filter(l => !l.is_above_line).map(fromApi), [budget]);

  const [weeks,        setWeeks]        = useState(String(budget?.contracted_weeks ?? ''));
  const [marginPct,    setMarginPct]    = useState(String(((budget?.margin_rate ?? globalMarginRate) * 100).toFixed(0)));
  const [budgetNotes,  setBudgetNotes]  = useState(budget?.notes ?? '');
  const [aboveLines,   setAboveLines]   = useState<EditLine[]>(initAbove);
  const [setLines,     setSetLines]     = useState<EditLine[]>(initSet);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [saveOk,       setSaveOk]       = useState(false);

  const upd = (
    setFn: React.Dispatch<React.SetStateAction<EditLine[]>>,
    key: number, field: keyof EditLine, value: string
  ) => { setSaveOk(false); setFn(prev => prev.map(l => l._key === key ? { ...l, [field]: value } : l)); };

  const del = (
    setFn: React.Dispatch<React.SetStateAction<EditLine[]>>, key: number
  ) => { setSaveOk(false); setFn(prev => prev.filter(l => l._key !== key)); };

  const save = async () => {
    setSaving(true); setSaveMsg(''); setSaveOk(false);
    const all = [...aboveLines, ...setLines];
    try {
      await costReportExtApi.upsertBudget(productionId, {
        margin_rate:      parseFloat(marginPct || '10') / 100,
        contracted_weeks: parseInt(weeks || '0', 10),
        notes:            budgetNotes || undefined,
        budget_lines: all.map((l, i) => ({
          account_code:     l.account_code || null,
          description:      l.description,
          bectu_rate:       l.bectu_rate !== '' ? parseFloat(l.bectu_rate) : null,
          agreed_rate:      l.agreed_rate !== '' ? parseFloat(l.agreed_rate) : null,
          weekly_cost:      l.is_above_line ? parseFloat(l.agreed_rate || '0') : parseFloat(l.weekly_cost || '0'),
          line_margin_rate: l.line_margin_rate !== '' ? parseFloat(l.line_margin_rate) / 100 : null,
          weeks:            parseInt(l.weeks || weeks || '0', 10),
          is_above_line:    l.is_above_line,
          set_id:           l.set_id || null,
          notes:            l.notes || null,
          line_type:        l.line_type,
          sort_order:       i,
        })),
      });
      setSaveOk(true); setSaveMsg('Saved successfully');
      onSaved();
    } catch (err: unknown) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const aboveWeekly = aboveLines.reduce((s, l) => s + calcWeeklyTotal(l, marginPct), 0);
  const aboveTotal  = aboveLines.reduce((s, l) => s + calcTotal(l, marginPct), 0);
  const setTotal    = setLines.reduce((s, l) => s + calcTotal(l, marginPct), 0);

  const SaveBtn = ({ bottom = false }: { bottom?: boolean }) => {
    if (saveOk) {
      return (
        <button disabled
          className={`flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg shadow-sm ${bottom ? 'px-8' : ''}`}>
          <Check size={14} />
          Saved
        </button>
      );
    }
    return (
      <button onClick={save} disabled={saving}
        className={`flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm ${bottom ? 'px-8' : ''}`}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Save Budget
      </button>
    );
  };

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Contracted Weeks</label>
            <input type="number" min="0" value={weeks} onChange={e => { setWeeks(e.target.value); setSaveOk(false); }}
              className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 text-center font-semibold" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Overall Margin %</label>
            <div className="flex items-center gap-1">
              <input type="number" min="0" max="100" step="0.5" value={marginPct} onChange={e => { setMarginPct(e.target.value); setSaveOk(false); }}
                className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 text-center font-semibold" />
              <span className="text-slate-500 text-sm font-medium">%</span>
            </div>
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Adjustment / Reallocation Notes</label>
            <input type="text" value={budgetNotes} onChange={e => { setBudgetNotes(e.target.value); setSaveOk(false); }}
              placeholder="Budget adjustments, reallocations…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && <p className={`text-xs font-medium ${saveOk ? 'text-green-600' : 'text-red-600'}`}>{saveMsg}</p>}
            <SaveBtn />
          </div>
        </div>
      </div>

      {/* ── Above the Line ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="text-slate-900 font-semibold text-sm">Above the Line — Fixed Weekly Costs</h3>
            <p className="text-slate-400 text-xs mt-0.5">Construction Manager, Box Rental, Luton, HOD roles etc.</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Weekly total</p>
            <p className="text-slate-900 font-bold">{fmt(aboveWeekly)}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Role / Description</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-28">Account Code</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-32">BECTU Rate (£/wk)</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-32">Agreed Rate (£/wk)</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-24">Margin %</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-28">Weekly Total</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-20">Weeks</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-28">Budget Total</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Notes</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {aboveLines.length === 0 && (
                <tr><td colSpan={10} className="px-5 py-5 text-slate-400 text-sm text-center">No above-the-line roles yet</td></tr>
              )}
              {aboveLines.map(l => (
                <tr key={l._key} className="border-b border-slate-100 hover:bg-blue-50/20">
                  <td className="px-3 py-2">
                    <input list="role-list" value={l.description}
                      onChange={e => upd(setAboveLines, l._key, 'description', e.target.value)}
                      placeholder="e.g. Construction Manager" className={inputCls} />
                    <datalist id="role-list">
                      {ABOVE_LINE_ROLES.map(r => <option key={r} value={r} />)}
                    </datalist>
                  </td>
                  <td className="px-3 py-2">
                    <input value={l.account_code} onChange={e => upd(setAboveLines, l._key, 'account_code', e.target.value)}
                      placeholder="AL001" className={inputCls} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min="0" step="0.01" value={l.bectu_rate}
                      onChange={e => upd(setAboveLines, l._key, 'bectu_rate', e.target.value)}
                      placeholder="0.00" className={numCls} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min="0" step="0.01" value={l.agreed_rate}
                      onChange={e => upd(setAboveLines, l._key, 'agreed_rate', e.target.value)}
                      placeholder="0.00" className={numCls} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-0.5">
                      <input type="number" min="0" max="100" step="0.5" value={l.line_margin_rate}
                        onChange={e => upd(setAboveLines, l._key, 'line_margin_rate', e.target.value)}
                        placeholder={marginPct} className={numCls} />
                      <span className="text-slate-400 text-xs">%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900 whitespace-nowrap">
                    {fmt(calcWeeklyTotal(l, marginPct))}
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min="0" value={l.weeks || weeks}
                      onChange={e => upd(setAboveLines, l._key, 'weeks', e.target.value)}
                      placeholder={weeks} className={numCls} />
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                    {fmt(calcTotal(l, marginPct))}
                  </td>
                  <td className="px-3 py-2">
                    <input value={l.notes} onChange={e => upd(setAboveLines, l._key, 'notes', e.target.value)}
                      placeholder="Notes…" className={inputCls} />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => del(setAboveLines, l._key)} className="text-slate-300 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={10} className="px-4 py-2.5 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => { setSaveOk(false); setAboveLines(p => [...p, blankAbove()]); }}
                      className="flex items-center gap-1.5 text-xs text-blue-600 font-medium px-3 py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50">
                      <Plus size={12} /> Add Role
                    </button>
                    {ABOVE_LINE_ROLES.map(role => (
                      <button key={role} onClick={() => { setSaveOk(false); setAboveLines(p => [...p, blankAbove(role)]); }}
                        className="text-xs text-slate-500 hover:text-blue-600 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full hover:border-blue-200">
                        + {role}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
              {aboveLines.length > 0 && (
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={5} className="px-4 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">Above-the-Line Total</td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-900">{fmt(aboveWeekly)}</td>
                  <td />
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-900">{fmt(aboveTotal)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Set-by-Set Budget ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="text-slate-900 font-semibold text-sm">Set-by-Set Budget</h3>
            <p className="text-slate-400 text-xs mt-0.5">Weekly cost per set with account codes — margin applied on send</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Budget total</p>
            <p className="text-slate-900 font-bold">{fmt(setTotal)}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-36">Set</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-28">Account Code</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Description</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-32">Weekly Cost (£)</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-24">Margin %</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-20">Weeks</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 w-28">Total</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Notes</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {setLines.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-5 text-slate-400 text-sm text-center">No set budget lines yet</td></tr>
              )}
              {setLines.map(l => {
                const setInfo = productionSets.find(s => s.id === l.set_id);
                return (
                  <tr key={l._key} className="border-b border-slate-100 hover:bg-blue-50/20">
                    <td className="px-3 py-2">
                      <select value={l.set_id} onChange={e => upd(setSetLines, l._key, 'set_id', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">— No set —</option>
                        {productionSets.map(s => (
                          <option key={s.id} value={s.id}>{s.set_number}{s.set_name ? ` — ${s.set_name}` : ''}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={l.account_code} onChange={e => upd(setSetLines, l._key, 'account_code', e.target.value)}
                        placeholder="e.g. S001" className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input value={l.description} onChange={e => upd(setSetLines, l._key, 'description', e.target.value)}
                        placeholder={setInfo?.set_name ?? 'Description'} className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={l.weekly_cost}
                        onChange={e => upd(setSetLines, l._key, 'weekly_cost', e.target.value)}
                        placeholder="0.00" className={numCls} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-0.5">
                        <input type="number" min="0" max="100" step="0.5" value={l.line_margin_rate}
                          onChange={e => upd(setSetLines, l._key, 'line_margin_rate', e.target.value)}
                          placeholder={marginPct} className={numCls} />
                        <span className="text-slate-400 text-xs">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" value={l.weeks}
                        onChange={e => upd(setSetLines, l._key, 'weeks', e.target.value)}
                        placeholder={weeks} className={numCls} />
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                      {fmt(calcTotal(l, marginPct))}
                    </td>
                    <td className="px-3 py-2">
                      <input value={l.notes} onChange={e => upd(setSetLines, l._key, 'notes', e.target.value)}
                        placeholder="Notes / reallocation…" className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => del(setSetLines, l._key)} className="text-slate-300 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={9} className="px-4 py-2.5 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => { setSaveOk(false); setSetLines(p => [...p, blankSet()]); }}
                      className="flex items-center gap-1.5 text-xs text-blue-600 font-medium px-3 py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50">
                      <Plus size={12} /> Add Budget Line
                    </button>
                    {productionSets.map(s => (
                      <button key={s.id} onClick={() => { setSaveOk(false); setSetLines(p => [...p, blankSet(s.id)]); }}
                        className="text-xs text-slate-500 hover:text-blue-600 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full hover:border-blue-200">
                        + {s.set_number}{s.set_name ? ` ${s.set_name}` : ''}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
              {setLines.length > 0 && (
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={6} className="px-4 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">Set Budget Total</td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-900">{fmt(setTotal)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>

      {/* Grand total bar */}
      <div className="bg-blue-600 rounded-xl px-5 py-4 flex items-center justify-between text-white shadow-sm">
        <p className="font-semibold text-sm">Grand Total Budget</p>
        <p className="text-2xl font-bold">{fmt(aboveTotal + setTotal)}</p>
      </div>

      {/* Bottom save */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => { setAboveLines(initAbove()); setSetLines(initSet()); setSaveMsg(''); setSaveOk(false); }}
          className="flex items-center gap-1.5 px-4 py-2 text-slate-600 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">
          <RotateCcw size={13} /> Reset to saved
        </button>
        <SaveBtn bottom />
      </div>
    </div>
  );
}

// ─── Tab: Warren's Weekly P&L ────────────────────────────────────────────────

function TabWeeklyPL({ rows, productionId, onRefresh, canEdit }: {
  rows: PLRow[];
  productionId: string;
  onRefresh: () => void;
  canEdit: boolean;
}) {
  const [salaryEdits, setSalaryEdits] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState<Record<string, boolean>>({});
  const [saveErr,     setSaveErr]     = useState<Record<string, string>>({});

  useEffect(() => {
    setSalaryEdits(Object.fromEntries(rows.map(r => [
      r.week_ending_date ?? '__null__',
      r.warrens_salary > 0 ? String(r.warrens_salary) : '',
    ])));
  }, [rows]);

  const save = async (r: PLRow) => {
    if (!r.week_ending_date) return;
    const key    = r.week_ending_date;
    const salary = parseFloat(salaryEdits[key] || '0') || 0;
    setSaving(s  => ({ ...s, [key]: true }));
    setSaveErr(e => ({ ...e, [key]: '' }));
    try {
      await costReportExtApi.upsertWeeklyPL(productionId, r.week_ending_date, { warrens_salary: salary });
      onRefresh();
    } catch (err) {
      setSaveErr(e => ({ ...e, [key]: err instanceof Error ? err.message : 'Save failed' }));
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const colCount = canEdit ? 6 : 5;

  return (
    <TableWrap>
      <thead><tr>
        <Th>Week Ending</Th>
        <Th right>Margin from Recharged Costs</Th>
        <Th right>Warren&apos;s Salary {canEdit && <span className="text-blue-400 font-normal">(editable)</span>}</Th>
        <Th right>Weekly Profit</Th>
        <Th right>Running Total Profit</Th>
        {canEdit && <Th>Save</Th>}
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={colCount} label="No P&L data yet" /> : rows.map((r, i) => {
          const key          = r.week_ending_date ?? '__null__';
          const localSalary  = parseFloat(salaryEdits[key] || '0') || 0;
          const localProfit  = r.margin_from_recharged_costs - localSalary;
          const pos          = localProfit >= 0;
          const isSaving     = saving[key]  || false;
          const err          = saveErr[key] || '';
          return (
            <tr key={i} className="hover:bg-slate-50/50">
              <Td bold>{fmtDate(r.week_ending_date)}</Td>
              <Td right>{fmt(r.margin_from_recharged_costs)}</Td>
              <td className="px-4 py-3 text-right border-b border-slate-100 text-sm text-slate-700">
                {canEdit ? (
                  <input type="number" min="0" step="0.01"
                    value={salaryEdits[key] ?? ''}
                    onChange={e => setSalaryEdits(s => ({ ...s, [key]: e.target.value }))}
                    placeholder="0.00"
                    className="w-28 text-xs text-right border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums" />
                ) : fmt(r.warrens_salary)}
              </td>
              <Td right>
                <span className={`flex items-center justify-end gap-1 font-semibold ${pos ? 'text-green-700' : 'text-red-600'}`}>
                  {pos ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {fmt(localProfit)}
                </span>
              </Td>
              <Td right>
                <span className={`font-bold text-base ${r.running_total_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {fmt(r.running_total_profit)}
                </span>
              </Td>
              {canEdit && (
                <td className="px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => save(r)} disabled={isSaving || !r.week_ending_date}
                      title={!r.week_ending_date ? 'Week ending date not set' : undefined}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 font-medium">
                      {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      Save
                    </button>
                    {err && <span className="text-red-500 text-[10px]">{err}</span>}
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

// ─── Tab: Omitted Entries ─────────────────────────────────────────────────────

function TabOmitted({ omittedLabour, omittedMaterials, productionId, onRestored }: {
  omittedLabour: OmittedRow[];
  omittedMaterials: OmittedRow[];
  productionId: string;
  onRestored: () => void;
}) {
  const [restoring, setRestoring] = useState<string | null>(null);

  const restore = async (row: OmittedRow) => {
    setRestoring(row.entry_id);
    try {
      await costReportExtApi.unomitEntry(productionId, row.entry_id, row.week_ending_date);
      onRestored();
    } catch { /* silent */ } finally { setRestoring(null); }
  };

  const all = [...omittedLabour, ...omittedMaterials]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  if (all.length === 0) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl px-5 py-12 text-center">
        <p className="text-slate-500 text-sm font-medium">No omitted entries</p>
        <p className="text-slate-400 text-xs mt-1">Use &quot;Omit week&quot; in Labour or Materials tabs to hold an entry for next week&apos;s submission</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-amber-800 text-xs font-medium">
          {all.length} {all.length === 1 ? 'entry is' : 'entries are'} excluded from the current submission.
          Use &quot;Include next week&quot; to restore.
        </p>
      </div>
      <TableWrap>
        <thead><tr>
          <Th>Type</Th><Th>Week Ending</Th><Th>Who / Supplier</Th>
          <Th>Set</Th><Th>Account Code</Th><Th>Description</Th>
          <Th right>Net Amount</Th><Th right>Margin</Th><Th right>CTP / Recharge</Th>
          <Th>Reason</Th><Th>Action</Th>
        </tr></thead>
        <tbody>
          {all.map(r => {
            const ctp = r.type === 'labour' ? (r.cost_to_production ?? 0) : (r.recharge_to_production ?? 0);
            return (
              <tr key={r.entry_id} className="hover:bg-slate-50/50">
                <Td>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.type === 'labour' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {r.type === 'labour' ? 'Labour' : 'Material'}
                  </span>
                </Td>
                <Td>{fmtDate(r.week_ending_date)}</Td>
                <Td bold>{r.type === 'labour' ? `${r.crew_name} (${r.crew_number})` : r.supplier}</Td>
                <Td mono>{r.set_code ?? '—'}</Td>
                <Td mono>{r.account_code ?? '—'}</Td>
                <Td>{r.description}</Td>
                <Td right>{fmt(r.net_amount ?? 0)}</Td>
                <Td right>{fmt(r.margin_amount ?? 0)}</Td>
                <Td right bold>{fmt(ctp)}</Td>
                <Td><span className="text-xs text-slate-500 italic">{r.omit_reason ?? 'No reason given'}</span></Td>
                <td className="px-4 py-3 border-b border-slate-100">
                  <button onClick={() => restore(r)} disabled={restoring === r.entry_id}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50 font-medium whitespace-nowrap">
                    {restoring === r.entry_id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    Include next week
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ─── Tab: Margins Reference ───────────────────────────────────────────────────

const DEFAULT_MARGIN_ITEMS = [
  'Employers liability insurance', 'Public liability insurance',
  'Professional indemnity insurance', 'NI contributions', 'PAYE contributions',
  'Vehicle insurance', 'Legal fees', 'Car allowances', 'Training', 'Software',
  'Professional memberships', 'Telephone', 'Payroll accountancy',
];

function TabMargins({ marginsRef, productionId, onRefresh, canEdit }: {
  marginsRef: Type2Report['margins_reference'];
  productionId: string;
  onRefresh: () => void;
  canEdit: boolean;
}) {
  const serverItems = (marginsRef?.items?.length ? marginsRef.items : DEFAULT_MARGIN_ITEMS) as string[];
  const [editMode,  setEditMode]  = useState(false);
  const [editItems, setEditItems] = useState<string[]>([]);
  const [newItem,   setNewItem]   = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState('');

  const startEdit = () => {
    setEditItems([...serverItems]);
    setNewItem('');
    setSaveErr('');
    setEditMode(true);
  };

  const cancelEdit = () => { setEditMode(false); setSaveErr(''); };

  const saveEdit = async () => {
    setSaving(true); setSaveErr('');
    try {
      await costReportExtApi.updateMarginsReference(productionId, { items: editItems });
      setEditMode(false);
      onRefresh();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    setEditItems(prev => [...prev, newItem.trim()]);
    setNewItem('');
  };

  const updateItem = (idx: number, val: string) =>
    setEditItems(prev => prev.map((item, i) => i === idx ? val : item));

  const deleteItem = (idx: number) =>
    setEditItems(prev => prev.filter((_, i) => i !== idx));

  const displayItems = editMode ? editItems : serverItems;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-slate-900 font-semibold text-sm">What the Margin Covers</h3>
          <p className="text-slate-400 text-xs mt-0.5">{canEdit ? 'Click Edit to add, change, or remove items' : 'Read-only reference'}</p>
        </div>
        {canEdit && !editMode && (
          <button onClick={startEdit}
            className="flex items-center gap-1.5 text-xs text-blue-600 font-medium px-3 py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50">
            <Pencil size={12} /> Edit
          </button>
        )}
        {editMode && (
          <div className="flex items-center gap-2">
            {saveErr && <span className="text-red-500 text-xs">{saveErr}</span>}
            <button onClick={cancelEdit}
              className="text-xs text-slate-600 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={saveEdit} disabled={saving}
              className="flex items-center gap-1.5 text-xs text-white bg-blue-600 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          </div>
        )}
      </div>

      {editMode ? (
        <div className="space-y-3">
          {/* Add new item — at the top so it's immediately visible */}
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
            <input value={newItem} onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Type a new reference item and press Enter or click Add…"
              autoFocus
              className="flex-1 text-xs border border-blue-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50/40 placeholder-slate-400" />
            <button onClick={addItem}
              className="flex items-center gap-1 text-xs text-white bg-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-700 whitespace-nowrap shrink-0">
              <Plus size={12} /> Add
            </button>
          </div>

          {/* Existing items — editable */}
          <div className="space-y-2">
            {editItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={item} onChange={e => updateItem(i, e.target.value)}
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 text-slate-800" />
                <button onClick={() => deleteItem(i)} title="Remove this item"
                  className="text-slate-300 hover:text-red-500 shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {displayItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-slate-700 text-xs">{item}</span>
            </div>
          ))}
        </div>
      )}

      {!editMode && marginsRef?.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-amber-800 text-xs">{marginsRef.notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CostReportType2({ report, onRefresh, userRole }: {
  report: Type2Report;
  onRefresh: () => void;
  userRole?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('main');
  const omittedCount = (report.omitted_labour?.length ?? 0) + (report.omitted_materials?.length ?? 0);
  const isMD      = userRole === 'managing_director';
  const canEdit   = true;

  return (
    <div className="space-y-4">
      <SummaryBanner summary={report.summary} />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="border-b border-slate-200 overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
                {tab.id === 'omitted' && omittedCount > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {omittedCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 md:p-5">
          {activeTab === 'main'      && <TabMainCostReport rows={report.main_cost_report} />}
          {activeTab === 'pos'       && <TabPOsBilling rows={report.pos_and_billing} productionId={report.production.id} onRefresh={onRefresh} />}
          {activeTab === 'labour'    && <TabLabour rows={report.labour_to_send} productionId={report.production.id} onOmitted={onRefresh} />}
          {activeTab === 'materials' && <TabMaterials rows={report.materials_to_send} productionId={report.production.id} onOmitted={onRefresh} />}
          {activeTab === 'weekly'    && <TabWeeklyInvoice rows={report.weekly_invoice_summary} productionId={report.production.id} onRefresh={onRefresh} />}
          {activeTab === 'budget'    && (
            <TabMasterBudget
              budget={report.budget}
              productionId={report.production.id}
              productionSets={report.production_sets ?? []}
              globalMarginRate={report.summary.margin_rate}
              onSaved={onRefresh}
            />
          )}
          {activeTab === 'pl'        && <TabWeeklyPL rows={report.weekly_pl} productionId={report.production.id} onRefresh={onRefresh} canEdit={canEdit} />}
          {activeTab === 'omitted'   && (
            <TabOmitted
              omittedLabour={report.omitted_labour ?? []}
              omittedMaterials={report.omitted_materials ?? []}
              productionId={report.production.id}
              onRestored={onRefresh}
            />
          )}
          {activeTab === 'margins'   && <TabMargins marginsRef={report.margins_reference} productionId={report.production.id} onRefresh={onRefresh} canEdit={canEdit} />}
        </div>
      </div>
    </div>
  );
}
