/**
 * FB-07 / ADR-09 — The Percentometer, exactly as Ben's "Percentometer FINAL.xlsx":
 *
 *   Carpenters cost (£)        = Σ weekly rate × number of carpenters × weeks   (or typed directly)
 *   ATL                        = construction above-the-line fixed costs, % of total (default 25)
 *   Estimated total cost (£)   = carpenters cost ÷ (carpenter base share × (1 − ATL))
 *   Each department line       = total × base share × (1 − ATL)
 *   "Above-the-line fixed costs" line = total × ATL
 *   → the lines sum to the total, and the carpenters line equals the carpenters cost.
 *
 * Shared by the calculator (/api/forecasting/percentometer/calculate and /api/percentometer/calculate)
 * and saved scenarios (forecasts.percentometer_total), so they can never disagree (fixes F-B).
 */
const db = require('../config/db');

const DEFAULT_ATL_PCT = 25;
const ATL_SETTING_KEY = 'percentometer_atl_pct';
const ATL_COST_TYPE   = 'Above-the-line fixed costs';
const KNOWN_COST_TYPE = 'Carpenters';

const DEFAULT_RATIOS = [
  { cost_type: 'Carpenters',  percentage: 0.42 },
  { cost_type: 'Painters',    percentage: 0.18 },
  { cost_type: 'Stagehands',  percentage: 0.09 },
  { cost_type: 'Riggers',     percentage: 0.06 },
  { cost_type: 'Timber',      percentage: 0.09 },
  { cost_type: 'Plasterwork', percentage: 0.06 },
  { cost_type: 'Misc',        percentage: 0.03 },
  { cost_type: 'Sculptors',   percentage: 0.02 },
  { cost_type: 'Metalwork',   percentage: 0.02 },
  { cost_type: 'Paint',       percentage: 0.02 },
  { cost_type: 'Glass',       percentage: 0.01 },
];

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** A valid ATL % is 0 ≤ x < 100 (100% would leave nothing for departments). */
const parseAtlPct = (value) => {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
};

/** Active ratios only (F-A: historical versions have effective_to set). Falls back to the defaults. */
const getActiveRatios = async (client = db) => {
  try {
    const { rows } = await client.query(
      `SELECT * FROM percentometer_ratios WHERE effective_to IS NULL ORDER BY percentage DESC, cost_type`
    );
    return rows.length ? rows : DEFAULT_RATIOS;
  } catch (err) {
    // Very old schema without effective_to: every row is active.
    if (err.code === '42703') {
      const { rows } = await client.query('SELECT * FROM percentometer_ratios ORDER BY percentage DESC, cost_type');
      return rows.length ? rows : DEFAULT_RATIOS;
    }
    throw err;
  }
};

const getAtlPct = async (client = db) => {
  const { rows: [row] } = await client.query('SELECT value FROM app_settings WHERE key = $1', [ATL_SETTING_KEY]);
  const parsed = row ? parseAtlPct(row.value) : null;
  return parsed == null ? DEFAULT_ATL_PCT : parsed;
};

/**
 * Carpenter cost from builder rows [{ grade, weekly_rate, headcount, weeks }].
 * Returns { total, rows } or { error }.
 */
const carpenterCostFromCrew = (crew) => {
  if (!Array.isArray(crew) || !crew.length) return { error: 'crew must be a non-empty array' };
  if (crew.length > 50) return { error: 'crew can have at most 50 rows' };
  const rows = [];
  for (const c of crew) {
    const rate = Number(c?.weekly_rate), head = Number(c?.headcount), weeks = Number(c?.weeks);
    if (![rate, head, weeks].every(v => Number.isFinite(v) && v >= 0))
      return { error: 'Each crew row needs a weekly_rate, headcount and weeks of 0 or more' };
    rows.push({ grade: String(c.grade || '').slice(0, 100), weekly_rate: rate, headcount: head, weeks, cost: r2(rate * head * weeks) });
  }
  return { total: r2(rows.reduce((s, r) => s + r.cost, 0)), rows };
};

/**
 * Pure calculation. ratios: [{ cost_type, percentage (0–1) }]; atlPct: 0–<100.
 * Returns { error } or the full breakdown.
 */
const calculate = ({ knownCost, knownCostType = KNOWN_COST_TYPE, ratios, atlPct }) => {
  const cost = Number(knownCost);
  if (!Number.isFinite(cost) || cost <= 0) return { error: 'known_cost must be a positive number' };
  const atl = parseAtlPct(atlPct);
  if (atl == null) return { error: 'atl_pct must be a number from 0 to less than 100' };
  const known = ratios.find(r => r.cost_type === knownCostType);
  if (!known) return { error: `Unknown cost type: ${knownCostType}` };
  const knownShare = parseFloat(known.percentage);
  if (!(knownShare > 0)) return { error: `${knownCostType} has no ratio to scale from` };

  const atlFraction = atl / 100;
  const total = cost / (knownShare * (1 - atlFraction));
  const breakdown = ratios.map(r => {
    const base  = parseFloat(r.percentage);
    const share = base * (1 - atlFraction);
    return {
      cost_type:        r.cost_type,
      base_percentage:  Number((base * 100).toFixed(4)),   // the stored ratio (e.g. 42)
      percentage:       Number((share * 100).toFixed(4)),  // share of the total after ATL (e.g. 31.5)
      estimated_value:  r2(total * share),
      is_atl:           false,
    };
  });
  if (atlFraction > 0) {
    breakdown.push({
      cost_type: ATL_COST_TYPE, base_percentage: null, percentage: atl, estimated_value: r2(total * atlFraction), is_atl: true,
    });
  }
  return {
    known_cost:               r2(cost),
    known_cost_type:          knownCostType,
    atl_pct:                  atl,
    total_estimated_job_cost: r2(total),
    breakdown,
  };
};

/** Load active ratios + ATL setting and calculate (atlPctOverride wins when provided). */
const calculateFromDb = async ({ knownCost, knownCostType, atlPct }, client = db) => {
  const [ratios, storedAtl] = await Promise.all([getActiveRatios(client), atlPct == null ? getAtlPct(client) : null]);
  return calculate({ knownCost, knownCostType, ratios, atlPct: atlPct == null ? storedAtl : atlPct });
};

module.exports = {
  DEFAULT_ATL_PCT, ATL_SETTING_KEY, ATL_COST_TYPE, DEFAULT_RATIOS,
  parseAtlPct, getActiveRatios, getAtlPct, carpenterCostFromCrew, calculate, calculateFromDb,
};
