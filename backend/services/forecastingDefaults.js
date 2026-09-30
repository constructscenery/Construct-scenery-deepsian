/**
 * CS HQ Forecasting Defaults and Structure (Addendum 4)
 * Defines standard department sections, grades, above-the-line categories,
 * and automatic rate resolution against bectu_rates.
 */

const STANDARD_SECTIONS = [
  {
    key: 'fixed_weekly',
    label: 'FIXED WEEKLY COSTS',
    roles: [
      { trade: 'Non-BECTU', rank: 'Construction Manager', cost_code: '500', isHOD: false },
      { trade: 'Non-BECTU', rank: 'Construction Accountant', cost_code: '504', isHOD: false },
      { trade: 'Non-BECTU', rank: 'Construction Coordinator', cost_code: '506', isHOD: false },
      { trade: 'Carpenters', rank: 'HOD', cost_code: '508', label: 'HOD — Carpenter', isHOD: true },
      { trade: 'Scenic Painters', rank: 'HOD', cost_code: '510', label: 'HOD — Painter', isHOD: true },
      { trade: 'Stagehands', rank: 'HOD', cost_code: '514', label: 'HOD — Stagehand', isHOD: true },
      { trade: 'Riggers', rank: 'HOD', cost_code: '516', label: 'HOD — Rigger', isHOD: true },
      // Labour Flow specific fixed weekly items:
      { trade: 'Non-BECTU', rank: 'Construction Box Rental', cost_code: '501', isFixedCost: true, defaultRate: 350.00 },
      { trade: 'Non-BECTU', rank: 'Construction Runaround (Luton)', cost_code: '502', isFixedCost: true, defaultRate: 450.00 },
    ],
  },
  {
    key: 'carpenters',
    label: 'DEPARTMENT — CARPENTERS',
    trade: 'Carpenters',
    cost_code: '508',
    roles: [
      { rank: 'Supervisor', cost_code: '508-SUP' },
      { rank: 'Chargehand', cost_code: '508-CHG' },
      { rank: 'Carpenter', label: 'Standard', cost_code: '508-STD' },
      { rank: 'Improver', cost_code: '508-IMP', fallbackPct: 0.85 },
      { rank: 'Apprentice Year 1', cost_code: '508-APP1', fallbackPct: 0.60 },
      { rank: 'Apprentice Year 2', cost_code: '508-APP2', fallbackPct: 0.70 },
      { rank: 'Apprentice Year 3', cost_code: '508-APP3', fallbackPct: 0.80 },
    ],
  },
  {
    key: 'painters',
    label: 'DEPARTMENT — PAINTERS',
    trade: 'Scenic Painters',
    cost_code: '510',
    roles: [
      { rank: 'Supervisor', cost_code: '510-SUP' },
      { rank: 'Chargehand', cost_code: '510-CHG' },
      { rank: 'Painter', label: 'Standard', cost_code: '510-STD' },
      { rank: 'Improver', cost_code: '510-IMP', fallbackPct: 0.85 },
      { rank: 'Apprentice Year 1', cost_code: '510-APP1', fallbackPct: 0.60 },
      { rank: 'Apprentice Year 2', cost_code: '510-APP2', fallbackPct: 0.70 },
      { rank: 'Apprentice Year 3', cost_code: '510-APP3', fallbackPct: 0.80 },
    ],
  },
  {
    key: 'riggers',
    label: 'DEPARTMENT — RIGGERS',
    trade: 'Riggers',
    cost_code: '516',
    roles: [
      { rank: 'Supervisor', cost_code: '516-SUP' },
      { rank: 'Chargehand', cost_code: '516-CHG' },
      { rank: 'Rigger', label: 'Standard', cost_code: '516-STD' },
      { rank: 'Improver', cost_code: '516-IMP', fallbackPct: 0.85 },
      { rank: 'Apprentice Year 1', cost_code: '516-APP1', fallbackPct: 0.60 },
      { rank: 'Apprentice Year 2', cost_code: '516-APP2', fallbackPct: 0.70 },
      { rank: 'Apprentice Year 3', cost_code: '516-APP3', fallbackPct: 0.80 },
    ],
  },
  {
    key: 'stagehands',
    label: 'DEPARTMENT — STAGEHANDS',
    trade: 'Stagehands',
    cost_code: '514',
    roles: [
      { rank: 'Supervisor', cost_code: '514-SUP' },
      { rank: 'Chargehand', cost_code: '514-CHG' },
      { rank: 'Stagehand', label: 'Standard', cost_code: '514-STD' },
    ],
  },
];

