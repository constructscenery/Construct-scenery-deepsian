'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calculator, Plus, Trash2, Save, Download, Printer, Copy,
  RefreshCw, Check, CheckCircle2, AlertCircle, Loader2, ChevronDown,
  Layers, Clock, Car, Users, Percent, Sparkles, FileText, ArrowRight,
  Building2, Filter, GitCompare, X, ChevronRight,
} from 'lucide-react';
import {
  weeklyEstimatesApi,
  Production,
  WeeklyCustomEstimate,
  WeeklyEstimateWeekConfig,
  WeeklyEstimateRoleLine,
  WeeklyEstimateVehicleLine,
  WeeklyEstimatesRatesLookup,
} from '@/lib/api';

interface WeeklyCustomEstimatorProps {
  productions: Production[];
}

const fmtGBP = (n: number | string | null | undefined) => {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isNaN(num) ? 0 : num);
};

// Generates an initial default week config matching Warren's example:
// "3D Accountant, 2D coordinator, 4 carp W, 2 stag W, Luton, 1 hour travel PER CREW, General OT, Saturday OT, Sunday OT"
const createInitialRoles = (): WeeklyEstimateRoleLine[] => [
  {
    id: 'role-1',
    trade: 'Non-BECTU',
    rank: 'Construction Accountant',
    quantity: 1,
    unit_type: 'days',
    days_count: 3,
    weeks_count: 1,
    daily_rate: 350,
    weekly_rate: 1750,
    travel_hours: 0,
    travel_hourly_rate: 25,
    overtime_hours: 0,
    overtime_hourly_rate: 45,
    saturday_ot_hours: 0,
    saturday_ot_rate: 45,
    sunday_ot_hours: 0,
    sunday_ot_rate: 70,
    line_cost: 1050,
  },
  {
    id: 'role-2',
    trade: 'Non-BECTU',
    rank: 'Construction Coordinator',
    quantity: 1,
    unit_type: 'days',
    days_count: 2,
    weeks_count: 1,
    daily_rate: 280,
    weekly_rate: 1400,
    travel_hours: 0,
    travel_hourly_rate: 25,
    overtime_hours: 0,
    overtime_hourly_rate: 40,
    saturday_ot_hours: 0,
    saturday_ot_rate: 40,
    sunday_ot_hours: 0,
    sunday_ot_rate: 56,
    line_cost: 560,
  },
  {
    id: 'role-3',
    trade: 'Carpenters',
    rank: 'Carpenter',
    quantity: 4,
    unit_type: 'weeks',
    days_count: 5,
    weeks_count: 1,
    daily_rate: 300,
    weekly_rate: 1500,
    travel_hours: 1,
    travel_hourly_rate: 25,
    overtime_hours: 2, // General OT
    overtime_hourly_rate: 45,
    saturday_ot_hours: 4, // Saturday OT
    saturday_ot_rate: 45,
    sunday_ot_hours: 0, // Sunday OT
    sunday_ot_rate: 60,
    line_cost: 0, // will be auto-calculated
  },
  {
    id: 'role-4',
    trade: 'Stagehands',
    rank: 'Stagehand',
    quantity: 2,
    unit_type: 'weeks',
    days_count: 5,
    weeks_count: 1,
    daily_rate: 240,
    weekly_rate: 1200,
    travel_hours: 1,
    travel_hourly_rate: 25,
    overtime_hours: 2, // General OT
    overtime_hourly_rate: 36,
    saturday_ot_hours: 0,
    saturday_ot_rate: 36,
    sunday_ot_hours: 4, // Sunday OT (Double time)
    sunday_ot_rate: 48,
    line_cost: 0, // will be auto-calculated
  },
];

const createInitialVehicles = (): WeeklyEstimateVehicleLine[] => [
  {
    id: 'veh-1',
    name: 'Luton Van (Runaround)',
    quantity: 1,
    rate: 450,
    unit_type: 'weeks',
    units_count: 1,
    line_cost: 450,
  },
];

const calculateRoleCost = (role: WeeklyEstimateRoleLine): number => {
  const qty = Math.max(0, role.quantity || 0);
  const travelHrs = Math.max(0, role.travel_hours || 0);
  const travelRate = Math.max(0, role.travel_hourly_rate || 0);

  // General OT
  const genOtHrs = Math.max(0, role.overtime_hours || 0);
  const genOtRate = Math.max(0, role.overtime_hourly_rate || 0);

  // Saturday OT
  const satOtHrs = Math.max(0, role.saturday_ot_hours || 0);
  const satOtRate = Math.max(0, role.saturday_ot_rate ?? genOtRate);

  // Sunday OT (defaults to 2x double time if not specified)
  const sunOtHrs = Math.max(0, role.sunday_ot_hours || 0);
  const defaultSunRate = role.daily_rate ? (role.daily_rate / 10) * 2 : genOtRate * 1.33;
  const sunOtRate = Math.max(0, role.sunday_ot_rate ?? defaultSunRate);

  let basePay = 0;
  let travelPay = 0;
  let otPay = 0;

  const totalRoleOtPerUnit = (genOtHrs * genOtRate) + (satOtHrs * satOtRate) + (sunOtHrs * sunOtRate);

  if (role.unit_type === 'days') {
    const days = Math.max(0, role.days_count || 1);
    const dailyRate = Math.max(0, role.daily_rate || 0);
    basePay = qty * days * dailyRate;
    travelPay = qty * days * (travelHrs * travelRate);
    otPay = qty * totalRoleOtPerUnit;
  } else {
    // Weeks unit
    const weeks = Math.max(0, role.weeks_count || 1);
    const weeklyRate = Math.max(0, role.weekly_rate || 0);
    basePay = qty * weeks * weeklyRate;
    travelPay = qty * (weeks * 5) * (travelHrs * travelRate);
    otPay = qty * weeks * totalRoleOtPerUnit;
  }

  return Number((basePay + travelPay + otPay).toFixed(2));
};

const calculateVehicleCost = (veh: WeeklyEstimateVehicleLine): number => {
  const qty = Math.max(0, veh.quantity || 0);
  const units = Math.max(0, veh.units_count || 1);
  const rate = Math.max(0, veh.rate || 0);
  return Number((qty * units * rate).toFixed(2));
};

