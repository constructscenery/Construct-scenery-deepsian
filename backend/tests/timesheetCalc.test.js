'use strict';
/**
 * TECH-01 — services/timesheetCalc is a verbatim move of the saveEntries maths.
 * The golden-master test runs the ORIGINAL saveEntries implementation (copied from git HEAD
 * before TECH-01) side by side with the new service on hundreds of random timesheets and requires
 * identical money. CS-08 commercial-rate rules are covered at the end.
 */
const calc = require('../services/timesheetCalc');

// ─── Original implementation (git HEAD fc6e741, timesheetsController.saveEntries) ──────────────
const MEAL_RATES = { breakfast: 5.00, lunch: 10.00, supper: 10.00 };
function originalRates(rateOverride, rateRow) {
  let dailyRate, otRate;
  if (rateOverride != null) {
    dailyRate = parseFloat(rateOverride);
    otRate    = dailyRate > 0 ? Math.round(dailyRate * 1.5 / 9.5 * 100) / 100 : 0;
  } else {
    dailyRate = parseFloat(rateRow?.daily_rate || 0);
    otRate    = parseFloat(rateRow?.overtime_rate || 0);
    if (!otRate && dailyRate > 0) otRate = Math.round(dailyRate * 1.5 / 9.5 * 100) / 100;
  }
  return { dailyRate, otRate };
}
function originalTotals(entries, dailyRate, otRate, ts) {
  const rows = entries.map(e => ({
    full_day_worked: e.full_day_worked || false,
    day_of_week: e.day_of_week,
    overtime_hours: parseFloat(e.overtime_hours || 0),
    travel: parseFloat(e.travel || 0),
    meal_breakfast: e.meal_breakfast || false, meal_lunch: e.meal_lunch || false, meal_supper: e.meal_supper || false,
    meal_allowance_breakfast: e.meal_allowance_breakfast != null ? parseFloat(e.meal_allowance_breakfast) : null,
    meal_allowance_lunch: e.meal_allowance_lunch != null ? parseFloat(e.meal_allowance_lunch) : null,
    meal_allowance_supper: e.meal_allowance_supper != null ? parseFloat(e.meal_allowance_supper) : null,
    mileage: parseFloat(e.mileage || 0), per_diem: parseFloat(e.per_diem || 0), ad_hoc_reimbursement: parseFloat(e.ad_hoc_reimbursement || 0),
  }));
  const worked = rows.filter(e => e.full_day_worked);
  const sunday = rows.find(e => e.day_of_week === 'Sunday' && e.full_day_worked);
  const stdDays = worked.filter(e => e.day_of_week !== 'Sunday').length;
  const weeklyRate = dailyRate * stdDays;
  const sixthDayPayment = 0;
  const seventhDayPayment = sunday ? dailyRate * 2.0 : 0;
  const totalOT = rows.reduce((s, e) => s + e.overtime_hours, 0);
  const overtimeAmount = totalOT * otRate;
  const mealAllowance = rows.reduce((s, e) => {
    const b = e.meal_allowance_breakfast != null ? e.meal_allowance_breakfast : (e.meal_breakfast ? MEAL_RATES.breakfast : 0);
    const l = e.meal_allowance_lunch != null ? e.meal_allowance_lunch : (e.meal_lunch ? MEAL_RATES.lunch : 0);
    const sup = e.meal_allowance_supper != null ? e.meal_allowance_supper : (e.meal_supper ? MEAL_RATES.supper : 0);
    return s + b + l + sup;
  }, 0);
  const mileageAndTravel = rows.reduce((s, e) => s + e.travel + e.mileage + e.per_diem + e.ad_hoc_reimbursement, 0);
  const grossTotal = weeklyRate + sixthDayPayment + seventhDayPayment + overtimeAmount + mealAllowance + mileageAndTravel;
  const vatRegistered = ts.employment_status === 'self_employed' && !!ts.vat_registration_number;
  const vat = vatRegistered ? grossTotal * 0.20 : 0;
  return {
    weekly_rate: weeklyRate, sixth_day_payment: sixthDayPayment, seventh_day_payment: seventhDayPayment,
    overtime_amount: overtimeAmount, meal_allowance_total: mealAllowance, mileage_and_travel: mileageAndTravel,
    vat, gross_total: grossTotal, grand_total: grossTotal + vat,
  };
}

