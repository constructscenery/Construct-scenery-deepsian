/**
 * FB-08 / ADR-04 — Cost Forecast pricing (Ben's item 9).
 *
 * A crew line costs
 *   base    = units × unit_rate                       (unit_rate = weekly or daily card rate × multiplier)
 *   + OT    = ot_hours       × (ot_rate       ?? default_ot_rate)
 *   + travel= travel_hours   × forecast.travel_hourly_rate
 *   + p.d.  = per_diem_days  × forecast.per_diem_rate
 *   + Sat   = saturday_days  × (saturday_rate ?? daily_rate × 1)   — timesheet rule: Saturday is a normal day
 *   + Sun   = sunday_days    × (sunday_rate   ?? daily_rate × 2)   — timesheet rule: Sunday is double time
 * and margin = line total × margin_pct / 100 when the forecast's margin is on AND the line's toggle is on.
 *
 * Synced columns (unit_rate, daily_rate, default_ot_rate) follow the live rate card × the forecast's
 * rate multiplier while the forecast is unlocked. Typed overrides (ot_rate, saturday_rate,
 * sunday_rate), hours/days and margin toggles are never touched by the sync.
 * Commercial uplift applies to card rates only — never to travel, per diem or typed overrides
 * (the same rule as timesheets, where expenses are never uplifted).
 *
 * totals.total_crew_cost / total_non_labour_cost / grand_total_cost stay COST (no margin): the
 * dashboard forecast-vs-actual variance reads total_crew_cost. Margin is reported separately.
 *
 * A TypeScript copy for the live preview lives in frontend/src/lib/costForecastCalc.ts — keep in step
 * (tests/costForecastCalc.test.js checks both against the same cases).
 */
const { STANDARD_SECTIONS, resolveRate } = require('./forecastingDefaults');
const { applyMultiplier, deriveOtRate, commercialRate } = require('./timesheetCalc');

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const optNum = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

const DEFAULTS = Object.freeze({
  travel_hourly_rate: 25,   // the Weekly Estimator's existing default; editable per forecast
  per_diem_rate:      0,    // no default exists in the system — set per forecast
  margin_pct:         10,   // Weekly Estimator / Cost Plus default; editable per forecast
  margin_enabled:     false,// off so existing forecasts keep their totals
  saturday_factor:    1,    // timesheetCalc: Saturday is a normal day
  sunday_factor:      2,    // timesheetCalc: Sunday is double time
});

/** Rate a Saturday / Sunday day is costed at when the line has no typed override. */
const defaultSaturdayRate = dailyRate => r2(num(dailyRate) * DEFAULTS.saturday_factor);
const defaultSundayRate   = dailyRate => r2(num(dailyRate) * DEFAULTS.sunday_factor);

const marginOn = (fc, line) => Boolean(fc?.margin_enabled) && line?.margin_applied !== false;

/** Price one crew line. fc = forecast settings { travel_hourly_rate, per_diem_rate, margin_enabled, margin_pct }. */
const priceCrewLine = (line, fc) => {
  const daily   = num(line.daily_rate);
  const otRate  = optNum(line.ot_rate)       ?? num(line.default_ot_rate);
  const satRate = optNum(line.saturday_rate) ?? defaultSaturdayRate(daily);
  const sunRate = optNum(line.sunday_rate)   ?? defaultSundayRate(daily);
  const parts = {
    base:     num(line.units)         * num(line.unit_rate),
    overtime: num(line.ot_hours)      * otRate,
    travel:   num(line.travel_hours)  * num(fc?.travel_hourly_rate),
    per_diem: num(line.per_diem_days) * num(fc?.per_diem_rate),
    saturday: num(line.saturday_days) * satRate,
    sunday:   num(line.sunday_days)   * sunRate,
  };
  Object.keys(parts).forEach(k => { parts[k] = r2(parts[k]); });
  const lineTotal = r2(Object.values(parts).reduce((s, v) => s + v, 0));
  const margin    = marginOn(fc, line) ? r2(lineTotal * num(fc.margin_pct) / 100) : 0;
  return { line_total: lineTotal, margin_amount: margin, parts, rates: { ot: otRate, saturday: satRate, sunday: sunRate } };
};

const priceNonLabourLine = (line, fc) => {
  const lineTotal = r2(num(line.quantity) * num(line.unit_rate));
  const margin    = marginOn(fc, line) ? r2(lineTotal * num(fc.margin_pct) / 100) : 0;
  return { line_total: lineTotal, margin_amount: margin };
};

/** Totals for a whole forecast. Lines must already be priced (line_total / margin_amount). */
const sumForecast = (crewLines, nonLabourLines) => {
  const crew   = r2(crewLines.reduce((s, l) => s + num(l.line_total), 0));
  const nl     = r2(nonLabourLines.reduce((s, l) => s + num(l.line_total), 0));
  const margin = r2([...crewLines, ...nonLabourLines].reduce((s, l) => s + num(l.margin_amount), 0));
  const grand  = r2(crew + nl);
  return {
    total_crew_cost:         crew,
    total_non_labour_cost:   nl,
    grand_total_cost:        grand,
    margin_total:            margin,
    grand_total_with_margin: r2(grand + margin),
  };
};