export default function WeeklyCustomEstimator({ productions }: WeeklyCustomEstimatorProps) {
  // Saved estimates management
  const [savedEstimates, setSavedEstimates] = useState<WeeklyCustomEstimate[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string>('');
  const [loadingSaved, setLoadingSaved] = useState<boolean>(false);
  const [ratesLookup, setRatesLookup] = useState<WeeklyEstimatesRatesLookup | null>(null);

  // Production scope filter ('all' = all portfolio, 'unlinked' = general quotes, or a specific production ID)
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  // Summary sub-view: 'active_scenario' | 'segregated_productions' | 'combined_rollup'
  const [summarySubView, setSummarySubView] = useState<'active_scenario' | 'segregated_productions' | 'combined_rollup'>('active_scenario');

  // Compare scenarios modal
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);

  // Selected estimates for combined rollup (maps estimate.id -> boolean)
  const [rollupSelection, setRollupSelection] = useState<Record<string, boolean>>({});

  // Current estimate editing state
  const [estimateTitle, setEstimateTitle] = useState<string>('3-Week Labour & Vehicles Estimate');
  const [productionId, setProductionId] = useState<string>('');
  const [numWeeks, setNumWeeks] = useState<number>(3);
  const [startDate, setStartDate] = useState<string>('');
  const [marginEnabled, setMarginEnabled] = useState<boolean>(true);
  const [marginPercentage, setMarginPercentage] = useState<number>(10);
  const [notes, setNotes] = useState<string>('');

  // Active view tab in multi-week: 'summary' or specific week index (0, 1, 2...)
  const [activeWeekTab, setActiveWeekTab] = useState<number | 'summary'>('summary');

  // Multi-week configurations array
  const [weeksConfig, setWeeksConfig] = useState<WeeklyEstimateWeekConfig[]>(() => {
    return Array.from({ length: 3 }).map((_, idx) => ({
      week_number: idx + 1,
      week_label: `Week ${idx + 1}`,
      roles: createInitialRoles().map(r => ({ ...r, line_cost: calculateRoleCost(r) })),
      vehicles: createInitialVehicles().map(v => ({ ...v, line_cost: calculateVehicleCost(v) })),
      week_subtotal: 0,
      week_margin_amount: 0,
      week_total_with_margin: 0,
    }));
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  // Load lookup rates and saved estimates list on mount
  useEffect(() => {
    weeklyEstimatesApi.getRatesLookup()
      .then(res => setRatesLookup(res))
      .catch(() => {});

    loadSavedList();
  }, []);

  const loadSavedList = async () => {
    setLoadingSaved(true);
    try {
      const res = await weeklyEstimatesApi.list();
      const list = res.estimates || [];
      setSavedEstimates(list);
      setRollupSelection(prev => {
        const next = { ...prev };
        list.forEach(est => {
          if (next[est.id] === undefined) {
            next[est.id] = true;
          }
        });
        return next;
      });
    } catch {
      /* ignore */
    } finally {
      setLoadingSaved(false);
    }
  };

  // Filter scenarios based on selected scope
  const visibleScenarios = useMemo(() => {
    if (scopeFilter === 'all') return savedEstimates;
    if (scopeFilter === 'unlinked') return savedEstimates.filter(e => !e.production_id);
    return savedEstimates.filter(e => e.production_id === scopeFilter);
  }, [savedEstimates, scopeFilter]);

  // Group saved estimates by production for segregated summary
  const productionGroups = useMemo(() => {
    const map = new Map<string, {
      productionId: string | null;
      productionName: string;
      productionCode?: string | null;
      productionStatus?: string | null;
      estimates: WeeklyCustomEstimate[];
    }>();

    savedEstimates.forEach(est => {
      const key = est.production_id || 'unlinked';
      if (!map.has(key)) {
        map.set(key, {
          productionId: est.production_id,
          productionName: est.production_name || (est.production_id ? 'Unknown Production' : 'General / Combined Portfolio Quotes'),
          productionCode: est.production_code,
          productionStatus: est.production_status,
          estimates: [],
        });
      }
      map.get(key)!.estimates.push(est);
    });

    return Array.from(map.values());
  }, [savedEstimates]);

  // Create a new scenario in current scope
  const handleCreateNewScenario = (targetProdId?: string) => {
    setSelectedEstimateId('');
    const effectiveProdId = targetProdId !== undefined ? targetProdId : (scopeFilter !== 'all' && scopeFilter !== 'unlinked' ? scopeFilter : '');
    setProductionId(effectiveProdId);
    const prodObj = productions.find(p => p.id === effectiveProdId);
    const prodPrefix = prodObj ? `${prodObj.name} — ` : '';
    setEstimateTitle(`${prodPrefix}Scenario ${String.fromCharCode(65 + (visibleScenarios.length % 26))}`);
    setNumWeeks(3);
    setWeeksConfig(Array.from({ length: 3 }).map((_, idx) => ({
      week_number: idx + 1,
      week_label: `Week ${idx + 1}`,
      roles: createInitialRoles().map(r => ({ ...r, line_cost: calculateRoleCost(r) })),
      vehicles: createInitialVehicles().map(v => ({ ...v, line_cost: calculateVehicleCost(v) })),
      week_subtotal: 0,
      week_margin_amount: 0,
      week_total_with_margin: 0,
    })));
    setSuccessMsg('Initialized new estimate scenario draft');
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  // Clone active estimate as a new scenario
  const handleCloneScenario = async () => {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const nextLetter = String.fromCharCode(65 + ((visibleScenarios.length + 1) % 26));
      const clonedTitle = `${estimateTitle} (Scenario ${nextLetter})`;
      const payload: Partial<WeeklyCustomEstimate> = {
        title: clonedTitle,
        production_id: productionId || null,
        num_weeks: numWeeks,
        start_date: startDate || null,
        margin_enabled: marginEnabled,
        margin_percentage: marginPercentage,
        weeks_config: computedSummary.weeks,
        summary_totals: computedSummary.totals,
        notes: notes ? `${notes} · Cloned scenario` : 'Cloned scenario',
      };
      const res = await weeklyEstimatesApi.create(payload);
      setSelectedEstimateId(res.estimate.id);
      setEstimateTitle(res.estimate.title);
      await loadSavedList();
      setSuccessMsg(`Cloned new scenario "${res.estimate.title}"!`);
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to clone scenario');
    } finally {
      setSaving(false);
    }
  };

  // Adjust number of weeks dynamically when numWeeks changes
  const handleNumWeeksChange = (newCount: number) => {
    const validCount = Math.max(1, Math.min(12, newCount));
    setNumWeeks(validCount);

    setWeeksConfig(prev => {
      if (validCount === prev.length) return prev;
      if (validCount > prev.length) {
        const templateWeek = prev[prev.length - 1] || {
          roles: createInitialRoles(),
          vehicles: createInitialVehicles(),
        };
        const next = [...prev];
        for (let i = prev.length; i < validCount; i++) {
          next.push({
            week_number: i + 1,
            week_label: `Week ${i + 1}`,
            roles: templateWeek.roles.map(r => ({ ...r, id: `role-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` })),
            vehicles: templateWeek.vehicles.map(v => ({ ...v, id: `veh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` })),
            week_subtotal: 0,
            week_margin_amount: 0,
            week_total_with_margin: 0,
          });
        }
        return next;
      }
      return prev.slice(0, validCount);
    });
  };

  // Compute calculated financial totals for each week and overall
  const computedSummary = useMemo(() => {
    let grandSubtotalLabour = 0;
    let grandSubtotalTravel = 0;
    let grandSubtotalOvertime = 0;
    let grandSubtotalOtGeneral = 0;
    let grandSubtotalOtSaturday = 0;
    let grandSubtotalOtSunday = 0;
    let grandSubtotalVehicles = 0;
    let grandNetSubtotal = 0;
    let grandMarginAmount = 0;
    let grandTotalWithMargin = 0;

    const weeksProcessed = weeksConfig.map((week, idx) => {
      let weekLabour = 0;
      let weekTravel = 0;
      let weekOtGeneral = 0;
      let weekOtSaturday = 0;
      let weekOtSunday = 0;
      let weekOvertime = 0;
      let weekVehicles = 0;

      const rolesWithCosts = week.roles.map(r => {
        const cost = calculateRoleCost(r);
        const qty = Math.max(0, r.quantity || 0);
        const travelRate = Math.max(0, r.travel_hourly_rate || 0);
        const travelHrs = Math.max(0, r.travel_hours || 0);

        const genOtRate = Math.max(0, r.overtime_hourly_rate || 0);
        const satOtRate = Math.max(0, r.saturday_ot_rate ?? genOtRate);
        const defaultSunRate = r.daily_rate ? (r.daily_rate / 10) * 2 : genOtRate * 1.33;
        const sunOtRate = Math.max(0, r.sunday_ot_rate ?? defaultSunRate);

        const genOtHrs = Math.max(0, r.overtime_hours || 0);
        const satOtHrs = Math.max(0, r.saturday_ot_hours || 0);
        const sunOtHrs = Math.max(0, r.sunday_ot_hours || 0);

        const mult = r.unit_type === 'days' ? 1 : Math.max(0, r.weeks_count || 1);

        if (r.unit_type === 'days') {
          const days = Math.max(0, r.days_count || 1);
          weekLabour += qty * days * (r.daily_rate || 0);
          weekTravel += qty * days * travelHrs * travelRate;
        } else {
          const weeks = Math.max(0, r.weeks_count || 1);
          weekLabour += qty * weeks * (r.weekly_rate || 0);
          weekTravel += qty * (weeks * 5) * travelHrs * travelRate;
        }

        const roleGenOt = qty * mult * genOtHrs * genOtRate;
        const roleSatOt = qty * mult * satOtHrs * satOtRate;
        const roleSunOt = qty * mult * sunOtHrs * sunOtRate;

        weekOtGeneral += roleGenOt;
        weekOtSaturday += roleSatOt;
        weekOtSunday += roleSunOt;
        weekOvertime += (roleGenOt + roleSatOt + roleSunOt);

        return { ...r, line_cost: cost };
      });

      const vehiclesWithCosts = week.vehicles.map(v => {
        const cost = calculateVehicleCost(v);
        weekVehicles += cost;
        return { ...v, line_cost: cost };
      });

      const weekSubtotal = weekLabour + weekTravel + weekOvertime + weekVehicles;
      const marginFactor = marginEnabled ? (marginPercentage / 100) : 0;
      const weekMargin = Number((weekSubtotal * marginFactor).toFixed(2));
      const weekTotal = Number((weekSubtotal + weekMargin).toFixed(2));

      grandSubtotalLabour += weekLabour;
      grandSubtotalTravel += weekTravel;
      grandSubtotalOvertime += weekOvertime;
      grandSubtotalOtGeneral += weekOtGeneral;
      grandSubtotalOtSaturday += weekOtSaturday;
      grandSubtotalOtSunday += weekOtSunday;
      grandSubtotalVehicles += weekVehicles;
      grandNetSubtotal += weekSubtotal;
      grandMarginAmount += weekMargin;
      grandTotalWithMargin += weekTotal;

      return {
        ...week,
        week_number: idx + 1,
        week_label: week.week_label || `Week ${idx + 1}`,
        roles: rolesWithCosts,
        vehicles: vehiclesWithCosts,
        week_subtotal: Number(weekSubtotal.toFixed(2)),
        week_margin_amount: weekMargin,
        week_total_with_margin: weekTotal,
      };
    });

    return {
      weeks: weeksProcessed,
      totals: {
        num_weeks: numWeeks,
        subtotal_labour: Number(grandSubtotalLabour.toFixed(2)),
        subtotal_travel: Number(grandSubtotalTravel.toFixed(2)),
        subtotal_overtime: Number(grandSubtotalOvertime.toFixed(2)),
        subtotal_ot_general: Number(grandSubtotalOtGeneral.toFixed(2)),
        subtotal_ot_saturday: Number(grandSubtotalOtSaturday.toFixed(2)),
        subtotal_ot_sunday: Number(grandSubtotalOtSunday.toFixed(2)),
        subtotal_vehicles: Number(grandSubtotalVehicles.toFixed(2)),
        net_subtotal: Number(grandNetSubtotal.toFixed(2)),
        margin_enabled: marginEnabled,
        margin_percentage: marginPercentage,
        margin_amount: Number(grandMarginAmount.toFixed(2)),
        grand_total_with_margin: Number(grandTotalWithMargin.toFixed(2)),
      },
    };
  }, [weeksConfig, marginEnabled, marginPercentage, numWeeks]);

  // Compute combined portfolio rollup across selected estimates
  const combinedRollup = useMemo(() => {
    const included = savedEstimates.filter(est => rollupSelection[est.id] !== false);
    if (included.length === 0) {
      return {
        weeks: [],
        totals: {
          grand_labour: 0, grand_travel: 0, grand_ot_gen: 0, grand_ot_sat: 0,
          grand_ot_sun: 0, grand_ot_total: 0, grand_vehicles: 0, grand_subtotal: 0,
          grand_margin: 0, grand_total: 0,
        },
      };
    }

    const maxWeeks = Math.max(...included.map(e => e.num_weeks || 1), 1);
    const weeksData = [];

    let grandLabour = 0;
    let grandTravel = 0;
    let grandOtGen = 0;
    let grandOtSat = 0;
    let grandOtSun = 0;
    let grandOtTotal = 0;
    let grandVehicles = 0;
    let grandSubtotal = 0;
    let grandMargin = 0;
    let grandTotal = 0;

    for (let w = 1; w <= maxWeeks; w++) {
      let weekCrewCount = 0;
      let weekLabour = 0;
      let weekTravel = 0;
      let weekOtGen = 0;
      let weekOtSat = 0;
      let weekOtSun = 0;
      let weekVehicles = 0;
      let weekSubtotal = 0;
      let weekMargin = 0;
      let weekTotal = 0;
      const contributingEstimates: string[] = [];

      included.forEach(est => {
        const weekConfig = est.weeks_config?.[w - 1];
        if (weekConfig) {
          contributingEstimates.push(est.production_name || est.title);
          const crewCount = (weekConfig.roles || []).reduce((s, r) => s + (r.quantity || 0), 0);
          weekCrewCount += crewCount;

          (weekConfig.roles || []).forEach(r => {
            const qty = r.quantity || 0;
            const th = r.travel_hours || 0;
            const tr = r.travel_hourly_rate || 25;
            const mult = r.unit_type === 'days' ? (r.days_count || 1) : ((r.weeks_count || 1) * 5);
            const basePay = r.unit_type === 'days' ? (qty * (r.days_count || 1) * (r.daily_rate || 0)) : (qty * (r.weeks_count || 1) * (r.weekly_rate || 0));
            const travelPay = qty * mult * th * tr;
            const otMult = r.unit_type === 'days' ? 1 : (r.weeks_count || 1);
            const genOt = qty * otMult * (r.overtime_hours || 0) * (r.overtime_hourly_rate || 0);
            const satOt = qty * otMult * (r.saturday_ot_hours || 0) * (r.saturday_ot_rate || r.overtime_hourly_rate || 0);
            const sunRate = r.sunday_ot_rate || (r.daily_rate ? (r.daily_rate / 10) * 2 : (r.overtime_hourly_rate || 0) * 1.33);
            const sunOt = qty * otMult * (r.sunday_ot_hours || 0) * sunRate;

            weekLabour += basePay;
            weekTravel += travelPay;
            weekOtGen += genOt;
            weekOtSat += satOt;
            weekOtSun += sunOt;
          });

          (weekConfig.vehicles || []).forEach(v => {
            weekVehicles += (v.line_cost || 0);
          });

          weekSubtotal += (weekConfig.week_subtotal || 0);
          weekMargin += (weekConfig.week_margin_amount || 0);
          weekTotal += (weekConfig.week_total_with_margin || 0);
        }
      });

      const totalWeekOt = weekOtGen + weekOtSat + weekOtSun;
      grandLabour += weekLabour;
      grandTravel += weekTravel;
      grandOtGen += weekOtGen;
      grandOtSat += weekOtSat;
      grandOtSun += weekOtSun;
      grandOtTotal += totalWeekOt;
      grandVehicles += weekVehicles;
      grandSubtotal += weekSubtotal;
      grandMargin += weekMargin;
      grandTotal += weekTotal;

      weeksData.push({
        week_number: w,
        week_label: `Week ${w}`,
        contributingCount: contributingEstimates.length,
        crew_count: weekCrewCount,
        labour_base: weekLabour,
        travel: weekTravel,
        ot_general: weekOtGen,
        ot_saturday: weekOtSat,
        ot_sunday: weekOtSun,
        ot_total: totalWeekOt,
        vehicles: weekVehicles,
        subtotal: weekSubtotal,
        margin: weekMargin,
        total_with_margin: weekTotal,
      });
    }

    return {
      weeks: weeksData,
      totals: {
        grand_labour: grandLabour,
        grand_travel: grandTravel,
        grand_ot_gen: grandOtGen,
        grand_ot_sat: grandOtSat,
        grand_ot_sun: grandOtSun,
        grand_ot_total: grandOtTotal,
        grand_vehicles: grandVehicles,
        grand_subtotal: grandSubtotal,
        grand_margin: grandMargin,
        grand_total: grandTotal,
      },
    };
  }, [savedEstimates, rollupSelection]);

  // Export Combined Portfolio Rollup to CSV
  const exportCombinedCSV = () => {
    const headers = [
      'Week',
      'Contributing Estimates',
      'Total Crew Headcount',
      'Labour Base (£)',
      'Travel Pay (£)',
      'General OT (£)',
      'Saturday OT (£)',
      'Sunday OT (£)',
      'Total OT (£)',
      'Vehicles (£)',
      'Net Subtotal (£)',
      'Margin (£)',
      'Combined Total (£)',
    ];

    const rows = combinedRollup.weeks.map(w => [
      w.week_label,
      String(w.contributingCount),
      String(w.crew_count),
      w.labour_base.toFixed(2),
      w.travel.toFixed(2),
      w.ot_general.toFixed(2),
      w.ot_saturday.toFixed(2),
      w.ot_sunday.toFixed(2),
      w.ot_total.toFixed(2),
      w.vehicles.toFixed(2),
      w.subtotal.toFixed(2),
      w.margin.toFixed(2),
      w.total_with_margin.toFixed(2),
    ]);

    const t = combinedRollup.totals;
    rows.push([
      'COMBINED PORTFOLIO GRAND TOTAL',
      `${savedEstimates.filter(e => rollupSelection[e.id] !== false).length} Estimates`,
      '—',
      t.grand_labour.toFixed(2),
      t.grand_travel.toFixed(2),
      t.grand_ot_gen.toFixed(2),
      t.grand_ot_sat.toFixed(2),
      t.grand_ot_sun.toFixed(2),
      t.grand_ot_total.toFixed(2),
      t.grand_vehicles.toFixed(2),
      t.grand_subtotal.toFixed(2),
      t.grand_margin.toFixed(2),
      t.grand_total.toFixed(2),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'Construct_Scenery_Combined_Portfolio_Rollup.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Update a single role in a given week
  const updateRole = (weekIdx: number, roleId: string, patch: Partial<WeeklyEstimateRoleLine>) => {
    setWeeksConfig(prev => {
      const next = [...prev];
      const targetWeek = { ...next[weekIdx] };
      targetWeek.roles = targetWeek.roles.map(r => {
        if (r.id !== roleId) return r;
        const updated = { ...r, ...patch };

        if (patch.rank && ratesLookup?.rates) {
          const match = ratesLookup.rates.find(item => item.rank === patch.rank && (patch.trade ? item.trade === patch.trade : true));
          if (match) {
            if (match.daily_rate) updated.daily_rate = Number(match.daily_rate);
            if (match.weekly_rate) updated.weekly_rate = Number(match.weekly_rate);
            if (match.overtime_rate) {
              const ot = Number(match.overtime_rate);
              updated.overtime_hourly_rate = ot;
              if (updated.saturday_ot_rate == null) updated.saturday_ot_rate = ot;
            }
          }
        }
        updated.line_cost = calculateRoleCost(updated);
        return updated;
      });
      next[weekIdx] = targetWeek;
      return next;
    });
  };

  // Add role line to a week
  const addRole = (weekIdx: number, presetRank?: string, presetTrade?: string) => {
    let dailyRate = 300;
    let weeklyRate = 1500;
    let otRate = 45;

    if (presetRank && ratesLookup?.rates) {
      const match = ratesLookup.rates.find(r => r.rank === presetRank);
      if (match) {
        dailyRate = Number(match.daily_rate) || dailyRate;
        weeklyRate = Number(match.weekly_rate) || weeklyRate;
        otRate = Number(match.overtime_rate) || otRate;
      }
    }

    const sundayDoubleRate = Math.round((dailyRate / 10) * 2) || Math.round(otRate * 1.33);

    const newRole: WeeklyEstimateRoleLine = {
      id: `role-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      trade: presetTrade || 'Carpenters',
      rank: presetRank || 'Carpenter',
      quantity: 1,
      unit_type: 'weeks',
      days_count: 5,
      weeks_count: 1,
      daily_rate: dailyRate,
      weekly_rate: weeklyRate,
      travel_hours: 1,
      travel_hourly_rate: 25,
      overtime_hours: 0,
      overtime_hourly_rate: otRate,
      saturday_ot_hours: 0,
      saturday_ot_rate: otRate,
      sunday_ot_hours: 0,
      sunday_ot_rate: sundayDoubleRate,
      line_cost: 0,
    };
    newRole.line_cost = calculateRoleCost(newRole);

    setWeeksConfig(prev => {
      const next = [...prev];
      const target = { ...next[weekIdx] };
      target.roles = [...target.roles, newRole];
      next[weekIdx] = target;
      return next;
    });
  };

  // Remove role line from a week
  const removeRole = (weekIdx: number, roleId: string) => {
    setWeeksConfig(prev => {
      const next = [...prev];
      const target = { ...next[weekIdx] };
      target.roles = target.roles.filter(r => r.id !== roleId);
      next[weekIdx] = target;
      return next;
    });
  };

  // Update vehicle line in a week
  const updateVehicle = (weekIdx: number, vehId: string, patch: Partial<WeeklyEstimateVehicleLine>) => {
    setWeeksConfig(prev => {
      const next = [...prev];
      const target = { ...next[weekIdx] };
      target.vehicles = target.vehicles.map(v => {
        if (v.id !== vehId) return v;
        const updated = { ...v, ...patch };
        updated.line_cost = calculateVehicleCost(updated);
        return updated;
      });
      next[weekIdx] = target;
      return next;
    });
  };

  // Add vehicle to a week
  const addVehicle = (weekIdx: number, presetName: string = 'Luton Van (Runaround)', defaultWeeklyRate: number = 450) => {
    const newVeh: WeeklyEstimateVehicleLine = {
      id: `veh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: presetName,
      quantity: 1,
      rate: defaultWeeklyRate,
      unit_type: 'weeks',
      units_count: 1,
      line_cost: defaultWeeklyRate,
    };

    setWeeksConfig(prev => {
      const next = [...prev];
      const target = { ...next[weekIdx] };
      target.vehicles = [...target.vehicles, newVeh];
      next[weekIdx] = target;
      return next;
    });
  };

  // Remove vehicle from a week
  const removeVehicle = (weekIdx: number, vehId: string) => {
    setWeeksConfig(prev => {
      const next = [...prev];
      const target = { ...next[weekIdx] };
      target.vehicles = target.vehicles.filter(v => v.id !== vehId);
      next[weekIdx] = target;
      return next;
    });
  };

  // Copy Week 1 config across all subsequent weeks
  const copyWeek1ToAll = () => {
    if (weeksConfig.length <= 1) return;
    const sourceWeek = weeksConfig[0];
    if (!confirm(`Apply Week 1 (${sourceWeek.roles.length} roles, ${sourceWeek.vehicles.length} vehicles) to all other ${weeksConfig.length - 1} weeks?`)) {
      return;
    }

    setWeeksConfig(prev => {
      return prev.map((w, idx) => {
        if (idx === 0) return w;
        return {
          ...w,
          roles: sourceWeek.roles.map(r => ({ ...r, id: `role-w${idx + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}` })),
          vehicles: sourceWeek.vehicles.map(v => ({ ...v, id: `veh-w${idx + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}` })),
        };
      });
    });

    setSuccessMsg('Week 1 configuration successfully copied across all weeks!');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // Save / Update estimate to backend
  const handleSaveEstimate = async () => {
    if (!estimateTitle.trim()) {
      setErrorMsg('Estimate title is required.');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload: Partial<WeeklyCustomEstimate> = {
        title: estimateTitle.trim(),
        production_id: productionId || null,
        num_weeks: numWeeks,
        start_date: startDate || null,
        margin_enabled: marginEnabled,
        margin_percentage: marginPercentage,
        weeks_config: computedSummary.weeks,
        summary_totals: computedSummary.totals,
        notes: notes.trim() || null,
      };

      if (selectedEstimateId) {
        const res = await weeklyEstimatesApi.update(selectedEstimateId, payload);
        setSuccessMsg(`Estimate "${res.estimate.title}" updated successfully!`);
      } else {
        const res = await weeklyEstimatesApi.create(payload);
        setSelectedEstimateId(res.estimate.id);
        setSuccessMsg(`Estimate "${res.estimate.title}" created and saved!`);
      }
      loadSavedList();
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save estimate');
    } finally {
      setSaving(false);
    }
  };

  // Load a saved estimate from dropdown
  const handleSelectEstimate = async (id: string) => {
    if (!id) {
      setSelectedEstimateId('');
      setEstimateTitle('New Labour & Vehicles Multi-Week Estimate');
      setNumWeeks(3);
      setWeeksConfig(Array.from({ length: 3 }).map((_, idx) => ({
        week_number: idx + 1,
        week_label: `Week ${idx + 1}`,
        roles: createInitialRoles().map(r => ({ ...r, line_cost: calculateRoleCost(r) })),
        vehicles: createInitialVehicles().map(v => ({ ...v, line_cost: calculateVehicleCost(v) })),
        week_subtotal: 0,
        week_margin_amount: 0,
        week_total_with_margin: 0,
      })));
      return;
    }

    setLoadingSaved(true);
    setErrorMsg('');
    try {
      const res = await weeklyEstimatesApi.getById(id);
      const est = res.estimate;
      setSelectedEstimateId(est.id);
      setEstimateTitle(est.title);
      setProductionId(est.production_id || '');
      setNumWeeks(est.num_weeks || 3);
      setStartDate(est.start_date ? est.start_date.split('T')[0] : '');
      setMarginEnabled(est.margin_enabled ?? true);
      setMarginPercentage(Number(est.margin_percentage) || 10);
      setNotes(est.notes || '');

      if (Array.isArray(est.weeks_config) && est.weeks_config.length > 0) {
        setWeeksConfig(est.weeks_config);
      }
      setSuccessMsg(`Loaded estimate: ${est.title}`);
      setTimeout(() => setSuccessMsg(''), 2500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load estimate');
    } finally {
      setLoadingSaved(false);
    }
  };

  // Delete estimate
  const handleDeleteEstimate = async (targetId?: string | React.MouseEvent) => {
    const idToDelete = typeof targetId === 'string' ? targetId : selectedEstimateId;
    if (!idToDelete) return;
    if (!confirm('Are you sure you want to delete this saved estimate? This action cannot be undone.')) return;

    setDeleting(true);
    try {
      await weeklyEstimatesApi.delete(idToDelete);
      if (idToDelete === selectedEstimateId) {
        setSelectedEstimateId('');
        setEstimateTitle('New Labour & Vehicles Multi-Week Estimate');
      }
      loadSavedList();
      setSuccessMsg('Estimate deleted successfully');
      setTimeout(() => setSuccessMsg(''), 2500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete estimate');
    } finally {
      setDeleting(false);
    }
  };

  // Copy textual quote summary to clipboard
  const copyQuoteSummary = () => {
    const t = computedSummary.totals;
    const lines = [
      `CONSTRUCT SCENERY — ESTIMATE SUMMARY`,
      `Title: ${estimateTitle}`,
      `Period: ${t.num_weeks} Weeks`,
      `---------------------------------------`,
      ...computedSummary.weeks.map(w =>
        `${w.week_label}: Net ${fmtGBP(w.week_subtotal)} | ${marginEnabled ? `Margin (${marginPercentage}%): ${fmtGBP(w.week_margin_amount)} | ` : ''}Total: ${fmtGBP(w.week_total_with_margin)}`
      ),
      `---------------------------------------`,
      `Net Subtotal: ${fmtGBP(t.net_subtotal)}`,
      `• Basic Labour: ${fmtGBP(t.subtotal_labour)}`,
      `• Travel: ${fmtGBP(t.subtotal_travel)}`,
      `• Overtime: ${fmtGBP(t.subtotal_overtime)} (General OT: ${fmtGBP(t.subtotal_ot_general)}, Saturday OT: ${fmtGBP(t.subtotal_ot_saturday)}, Sunday OT: ${fmtGBP(t.subtotal_ot_sunday)})`,
      `• Vehicles/Transport: ${fmtGBP(t.subtotal_vehicles)}`,
      marginEnabled ? `Margin (${marginPercentage}%): +${fmtGBP(t.margin_amount)}` : `Margin: OFF (Net cost only)`,
      `GRAND TOTAL: ${fmtGBP(t.grand_total_with_margin)}`,
    ];

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
  };

  // Export estimate to CSV
  const exportEstimateCSV = () => {
    const headers = [
      'Week',
      'Item Type',
      'Role / Description',
      'Quantity',
      'Unit Type (Days/Weeks)',
      'Units Count',
      'Base Rate (£)',
      'Travel Hours / Crew',
      'Travel Hourly Rate (£)',
      'General OT Hours',
      'General OT Rate (£)',
      'Saturday OT Hours',
      'Saturday OT Rate (£)',
      'Sunday OT Hours',
      'Sunday OT Rate (£)',
      'Line Cost (£)',
    ];

    const rows: Array<string[]> = [];

    computedSummary.weeks.forEach(w => {
      // Roles
      w.roles.forEach(r => {
        rows.push([
          w.week_label,
          'Labour',
          `"${r.trade} - ${r.rank}"`,
          String(r.quantity),
          r.unit_type === 'days' ? 'Days (D)' : 'Weeks (W)',
          String(r.unit_type === 'days' ? r.days_count : r.weeks_count),
          String(r.unit_type === 'days' ? r.daily_rate : r.weekly_rate),
          String(r.travel_hours || 0),
          String(r.travel_hourly_rate || 0),
          String(r.overtime_hours || 0),
          String(r.overtime_hourly_rate || 0),
          String(r.saturday_ot_hours || 0),
          String(r.saturday_ot_rate || r.overtime_hourly_rate || 0),
          String(r.sunday_ot_hours || 0),
          String(r.sunday_ot_rate || (r.daily_rate ? (r.daily_rate / 10) * 2 : 60)),
          (r.line_cost || 0).toFixed(2),
        ]);
      });

      // Vehicles
      w.vehicles.forEach(v => {
        rows.push([
          w.week_label,
          'Vehicle/Equipment',
          `"${v.name}"`,
          String(v.quantity),
          v.unit_type === 'days' ? 'Days' : 'Weeks',
          String(v.units_count),
          String(v.rate),
          '—', '—', '—', '—', '—', '—', '—', '—',
          (v.line_cost || 0).toFixed(2),
        ]);
      });

      // Week subtotal row
      rows.push([
        w.week_label,
        'WEEK SUB-TOTAL',
        '', '', '', '', '', '', '', '', '', '', '', '',
        marginEnabled ? `Margin (${marginPercentage}%): ${w.week_margin_amount.toFixed(2)}` : 'Margin: 0.00',
        w.week_total_with_margin.toFixed(2),
      ]);
      rows.push([]);
    });

    // Grand totals
    const t = computedSummary.totals;
    rows.push([
      'ESTIMATE GRAND TOTAL',
      `${t.num_weeks} Weeks`,
      '', '', '', '', '', '', '', '', '', '', '', '',
      `Margin: ${t.margin_amount.toFixed(2)}`,
      t.grand_total_with_margin.toFixed(2),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${estimateTitle.replace(/\s+/g, '_')}_Forecaster.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totals = computedSummary.totals;

  return (
    <div className="space-y-6">
      {/* Top Banner & Saved Estimates Selector */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <Calculator size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Warren’s Multi-Week Custom Estimator
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Customisable Forecaster
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Calculate custom multi-week estimates with Days (D) vs Weeks (W), travel hours per crew, General OT, Saturday OT, Sunday OT, vehicles, and a toggleable margin.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={copyQuoteSummary}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors"
              title="Copy quote summary to clipboard"
            >
              {copiedSummary ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              {copiedSummary ? 'Copied!' : 'Copy Summary'}
            </button>

            <button
              type="button"
              onClick={exportEstimateCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors"
              title="Download CSV breakdown"
            >
              <Download size={14} />
              Export CSV
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Printer size={14} />
              Print
            </button>

            <button
              type="button"
              onClick={handleCloneScenario}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50"
              title="Clone current estimate as a new what-if scenario"
            >
              <Copy size={14} />
              Clone Scenario
            </button>

            {visibleScenarios.length > 1 && (
              <button
                type="button"
                onClick={() => setShowCompareModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors"
                title="Compare multiple scenarios side-by-side"
              >
                <GitCompare size={14} />
                Compare ({visibleScenarios.length})
              </button>
            )}

            {selectedEstimateId && (
              <button
                type="button"
                onClick={() => handleDeleteEstimate()}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 text-xs font-semibold rounded-xl border border-red-200 dark:border-red-800/60 transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}

            <button
              type="button"
              onClick={handleSaveEstimate}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {selectedEstimateId ? 'Save Changes' : 'Save Scenario'}
            </button>
          </div>
        </div>

        {/* Status Messages */}
        {errorMsg && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle size={15} className="flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800/60 text-green-700 dark:text-green-300 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 size={15} className="flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Production Scope & Scenario Switcher Bar */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                <Building2 size={14} className="text-slate-500 dark:text-slate-400" />
                Production Scope:
              </span>
              <select
                value={scopeFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setScopeFilter(val);
                  if (val !== 'all' && val !== 'unlinked') {
                    setProductionId(val);
                  } else if (val === 'unlinked') {
                    setProductionId('');
                  }
                }}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">🌐 All Productions / Combined Portfolio ({savedEstimates.length})</option>
                <option value="unlinked">📦 General Quotes / Unlinked ({savedEstimates.filter(e => !e.production_id).length})</option>
                {productions.map(p => {
                  const count = savedEstimates.filter(e => e.production_id === p.id).length;
                  return (
                    <option key={p.id} value={p.id}>
                      🎬 {p.name} {p.production_code ? `(${p.production_code})` : ''} ({count} scenario{count !== 1 ? 's' : ''})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCreateNewScenario()}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title="Create a new scenario draft"
              >
                <Plus size={12} className="text-slate-500 dark:text-slate-400" />
                New Scenario
              </button>

              <button
                type="button"
                onClick={handleCloneScenario}
                disabled={saving}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title="Duplicate active scenario to test variations"
              >
                <Copy size={12} className="text-slate-500 dark:text-slate-400" />
                Clone as Scenario
              </button>

              {visibleScenarios.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowCompareModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  title="Compare scenarios side-by-side"
                >
                  <GitCompare size={12} />
                  Compare ({visibleScenarios.length})
                </button>
              )}
            </div>
          </div>

          {/* Scenario Tabs Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mr-1 flex-shrink-0">
              Scenarios ({visibleScenarios.length}):
            </span>
            {visibleScenarios.length === 0 ? (
              <span className="text-xs text-slate-400 italic">No saved scenarios in this scope yet — editing draft below.</span>
            ) : (
              visibleScenarios.map(est => {
                const isSelected = selectedEstimateId === est.id;
                return (
                  <button
                    key={est.id}
                    type="button"
                    onClick={() => handleSelectEstimate(est.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80'
                    }`}
                  >
                    <span>{est.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isSelected
                        ? 'bg-blue-700 text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                    }`}>
                      {fmtGBP(est.summary_totals?.grand_total_with_margin)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Estimate Header Configuration Form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Estimate / Scenario Title
            </label>
            <input
              type="text"
              value={estimateTitle}
              onChange={(e) => setEstimateTitle(e.target.value)}
              placeholder="e.g. 3-Week Set Build Quote"
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Production <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <span className="text-[10px] font-semibold text-slate-400">
                {productionId ? 'Single Production' : 'General / Combined'}
              </span>
            </div>
            <select
              value={productionId}
              onChange={(e) => setProductionId(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="">No linked production (General Quote / Combined)</option>
              {productions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.production_code ? `(${p.production_code})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Number of Weeks
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={12}
                value={numWeeks}
                onChange={(e) => handleNumWeeksChange(parseInt(e.target.value, 10) || 1)}
                className="w-24 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Weeks</span>
              {numWeeks > 1 && (
                <button
                  type="button"
                  onClick={copyWeek1ToAll}
                  className="ml-auto text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                  title="Copy Week 1 labour & vehicles configuration to all weeks"
                >
                  <Copy size={12} />
                  Copy W1 to All
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Quick Load Scenario ({savedEstimates.length})
            </label>
            <select
              value={selectedEstimateId}
              onChange={(e) => handleSelectEstimate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="">＋ Draft / New Scenario</option>
              {savedEstimates.map(est => (
                <option key={est.id} value={est.id}>
                  {est.title} {est.production_name ? `[${est.production_name}]` : '[General]'} ({est.num_weeks}w · {fmtGBP(est.summary_totals?.grand_total_with_margin)})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Margin Configuration & Overview Banner */}
      {/* Margin Configuration & Overview Banner */}
      <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg">
            %
          </div>
          <div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Margin Toggle & Percentage
              </span>
              <button
                type="button"
                onClick={() => setMarginEnabled(!marginEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  marginEnabled ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                    marginEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                marginEnabled
                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}>
                {marginEnabled ? 'MARGIN ACTIVE' : 'MARGIN OFF'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {marginEnabled
                ? `Applying ${marginPercentage}% markup to net costs across all ${numWeeks} weeks.`
                : 'Showing pure net labour and equipment cost without any margin markup.'}
            </p>
          </div>
        </div>

        {/* Margin percentage control & Grand Total */}
        <div className="flex items-center gap-6 self-end md:self-auto">
          {marginEnabled && (
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-semibold">Margin %:</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={marginPercentage}
                onChange={(e) => setMarginPercentage(parseFloat(e.target.value) || 0)}
                className="w-16 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-400 font-bold">%</span>
            </div>
          )}

          <div className="text-right">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Grand Total ({numWeeks} Weeks)
            </span>
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {fmtGBP(totals.grand_total_with_margin)}
            </span>
          </div>
        </div>
      </div>

      {/* Week Selector Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveWeekTab('summary')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap ${
            activeWeekTab === 'summary'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <Layers size={14} />
          Multi-Week Summary
        </button>

        {computedSummary.weeks.map((w, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setActiveWeekTab(idx)}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap ${
              activeWeekTab === idx
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <span>{w.week_label}</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeWeekTab === idx ? 'bg-blue-700 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
            }`}>
              {fmtGBP(w.week_total_with_margin)}
            </span>
          </button>
        ))}
      </div>

      {/* ── VIEW 1: MULTI-WEEK SUMMARY TABLE & PRODUCTION SEGREGATION ── */}
      {activeWeekTab === 'summary' && (
        <div className="space-y-6">
          {/* Sub-View Navigation Bar */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 flex-wrap gap-3">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <button
                type="button"
                onClick={() => setSummarySubView('active_scenario')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  summarySubView === 'active_scenario'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText size={13} />
                Current Scenario Breakdown
              </button>

              <button
                type="button"
                onClick={() => setSummarySubView('segregated_productions')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  summarySubView === 'segregated_productions'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Building2 size={13} />
                Segregated by Production ({productionGroups.length})
              </button>

              <button
                type="button"
                onClick={() => setSummarySubView('combined_rollup')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  summarySubView === 'combined_rollup'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers size={13} />
                Combined Portfolio Rollup
              </button>
            </div>

            {summarySubView === 'combined_rollup' && (
              <button
                type="button"
                onClick={exportCombinedCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs transition-colors"
              >
                <Download size={13} />
                Export Combined Rollup CSV
              </button>
            )}
          </div>

          {/* SUB-VIEW 1: Active Scenario Breakdown */}
          {summarySubView === 'active_scenario' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Basic Labour Cost
              </span>
              <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                {fmtGBP(totals.subtotal_labour)}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                Standard day & week wages
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Overtime Subtotal
              </span>
              <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                {fmtGBP(totals.subtotal_overtime)}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                Gen: {fmtGBP(totals.subtotal_ot_general)} · Sat: {fmtGBP(totals.subtotal_ot_saturday)} · Sun: {fmtGBP(totals.subtotal_ot_sunday)}
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Travel & Vehicles Subtotal
              </span>
              <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                {fmtGBP(totals.subtotal_travel + totals.subtotal_vehicles)}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                Travel: {fmtGBP(totals.subtotal_travel)} · Transport: {fmtGBP(totals.subtotal_vehicles)}
              </span>
            </div>

            <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-4 shadow-sm">
              <span className="text-[11px] font-bold uppercase tracking-wider block opacity-90">
                Combined Estimate Total
              </span>
              <span className="text-2xl font-black mt-1 block">
                {fmtGBP(totals.grand_total_with_margin)}
              </span>
              <span className="text-[11px] font-semibold mt-1 block opacity-85">
                {marginEnabled ? `Includes ${marginPercentage}% margin (${fmtGBP(totals.margin_amount)})` : 'Net cost (No margin)'}
              </span>
            </div>
          </div>

          {/* Week-by-Week Comparison Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <FileText size={15} className="text-slate-500" />
                Multi-Week Cost Comparison & Breakdown
              </h3>
              <span className="text-xs text-slate-500 font-medium">
                {computedSummary.weeks.length} Weeks Configured
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Period</th>
                    <th className="py-3 px-3 text-center">Crew Count</th>
                    <th className="py-3 px-4 text-right">Labour Base</th>
                    <th className="py-3 px-4 text-right">Travel</th>
                    <th className="py-3 px-4 text-right">General OT</th>
                    <th className="py-3 px-4 text-right">Saturday OT</th>
                    <th className="py-3 px-4 text-right">Sunday OT</th>
                    <th className="py-3 px-4 text-right">Vehicles</th>
                    <th className="py-3 px-4 text-right">Net Subtotal</th>
                    <th className="py-3 px-4 text-right">Margin ({marginEnabled ? `${marginPercentage}%` : 'Off'})</th>
                    <th className="py-3 px-4 text-right font-bold text-slate-900">Total for Week</th>
                    <th className="py-3 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {computedSummary.weeks.map((w, idx) => {
                    const totalCrewQty = w.roles.reduce((s, r) => s + (r.quantity || 0), 0);
                    const weekTravel = w.roles.reduce((s, r) => {
                      const qty = r.quantity || 0;
                      const th = r.travel_hours || 0;
                      const tr = r.travel_hourly_rate || 0;
                      const mult = r.unit_type === 'days' ? (r.days_count || 1) : ((r.weeks_count || 1) * 5);
                      return s + (qty * mult * th * tr);
                    }, 0);

                    const weekGenOt = w.roles.reduce((s, r) => {
                      const qty = r.quantity || 0;
                      const mult = r.unit_type === 'days' ? 1 : (r.weeks_count || 1);
                      return s + (qty * mult * (r.overtime_hours || 0) * (r.overtime_hourly_rate || 0));
                    }, 0);

                    const weekSatOt = w.roles.reduce((s, r) => {
                      const qty = r.quantity || 0;
                      const mult = r.unit_type === 'days' ? 1 : (r.weeks_count || 1);
                      return s + (qty * mult * (r.saturday_ot_hours || 0) * (r.saturday_ot_rate || r.overtime_hourly_rate || 0));
                    }, 0);

                    const weekSunOt = w.roles.reduce((s, r) => {
                      const qty = r.quantity || 0;
                      const mult = r.unit_type === 'days' ? 1 : (r.weeks_count || 1);
                      const sunRate = r.sunday_ot_rate || (r.daily_rate ? (r.daily_rate / 10) * 2 : (r.overtime_hourly_rate || 0) * 1.33);
                      return s + (qty * mult * (r.sunday_ot_hours || 0) * sunRate);
                    }, 0);

                    const weekVeh = w.vehicles.reduce((s, v) => s + (v.line_cost || 0), 0);
                    const weekLabourBase = w.week_subtotal - weekTravel - (weekGenOt + weekSatOt + weekSunOt) - weekVeh;

                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {w.week_label}
                        </td>
                        <td className="py-3 px-3 text-center font-semibold text-slate-700">
                          {totalCrewQty}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {fmtGBP(weekLabourBase)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {fmtGBP(weekTravel)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {fmtGBP(weekGenOt)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {fmtGBP(weekSatOt)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {fmtGBP(weekSunOt)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {fmtGBP(weekVeh)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900 font-mono">
                          {fmtGBP(w.week_subtotal)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-700 dark:text-slate-300">
                          {marginEnabled ? `+${fmtGBP(w.week_margin_amount)}` : '£0.00'}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white font-mono text-sm">
                          {fmtGBP(w.week_total_with_margin)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setActiveWeekTab(idx)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg border border-blue-200/60 dark:border-blue-800/60 transition-colors"
                          >
                            Edit Week
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100/90 dark:bg-slate-800/90 font-bold border-t-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white">
                  <tr>
                    <td className="py-3.5 px-4 uppercase text-xs tracking-wider" colSpan={2}>
                      Grand Totals ({numWeeks} Weeks)
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(totals.subtotal_labour)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(totals.subtotal_travel)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(totals.subtotal_ot_general)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(totals.subtotal_ot_saturday)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(totals.subtotal_ot_sunday)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(totals.subtotal_vehicles)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-950 dark:text-white font-bold">
                      {fmtGBP(totals.net_subtotal)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-900 dark:text-white font-bold">
                      {marginEnabled ? `+${fmtGBP(totals.margin_amount)}` : '£0.00'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-900 dark:text-white text-base font-black bg-slate-200/80 dark:bg-slate-800">
                      {fmtGBP(totals.grand_total_with_margin)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

          {/* SUB-VIEW 2: Segregated by Production */}
          {summarySubView === 'segregated_productions' && (
            <div className="space-y-6">
              {/* Segregated summary banner */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Building2 className="text-blue-600 dark:text-blue-400" size={18} />
                      Production Estimations Breakdown
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Individual estimations segregated by production. Each production can contain multiple estimate scenarios (e.g. Standard vs High-OT vs Extended).
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleCreateNewScenario()}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors shadow-xs"
                    >
                      <Plus size={14} />
                      New Production Estimation
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Production Scopes</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{productionGroups.length}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Total Scenarios</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{savedEstimates.length}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Linked to Active Builds</span>
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {productionGroups.filter(g => g.productionId !== null).length}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Combined Portfolio Value</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">
                      {fmtGBP(savedEstimates.reduce((sum, e) => sum + (e.summary_totals?.grand_total_with_margin || 0), 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* List of productions with their scenarios */}
              <div className="space-y-4">
                {productionGroups.map((group) => {
                  const isUnlinked = !group.productionId;
                  return (
                    <div
                      key={group.productionId || 'unlinked'}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
                    >
                      {/* Production header card */}
                      <div className="px-5 py-4 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {group.productionCode || (isUnlinked ? 'GEN' : 'PROD')}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                                {group.productionName}
                              </h4>
                              {group.productionStatus && (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  group.productionStatus.toLowerCase().includes('active') || group.productionStatus.toLowerCase().includes('build')
                                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                }`}>
                                  {group.productionStatus}
                                </span>
                              )}
                              {isUnlinked && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                  Optional / Non-Production
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {group.estimates.length} scenario{group.estimates.length === 1 ? '' : 's'} recorded
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCreateNewScenario(group.productionId || '')}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xs hover:border-slate-300 transition-colors"
                          >
                            <Plus size={13} />
                            Add Scenario
                          </button>
                        </div>
                      </div>

                      {/* Scenarios Table for this production */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-slate-100/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                            <tr>
                              <th className="py-2.5 px-4">Scenario Title</th>
                              <th className="py-2.5 px-3 text-center">Weeks</th>
                              <th className="py-2.5 px-3 text-right">Labour Base</th>
                              <th className="py-2.5 px-3 text-right">Travel Pay</th>
                              <th className="py-2.5 px-3 text-right">General OT</th>
                              <th className="py-2.5 px-3 text-right">Sat OT</th>
                              <th className="py-2.5 px-3 text-right">Sun OT (2x)</th>
                              <th className="py-2.5 px-3 text-right">Vehicles</th>
                              <th className="py-2.5 px-3 text-right">Margin</th>
                              <th className="py-2.5 px-4 text-right font-black text-slate-900 dark:text-white">Estimate Total</th>
                              <th className="py-2.5 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {group.estimates.map(est => {
                              const isSelected = est.id === selectedEstimateId;
                              const t = est.summary_totals;
                              return (
                                <tr
                                  key={est.id}
                                  className={`transition-colors ${
                                    isSelected
                                      ? 'bg-blue-50/40 dark:bg-blue-950/20 font-medium'
                                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                                  }`}
                                >
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      {isSelected && (
                                        <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" title="Currently Editing" />
                                      )}
                                      <span className="font-semibold text-slate-900 dark:text-white">
                                        {est.title}
                                      </span>
                                    </div>
                                    {est.notes && (
                                      <p className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">{est.notes}</p>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-center font-mono text-slate-600 dark:text-slate-400">
                                    {est.num_weeks || est.weeks_config?.length || 1} wks
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {fmtGBP(t?.subtotal_labour || 0)}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {fmtGBP(t?.subtotal_travel || 0)}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {fmtGBP(t?.subtotal_ot_general || 0)}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {fmtGBP(t?.subtotal_ot_saturday || 0)}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {fmtGBP(t?.subtotal_ot_sunday || 0)}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {fmtGBP(t?.subtotal_vehicles || 0)}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                    {t?.margin_enabled ? `+${fmtGBP(t.margin_amount)}` : '£0.00'}
                                  </td>
                                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white text-sm">
                                    {fmtGBP(t?.grand_total_with_margin || 0)}
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleSelectEstimate(est.id);
                                          setSummarySubView('active_scenario');
                                        }}
                                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 rounded-md transition-colors"
                                      >
                                        Edit Scenario
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteEstimate(est.id)}
                                        className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                        title="Delete Scenario"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}

                {productionGroups.length === 0 && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-slate-500 dark:text-slate-400">
                    <p className="text-sm font-semibold">No production estimations created yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Start by clicking "New Production Estimation" above.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUB-VIEW 3: Combined Portfolio Rollup */}
          {summarySubView === 'combined_rollup' && (
            <div className="space-y-6">
              {/* Header card with rollup toggle controls */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Layers className="text-blue-600 dark:text-blue-400" size={18} />
                      Combined Portfolio Weekly Estimation Rollup
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Aggregates multiple weekly estimations across productions into a unified company-wide cashflow, crew headcount, and labour profile.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const allOn: Record<string, boolean> = {};
                        savedEstimates.forEach(e => { allOn[e.id] = true; });
                        setRollupSelection(allOn);
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors"
                    >
                      Select All ({savedEstimates.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRollupSelection({})}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors"
                    >
                      Deselect All
                    </button>
                    <button
                      type="button"
                      onClick={exportCombinedCSV}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs transition-colors"
                    >
                      <Download size={13} />
                      Export Rollup CSV
                    </button>
                  </div>
                </div>

                {/* Estimate selection pills */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-2">
                    Include in Combined Rollup:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {savedEstimates.map(est => {
                      const isIncluded = rollupSelection[est.id] !== false;
                      return (
                        <button
                          key={est.id}
                          type="button"
                          onClick={() => setRollupSelection(prev => ({
                            ...prev,
                            [est.id]: !isIncluded,
                          }))}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            isIncluded
                              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200 font-semibold'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${isIncluded ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
                          <span className="truncate max-w-[200px]">
                            {est.production_name ? `${est.production_name}: ` : ''}{est.title}
                          </span>
                          <span className="text-[10px] opacity-75 font-mono">
                            ({fmtGBP(est.summary_totals?.grand_total_with_margin || 0)})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Combined Top KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Combined Labour Base
                  </span>
                  <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                    {fmtGBP(combinedRollup.totals.grand_labour)}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Across {savedEstimates.filter(e => rollupSelection[e.id] !== false).length} estimations
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Combined Overtime Total
                  </span>
                  <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                    {fmtGBP(combinedRollup.totals.grand_ot_total)}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Gen: {fmtGBP(combinedRollup.totals.grand_ot_gen)} · Sat: {fmtGBP(combinedRollup.totals.grand_ot_sat)} · Sun: {fmtGBP(combinedRollup.totals.grand_ot_sun)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Combined Travel & Transport
                  </span>
                  <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                    {fmtGBP(combinedRollup.totals.grand_travel + combinedRollup.totals.grand_vehicles)}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Travel: {fmtGBP(combinedRollup.totals.grand_travel)} · Veh: {fmtGBP(combinedRollup.totals.grand_vehicles)}
                  </span>
                </div>

                <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-4 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider block opacity-90">
                    Combined Portfolio Grand Total
                  </span>
                  <span className="text-2xl font-black mt-1 block">
                    {fmtGBP(combinedRollup.totals.grand_total)}
                  </span>
                  <span className="text-[11px] font-semibold mt-1 block opacity-85">
                    Net: {fmtGBP(combinedRollup.totals.grand_subtotal)} + Margin: {fmtGBP(combinedRollup.totals.grand_margin)}
                  </span>
                </div>
              </div>

              {/* Combined Master Weekly Aggregation Table */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Combined Weekly Aggregation Table
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Rollup of all selected production estimates organized by timeline week
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-bold">
                      <tr>
                        <th className="py-3 px-4">Timeline Week</th>
                        <th className="py-3 px-3 text-center">Contributing Quotes</th>
                        <th className="py-3 px-3 text-center">Crew Count</th>
                        <th className="py-3 px-4 text-right">Labour Base</th>
                        <th className="py-3 px-4 text-right">Travel Pay</th>
                        <th className="py-3 px-4 text-right">General OT</th>
                        <th className="py-3 px-4 text-right">Sat OT</th>
                        <th className="py-3 px-4 text-right">Sun OT (2x)</th>
                        <th className="py-3 px-4 text-right">Vehicles</th>
                        <th className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white">Net Subtotal</th>
                        <th className="py-3 px-4 text-right text-slate-700 dark:text-slate-300 font-semibold">Margin</th>
                        <th className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white">Combined Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {combinedRollup.weeks.map(w => (
                        <tr key={w.week_number} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            {w.week_label}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {w.contributingCount} {w.contributingCount === 1 ? 'production' : 'productions'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {w.crew_count}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmtGBP(w.labour_base)}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmtGBP(w.travel)}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmtGBP(w.ot_general)}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmtGBP(w.ot_saturday)}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmtGBP(w.ot_sunday)}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300">{fmtGBP(w.vehicles)}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">{fmtGBP(w.subtotal)}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-300 font-semibold">
                            {w.margin > 0 ? `+${fmtGBP(w.margin)}` : '£0.00'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {fmtGBP(w.total_with_margin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-100 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white">
                      <tr>
                        <td className="py-3.5 px-4 text-slate-900 dark:text-white uppercase font-black tracking-wider" colSpan={3}>
                          Combined Portfolio Grand Totals
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(combinedRollup.totals.grand_labour)}</td>
                        <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(combinedRollup.totals.grand_travel)}</td>
                        <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(combinedRollup.totals.grand_ot_gen)}</td>
                        <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(combinedRollup.totals.grand_ot_sat)}</td>
                        <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(combinedRollup.totals.grand_ot_sun)}</td>
                        <td className="py-3.5 px-4 text-right font-mono">{fmtGBP(combinedRollup.totals.grand_vehicles)}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-950 dark:text-white font-bold">
                          {fmtGBP(combinedRollup.totals.grand_subtotal)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-900 dark:text-white font-bold">
                          +{fmtGBP(combinedRollup.totals.grand_margin)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-900 dark:text-white text-base font-black bg-slate-200/80 dark:bg-slate-800">
                          {fmtGBP(combinedRollup.totals.grand_total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── VIEW 2: INDIVIDUAL WEEK DETAIL EDITOR ── */}
      {typeof activeWeekTab === 'number' && computedSummary.weeks[activeWeekTab] && (
        (() => {
          const wIdx = activeWeekTab;
          const week = computedSummary.weeks[wIdx];

          return (
            <div className="space-y-6">
              {/* Week sub-header */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center justify-center font-bold text-sm">
                    W{week.week_number}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Configuring {week.week_label}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Configure roles, D vs W units, travel hours, General OT, Saturday OT, Sunday OT, and vehicles.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 font-semibold block uppercase">Week Total</span>
                    <span className="text-base font-bold text-slate-900 dark:text-white font-mono">
                      {fmtGBP(week.week_total_with_margin)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveWeekTab('summary')}
                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
                  >
                    Back to Summary
                  </button>
                </div>
              </div>

              {/* SECTION: LABOUR & CREW LINES */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-5 py-4 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-slate-600 dark:text-slate-400" />
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      Crew & Labour Lines ({week.roles.length})
                    </h4>
                  </div>

                  {/* Quick-add presets */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Quick Add:</span>
                    <button
                      type="button"
                      onClick={() => addRole(wIdx, 'Carpenter', 'Carpenters')}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + Carpenter
                    </button>
                    <button
                      type="button"
                      onClick={() => addRole(wIdx, 'Stagehand', 'Stagehands')}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + Stagehand
                    </button>
                    <button
                      type="button"
                      onClick={() => addRole(wIdx, 'Construction Accountant', 'Non-BECTU')}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + Accountant
                    </button>
                    <button
                      type="button"
                      onClick={() => addRole(wIdx, 'Construction Coordinator', 'Non-BECTU')}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + Coordinator
                    </button>
                    <button
                      type="button"
                      onClick={() => addRole(wIdx)}
                      className="px-3 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                    >
                      <Plus size={12} />
                      Custom Role
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Qty</th>
                        <th className="py-2.5 px-4">Role / Rank</th>
                        <th className="py-2.5 px-4 text-center">Unit Type (D vs W)</th>
                        <th className="py-2.5 px-3 text-center">Days / Wks</th>
                        <th className="py-2.5 px-3 text-right">Base Rate (£)</th>
                        <th className="py-2.5 px-3 text-center">Travel (Hrs/Crew)</th>
                        <th className="py-2.5 px-3 text-center">General OT (Hrs)</th>
                        <th className="py-2.5 px-3 text-center">Saturday OT (Hrs)</th>
                        <th className="py-2.5 px-3 text-center">Sunday OT (Hrs)</th>
                        <th className="py-2.5 px-4 text-right">Line Total</th>
                        <th className="py-2.5 px-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {week.roles.map((role) => (
                        <tr key={role.id} className="hover:bg-slate-50/70 transition-colors">
                          {/* Quantity */}
                          <td className="py-2.5 px-3 w-16">
                            <input
                              type="number"
                              min={1}
                              value={role.quantity}
                              onChange={(e) => updateRole(wIdx, role.id, { quantity: parseInt(e.target.value, 10) || 1 })}
                              className="w-14 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>

                          {/* Role / Rank input */}
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={role.rank}
                                onChange={(e) => updateRole(wIdx, role.id, { rank: e.target.value })}
                                placeholder="e.g. Carpenter, Accountant"
                                className="w-40 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </td>

                          {/* D vs W Unit Type Toggle */}
                          <td className="py-2.5 px-4 text-center">
                            <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-100">
                              <button
                                type="button"
                                onClick={() => updateRole(wIdx, role.id, { unit_type: 'days' })}
                                className={`px-2 py-0.5 text-xs font-bold rounded-md transition-colors ${
                                  role.unit_type === 'days'
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                                title="Days (e.g. 3D Accountant, 2D Coordinator)"
                              >
                                D (Days)
                              </button>
                              <button
                                type="button"
                                onClick={() => updateRole(wIdx, role.id, { unit_type: 'weeks' })}
                                className={`px-2 py-0.5 text-xs font-bold rounded-md transition-colors ${
                                  role.unit_type === 'weeks'
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                                title="Weeks (e.g. 4 carp W, 2 stag W)"
                              >
                                W (Weeks)
                              </button>
                            </div>
                          </td>

                          {/* Days or Weeks count */}
                          <td className="py-2.5 px-3 text-center w-24">
                            {role.unit_type === 'days' ? (
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  max={7}
                                  value={role.days_count ?? 1}
                                  onChange={(e) => updateRole(wIdx, role.id, { days_count: parseInt(e.target.value, 10) || 1 })}
                                  className="w-12 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-[11px] font-bold text-slate-500">D</span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  max={4}
                                  value={role.weeks_count ?? 1}
                                  onChange={(e) => updateRole(wIdx, role.id, { weeks_count: parseInt(e.target.value, 10) || 1 })}
                                  className="w-12 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-[11px] font-bold text-slate-500">W</span>
                              </div>
                            )}
                          </td>

                          {/* Base Rate (£) */}
                          <td className="py-2.5 px-3 text-right w-28">
                            <div className="relative">
                              <span className="absolute left-2 top-1 text-[11px] text-slate-400">£</span>
                              <input
                                type="number"
                                min={0}
                                step={10}
                                value={role.unit_type === 'days' ? role.daily_rate : role.weekly_rate}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  if (role.unit_type === 'days') {
                                    updateRole(wIdx, role.id, { daily_rate: val });
                                  } else {
                                    updateRole(wIdx, role.id, { weekly_rate: val });
                                  }
                                }}
                                className="w-24 bg-white border border-slate-300 rounded-lg pl-5 pr-2 py-1 text-xs text-slate-900 font-mono font-semibold text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </td>

                          {/* Travel Hours per Crew */}
                          <td className="py-2.5 px-3 text-center w-28">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={12}
                                step={0.5}
                                value={role.travel_hours || 0}
                                onChange={(e) => updateRole(wIdx, role.id, { travel_hours: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="w-12 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-[10px] text-slate-400">h @ £{role.travel_hourly_rate || 25}</span>
                            </div>
                          </td>

                          {/* 1. General OT */}
                          <td className="py-2.5 px-3 text-center w-28">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={24}
                                step={1}
                                value={role.overtime_hours || 0}
                                onChange={(e) => updateRole(wIdx, role.id, { overtime_hours: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="w-12 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-[10px] text-slate-400">h @ £{role.overtime_hourly_rate || 45}</span>
                            </div>
                          </td>

                          {/* 2. Saturday OT */}
                          <td className="py-2.5 px-3 text-center w-28">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={16}
                                step={1}
                                value={role.saturday_ot_hours || 0}
                                onChange={(e) => updateRole(wIdx, role.id, { saturday_ot_hours: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="w-12 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-[10px] text-slate-400">h @ £{role.saturday_ot_rate || role.overtime_hourly_rate || 45}</span>
                            </div>
                          </td>

                          {/* 3. Sunday OT */}
                          <td className="py-2.5 px-3 text-center w-28">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={16}
                                step={1}
                                value={role.sunday_ot_hours || 0}
                                onChange={(e) => updateRole(wIdx, role.id, { sunday_ot_hours: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="w-12 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-[10px] text-slate-400">
                                h @ £{role.sunday_ot_rate || (role.daily_rate ? Math.round((role.daily_rate / 10) * 2) : 60)}
                              </span>
                            </div>
                          </td>

                          {/* Line Total */}
                          <td className="py-2.5 px-4 text-right font-black text-slate-900 font-mono text-xs whitespace-nowrap">
                            {fmtGBP(role.line_cost)}
                          </td>

                          {/* Remove button */}
                          <td className="py-2.5 px-2 text-center w-8">
                            <button
                              type="button"
                              onClick={() => removeRole(wIdx, role.id)}
                              className="text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECTION: VEHICLES & EQUIPMENT LINES */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Car size={16} className="text-slate-600" />
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Vehicles & Equipment Lines ({week.vehicles.length})
                    </h4>
                  </div>

                  {/* Quick-add presets */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Presets:</span>
                    <button
                      type="button"
                      onClick={() => addVehicle(wIdx, 'Luton Van (Runaround)', 450)}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + Luton Van (£450/wk)
                    </button>
                    <button
                      type="button"
                      onClick={() => addVehicle(wIdx, '7.5 Tonne Lorry', 750)}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + 7.5T Lorry (£750/wk)
                    </button>
                    <button
                      type="button"
                      onClick={() => addVehicle(wIdx, 'Box Rental (Tools & Equip)', 350)}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      + Box Rental (£350/wk)
                    </button>
                    <button
                      type="button"
                      onClick={() => addVehicle(wIdx, 'Custom Item', 100)}
                      className="px-3 py-1 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                    >
                      <Plus size={12} />
                      Custom Vehicle
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Qty</th>
                        <th className="py-2.5 px-4">Item Name / Vehicle</th>
                        <th className="py-2.5 px-3 text-center">Unit</th>
                        <th className="py-2.5 px-3 text-center">Units Count</th>
                        <th className="py-2.5 px-3 text-right">Rate (£)</th>
                        <th className="py-2.5 px-4 text-right">Line Total</th>
                        <th className="py-2.5 px-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {week.vehicles.map((veh) => (
                        <tr key={veh.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3 w-16">
                            <input
                              type="number"
                              min={1}
                              value={veh.quantity}
                              onChange={(e) => updateVehicle(wIdx, veh.id, { quantity: parseInt(e.target.value, 10) || 1 })}
                              className="w-14 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <input
                              type="text"
                              value={veh.name}
                              onChange={(e) => updateVehicle(wIdx, veh.id, { name: e.target.value })}
                              className="w-64 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <select
                              value={veh.unit_type}
                              onChange={(e) => updateVehicle(wIdx, veh.id, { unit_type: e.target.value as 'days' | 'weeks' })}
                              className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="weeks">Weeks</option>
                              <option value="days">Days</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-center w-24">
                            <input
                              type="number"
                              min={1}
                              value={veh.units_count}
                              onChange={(e) => updateVehicle(wIdx, veh.id, { units_count: parseInt(e.target.value, 10) || 1 })}
                              className="w-16 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right w-28">
                            <div className="relative">
                              <span className="absolute left-2 top-1 text-[11px] text-slate-400">£</span>
                              <input
                                type="number"
                                min={0}
                                step={25}
                                value={veh.rate}
                                onChange={(e) => updateVehicle(wIdx, veh.id, { rate: parseFloat(e.target.value) || 0 })}
                                className="w-24 bg-white border border-slate-300 rounded-lg pl-5 pr-2 py-1 text-xs text-slate-900 font-mono font-semibold text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-black text-slate-900 font-mono text-xs whitespace-nowrap">
                            {fmtGBP(veh.line_cost)}
                          </td>
                          <td className="py-2.5 px-2 text-center w-8">
                            <button
                              type="button"
                              onClick={() => removeVehicle(wIdx, veh.id)}
                              className="text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()
      )}

      {/* ── SCENARIO COMPARISON MODAL ── */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <GitCompare className="text-blue-600 dark:text-blue-400" size={18} />
                  Scenario Comparison Matrix
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Side-by-side financial comparison of estimate scenarios within current scope
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompareModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {visibleScenarios.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  No scenarios saved in this scope to compare yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleScenarios.map(sc => {
                    const t = sc.summary_totals;
                    const isCurrent = sc.id === selectedEstimateId;
                    return (
                      <div
                        key={sc.id}
                        className={`rounded-2xl border p-4 flex flex-col justify-between transition-all ${
                          isCurrent
                            ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-400 dark:border-blue-600 ring-2 ring-blue-500/20'
                            : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-750'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                              {sc.title}
                            </span>
                            {isCurrent && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white shrink-0">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          {sc.production_name && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-3 font-medium">
                              {sc.production_name}
                            </span>
                          )}

                          <div className="space-y-2 py-3 border-y border-slate-100 dark:border-slate-800 text-xs">
                            <div className="flex justify-between text-slate-600 dark:text-slate-400">
                              <span>Duration:</span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{sc.num_weeks} Weeks</span>
                            </div>
                            <div className="flex justify-between text-slate-600 dark:text-slate-400">
                              <span>Labour Base:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">{fmtGBP(t?.subtotal_labour)}</span>
                            </div>
                            <div className="flex justify-between text-slate-600 dark:text-slate-400">
                              <span>Travel Pay:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">{fmtGBP(t?.subtotal_travel)}</span>
                            </div>
                            <div className="flex justify-between text-slate-600 dark:text-slate-400">
                              <span>General OT:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">{fmtGBP(t?.subtotal_ot_general)}</span>
                            </div>
                            <div className="flex justify-between text-slate-600 dark:text-slate-400">
                              <span>Sat / Sun OT:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">
                                {fmtGBP((t?.subtotal_ot_saturday || 0) + (t?.subtotal_ot_sunday || 0))}
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-600 dark:text-slate-400">
                              <span>Transport & Vehicles:</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">{fmtGBP(t?.subtotal_vehicles)}</span>
                            </div>
                            <div className="flex justify-between text-slate-700 dark:text-slate-300 font-medium">
                              <span>Margin ({t?.margin_enabled ? `${t?.margin_percentage}%` : 'OFF'}):</span>
                              <span className="font-mono">{t?.margin_enabled ? `+${fmtGBP(t.margin_amount)}` : '£0.00'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-2">
                          <div className="flex justify-between items-baseline mb-3">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Estimate Total:
                            </span>
                            <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                              {fmtGBP(t?.grand_total_with_margin)}
                            </span>
                          </div>

                          {!isCurrent ? (
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectEstimate(sc.id);
                                setShowCompareModal(false);
                              }}
                              className="w-full py-2 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-900 rounded-xl transition-colors shadow-xs"
                            >
                              Switch to this Scenario
                            </button>
                          ) : (
                            <div className="w-full py-2 text-xs font-bold text-center text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl">
                              Currently Loaded in Editor
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500">
              <span>Showing {visibleScenarios.length} scenarios in scope</span>
              <button
                type="button"
                onClick={() => setShowCompareModal(false)}
                className="px-4 py-2 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
