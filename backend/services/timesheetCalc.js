/**
 * TECH-01 — the single source of truth for timesheet rates and weekly totals.
 *
 * Used by saveEntries, the roll-forward in createTimesheet, and production-wide recalculation (CS-08).
 * The maths here is moved verbatim from timesheetsController.saveEntries — do not change it without
 * updating tests/timesheetCalc.test.js, which pins it against the original implementation.
 *
 * Money rules (unchanged):
 *   - Saturday is a normal day; only Sunday is premium (double time).
 *   - OT rate = rate-card overtime_rate, or daily × 1.5 / 9.5 (rounded to 2 dp) when none is configured.
 *   - Meal allowance: explicit amount per meal, else the legacy flat MEAL_RATES when the box is ticked.
 *   - VAT 20% only for self-employed crew with a VAT registration number.
 *
 * CS-08: `multiplier` (commercial rate card) scales the rate-card daily and OT rates, rounded to 2 dp
 * per rate. A manual rate_override is used exactly as entered and is never multiplied.
 */

const MEAL_RATES = { breakfast: 5.00, lunch: 10.00, supper: 10.00 };

const round2 = n => Math.round(n * 100) / 100;

// BECTU rate years run 1 July → 30 June (e.g. '2025/26' covers Jul 2025 – Jun 2026).
const getRateYear = (weekEndingDate) => {
  const d     = new Date(String(weekEndingDate).split('T')[0] + 'T00:00:00Z');
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
};

// Kept byte-for-byte as saveEntries had it (Math.round(x * 100) / 100) so no OT rate moves by a penny.
const deriveOtRate = dailyRate => (dailyRate > 0 ? round2(dailyRate * 1.5 / 9.5) : 0);

/**
 * rate × multiplier, rounded half-up to the penny the same way Postgres ROUND(numeric, 2) does.
 * Works in pence and trims float noise (5907 × 1.1 = 6497.700000000001) before rounding.
 */
const applyMultiplier = (rate, multiplier) => {
  const pence = Math.round(Number(rate) * 100) * Number(multiplier);
  return Math.round(Number(pence.toPrecision(12))) / 100;
};

/**
 * Resolve the day and OT rate for one timesheet.
 * Order: rate_override → rate card for the effective rank in the week's rate year → latest rate card row.
 * Non-BECTU roles are matched by trade or rank under trade 'Non-BECTU'.
 */
const resolveRates = async (client, { trade, rank, weekEndingDate, rateOverride = null, multiplier = 1 }) => {
  if (rateOverride != null && rateOverride !== '') {
    const dailyRate = parseFloat(rateOverride);
    return { dailyRate, otRate: deriveOtRate(dailyRate), multiplier: 1, source: 'override' };
  }
  const rateYear = getRateYear(weekEndingDate);
  let { rows: [rateRow] } = await client.query(
    `SELECT daily_rate, overtime_rate FROM bectu_rates
     WHERE ((trade = $1 AND rank = $2)
        OR (trade = 'Non-BECTU' AND (rank = $1 OR rank = $2)))
       AND rate_year = $3
     ORDER BY effective_from DESC NULLS LAST LIMIT 1`,
    [trade, rank, rateYear]
  );
  if (!rateRow) {
    ({ rows: [rateRow] } = await client.query(
      `SELECT daily_rate, overtime_rate FROM bectu_rates
       WHERE (trade = $1 AND rank = $2)
          OR (trade = 'Non-BECTU' AND (rank = $1 OR rank = $2))
       ORDER BY effective_from DESC NULLS LAST LIMIT 1`,
      [trade, rank]
    ));
  }
  const baseDaily = parseFloat(rateRow?.daily_rate || 0);
  let   baseOt    = parseFloat(rateRow?.overtime_rate || 0);
  // Non-BECTU roles often have no OT rate configured; derive from daily rate (daily / 9.5 × 1.5)
  if (!baseOt && baseDaily > 0) baseOt = deriveOtRate(baseDaily);

  const m = Number(multiplier) > 0 ? Number(multiplier) : 1;
  if (m === 1) return { dailyRate: baseDaily, otRate: baseOt, multiplier: 1, source: 'rate_card' };
  return { dailyRate: applyMultiplier(baseDaily, m), otRate: applyMultiplier(baseOt, m), multiplier: m, source: 'rate_card' };
};