const STANDARD_NON_LABOUR_ITEMS = [
  { category: 'plant_hire', description: '17m Telehandler', cost_code: '512', unit_rate: 500.00, quantity: 1, unit_type: 'weekly' },
  { category: 'plant_hire', description: '6m Telehandler', cost_code: '512', unit_rate: 420.00, quantity: 0, unit_type: 'weekly' },
  { category: 'plant_hire', description: 'Scissorlifts', cost_code: '513', unit_rate: 180.00, quantity: 0, unit_type: 'weekly' },
  { category: 'plant_hire', description: 'Genie Boom', cost_code: '515', unit_rate: 350.00, quantity: 0, unit_type: 'weekly' },
  { category: 'plant_hire', description: 'Manitou Crane', cost_code: '517', unit_rate: 750.00, quantity: 0, unit_type: 'weekly' },
  { category: 'plant_hire', description: 'Forklift', cost_code: '518', unit_rate: 280.00, quantity: 0, unit_type: 'weekly' },
  { category: 'workshop_hire', description: 'Workshop Hire', cost_code: '520', unit_rate: 1200.00, quantity: 0, unit_type: 'weekly' },
  { category: 'consumables', description: 'Consumables and Samples', cost_code: '525', unit_rate: 500.00, quantity: 0, unit_type: 'lump_sum' },
  { category: 'waste_disposal', description: 'Studio Skips / Waste Disposal', cost_code: '529', unit_rate: 1000.00, quantity: 1, unit_type: 'weekly' },
  { category: 'waste_disposal', description: 'Hazardous Waste Removal', cost_code: '530', unit_rate: 650.00, quantity: 0, unit_type: 'weekly' },
  { category: 'standby_crew', description: 'Standby / Operational Crew', cost_code: '532', unit_rate: 800.00, quantity: 0, unit_type: 'weekly' },
  { category: 'fuel', description: 'Plant Fuel / Diesel', cost_code: '535', unit_rate: 350.00, quantity: 0, unit_type: 'weekly' },
  { category: 'strike_costs', description: 'Strike Costs (Estimated)', cost_code: '540', unit_rate: 2500.00, quantity: 0, unit_type: 'lump_sum' },
  { category: 'loss_damage', description: 'Construction Loss and Damage', cost_code: '545', unit_rate: 500.00, quantity: 0, unit_type: 'lump_sum' },
  { category: 'bank_holiday', description: 'Bank Holiday Payments — Unworked', cost_code: '550', unit_rate: 1200.00, quantity: 0, unit_type: 'lump_sum' },
  { category: 'location_setup', description: 'Location Set Up', cost_code: '555', unit_rate: 1500.00, quantity: 0, unit_type: 'lump_sum' },
  { category: 'materials', description: 'Materials (manually added)', cost_code: '560', unit_rate: 0.00, quantity: 1, unit_type: 'lump_sum' },
];

/**
 * Resolves weekly & daily rate for a given trade and rank from bectu_rates array.
 */
function resolveRate(bectuRates, trade, rank, fallbackPct = 1.0) {
  const match = bectuRates.find(r =>
    r.trade.toLowerCase() === trade.toLowerCase() &&
    r.rank.toLowerCase() === rank.toLowerCase()
  );

  if (match) {
    const daily = parseFloat(match.daily_rate) || 0;
    const weekly = match.weekly_rate ? parseFloat(match.weekly_rate) : daily * 5;
    return {
      bectu_rate_id: match.id,
      daily_rate: Number((daily * fallbackPct).toFixed(2)),
      weekly_rate: Number((weekly * fallbackPct).toFixed(2)),
      overtime_rate: match.overtime_rate ? parseFloat(match.overtime_rate) : null,
    };
  }

  // If apprentice or improver not in rate card, scale from standard craftsperson rank
  if (fallbackPct < 1.0) {
    const standardRank = trade === 'Carpenters' ? 'Carpenter'
      : trade === 'Scenic Painters' ? 'Painter'
      : trade === 'Riggers' ? 'Rigger'
      : 'Stagehand';

    const base = bectuRates.find(r =>
      r.trade.toLowerCase() === trade.toLowerCase() &&
      r.rank.toLowerCase() === standardRank.toLowerCase()
    );

    if (base) {
      const daily = parseFloat(base.daily_rate) || 0;
      const weekly = base.weekly_rate ? parseFloat(base.weekly_rate) : daily * 5;
      return {
        bectu_rate_id: null,
        daily_rate: Number((daily * fallbackPct).toFixed(2)),
        weekly_rate: Number((weekly * fallbackPct).toFixed(2)),
        overtime_rate: base.overtime_rate ? Number((parseFloat(base.overtime_rate) * fallbackPct).toFixed(2)) : null,
      };
    }
  }

  return { bectu_rate_id: null, daily_rate: 0, weekly_rate: 0, overtime_rate: 0 };
}

