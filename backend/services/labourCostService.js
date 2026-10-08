/**
 * LabourCostService — writes finalised-timesheet labour data into cost_report_entries
 * when a pay run is processed.
 *
 * Must be called within an active database transaction (pass the pg client).
 *
 * Mapping:
 *   net_amount   = timesheet.gross_total  (pay amount before VAT)
 *   vat          = timesheet.vat          (20% for VAT-registered self-employed, else 0)
 *   gross_amount = timesheet.grand_total  (final pay inc. VAT)
 */

// BECTU rate years run 1 July → 30 June
const getRateYear = (weekEndingDate) => {
  const d     = new Date(weekEndingDate + 'T00:00:00Z');
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const start = month >= 7 ? year : year - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
};

const DAY_MAP = {
  Monday: 'day_monday', Tuesday: 'day_tuesday', Wednesday: 'day_wednesday',
  Thursday: 'day_thursday', Friday: 'day_friday', Saturday: 'day_saturday', Sunday: 'day_sunday',
};

/**
 * Record one cost_report_entry per finalised timesheet for the given week.
 * Called atomically inside the processPayRun transaction.
 */
const recordWeeklyLabour = async (weekEndingDate, productionId, client) => {
  const { rows: timesheets } = await client.query(
    `SELECT t.id, t.production_id, t.crew_member_id, t.week_ending_date,
            t.gross_total, t.vat, t.grand_total,
            cm.crew_trade, cm.crew_rank, cm.account_code
     FROM timesheets t
     JOIN crew_members cm ON t.crew_member_id = cm.id
     WHERE t.production_id    = $1
       AND t.week_ending_date = $2
       AND t.status           = 'finalised'`,
    [productionId, weekEndingDate]
  );

  for (const ts of timesheets) {
    // Fetch daily entries for day flags and OT total
    const { rows: entries } = await client.query(
      `SELECT day_of_week, full_day_worked, overtime_hours, set_number
       FROM timesheet_entries WHERE timesheet_id = $1`,
      [ts.id]
    );

    const dayFlags = { day_monday: false, day_tuesday: false, day_wednesday: false,
                       day_thursday: false, day_friday: false, day_saturday: false, day_sunday: false };
    let totalDays = 0;
    let otHours   = 0;
    let setCode   = null;

    for (const e of entries) {
      const col = DAY_MAP[e.day_of_week];
      if (col) dayFlags[col] = !!e.full_day_worked;
      if (e.full_day_worked) totalDays++;
      otHours += parseFloat(e.overtime_hours || 0);
      if (e.set_number && !setCode) setCode = e.set_number;
    }

    // Fetch BECTU rate in effect at week_ending_date; fall back to most-recent
    const rateYear = getRateYear(weekEndingDate);
    let { rows: [rateRow] } = await client.query(
      `SELECT daily_rate, overtime_rate FROM bectu_rates
       WHERE trade = $1 AND rank = $2 AND rate_year = $3`,
      [ts.crew_trade, ts.crew_rank, rateYear]
    );
    if (!rateRow) {
      ({ rows: [rateRow] } = await client.query(
        `SELECT daily_rate, overtime_rate FROM bectu_rates
         WHERE trade = $1 AND rank = $2 ORDER BY rate_year DESC LIMIT 1`,
        [ts.crew_trade, ts.crew_rank]
      ));
    }

    // Skip if a non-deleted entry already exists for this timesheet
    const { rows: [existing] } = await client.query(
      `SELECT id FROM cost_report_entries
       WHERE source_id = $1 AND entry_type = 'labour' AND deleted_at IS NULL`,
      [ts.id]
    );
    if (existing) continue;

    await client.query(
      `INSERT INTO cost_report_entries
         (production_id, entry_type, source_id, source_type,
          crew_member_id, trade, rank, week_ending_date,
          day_monday, day_tuesday, day_wednesday, day_thursday,
          day_friday, day_saturday, day_sunday,
          total_days, ot_hours, daily_rate, ot_rate,
          net_amount, vat, gross_amount, set_code, date, account_code)
       VALUES ($1,'labour',$2,'timesheet',
               $3,$4,$5,$6,
               $7,$8,$9,$10,$11,$12,$13,
               $14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23)`,
      [
        ts.production_id, ts.id,
        ts.crew_member_id, ts.crew_trade, ts.crew_rank, ts.week_ending_date,
        dayFlags.day_monday, dayFlags.day_tuesday, dayFlags.day_wednesday, dayFlags.day_thursday,
        dayFlags.day_friday, dayFlags.day_saturday, dayFlags.day_sunday,
        totalDays, Math.round(otHours * 100) / 100,
        parseFloat(rateRow?.daily_rate    || 0),
        parseFloat(rateRow?.overtime_rate || 0),
        parseFloat(ts.gross_total  || 0),
        parseFloat(ts.vat          || 0),
        parseFloat(ts.grand_total  || 0),
        setCode,
        weekEndingDate,
        ts.account_code || null,
      ]
    );
  }
};

/**
 * Soft-delete all labour entries for a given week (MD re-open edge case).
 * Must be called within an active transaction.
 */
const softDeleteLabourEntries = async (weekEndingDate, productionId, client) => {
  await client.query(
    `UPDATE cost_report_entries
     SET deleted_at = NOW()
     WHERE entry_type  = 'labour'
       AND source_type = 'timesheet'
       AND deleted_at  IS NULL
       AND source_id IN (
         SELECT id FROM timesheets
         WHERE production_id    = $1
           AND week_ending_date = $2
       )`,
    [productionId, weekEndingDate]
  );
};

module.exports = { recordWeeklyLabour, softDeleteLabourEntries };