/** Normalise raw entry input exactly as saveEntries always has. */
const normaliseEntries = (timesheetId, entries) => entries.map(e => ({
  timesheet_id:              timesheetId,
  date:                      e.date,
  day_of_week:               e.day_of_week,
  full_day_worked:           e.full_day_worked || false,
  overtime_hours:            parseFloat(e.overtime_hours || 0),
  set_number:                e.set_number || null,
  site:                      e.site || null,
  travel:                    parseFloat(e.travel || 0),
  meal_breakfast:            e.meal_breakfast || false,
  meal_lunch:                e.meal_lunch || false,
  meal_supper:               e.meal_supper || false,
  meal_allowance_breakfast:  e.meal_allowance_breakfast != null ? parseFloat(e.meal_allowance_breakfast) : null,
  meal_allowance_lunch:      e.meal_allowance_lunch     != null ? parseFloat(e.meal_allowance_lunch)     : null,
  meal_allowance_supper:     e.meal_allowance_supper    != null ? parseFloat(e.meal_allowance_supper)    : null,
  mileage:                   parseFloat(e.mileage              || 0),
  per_diem:                  parseFloat(e.per_diem             || 0),
  ad_hoc_reimbursement:      parseFloat(e.ad_hoc_reimbursement || 0),
}));

/**
 * Weekly totals from normalised entries (see normaliseEntries) and resolved rates. Pure function.
 * crew: { employment_status, vat_registration_number }
 */
const computeTotals = (rows, { dailyRate, otRate }, crew) => {
  const worked    = rows.filter(e => e.full_day_worked);
  const sunday    = rows.find(e => e.day_of_week === 'Sunday' && e.full_day_worked);
  // Saturday has no weekend premium; paid at normal day rate. Only Sunday has premium (double time).
  const stdDays   = worked.filter(e => e.day_of_week !== 'Sunday').length;

  const weeklyRate        = dailyRate * stdDays;
  const sixthDayPayment   = 0;
  const seventhDayPayment = sunday ? dailyRate * 2.0 : 0;
  const totalOT           = rows.reduce((s, e) => s + e.overtime_hours, 0);
  const overtimeAmount    = totalOT * otRate;

  const mealAllowance = rows.reduce((s, e) => {
    const b = e.meal_allowance_breakfast != null ? e.meal_allowance_breakfast : (e.meal_breakfast ? MEAL_RATES.breakfast : 0);
    const l = e.meal_allowance_lunch     != null ? e.meal_allowance_lunch     : (e.meal_lunch     ? MEAL_RATES.lunch     : 0);
    const sup = e.meal_allowance_supper  != null ? e.meal_allowance_supper    : (e.meal_supper    ? MEAL_RATES.supper    : 0);
    return s + b + l + sup;
  }, 0);

  const mileageAndTravel = rows.reduce((s, e) => s + e.travel + e.mileage + e.per_diem + e.ad_hoc_reimbursement, 0);
  const grossTotal       = weeklyRate + sixthDayPayment + seventhDayPayment + overtimeAmount + mealAllowance + mileageAndTravel;
  const vatRegistered    = crew.employment_status === 'self_employed' && !!crew.vat_registration_number;
  const vat              = vatRegistered ? grossTotal * 0.20 : 0;
  const grandTotal       = grossTotal + vat;

  return {
    weekly_rate:          weeklyRate,
    sixth_day_payment:    sixthDayPayment,
    seventh_day_payment:  seventhDayPayment,
    overtime_amount:      overtimeAmount,
    meal_allowance_total: mealAllowance,
    mileage_and_travel:   mileageAndTravel,
    vat,
    gross_total:          grossTotal,
    grand_total:          grandTotal,
  };
};

/**
 * Price one timesheet from its saved entries WITHOUT writing anything.
 * Overrides stored on the timesheet (rank_override, rate_override) are honoured.
 * `multiplier` defaults to the production's current rate card. Returns null if not found.
 */