/**
 * Generates initial Cost Forecast crew lines from active BECTU rates.
 */
function buildDefaultCostForecastLines(bectuRates) {
  const lines = [];
  let sortOrder = 0;

  for (const section of STANDARD_SECTIONS) {
    for (const r of section.roles) {
      // Box rental and runaround are non-labour in Cost Forecast (handled in non-labour section)
      if (r.isFixedCost) continue;

      const trade = r.trade || section.trade;
      const rateInfo = resolveRate(bectuRates, trade, r.rank, r.fallbackPct || 1.0);

      lines.push({
        section: section.key,
        trade,
        rank: r.rank,
        display_label: r.label || `${trade} — ${r.rank}`,
        cost_code: r.cost_code,
        bectu_rate_id: rateInfo.bectu_rate_id,
        daily_rate: rateInfo.daily_rate,
        weekly_rate: rateInfo.weekly_rate,
        unit_rate: rateInfo.weekly_rate, // default view is weekly
        units: 0,
        rate_unit: 'weekly',
        sort_order: sortOrder++,
      });
    }
  }

  return lines;
}

/**
 * Generates initial Weekly Labour Flow rows with default rates from BECTU card.
 */
function buildDefaultLabourFlowRows(bectuRates) {
  const rows = [];
  let sortOrder = 0;

  for (const section of STANDARD_SECTIONS) {
    for (const r of section.roles) {
      const trade = r.trade || section.trade;
      let weeklyRate = r.defaultRate || 0;
      let bectuRateId = null;

      if (!r.isFixedCost) {
        const rateInfo = resolveRate(bectuRates, trade, r.rank, r.fallbackPct || 1.0);
        weeklyRate = rateInfo.weekly_rate;
        bectuRateId = rateInfo.bectu_rate_id;
      }

      rows.push({
        section: section.key,
        trade,
        rank: r.rank,
        display_label: r.label || r.rank,
        cost_code: r.cost_code,
        bectu_rate_id: bectuRateId,
        weekly_rate: weeklyRate,
        headcounts: {},
        sort_order: sortOrder++,
      });
    }
  }

  return rows;
}

/**
 * Parses a YYYY-MM-DD string as a pure UTC date (no timezone shift).
 */
function parseUTCDate(dateStr) {
  const parts = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1));
}

/**
 * Calculates dynamically generated week descriptors between start Monday and end Sunday.
 * Uses UTC methods throughout to avoid timezone-dependent day-of-week errors.
 * Returns: { weekNumber, weekMonday (YYYY-MM-DD), weekEndingDate (YYYY-MM-DD), label, subLabel }
 */
function calculateWeeks(startDateStr, endDateStr) {
  const start = parseUTCDate(startDateStr);
  const end   = parseUTCDate(endDateStr);
  const weeks = [];

  // Align start date to the nearest Monday (UTC)
  const day = start.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(start.getTime());
  currentMonday.setUTCDate(start.getUTCDate() + diffToMonday);

  let weekNum = 1;
  while (currentMonday.getTime() <= end.getTime() || weekNum === 1) {
    // Week-ending Sunday is 6 days after Monday
    const sunday = new Date(currentMonday.getTime());
    sunday.setUTCDate(currentMonday.getUTCDate() + 6);

    const pad  = (n) => String(n).padStart(2, '0');
    const dd   = pad(sunday.getUTCDate());
    const mm   = pad(sunday.getUTCMonth() + 1);
    const yy   = String(sunday.getUTCFullYear()).slice(-2);
    const yyyy = sunday.getUTCFullYear();

    const mondayPad = (n) => String(n).padStart(2, '0');
    const monDD = mondayPad(currentMonday.getUTCDate());
    const monMM = mondayPad(currentMonday.getUTCMonth() + 1);
    const monYYYY = currentMonday.getUTCFullYear();

    weeks.push({
      weekNumber:     weekNum,
      weekMonday:     `${monYYYY}-${monMM}-${monDD}`,
      weekEndingDate: `${yyyy}-${mm}-${dd}`,
      label:          `Wk ${weekNum}`,
      subLabel:       `w/e ${dd}.${mm}.${yy}`,
    });

    weekNum++;
    currentMonday.setUTCDate(currentMonday.getUTCDate() + 7);
  }

  return weeks;
}

module.exports = {
  STANDARD_SECTIONS,
  STANDARD_NON_LABOUR_ITEMS,
  resolveRate,
  buildDefaultCostForecastLines,
  buildDefaultLabourFlowRows,
  calculateWeeks,
};