// ─── deterministic random generator ────────────────────────────────────────────────────────────
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const maybe = (p, v) => (rnd() < p ? v : undefined);
const money = max => String(Math.round(rnd() * max * 100) / 100);
const randomEntries = () => DAYS.map((d, i) => ({
  date: `2026-11-${String(16 + i).padStart(2, '0')}`,
  day_of_week: d,
  full_day_worked: rnd() < 0.7,
  overtime_hours: maybe(0.5, pick(['0', '0.5', '1', '1.25', '2', '3.5'])),
  travel: maybe(0.3, money(40)), mileage: maybe(0.3, money(60)), per_diem: maybe(0.2, money(30)),
  ad_hoc_reimbursement: maybe(0.1, money(100)),
  meal_breakfast: rnd() < 0.3, meal_lunch: rnd() < 0.5, meal_supper: rnd() < 0.2,
  meal_allowance_breakfast: maybe(0.3, pick(['0', '5', '7.5'])),
  meal_allowance_lunch: maybe(0.3, pick(['0', '10', '12'])),
  meal_allowance_supper: maybe(0.2, pick(['0', '10'])),
  set_number: maybe(0.5, '100'),
}));
const randomRateRow = () => pick([
  undefined,
  { daily_rate: '0', overtime_rate: '0' },
  { daily_rate: money(500), overtime_rate: '0' },
  { daily_rate: money(500), overtime_rate: money(90) },
  { daily_rate: '331.00', overtime_rate: null },
]);
const fakeClient = rateRow => ({ query: jest.fn(async () => ({ rows: rateRow ? [rateRow] : [] })) });

describe('TECH-01 golden master: new calculator === original saveEntries maths', () => {
  test('600 random timesheets give identical rates and totals', async () => {
    for (let i = 0; i < 600; i++) {
      const entries = randomEntries();
      const rateRow = randomRateRow();
      const rateOverride = rnd() < 0.15 ? money(450) : null;
      const crew = pick([
        { employment_status: 'paye', vat_registration_number: null },
        { employment_status: 'self_employed', vat_registration_number: null },
        { employment_status: 'self_employed', vat_registration_number: 'GB123' },
      ]);
      const expectedRates = originalRates(rateOverride, rateRow);
      const expected = originalTotals(entries, expectedRates.dailyRate, expectedRates.otRate, crew);

      const rates = await calc.resolveRates(fakeClient(rateRow), {
        trade: 'Carpenters', rank: 'Chargehand', weekEndingDate: '2026-11-22', rateOverride, multiplier: 1,
      });
      expect({ dailyRate: rates.dailyRate, otRate: rates.otRate }).toEqual(expectedRates);
      expect(calc.computeTotals(calc.normaliseEntries('ts', entries), rates, crew)).toEqual(expected);
    }
  });

  test('rate lookup tries the week\'s rate year first, then the latest rate', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ daily_rate: '300' }] }) };
    const r = await calc.resolveRates(client, { trade: 'Carpenters', rank: 'Carpenter', weekEndingDate: '2026-07-05' });
    // RC-02: the week-ending date is passed so the version in force that week is chosen
    expect(client.query.mock.calls[0][1]).toEqual(['Carpenters', 'Carpenter', '2026/27', '2026-07-05']);
    expect(client.query.mock.calls[0][0]).toMatch(/ORDER BY \(effective_from <= \$4::date\) DESC NULLS LAST, effective_from DESC NULLS LAST/);
    expect(client.query.mock.calls[1][1]).toEqual(['Carpenters', 'Carpenter', '2026-07-05']);
    expect(r).toMatchObject({ dailyRate: 300, otRate: 47.37 });
  });

  describe('RC-02 commercial rates', () => {
    const card = row => ({ query: jest.fn().mockResolvedValue({ rows: [row] }) });
    const base = { daily_rate: '320.00', overtime_rate: '48.00', commercial_daily_rate: null, commercial_overtime_rate: null };
    const args = { trade: 'Carpenters', rank: 'Carpenter', weekEndingDate: '2026-11-29' };

    test('Auto commercial = standard × multiplier (unchanged)', async () => {
      const r = await calc.resolveRates(card(base), { ...args, multiplier: 1.1, commercial: true });
      expect(r).toMatchObject({ dailyRate: 352, otRate: 52.8, multiplier: 1.1 });
    });
    test('a Set commercial rate is used as entered; the other stays Auto', async () => {
      const r = await calc.resolveRates(card({ ...base, commercial_daily_rate: '400.00' }), { ...args, multiplier: 1.1, commercial: true });
      expect(r).toMatchObject({ dailyRate: 400, otRate: 52.8 });
    });
    test('Set rates apply even at 0 % uplift', async () => {
      const r = await calc.resolveRates(card({ ...base, commercial_daily_rate: '400.00', commercial_overtime_rate: '60.00' }), { ...args, multiplier: 1, commercial: true });
      expect(r).toMatchObject({ dailyRate: 400, otRate: 60 });
    });
    test('standard productions ignore commercial rates', async () => {
      const r = await calc.resolveRates(card({ ...base, commercial_daily_rate: '400.00' }), { ...args, multiplier: 1 });
      expect(r).toMatchObject({ dailyRate: 320, otRate: 48 });
    });
    test('a manual rate override is never replaced or multiplied', async () => {
      const r = await calc.resolveRates(card({ ...base, commercial_daily_rate: '400.00' }), { ...args, rateOverride: '380', multiplier: 1.1, commercial: true });
      expect(r).toMatchObject({ dailyRate: 380, otRate: 60, source: 'override' });
    });
    test('commercialRate helper', () => {
      expect(calc.commercialRate(320, null, 1.1)).toBe(352);
      expect(calc.commercialRate(320, '400.50', 1.1)).toBe(400.5);
      expect(calc.commercialRate(320, '', 1.1)).toBe(352);
    });
  });

  test('rate year boundaries (1 July)', () => {
    expect(calc.getRateYear('2026-06-28')).toBe('2025/26');
    expect(calc.getRateYear('2026-07-05')).toBe('2026/27');
    expect(calc.getRateYear('2027-01-03')).toBe('2026/27');
  });
});