/** fallbackPct for apprentice / improver grades (scaled from the standard grade when not on the card). */
const fallbackPctFor = (trade, rank) => {
  for (const section of STANDARD_SECTIONS) {
    for (const role of section.roles) {
      if ((role.trade || section.trade) === trade && role.rank === rank) return role.fallbackPct || 1.0;
    }
  }
  return 1.0;
};

/**
 * Card rates for a line × multiplier. Returns null when the grade is not on the card at all
 * (the stored unit_rate is then kept, exactly as before).
 */
const cardRatesFor = (bectuRates, line, multiplier, view, commercial = false) => {
  const info = resolveRate(bectuRates, line.trade, line.rank, fallbackPctFor(line.trade, line.rank));
  if (!info.bectu_rate_id && !(info.daily_rate > 0) && !(info.weekly_rate > 0)) return null;
  const m = num(multiplier) > 0 ? num(multiplier) : 1;
  // RC-05: on a commercial forecast a Set commercial rate is used as entered; Auto = card × multiplier.
  const rate = (base, override) => (commercial ? commercialRate(base, override, m) : applyMultiplier(base, m));
  const daily  = rate(info.daily_rate, info.commercial_daily_rate);
  const weekly = rate(info.weekly_rate, info.commercial_weekly_rate);
  const otBase = info.overtime_rate ? num(info.overtime_rate) : deriveOtRate(num(info.daily_rate));
  return {
    bectu_rate_id:   info.bectu_rate_id,
    unit_rate:       view === 'daily' ? daily : weekly,
    daily_rate:      daily,
    default_ot_rate: rate(otBase, info.commercial_overtime_rate),
  };
};

/** Apply the live card to a line (unlocked forecasts). Overrides and quantities are untouched. */
const syncLineRates = (line, bectuRates, multiplier, view, commercial = false) => {
  const card = cardRatesFor(bectuRates, line, multiplier, view, commercial);
  if (!card) return { ...line };
  return { ...line, ...card, bectu_rate_id: card.bectu_rate_id ?? line.bectu_rate_id ?? null };
};

/**
 * Validate a forecast-settings patch. Returns { values } (only keys present) or { error }.
 */
const RATE_CARD_TYPES = ['standard', 'commercial'];  // RateCardType
const parseSettings = (body = {}) => {
  const values = {};
  if (body.rate_card_type !== undefined) {
    if (!RATE_CARD_TYPES.includes(body.rate_card_type)) return { error: `rate_card_type must be one of: ${RATE_CARD_TYPES.join(', ')}` };
    values.rate_card_type = body.rate_card_type;
  }
  for (const key of ['travel_hourly_rate', 'per_diem_rate']) {
    if (body[key] === undefined) continue;
    const v = Number(body[key]);
    if (body[key] === '' || body[key] === null || !Number.isFinite(v) || v < 0 || v > 100000) return { error: `${key} must be a number from 0 to 100000` };
    values[key] = r2(v);
  }
  if (body.margin_pct !== undefined) {
    const v = Number(body.margin_pct);
    if (body.margin_pct === '' || body.margin_pct === null || !Number.isFinite(v) || v < 0 || v > 1000) return { error: 'margin_pct must be a number from 0 to 1000' };
    values.margin_pct = r2(v);
  }
  if (body.margin_enabled !== undefined) values.margin_enabled = Boolean(body.margin_enabled);
  return { values };
};

/** Clean the user-editable fields of a crew line from a request body. Returns { values } or { error }. */
const parseCrewLineInput = (l = {}) => {
  const out = {};
  for (const key of ['units', 'ot_hours', 'travel_hours', 'per_diem_days', 'saturday_days', 'sunday_days']) {
    const raw = l[key];
    const v = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return { error: `${key} must be a number of 0 or more` };
    out[key] = v;
  }
  for (const key of ['ot_rate', 'saturday_rate', 'sunday_rate']) {
    const raw = l[key];
    if (raw === '' || raw === null || raw === undefined) { out[key] = null; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return { error: `${key} must be blank (use the default) or a number of 0 or more` };
    out[key] = r2(v);
  }
  out.margin_applied = l.margin_applied === undefined ? true : Boolean(l.margin_applied);
  return { values: out };
};

module.exports = {
  DEFAULTS, RATE_CARD_TYPES,
  defaultSaturdayRate, defaultSundayRate,
  priceCrewLine, priceNonLabourLine, sumForecast,
  fallbackPctFor, cardRatesFor, syncLineRates,
  parseSettings, parseCrewLineInput,
};
