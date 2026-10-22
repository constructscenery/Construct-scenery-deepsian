'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Calendar, Download, Printer, Send, Loader2,
  DollarSign, Clock, CheckCircle2, AlertCircle, FileText,
  Filter, Building2, RefreshCw, ChevronDown, Check,
} from 'lucide-react';
import {
  crewApi,
  CrewDetail,
  CrewEarningsReportResponse,
  CrewEarningsWeekItem,
  Production,
} from '@/lib/api';

interface CrewEarningsReportModalProps {
  crewMember: CrewDetail;
  productions: Production[];
  onClose: () => void;
}

const fmtCurrency = (val: number | string | undefined | null) => {
  const num = typeof val === 'string' ? parseFloat(val) : (val ?? 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d;
  }
};

export default function CrewEarningsReportModal({
  crewMember,
  productions,
  onClose,
}: CrewEarningsReportModalProps) {
  // Preset calculations
  const today = new Date();
  const currentYear = today.getFullYear();

  // UK Tax Years: 6 April to 5 April
  const getTaxYearDates = (startYear: number) => ({
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  });

  const currentTaxYear = today >= new Date(`${currentYear}-04-06`)
    ? getTaxYearDates(currentYear)
    : getTaxYearDates(currentYear - 1);

  const prevTaxYear = today >= new Date(`${currentYear}-04-06`)
    ? getTaxYearDates(currentYear - 1)
    : getTaxYearDates(currentYear - 2);

  const [activePreset, setActivePreset] = useState<string>('current_tax_year');
  const [startDate, setStartDate] = useState<string>(currentTaxYear.start);
  const [endDate, setEndDate] = useState<string>(currentTaxYear.end);
  const [selectedProductionId, setSelectedProductionId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [reportData, setReportData] = useState<CrewEarningsReportResponse | null>(null);

  // Email dispatch state
  const [showEmailModal, setShowEmailModal] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState<string>(crewMember.email || '');
  const [customEmailMessage, setCustomEmailMessage] = useState<string>('');
  const [sendingEmail, setSendingEmail] = useState<boolean>(false);
  const [emailSuccessMessage, setEmailSuccessMessage] = useState<string>('');
  const [emailErrorMessage, setEmailErrorMessage] = useState<string>('');

  const loadReport = useCallback(async (start?: string, end?: string, prodId?: string, status?: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await crewApi.getEarningsReport(crewMember.id, {
        start_date: start !== undefined ? start : startDate,
        end_date: end !== undefined ? end : endDate,
        production_id: prodId !== undefined ? prodId : selectedProductionId,
        status: status !== undefined ? status : statusFilter,
      });
      setReportData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate earnings report');
    } finally {
      setLoading(false);
    }
  }, [crewMember.id, startDate, endDate, selectedProductionId, statusFilter]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    let s = '';
    let e = '';

    if (preset === 'current_tax_year') {
      s = currentTaxYear.start;
      e = currentTaxYear.end;
    } else if (preset === 'prev_tax_year') {
      s = prevTaxYear.start;
      e = prevTaxYear.end;
    } else if (preset === 'last_3_months') {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      s = d.toISOString().split('T')[0];
      e = today.toISOString().split('T')[0];
    } else if (preset === 'ytd') {
      s = `${today.getFullYear()}-01-01`;
      e = today.toISOString().split('T')[0];
    } else if (preset === 'all') {
      s = '';
      e = '';
    }

    setStartDate(s);
    setEndDate(e);
    loadReport(s, e, selectedProductionId, statusFilter);
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail || !recipientEmail.trim()) {
      setEmailErrorMessage('Recipient email is required.');
      return;
    }

    setSendingEmail(true);
    setEmailErrorMessage('');
    setEmailSuccessMessage('');

    try {
      const res = await crewApi.sendEarningsReport(crewMember.id, {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        recipient_email: recipientEmail.trim(),
        custom_message: customEmailMessage.trim() || undefined,
        production_id: selectedProductionId || undefined,
      });

      setEmailSuccessMessage(res.message || `Earnings statement sent successfully to ${recipientEmail}`);
      setTimeout(() => {
        setShowEmailModal(false);
        setEmailSuccessMessage('');
      }, 2500);
    } catch (err: unknown) {
      setEmailErrorMessage(err instanceof Error ? err.message : 'Failed to send email statement');
    } finally {
      setSendingEmail(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (!reportData) return;
    const items = reportData.weeks || reportData.breakdown || [];
    if (items.length === 0) {
      alert('No timesheet rows to export for this period.');
      return;
    }

    const headers = [
      'Week Ending Date',
      'Production Code',
      'Production Name',
      'Status',
      'Days Worked',
      'OT Hours',
      'Basic Pay (£)',
      'OT Amount (£)',
      '6th Day Pay (£)',
      '7th Day Pay (£)',
      'Meal Allowances (£)',
      'Mileage & Travel (£)',
      'VAT (£)',
      'Gross Total (£)',
      'Grand Total (£)',
    ];

    const rows = items.map((w: CrewEarningsWeekItem) => [
      w.week_ending_date,
      `"${w.production_code || ''}"`,
      `"${w.production_name || ''}"`,
      w.status,
      w.days_worked,
      w.overtime_hours,
      (w.basic_pay || 0).toFixed(2),
      (w.overtime_amount || 0).toFixed(2),
      (w.sixth_day_payment || 0).toFixed(2),
      (w.seventh_day_payment || 0).toFixed(2),
      (w.meal_allowance_total || 0).toFixed(2),
      (w.mileage_and_travel || 0).toFixed(2),
      (w.vat || 0).toFixed(2),
      (w.gross_total || 0).toFixed(2),
      (w.grand_total || 0).toFixed(2),
    ]);

    // Summary line
    const summary = reportData.summary;
    rows.push([]);
    rows.push([
      'TOTALS',
      '',
      '',
      '',
      String(summary.total_days_worked || 0),
      String(summary.total_overtime_hours || 0),
      (summary.total_basic_pay || 0).toFixed(2),
      (summary.total_overtime_pay || 0).toFixed(2),
      (summary.total_weekend_pay || 0).toFixed(2),
      '',
      (summary.total_meal_allowances || 0).toFixed(2),
      (summary.total_mileage_travel || 0).toFixed(2),
      (summary.total_vat || 0).toFixed(2),
      (summary.total_gross || 0).toFixed(2),
      (summary.grand_total || 0).toFixed(2),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const crewClean = `${crewMember.first_name}_${crewMember.last_name}`.replace(/\s+/g, '_');
    link.setAttribute('download', `Earnings_Report_${crewClean}_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = reportData?.summary;
  const items = reportData?.weeks || reportData?.breakdown || [];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-auto flex flex-col max-h-[92vh] border border-slate-200 overflow-hidden print:m-0 print:p-0 print:border-none print:shadow-none print:max-h-none print:w-full"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
              CS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Crew Earnings Statement & Report
                </h2>
                <span className="text-[11px] font-semibold bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Construct Scenery
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {crewMember.first_name} {crewMember.last_name} · {crewMember.crew_number}
                {crewMember.crew_trade ? ` · ${crewMember.crew_trade}` : ''}
                {crewMember.crew_rank ? ` (${crewMember.crew_rank})` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
              title="Print or Save as PDF"
            >
              <Printer size={14} />
              Print / PDF
            </button>
            <button
              onClick={handleExportCSV}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors disabled:opacity-40"
              title="Export as CSV spreadsheet"
            >
              <Download size={14} />
              CSV
            </button>
            <button
              onClick={() => {
                setRecipientEmail(crewMember.email || '');
                setShowEmailModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-colors"
              title="Send branded statement to crew member"
            >
              <Send size={14} />
              Send to Crew
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors ml-2"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filter Controls (Hidden during print) */}
        <div className="bg-slate-50 border-b border-slate-200 p-4 print:hidden space-y-3">
          {/* Quick preset buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
              <Filter size={13} />
              Presets:
            </span>
            <button
              type="button"
              onClick={() => applyPreset('current_tax_year')}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                activePreset === 'current_tax_year'
                  ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-sm'
                  : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Current Tax Year ({currentYear}/{String(currentYear + 1).slice(-2)})
            </button>
            <button
              type="button"
              onClick={() => applyPreset('prev_tax_year')}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                activePreset === 'prev_tax_year'
                  ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-sm'
                  : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Previous Tax Year ({currentYear - 1}/{String(currentYear).slice(-2)})
            </button>
            <button
              type="button"
              onClick={() => applyPreset('last_3_months')}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                activePreset === 'last_3_months'
                  ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-sm'
                  : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Last 3 Months
            </button>
            <button
              type="button"
              onClick={() => applyPreset('ytd')}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                activePreset === 'ytd'
                  ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-sm'
                  : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              YTD ({currentYear})
            </button>
            <button
              type="button"
              onClick={() => applyPreset('all')}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                activePreset === 'all'
                  ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-sm'
                  : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Date Range Inputs & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                From Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setActivePreset('custom');
                    setStartDate(e.target.value);
                  }}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                To Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setActivePreset('custom');
                    setEndDate(e.target.value);
                  }}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Production
              </label>
              <select
                value={selectedProductionId}
                onChange={(e) => setSelectedProductionId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">All Productions</option>
                {productions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.production_code ? `(${p.production_code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="approved">Approved</option>
                  <option value="verified">Verified</option>
                  <option value="paid">Paid</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => loadReport()}
                disabled={loading}
                className="self-end px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Branded Print Header (Shown ONLY during print) */}
          <div className="hidden print:block border-b-2 border-slate-900 pb-4 mb-4">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Construct Scenery Ltd</h1>
                <p className="text-sm text-slate-600 font-medium">Crew Earnings & Timesheet Statement</p>
                <p className="text-xs text-slate-500 mt-1">Generated: {new Date().toLocaleDateString('en-GB')}</p>
              </div>
              <div className="text-right text-xs text-slate-700">
                <p className="font-bold text-sm text-slate-900">{crewMember.first_name} {crewMember.last_name}</p>
                <p>Crew Ref: {crewMember.crew_number}</p>
                <p>Trade: {crewMember.crew_trade || '—'} ({crewMember.crew_rank || '—'})</p>
                <p>Employment: {crewMember.employment_status === 'paye' ? 'PAYE' : 'Self-Employed'}</p>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-600 bg-slate-100 p-2 rounded">
              Period: <span className="font-semibold">{fmtDate(startDate)}</span> to <span className="font-semibold">{fmtDate(endDate)}</span>
            </div>
          </div>

          {/* Metric Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Grand Gross Total */}
              <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl p-4 shadow-sm relative overflow-hidden">
                <div className="absolute -right-3 -bottom-3 w-16 h-16 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
                <span className="text-[11px] font-medium text-slate-300 uppercase tracking-wider block">
                  Total Gross Earnings
                </span>
                <span className="text-2xl font-black text-amber-400 mt-1 block">
                  {fmtCurrency(summary.total_gross)}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Across {summary.total_timesheets || summary.timesheet_count || 0} timesheets
                </span>
              </div>

              {/* Days & OT Hours */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Time Worked
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-bold text-slate-900">
                    {summary.total_days_worked || 0}
                  </span>
                  <span className="text-xs text-slate-500">days</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-xl font-bold text-slate-900">
                    {summary.total_overtime_hours || 0}
                  </span>
                  <span className="text-xs text-slate-500">hrs OT</span>
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Basic: {fmtCurrency(summary.total_basic_pay)}
                </span>
              </div>

              {/* Overtime & Weekend */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Overtime & Weekend
                </span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">
                  {fmtCurrency((summary.total_overtime_pay || 0) + (summary.total_weekend_pay || 0))}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  OT: {fmtCurrency(summary.total_overtime_pay)} · 6/7th: {fmtCurrency(summary.total_weekend_pay)}
                </span>
              </div>

              {/* Allowances & VAT */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Allowances & VAT
                </span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">
                  {fmtCurrency((summary.total_meal_allowances || 0) + (summary.total_mileage_travel || 0))}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Travel/Meals · VAT: {fmtCurrency(summary.total_vat)}
                </span>
              </div>
            </div>
          )}

          {/* Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <FileText size={15} className="text-slate-500" />
                Week-by-Week Breakdown
              </h3>
              <span className="text-xs text-slate-500 font-medium">
                {items.length} week{items.length !== 1 ? 's' : ''} found
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Loader2 size={24} className="animate-spin mx-auto text-amber-500" />
                <p className="text-xs">Calculating earnings breakdown from timesheets…</p>
              </div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Calendar size={32} className="mx-auto text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">No timesheets recorded in this period</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Try adjusting the date range filters or presets above to search for timesheets across different dates.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-[11px] uppercase font-semibold text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4">Week Ending</th>
                      <th className="py-2.5 px-4">Production</th>
                      <th className="py-2.5 px-3 text-center">Days</th>
                      <th className="py-2.5 px-3 text-center">OT Hrs</th>
                      <th className="py-2.5 px-4 text-right">Basic Pay</th>
                      <th className="py-2.5 px-4 text-right">OT & Wknd</th>
                      <th className="py-2.5 px-4 text-right">Allowances</th>
                      <th className="py-2.5 px-4 text-right">Gross Total</th>
                      <th className="py-2.5 px-4 text-right">Grand Total</th>
                      <th className="py-2.5 px-3 text-center print:hidden">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((row: CrewEarningsWeekItem) => (
                      <tr key={row.timesheet_id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-semibold text-slate-900 whitespace-nowrap">
                          {fmtDate(row.week_ending_date)}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span className="font-medium text-slate-800">{row.production_name || '—'}</span>
                          {row.production_code && (
                            <span className="text-[10px] text-slate-400 ml-1.5">({row.production_code})</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-medium">
                          {row.days_worked || 0}
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-600">
                          {row.overtime_hours > 0 ? `${row.overtime_hours}h` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600 font-mono">
                          {fmtCurrency(row.basic_pay)}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600 font-mono">
                          {fmtCurrency((row.overtime_amount || 0) + (row.sixth_day_payment || 0) + (row.seventh_day_payment || 0))}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600 font-mono">
                          {fmtCurrency((row.meal_allowance_total || 0) + (row.mileage_and_travel || 0))}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-slate-900 font-mono">
                          {fmtCurrency(row.gross_total)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-amber-700 font-mono">
                          {fmtCurrency(row.grand_total)}
                        </td>
                        <td className="py-2.5 px-3 text-center print:hidden">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full capitalize ${
                              row.status === 'paid'
                                ? 'bg-green-100 text-green-700'
                                : row.status === 'approved' || row.status === 'verified'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {summary && (
                    <tfoot className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                      <tr>
                        <td className="py-3 px-4 uppercase text-xs tracking-wider" colSpan={2}>
                          Grand Totals
                        </td>
                        <td className="py-3 px-3 text-center">{summary.total_days_worked || 0}</td>
                        <td className="py-3 px-3 text-center">{summary.total_overtime_hours || 0}h</td>
                        <td className="py-3 px-4 text-right font-mono">{fmtCurrency(summary.total_basic_pay)}</td>
                        <td className="py-3 px-4 text-right font-mono">
                          {fmtCurrency((summary.total_overtime_pay || 0) + (summary.total_weekend_pay || 0))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {fmtCurrency((summary.total_meal_allowances || 0) + (summary.total_mileage_travel || 0))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-950 text-sm">
                          {fmtCurrency(summary.total_gross)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-amber-800 text-sm">
                          {fmtCurrency(summary.grand_total)}
                        </td>
                        <td className="print:hidden"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between print:hidden">
          <p className="text-xs text-slate-500">
            Construct Scenery Database · Timesheets & Crew Earnings Module
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Send Statement Email Sub-Modal */}
        {showEmailModal && (
          <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowEmailModal(false)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 border border-slate-200 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                    <Send size={15} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Send Earnings Statement</h3>
                    <p className="text-xs text-slate-500">Construct Scenery Branded Dispatch</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowEmailModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={16} />
                </button>
              </div>

              {emailErrorMessage && (
                <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span>{emailErrorMessage}</span>
                </div>
              )}

              {emailSuccessMessage && (
                <div className="p-2.5 bg-green-50 text-green-700 text-xs rounded-lg flex items-center gap-2">
                  <CheckCircle2 size={14} className="flex-shrink-0" />
                  <span>{emailSuccessMessage}</span>
                </div>
              )}

              <form onSubmit={handleSendEmail} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Recipient Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="crew@example.com"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    Pre-filled from crew member profile. You may modify if sending to an alternative address.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Personalised Note (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={customEmailMessage}
                    onChange={(e) => setCustomEmailMessage(e.target.value)}
                    placeholder="Hi John, here is the earnings statement for the requested period..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                  <p className="font-semibold text-slate-800">Email preview details:</p>
                  <p>• Period: {fmtDate(startDate)} to {fmtDate(endDate)}</p>
                  <p>• Included Timesheets: {items.length} week(s)</p>
                  <p>• Total Gross: <span className="font-bold text-slate-900">{fmtCurrency(summary?.total_gross)}</span></p>
                  <p className="text-[11px] text-slate-400 italic">Dispatched via Amazon SES using official Construct Scenery template.</p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sendingEmail}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-sm transition-colors disabled:opacity-60"
                  >
                    {sendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {sendingEmail ? 'Dispatching…' : 'Send Statement'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