describe('CS-08 commercial rate', () => {
  test('rate card rates × 1.1, rounded to the penny per rate', async () => {
    const r = await calc.resolveRates(fakeClient({ daily_rate: '59.07', overtime_rate: '10.00' }),
      { trade: 'Carpenters', rank: 'Carpenter', weekEndingDate: '2026-11-22', multiplier: 1.1 });
    expect(r).toMatchObject({ dailyRate: 64.98, otRate: 11, multiplier: 1.1 });
  });

  test('derived OT (no rate-card OT) is derived from the standard rate, then uplifted', async () => {
    const r = await calc.resolveRates(fakeClient({ daily_rate: '331.00', overtime_rate: '0' }),
      { trade: 'Non-BECTU', rank: 'Driver', weekEndingDate: '2026-11-22', multiplier: 1.1 });
    // standard OT = round(331 × 1.5 / 9.5) = 52.26 → × 1.1 = 57.486 → 57.49
    expect(r).toMatchObject({ dailyRate: 364.1, otRate: 57.49 });
  });

  test('a manual rate override is never uplifted', async () => {
    const client = fakeClient({ daily_rate: '500' });
    const r = await calc.resolveRates(client, { trade: 'x', rank: 'y', weekEndingDate: '2026-11-22', rateOverride: '400', multiplier: 1.1 });
    expect(r).toMatchObject({ dailyRate: 400, otRate: 63.16, multiplier: 1, source: 'override' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('meals, mileage and travel are not uplifted; Sunday is uplifted day × 2', () => {
    const rows = calc.normaliseEntries('ts', [
      { day_of_week: 'Monday', full_day_worked: true, travel: '10', meal_allowance_lunch: '10' },
      { day_of_week: 'Sunday', full_day_worked: true, mileage: '5' },
    ]);
    const t = calc.computeTotals(rows, { dailyRate: 110, otRate: 0 }, { employment_status: 'paye' });
    expect(t).toMatchObject({ weekly_rate: 110, seventh_day_payment: 220, meal_allowance_total: 10, mileage_and_travel: 15, gross_total: 355 });
  });

  test.each([
    [{ rate_card_type: 'standard', commercial_uplift_pct: 10 }, 1],
    [{ rate_card_type: 'commercial', commercial_uplift_pct: 10 }, 1.1],
    [{ rate_card_type: 'commercial', commercial_uplift_pct: '12.5' }, 1.125],
    [{ rate_card_type: 'commercial', commercial_uplift_pct: null }, 1.1],      // unset → default 10%
    [{ rate_card_type: 'commercial', commercial_uplift_pct: 'abc' }, 1.1],    // invalid → default
    [{}, 1],
    [null, 1],
  ])('multiplier for %j is %d', (row, expected) => {
    expect(calc.rateMultiplierFor(row)).toBe(expected);
  });

  test('pence-exact rounding matches Postgres ROUND(numeric, 2)', () => {
    expect(calc.applyMultiplier(59.05, 1.1)).toBe(64.96); // 64.955 → 64.96 (float would give 64.95)
    expect(calc.applyMultiplier(66.01, 1.125)).toBe(74.26);
    expect(calc.applyMultiplier(100, 1)).toBe(100);
  });
});