const priceTimesheet = async (client, timesheetId, { multiplier } = {}) => {
  const { rows: [ts] } = await client.query(
    `SELECT t.*, cm.crew_trade, cm.crew_rank, cm.employment_status, cm.vat_registration_number,
            ${PRODUCTION_RATE_CARD_COLUMNS}
     FROM timesheets t
     JOIN crew_members cm ON cm.id = t.crew_member_id
     LEFT JOIN productions p ON p.id = t.production_id
     WHERE t.id = $1`,
    [timesheetId]
  );
  if (!ts) return null;
  const { rows: entries } = await client.query(
    'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date', [timesheetId]
  );
  const m = multiplier != null ? multiplier : rateMultiplierFor(ts);
  const rates = await resolveRates(client, {
    trade: ts.crew_trade,
    rank: ts.rank_override || ts.crew_rank,
    weekEndingDate: String(ts.week_ending_date).split('T')[0],
    rateOverride: ts.rate_override,
    multiplier: m,
  });
  return { ts, rates, multiplier: m, totals: computeTotals(normaliseEntries(timesheetId, entries), rates, ts) };
};

/**
 * Recalculate one timesheet's totals from its saved entries and store them (with rate_multiplier).
 * Used for brand-new roll-forward timesheets and production-wide recalculation (CS-08).
 * Never sends email. Never touches finalised timesheets (returns null for those).
 */
const recalculateAndStore = async (client, timesheetId, { multiplier } = {}) => {
  const priced = await priceTimesheet(client, timesheetId, { multiplier });
  if (!priced || priced.ts.status === 'finalised') return null; // TimesheetStatus.FINALISED is locked
  const { ts, rates, totals: t, multiplier: m } = priced;
  const { rows: [updated] } = await client.query(
    `UPDATE timesheets SET
       weekly_rate = $1, sixth_day_payment = $2, seventh_day_payment = $3,
       overtime_amount = $4, meal_allowance_total = $5, mileage_and_travel = $6,
       vat = $7, gross_total = $8, grand_total = $9, rate_multiplier = $10,
       amended_at = CASE WHEN status = 'distributed' AND grand_total IS DISTINCT FROM $9 THEN NOW() ELSE amended_at END
     WHERE id = $11 AND status <> 'finalised'
     RETURNING *`,
    [t.weekly_rate, t.sixth_day_payment, t.seventh_day_payment, t.overtime_amount, t.meal_allowance_total,
     t.mileage_and_travel, t.vat, t.gross_total, t.grand_total, m, timesheetId]
  );
  return { before: ts, after: updated || null, rates };
};

/**
 * True when re-pricing a timesheet at the multiplier it was last saved with reproduces its stored
 * total (to the penny). False means its totals don't come from its daily entries — e.g. CSV-imported
 * allowances, or a rate card edited since — so a bulk re-price must not overwrite it.
 */
const storedTotalsReproducible = async (client, timesheetId) => {
  const { rows: [row] } = await client.query('SELECT rate_multiplier, grand_total FROM timesheets WHERE id = $1', [timesheetId]);
  if (!row) return false;
  const stored = row.rate_multiplier != null ? parseFloat(row.rate_multiplier) : 1;
  const priced = await priceTimesheet(client, timesheetId, { multiplier: stored });
  return !!priced && Math.abs(priced.totals.grand_total - parseFloat(row.grand_total || 0)) < 0.005;
};

// ─── CS-08: commercial rate card ──────────────────────────────────────────────────────────────
const DEFAULT_COMMERCIAL_UPLIFT_PCT = 10;

/** Select-list fragment; needs `productions p` joined. Gives rate_card_type + commercial_uplift_pct. */
const PRODUCTION_RATE_CARD_COLUMNS = `p.rate_card_type,
              (SELECT s.value FROM app_settings s WHERE s.key = 'commercial_rate_uplift_pct') AS commercial_uplift_pct`;

/** Uplift % as a number; falls back to the default when unset or invalid. */
const parseUpliftPct = (value) => {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_COMMERCIAL_UPLIFT_PCT;
};

/** Multiplier for a row carrying rate_card_type / commercial_uplift_pct. Standard → 1. */
const rateMultiplierFor = (row) => {
  if (!row || row.rate_card_type !== 'commercial') return 1; // RateCardType.COMMERCIAL
  return Number((1 + parseUpliftPct(row.commercial_uplift_pct) / 100).toFixed(4));
};

