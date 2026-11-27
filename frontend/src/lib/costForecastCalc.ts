/**
 * FB-08 (Ben's item 9) — live preview of Cost Forecast pricing.
 * Mirror of backend/services/costForecastCalc.js (the backend re-prices on save and is authoritative;
 * backend/tests/costForecastCalc.test.js runs the same cases against both).
 *
 *   line total = units × unit_rate
 *              + ot_hours × (ot_rate ?? default_ot_rate)
 *              + travel_hours × travel £/hr + per_diem_days × per diem £/day
 *              + saturday_days × (saturday_rate ?? daily × 1) + sunday_days × (sunday_rate ?? daily × 2)
 *   margin     = line total × margin % when the forecast margin AND the line toggle are on
 */

export type ForecastSettings = {
  travel_hourly_rate: number | string | null | undefined;
  per_diem_rate: number | string | null | undefined;
  margin_enabled: boolean | null | undefined;
  margin_pct: number | string | null | undefined;
};

export type PriceableCrewLine = {
  units?: number | string | null;
  unit_rate?: number | string | null;
  daily_rate?: number | string | null;
  default_ot_rate?: number | string | null;
  ot_hours?: number | string | null;
  ot_rate?: number | string | null;
  travel_hours?: number | string | null;
  per_diem_days?: number | string | null;
  saturday_days?: number | string | null;
  saturday_rate?: number | string | null;
  sunday_days?: number | string | null;
  sunday_rate?: number | string | null;
  margin_applied?: boolean | null;
};

export type PriceableNonLabourLine = {
  quantity?: number | string | null;
  unit_rate?: number | string | null;
  margin_applied?: boolean | null;
};

export const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const SATURDAY_FACTOR = 1;  // timesheet rule: Saturday is a normal day
export const SUNDAY_FACTOR = 2;    // timesheet rule: Sunday is double time

export const defaultSaturdayRate = (daily: unknown) => r2(num(daily) * SATURDAY_FACTOR);
export const defaultSundayRate = (daily: unknown) => r2(num(daily) * SUNDAY_FACTOR);

const marginOn = (fc: ForecastSettings, line: { margin_applied?: boolean | null }) =>
  Boolean(fc.margin_enabled) && line.margin_applied !== false;

export function priceCrewLine(line: PriceableCrewLine, fc: ForecastSettings) {
  const daily = num(line.daily_rate);
  const otRate = optNum(line.ot_rate) ?? num(line.default_ot_rate);
  const satRate = optNum(line.saturday_rate) ?? defaultSaturdayRate(daily);
  const sunRate = optNum(line.sunday_rate) ?? defaultSundayRate(daily);
  const parts = {
    base: r2(num(line.units) * num(line.unit_rate)),
    overtime: r2(num(line.ot_hours) * otRate),
    travel: r2(num(line.travel_hours) * num(fc.travel_hourly_rate)),
    per_diem: r2(num(line.per_diem_days) * num(fc.per_diem_rate)),
    saturday: r2(num(line.saturday_days) * satRate),
    sunday: r2(num(line.sunday_days) * sunRate),
  };
  const lineTotal = r2(Object.values(parts).reduce((s, v) => s + v, 0));
  const margin = marginOn(fc, line) ? r2((lineTotal * num(fc.margin_pct)) / 100) : 0;
  return { line_total: lineTotal, margin_amount: margin, parts, rates: { ot: otRate, saturday: satRate, sunday: sunRate } };
}

export function priceNonLabourLine(line: PriceableNonLabourLine, fc: ForecastSettings) {
  const lineTotal = r2(num(line.quantity) * num(line.unit_rate));
  const margin = marginOn(fc, line) ? r2((lineTotal * num(fc.margin_pct)) / 100) : 0;
  return { line_total: lineTotal, margin_amount: margin };
}

export function sumForecast(
  crew: Array<{ line_total?: unknown; margin_amount?: unknown }>,
  nonLabour: Array<{ line_total?: unknown; margin_amount?: unknown }>,
) {
  const crewTotal = r2(crew.reduce((s: number, l) => s + num(l.line_total), 0));
  const nl = r2(nonLabour.reduce((s: number, l) => s + num(l.line_total), 0));
  const margin = r2([...crew, ...nonLabour].reduce((s: number, l) => s + num(l.margin_amount), 0));
  const grand = r2(crewTotal + nl);
  return {
    total_crew_cost: crewTotal,
    total_non_labour_cost: nl,
    grand_total_cost: grand,
    margin_total: margin,
    grand_total_with_margin: r2(grand + margin),
  };
}