// ─── SQL for showing a timesheet's rates (list, detail, PDFs) ────────────────────────────────
// Mirrors resolveRates() so the rate a user sees is the rate saveEntries will use:
//   effective rank = t.rank_override or the crew rank; the week's rate year first, else the latest
//   rate; OT falls back to daily × 1.5 / 9.5; CS-08 multiplier applied and rounded per rate.
// (Like saveEntries, a CSV-imported rate_override is not shown here: the editor never sends it back.)
const RATE_YEAR_SQL = (t) => `(
  (CASE WHEN EXTRACT(MONTH FROM ${t}.week_ending_date) >= 7 THEN EXTRACT(YEAR FROM ${t}.week_ending_date)::int
        ELSE EXTRACT(YEAR FROM ${t}.week_ending_date)::int - 1 END)::text
  || '/' ||
  RIGHT(((CASE WHEN EXTRACT(MONTH FROM ${t}.week_ending_date) >= 7 THEN EXTRACT(YEAR FROM ${t}.week_ending_date)::int
               ELSE EXTRACT(YEAR FROM ${t}.week_ending_date)::int - 1 END) + 1)::text, 2))`;

const rateLookupSql = (valueExpr, t, cm) => `(SELECT ${valueExpr}
               FROM bectu_rates br
               WHERE (br.trade = ${cm}.crew_trade AND br.rank = COALESCE(${t}.rank_override, ${cm}.crew_rank))
                  OR (br.trade = 'Non-BECTU' AND (br.rank = ${cm}.crew_trade OR br.rank = COALESCE(${t}.rank_override, ${cm}.crew_rank)))
               ORDER BY (br.rate_year = ${RATE_YEAR_SQL(t)}) DESC, br.effective_from DESC NULLS LAST
               LIMIT 1)`;

/**
 * The multiplier a timesheet's rates are shown with (CS-08), mirroring rateMultiplierFor():
 *   finalised      → the snapshot stored when it was last priced (never changes afterwards)
 *   anything else  → the production's CURRENT rate card, i.e. what the next save will use
 * Needs `productions p` joined. Uplift: app_settings.commercial_rate_uplift_pct (0–100), else 10.
 */
const effectiveMultiplierSql = (t, p) => `(CASE
    WHEN ${t}.status = 'finalised' THEN COALESCE(${t}.rate_multiplier, 1)
    WHEN ${p}.rate_card_type = 'commercial' THEN ROUND(1 + COALESCE((
      SELECT CASE WHEN jsonb_typeof(s.value) = 'number' AND (s.value)::text::numeric BETWEEN 0 AND 100
                  THEN (s.value)::text::numeric END
      FROM app_settings s WHERE s.key = 'commercial_rate_uplift_pct'), ${DEFAULT_COMMERCIAL_UPLIFT_PCT}) / 100, 4)
    ELSE 1 END)`;

const withMultiplier = (expr, t, p) =>
  `CASE WHEN ${effectiveMultiplierSql(t, p)} = 1 THEN ${expr} ELSE ROUND((${expr}) * ${effectiveMultiplierSql(t, p)}, 2) END`;

/** SQL expression for the displayed day rate (alias it AS daily_rate). Needs timesheets t, crew_members cm, productions p. */
const displayDailyRateSql = (t = 't', cm = 'cm', p = 'p') =>
  rateLookupSql(withMultiplier('br.daily_rate', t, p), t, cm);

/** SQL expression for the displayed overtime rate (alias it AS overtime_rate). */
const displayOvertimeRateSql = (t = 't', cm = 'cm', p = 'p') =>
  rateLookupSql(withMultiplier('COALESCE(NULLIF(br.overtime_rate, 0), ROUND(br.daily_rate * 1.5 / 9.5, 2))', t, p), t, cm);

/** SQL for the multiplier itself (alias AS effective_rate_multiplier) — lets the UI show a Commercial badge. */
const displayRateMultiplierSql = (t = 't', p = 'p') => effectiveMultiplierSql(t, p);

module.exports = {
  MEAL_RATES, round2, getRateYear, deriveOtRate, applyMultiplier,
  resolveRates, normaliseEntries, computeTotals, priceTimesheet, recalculateAndStore, storedTotalsReproducible,
  displayDailyRateSql, displayOvertimeRateSql, displayRateMultiplierSql,
  DEFAULT_COMMERCIAL_UPLIFT_PCT, PRODUCTION_RATE_CARD_COLUMNS, parseUpliftPct, rateMultiplierFor,
};
