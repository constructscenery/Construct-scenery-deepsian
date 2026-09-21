const db                           = require('../config/db');
const { sendEmail, templates }     = require('../config/email');
const fileStorage                  = require('../services/fileStorage');
const { generateTimesheetPdf }     = require('../services/timesheetPdfService');
const { generateVerificationPack } = require('../services/verificationPackService');
const { generateTimesheetListPdf } = require('../services/timesheetListPdfService');
const { logAudit }                 = require('../services/auditService');

// ─── Helper: record an outbound email to email_log ────────────────────────────
const logEmail = async (module, relatedRecordId, recipientEmail, recipientName, success, errorMessage = null) => {
  try {
    await db.query(
      `INSERT INTO email_log (module, related_record_id, recipient_email, recipient_name, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [module, relatedRecordId, recipientEmail, recipientName, success, errorMessage || null]
    );
  } catch (logErr) {
    console.error('email_log insert failed:', logErr.message);
  }
};

const STANDARD_START = '07:30';
const MEAL_RATES     = { breakfast: 10.50, lunch: 14.00, supper: 10.50 };

const toAmount = (value) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const summarizeTimesheetEntries = (entries = []) => entries.reduce((summary, entry) => {
  summary.overtime_hours_total += toAmount(entry.overtime_hours);
  summary.travel_total         += toAmount(entry.travel);
  summary.mileage_total        += toAmount(entry.mileage);
  summary.per_diem_total       += toAmount(entry.per_diem);
  summary.ad_hoc_total         += toAmount(entry.ad_hoc_reimbursement);
  summary.food_total           += toAmount(
    entry.meal_allowance_breakfast != null ? entry.meal_allowance_breakfast : (entry.meal_breakfast ? MEAL_RATES.breakfast : 0)
  ) + toAmount(
    entry.meal_allowance_lunch != null ? entry.meal_allowance_lunch : (entry.meal_lunch ? MEAL_RATES.lunch : 0)
  ) + toAmount(
    entry.meal_allowance_supper != null ? entry.meal_allowance_supper : (entry.meal_supper ? MEAL_RATES.supper : 0)
  );
  if (entry.full_day_worked) summary.days_worked += 1;
  return summary;
}, {
  overtime_hours_total: 0,
  travel_total: 0,
  mileage_total: 0,
  per_diem_total: 0,
  ad_hoc_total: 0,
  food_total: 0,
  days_worked: 0,
});

const enrichTimesheetSummary = (ts, entries = []) => {
  const source = entries.length ? summarizeTimesheetEntries(entries) : {
    overtime_hours_total: toAmount(ts.overtime_hours_total),
    travel_total:         toAmount(ts.travel_total),
    mileage_total:        toAmount(ts.mileage_total),
    per_diem_total:       toAmount(ts.per_diem_total),
    ad_hoc_total:         toAmount(ts.ad_hoc_total),
    food_total:           toAmount(ts.food_total),
    days_worked:          toAmount(ts.days_worked),
  };
  const dailyRate      = toAmount(ts.daily_rate);
  const overtimeRate   = toAmount(ts.overtime_rate);

  const weeklyRate     = toAmount(ts.weekly_rate) || (dailyRate * source.days_worked);
  const sixthDayPay    = toAmount(ts.sixth_day_payment);
  const seventhDayPay  = toAmount(ts.seventh_day_payment);
  const overtimeAmount = toAmount(ts.overtime_amount) || (source.overtime_hours_total * overtimeRate);

  const calculatedNet  = weeklyRate + sixthDayPay + seventhDayPay + overtimeAmount + source.travel_total + source.mileage_total + source.per_diem_total + source.ad_hoc_total + source.food_total;
  const netTotalAmount = toAmount(ts.gross_total) || calculatedNet;

  return {
    ...ts,
    overtime_hours_total: source.overtime_hours_total.toFixed(2),
    overtime_amount:      overtimeAmount.toFixed(2),
    travel_amount:        source.travel_total.toFixed(2),
    mileage_amount:       source.mileage_total.toFixed(2),
    per_diem_amount:      source.per_diem_total.toFixed(2),
    ad_hoc_amount:        source.ad_hoc_total.toFixed(2),
    food_amount:          source.food_total.toFixed(2),
    net_total_amount:     netTotalAmount.toFixed(2),
    days_worked:          source.days_worked ?? ts.days_worked ?? 0,
  };
};

// BECTU rate years run 1 July → 30 June (e.g. '2025/26' covers Jul 2025 – Jun 2026).
// This maps a week_ending_date to the matching rate_year string.
const getRateYear = (weekEndingDate) => {
  const d     = new Date(weekEndingDate + 'T00:00:00Z');
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-indexed
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
};

const calcTimeOut = (overtimeHours = 0) => {
  const endMinutes = 15 * 60 + 45 + Math.round(overtimeHours * 60); // 15:45 + OT
  return `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
};

// ─── Helper: build shared WHERE conditions for timesheet list/export queries ──
const buildTimesheetFilterConditions = (query) => {
  const conditions = [];
  const params     = [];
  let   i          = 1;

  if (query.production_id)    { conditions.push(`t.production_id = $${i++}`);                    params.push(query.production_id); }
  if (query.crew_member_id)   { conditions.push(`t.crew_member_id = $${i++}`);                   params.push(query.crew_member_id); }
  if (query.week_ending_date) { conditions.push(`t.week_ending_date = $${i++}`);                 params.push(query.week_ending_date); }
  if (query.status)           { conditions.push(`t.status = $${i++}`);                           params.push(query.status); }
  if (query.date_from)        { conditions.push(`t.week_ending_date >= $${i++}`);                params.push(query.date_from); }
  if (query.date_to)          { conditions.push(`t.week_ending_date <= $${i++}`);                params.push(query.date_to); }
  if (query.crew_trade)       { conditions.push(`cm.crew_trade = $${i++}`);                      params.push(query.crew_trade); }
  if (query.crew_rank)        { conditions.push(`cm.crew_rank = $${i++}`);                       params.push(query.crew_rank); }
  if (query.crew_number)      { conditions.push(`cm.crew_number ILIKE $${i++}`);                 params.push(`%${query.crew_number}%`); }
  if (query.crew_member_name) { conditions.push(`(cm.first_name || ' ' || cm.last_name) ILIKE $${i++}`); params.push(`%${query.crew_member_name}%`); }

  if (query.invoice_attached === 'yes') conditions.push(`t.invoice_attachment_url IS NOT NULL`);
  if (query.invoice_attached === 'no')  conditions.push(`t.invoice_attachment_url IS NULL`);

  // Pay-run status: does a processed pay_run exist that includes this timesheet?
  if (query.pay_run_status === 'processed') {
    conditions.push(`EXISTS (
      SELECT 1 FROM pay_run_items pri2
      JOIN pay_runs pr2 ON pr2.id = pri2.pay_run_id
      WHERE pri2.timesheet_id = t.id AND pr2.status = 'processed'
    )`);
  } else if (query.pay_run_status === 'not_processed') {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM pay_run_items pri2
      JOIN pay_runs pr2 ON pr2.id = pri2.pay_run_id
      WHERE pri2.timesheet_id = t.id AND pr2.status = 'processed'
    )`);
  }

  if (query.include_archived !== 'true') {
    conditions.push(`p.status != 'archived'`);
  }

  return { conditions, params };
};

// ─── Helper: human-readable filter summary for PDF export header ──────────────
const buildTimesheetFilterSummary = (query) => {
  const parts = [];
  if (query.crew_member_name) parts.push(`Name: ${query.crew_member_name}`);
  if (query.crew_number)      parts.push(`Crew No.: ${query.crew_number}`);
  if (query.crew_trade)       parts.push(`Trade: ${query.crew_trade}`);
  if (query.crew_rank)        parts.push(`Rank: ${query.crew_rank}`);
  if (query.date_from || query.date_to)
    parts.push(`Week: ${query.date_from || '*'} → ${query.date_to || '*'}`);
  if (query.status)           parts.push(`Status: ${query.status}`);
  if (query.invoice_attached) parts.push(`Invoice: ${query.invoice_attached}`);
  if (query.pay_run_status)   parts.push(`Pay run: ${query.pay_run_status.replace('_', ' ')}`);
  return parts.length ? parts.join('  ·  ') : null;
};

// ─── GET /api/timesheets ──────────────────────────────────────────────────────
const getAllTimesheets = async (req, res) => {
  try {
    const { conditions, params } = buildTimesheetFilterConditions(req.query);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT t.*,
              cm.id AS cm_id, cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
              p.id AS prod_id, p.name AS prod_name
              , COALESCE(te_agg.overtime_hours_total, 0) AS overtime_hours_total
              , COALESCE(te_agg.days_worked, 0)::int   AS days_worked
              , COALESCE(te_agg.mileage_total, 0)        AS mileage_total
              , COALESCE(te_agg.per_diem_total, 0)       AS per_diem_total
              , COALESCE(te_agg.ad_hoc_total, 0)         AS ad_hoc_total
              , COALESCE(te_agg.food_total, 0)           AS food_total
              , te_agg.attendance_days                   AS attendance_days
              , (
                  SELECT br.overtime_rate
                  FROM bectu_rates br
                  WHERE br.trade = cm.crew_trade
                    AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
                  ORDER BY br.effective_from DESC
                  LIMIT 1
                ) AS overtime_rate
       FROM   timesheets t
       JOIN   crew_members cm ON t.crew_member_id = cm.id
       JOIN   productions p  ON t.production_id   = p.id
       LEFT JOIN (
         SELECT te.timesheet_id,
                COALESCE(SUM(te.overtime_hours), 0) AS overtime_hours_total,
                COUNT(*) FILTER (WHERE te.full_day_worked = true) AS days_worked,
                COALESCE(SUM(te.travel), 0)         AS travel_total,
                COALESCE(SUM(te.mileage), 0)        AS mileage_total,
                COALESCE(SUM(te.per_diem), 0)       AS per_diem_total,
                COALESCE(SUM(te.ad_hoc_reimbursement), 0) AS ad_hoc_total,
                COALESCE(SUM(
                  COALESCE(te.meal_allowance_breakfast, CASE WHEN te.meal_breakfast THEN 10.50 ELSE 0 END)
                  + COALESCE(te.meal_allowance_lunch, CASE WHEN te.meal_lunch THEN 14.00 ELSE 0 END)
                  + COALESCE(te.meal_allowance_supper, CASE WHEN te.meal_supper THEN 10.50 ELSE 0 END)
                ), 0) AS food_total,
                JSON_AGG(JSON_BUILD_OBJECT('day', te.day_of_week, 'worked', te.full_day_worked)) AS attendance_days
         FROM timesheet_entries te
         GROUP BY te.timesheet_id
       ) te_agg ON te_agg.timesheet_id = t.id
       ${where}
       ORDER BY t.week_ending_date DESC`,
      params
    );
    res.json(rows.map(row => enrichTimesheetSummary(row)));
  } catch (err) {
    console.error('getAllTimesheets:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Shared export query ──────────────────────────────────────────────────────
// Fetches timesheets with computed columns needed for CSV/PDF export:
// days_worked, ot_hours_total, pay_run_status, withholding, pay_run_amount.
const fetchTimesheetsForExport = async (query) => {
  const { conditions, params } = buildTimesheetFilterConditions(query);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT t.*,
            cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
            cm.employment_status, cm.paye_withholding_rate,
            p.name AS prod_name,
            COALESCE(te_agg.days_worked, 0)::int   AS days_worked,
            COALESCE(te_agg.ot_hours_total, 0)     AS ot_hours_total,
            pr.status                               AS pay_run_status,
            pri.net_amount                          AS pay_run_net_amount
     FROM timesheets t
     JOIN crew_members cm ON t.crew_member_id = cm.id
     JOIN productions  p  ON t.production_id  = p.id
     LEFT JOIN (
       SELECT timesheet_id,
              COUNT(*) FILTER (WHERE full_day_worked = true) AS days_worked,
              SUM(overtime_hours)                            AS ot_hours_total
       FROM timesheet_entries
       GROUP BY timesheet_id
     ) te_agg ON te_agg.timesheet_id = t.id
     LEFT JOIN pay_run_items pri ON pri.timesheet_id = t.id
     LEFT JOIN pay_runs       pr  ON pr.id = pri.pay_run_id AND pr.status = 'processed'
     ${where}
     ORDER BY t.week_ending_date DESC, cm.last_name, cm.first_name`,
    params
  );
  return rows;
};

// ─── GET /api/timesheets/export/csv ───────────────────────────────────────────
// CSV columns (ticket spec): Crew Number, Name, Trade, Rank, Employment Type,
// Week Ending, Days Worked, OT Hours, Gross Total, Withholding, Pay Run Amount,
// Invoice Attached, Status
const exportTimesheetsCSV = async (req, res) => {
  try {
    const rows = await fetchTimesheetsForExport(req.query);
    const esc  = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [
      'Crew Number', 'Name', 'Trade', 'Rank', 'Employment Type',
      'Week Ending', 'Days Worked', 'OT Hours', 'Gross Total',
      'Withholding', 'Pay Run Amount', 'Invoice Attached', 'Status',
    ];
    const lines = [header.map(esc).join(',')];

    rows.forEach(r => {
      const gross       = parseFloat(r.grand_total || 0);
      const isPAYE      = r.employment_status === 'paye';
      const withholdRate = isPAYE ? parseFloat(r.paye_withholding_rate || 0) / 100 : 0;
      const withholding  = (gross * withholdRate).toFixed(2);
      const payRunAmt    = r.pay_run_net_amount != null
        ? parseFloat(r.pay_run_net_amount).toFixed(2)
        : (gross - parseFloat(withholding)).toFixed(2);

      lines.push([
        r.crew_number,
        `${r.first_name} ${r.last_name}`,
        r.crew_trade,
        r.crew_rank,
        r.employment_status === 'paye' ? 'PAYE' : 'Self-Employed',
        r.week_ending_date,
        r.days_worked,
        parseFloat(r.ot_hours_total || 0).toFixed(1),
        gross.toFixed(2),
        withholding,
        payRunAmt,
        r.invoice_attachment_url ? 'Yes' : 'No',
        r.status,
      ].map(esc).join(','));
    });

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="timesheets-${date}.csv"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('exportTimesheetsCSV:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/timesheets/export/pdf ───────────────────────────────────────────
// A4 portrait, branded list PDF with applied-filters summary in the header.
const exportTimesheetsPDF = async (req, res) => {
  try {
    const rows          = await fetchTimesheetsForExport(req.query);
    const filterSummary = buildTimesheetFilterSummary(req.query);
    const pdfBuffer     = await generateTimesheetListPdf(rows, filterSummary);

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="timesheets-${date}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('exportTimesheetsPDF:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets ─────────────────────────────────────────────────────
const createTimesheet = async (req, res) => {
  const { crew_member_id, production_id, week_ending_date } = req.body;
  if (!crew_member_id || !production_id || !week_ending_date)
    return res.status(400).json({ error: 'crew_member_id, production_id, and week_ending_date are required' });

  // Validate week_ending_date is a Sunday
  const wedDate = new Date(week_ending_date + 'T00:00:00Z');
  if (isNaN(wedDate.getTime()) || wedDate.getUTCDay() !== 0)
    return res.status(400).json({ error: 'week_ending_date must be a Sunday (YYYY-MM-DD)' });

  try {
    // STATUS GATE — block timesheets on pre_production, complete, archived
    const { rows: [prod] } = await db.query(
      'SELECT status FROM productions WHERE id = $1', [production_id]
    );
    if (!prod) return res.status(400).json({ error: 'Production not found' });
    if (prod.status === 'pre_production')
      return res.status(400).json({ error: 'PRODUCTION_NOT_ACTIVE', message: 'This production is still in Pre Production — change its status to Active Build before creating timesheets' });
    if (prod.status === 'complete')
      return res.status(400).json({ error: 'PRODUCTION_NOT_ACTIVE', message: 'Cannot create timesheets on a completed production' });
    if (prod.status === 'archived')
      return res.status(400).json({ error: 'PRODUCTION_NOT_ACTIVE', message: 'Cannot create timesheets on an archived production' });

    // GATEWAY RULE — crew member must exist and be active
    const { rows: [crewAny] } = await db.query(
      'SELECT id, first_name, last_name, is_active FROM crew_members WHERE id = $1',
      [crew_member_id]
    );
    if (!crewAny)
      return res.status(400).json({ error: 'CREW_NOT_FOUND', message: 'Crew member not found. Register them in the Crew Database.' });
    if (!crewAny.is_active)
      return res.status(400).json({ error: 'CREW_INACTIVE', message: `${crewAny.first_name} ${crewAny.last_name} is deactivated. Reactivate them in the Crew Database first.` });

    const crew = crewAny;

    // Prevent duplicate timesheet
    const { rows: [existing] } = await db.query(
      `SELECT id FROM timesheets
       WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3`,
      [crew_member_id, production_id, week_ending_date]
    );
    if (existing)
      return res.status(409).json({ error: 'DUPLICATE_TIMESHEET', message: 'A timesheet already exists for this crew member, production, and week' });

    const { rows: [ts] } = await db.query(
      `INSERT INTO timesheets (crew_member_id, production_id, week_ending_date, status, created_by)
       VALUES ($1,$2,$3,'draft',$4)
       RETURNING *`,
      [crew_member_id, production_id, week_ending_date, req.user.id]
    );

    // ── Roll-forward: copy entries from previous week if they exist ───────────
    try {
      const prevSunday = new Date(week_ending_date + 'T00:00:00Z');
      prevSunday.setUTCDate(prevSunday.getUTCDate() - 7);
      const prevDate = prevSunday.toISOString().split('T')[0];

      const { rows: [prevTs] } = await db.query(
        `SELECT id FROM timesheets WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3`,
        [crew_member_id, production_id, prevDate]
      );

      if (prevTs) {
        const { rows: prevEntries } = await db.query(
          'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
          [prevTs.id]
        );
        if (prevEntries.length) {
          const vph = prevEntries.map((_, idx) => {
            const b = idx * 17;
            return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17})`;
          }).join(',');

          const flatValues = prevEntries.flatMap(e => {
            // Shift the date forward by 7 days
            const d = new Date(String(e.date).split('T')[0] + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + 7);
            const newDate = d.toISOString().split('T')[0];
            return [
              ts.id, newDate, e.day_of_week, e.full_day_worked, parseFloat(e.overtime_hours || 0),
              e.set_number || null, e.site || null, parseFloat(e.travel || 0),
              e.meal_breakfast || false, e.meal_lunch || false, e.meal_supper || false,
              e.meal_allowance_breakfast != null ? parseFloat(e.meal_allowance_breakfast) : null,
              e.meal_allowance_lunch     != null ? parseFloat(e.meal_allowance_lunch)     : null,
              e.meal_allowance_supper    != null ? parseFloat(e.meal_allowance_supper)    : null,
              parseFloat(e.mileage || 0), parseFloat(e.per_diem || 0), parseFloat(e.ad_hoc_reimbursement || 0),
            ];
          });

          await db.query(
            `INSERT INTO timesheet_entries
               (timesheet_id, date, day_of_week, full_day_worked, overtime_hours,
                set_number, site, travel, meal_breakfast, meal_lunch, meal_supper,
                meal_allowance_breakfast, meal_allowance_lunch, meal_allowance_supper,
                mileage, per_diem, ad_hoc_reimbursement)
             VALUES ${vph}`,
            flatValues
          );
        }
      }
    } catch (rollErr) {
      // Roll-forward failure is non-fatal — timesheet still created with empty entries
      console.warn('Roll-forward copy failed (non-fatal):', rollErr.message);
    }

    // Return with joined crew and production info
    const { rows: [full] } = await db.query(
      `SELECT t.*,
              cm.id AS cm_id, cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
              cm.employment_status, cm.company_name, cm.paye_withholding_rate,
              p.id AS prod_id, p.name AS prod_name
       FROM   timesheets t
       JOIN   crew_members cm ON t.crew_member_id = cm.id
       JOIN   productions p  ON t.production_id   = p.id
       WHERE  t.id = $1`,
      [ts.id]
    );
    res.status(201).json(full);
  } catch (err) {
    console.error('createTimesheet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/timesheets/:id ──────────────────────────────────────────────────
const getTimesheetById = async (req, res) => {
  try {
    const { rows: [ts] } = await db.query(
      `SELECT t.*,
              cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
              cm.employment_status, cm.company_name, cm.paye_withholding_rate,
              cm.vat_registration_number,
              p.id AS prod_id, p.name AS prod_name,
              (SELECT br.daily_rate   FROM bectu_rates br
               WHERE  br.trade = cm.crew_trade
               AND    br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER  BY br.effective_from DESC LIMIT 1) AS daily_rate,
              (SELECT br.overtime_rate FROM bectu_rates br
               WHERE  br.trade = cm.crew_trade
               AND    br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER  BY br.effective_from DESC LIMIT 1) AS overtime_rate
       FROM   timesheets t
       JOIN   crew_members cm ON t.crew_member_id = cm.id
       JOIN   productions p  ON t.production_id   = p.id
       WHERE  t.id = $1`,
      [req.params.id]
    );
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });

    const { rows: entries } = await db.query(
      'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
      [req.params.id]
    );

    ts.timesheet_entries = entries.map(e => ({
      ...e,
      time_in:  e.full_day_worked ? STANDARD_START : null,
      time_out: e.full_day_worked ? calcTimeOut(e.overtime_hours) : null,
    }));

    res.json(enrichTimesheetSummary(ts, entries));
  } catch (err) {
    console.error('getTimesheetById:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/timesheets/:id/entries — save daily entries + recalculate totals
// Gap 3: accepts rank_override and rate_override at the timesheet level.
//   rank_override: overrides crew rank for this week's rate lookup (does not affect Crew DB).
//   rate_override: directly sets daily_rate for this week (skips rate card lookup).
// Gap 6: each entry accepts meal_allowance_breakfast, meal_allowance_lunch,
//   meal_allowance_supper as explicit £ amounts (null/blank, 5, or 10).
const saveEntries = async (req, res) => {
  const { entries, rank_override, rate_override } = req.body;
  if (!Array.isArray(entries) || !entries.length)
    return res.status(400).json({ error: 'entries array is required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Get timesheet with crew details
    const { rows: [ts] } = await client.query(
      `SELECT t.*, cm.crew_trade, cm.crew_rank, cm.employment_status, cm.vat_registration_number, cm.email
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!ts) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Timesheet not found' }); }
    if (ts.status === 'finalised') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Finalised timesheets are locked and cannot be edited' });
    }

    // Gap 3: persist rank/rate override fields on the timesheet row
    const effectiveRank = rank_override || ts.crew_rank;
    if (rank_override !== undefined || rate_override !== undefined) {
      await client.query(
        `UPDATE timesheets SET rank_override = $1, rate_override = $2 WHERE id = $3`,
        [rank_override || null, rate_override ? parseFloat(rate_override) : null, req.params.id]
      );
    }

    // Rate resolution: rate_override → rank_override rate → default rank rate
    let dailyRate, otRate;
    if (rate_override != null) {
      dailyRate = parseFloat(rate_override);
      otRate    = 0; // OT rate not overridden separately; caller can set it via entries if needed
    } else {
      const rateYear = getRateYear(ts.week_ending_date);
      let { rows: [rateRow] } = await client.query(
        'SELECT daily_rate, overtime_rate FROM bectu_rates WHERE trade = $1 AND rank = $2 AND rate_year = $3',
        [ts.crew_trade, effectiveRank, rateYear]
      );
      if (!rateRow) {
        ({ rows: [rateRow] } = await client.query(
          'SELECT daily_rate, overtime_rate FROM bectu_rates WHERE trade = $1 AND rank = $2 ORDER BY effective_from DESC LIMIT 1',
          [ts.crew_trade, effectiveRank]
        ));
      }
      dailyRate = parseFloat(rateRow?.daily_rate || 0);
      otRate    = parseFloat(rateRow?.overtime_rate || 0);
    }

    // Delete old entries and re-insert
    await client.query('DELETE FROM timesheet_entries WHERE timesheet_id = $1', [req.params.id]);

    const rows = entries.map(e => ({
      timesheet_id:              req.params.id,
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

    if (rows.length) {
      const valuePlaceholders = rows.map((_, idx) => {
        const base = idx * 17;
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17})`;
      }).join(',');

      await client.query(
        `INSERT INTO timesheet_entries
           (timesheet_id, date, day_of_week, full_day_worked, overtime_hours,
            set_number, site, travel, meal_breakfast, meal_lunch, meal_supper,
            meal_allowance_breakfast, meal_allowance_lunch, meal_allowance_supper,
            mileage, per_diem, ad_hoc_reimbursement)
         VALUES ${valuePlaceholders}`,
        rows.flatMap(r => [
          r.timesheet_id, r.date, r.day_of_week, r.full_day_worked, r.overtime_hours,
          r.set_number, r.site, r.travel, r.meal_breakfast, r.meal_lunch, r.meal_supper,
          r.meal_allowance_breakfast, r.meal_allowance_lunch, r.meal_allowance_supper,
          r.mileage, r.per_diem, r.ad_hoc_reimbursement,
        ])
      );
    }

    // ─── Weekly totals ────────────────────────────────────────────────────────
    const worked    = rows.filter(e => e.full_day_worked);
    const saturday  = rows.find(e => e.day_of_week === 'Saturday'  && e.full_day_worked);
    const sunday    = rows.find(e => e.day_of_week === 'Sunday'    && e.full_day_worked);
    const stdDays   = worked.filter(e => !['Saturday', 'Sunday'].includes(e.day_of_week)).length;

    const weeklyRate        = dailyRate * stdDays;
    const sixthDayPayment   = saturday ? dailyRate * 1.5 : 0;
    const seventhDayPayment = sunday   ? dailyRate * 2.0 : 0;
    const totalOT           = rows.reduce((s, e) => s + e.overtime_hours, 0);
    const overtimeAmount    = totalOT * otRate;

    // Gap 6: use explicit amounts if provided; fall back to legacy boolean+MEAL_RATES
    const mealAllowance = rows.reduce((s, e) => {
      const b = e.meal_allowance_breakfast != null ? e.meal_allowance_breakfast : (e.meal_breakfast ? MEAL_RATES.breakfast : 0);
      const l = e.meal_allowance_lunch     != null ? e.meal_allowance_lunch     : (e.meal_lunch     ? MEAL_RATES.lunch     : 0);
      const sup = e.meal_allowance_supper  != null ? e.meal_allowance_supper    : (e.meal_supper    ? MEAL_RATES.supper    : 0);
      return s + b + l + sup;
    }, 0);

    const mileageAndTravel = rows.reduce((s, e) => s + e.travel + e.mileage + e.per_diem + e.ad_hoc_reimbursement, 0);
    const grossTotal       = weeklyRate + sixthDayPayment + seventhDayPayment + overtimeAmount + mealAllowance + mileageAndTravel;
    const vatRegistered    = ts.employment_status === 'self_employed' && !!ts.vat_registration_number;
    const vat              = vatRegistered ? grossTotal * 0.20 : 0;
    const grandTotal       = grossTotal + vat;

    const { rows: [updated] } = await client.query(
      `UPDATE timesheets SET
         weekly_rate = $1, sixth_day_payment = $2, seventh_day_payment = $3,
         overtime_amount = $4, meal_allowance_total = $5, mileage_and_travel = $6,
         vat = $7, gross_total = $8, grand_total = $9,
         amended_at = CASE WHEN status = 'distributed' THEN NOW() ELSE amended_at END
       WHERE id = $10
       RETURNING *`,
      [weeklyRate, sixthDayPayment, seventhDayPayment, overtimeAmount,
       mealAllowance, mileageAndTravel, vat, grossTotal, grandTotal, req.params.id]
    );

    await client.query('COMMIT');

    if (ts.status === 'distributed' && ts.email) {
      // Re-fetch fully populated timesheet for the PDF and email
      const { rows: [fullTs] } = await db.query(
        `SELECT t.*, cm.first_name, cm.last_name, cm.email, cm.crew_number,
                cm.crew_trade, cm.crew_rank, cm.employment_status, cm.company_name,
                p.name AS prod_name
         FROM timesheets t
         JOIN crew_members cm ON t.crew_member_id = cm.id
         JOIN productions p   ON t.production_id  = p.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (fullTs) {
        sendTimesheetEmail(fullTs, rows).catch(err => {
          console.error('saveEntries resend email failed:', err);
        });
      }
    }
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('saveEntries:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── Helper: send one timesheet email with PDF attachment ─────────────────────
const sendTimesheetEmail = async (ts, entries) => {
  const crewName   = `${ts.first_name} ${ts.last_name}`;
  const daysWorked = entries.filter(e => e.full_day_worked).length;
  const pdfBuffer  = await generateTimesheetPdf(ts, entries);

  await sendEmail({
    replyTo:     'invoice@constructscenery.co.uk',
    to:          ts.email,
    ...templates.timesheetDistributed(crewName, ts.week_ending_date, ts.prod_name, daysWorked, ts.grand_total),
    attachments: [{ filename: `Timesheet-${ts.week_ending_date}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
};

// ─── POST /api/timesheets/:id/submit ──────────────────────────────────────────
const submitTimesheet = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `UPDATE timesheets SET status = 'submitted' WHERE id = $1 AND status = 'draft' RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Timesheet not found or not in draft status' });
    res.json({ message: 'Timesheet submitted', timesheet: rows[0] });
  } catch (err) {
    console.error('submitTimesheet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/bulk-distribute ─────────────────────────────────────
// Sends all DRAFT timesheets for the week. Status advances to distributed only
// on successful email send. Already-distributed timesheets are skipped entirely.
const bulkDistribute = async (req, res) => {
  const { week_ending_date, production_id } = req.body;
  if (!week_ending_date)
    return res.status(400).json({ error: 'week_ending_date is required' });

  try {
    const conditions = ["t.week_ending_date = $1", "t.status = 'submitted'"];  // TimesheetStatus.SUBMITTED
    const params     = [week_ending_date];
    if (production_id) { conditions.push(`t.production_id = $2`); params.push(production_id); }

    const { rows: timesheets } = await db.query(
      `SELECT t.*,
              cm.first_name, cm.last_name, cm.email, cm.crew_number,
              cm.crew_trade, cm.crew_rank, cm.employment_status, cm.company_name,
              p.name AS prod_name
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id  = p.id
       WHERE ${conditions.join(' AND ')}`,
      params
    );

    if (!timesheets.length)
      return res.status(400).json({ error: 'No submitted timesheets found for this week' });

    const results = { sent: [], failed: [], no_email: [] };

    const settled = await Promise.allSettled(timesheets.map(async ts => {
      const crewName = `${ts.first_name} ${ts.last_name}`;

      if (!ts.email) {
        await db.query(`UPDATE timesheets SET status = 'distributed' WHERE id = $1`, [ts.id]);
        results.no_email.push(crewName);
        return;
      }

      const { rows: entries } = await db.query(
        'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
        [ts.id]
      );

      let emailOk = false;
      try {
        await sendTimesheetEmail(ts, entries);
        await logEmail('timesheet_distribution', ts.id, ts.email, crewName, true);
        emailOk = true;
      } catch (emailErr) {
        console.error(`Timesheet email failed for ${crewName}:`, emailErr.message);
        await logEmail('timesheet_distribution', ts.id, ts.email, crewName, false, emailErr.message);
      }

      // DB update happens BEFORE we record the outcome — ensures the count only
      // reflects rows that actually changed in the DB. If this throws, Promise.allSettled
      // captures the rejection and the crew member lands in results.failed below.
      await db.query(`UPDATE timesheets SET status = 'distributed' WHERE id = $1`, [ts.id]);

      // Only record outcome after confirmed DB write
      if (emailOk) {
        results.sent.push(crewName);
      } else {
        results.failed.push(crewName);
      }
    }));

    // Any promise that rejected (e.g. DB timeout on the UPDATE) is a silent failure —
    // log it and surface the crew member in the failed list so the frontend shows it.
    settled.forEach((result, i) => {
      if (result.status === 'rejected') {
        const crewName = `${timesheets[i].first_name} ${timesheets[i].last_name}`;
        console.error(`bulkDistribute: DB update failed for ${crewName}:`, result.reason?.message ?? result.reason);
        if (!results.sent.includes(crewName) && !results.no_email.includes(crewName) && !results.failed.includes(crewName)) {
          results.failed.push(crewName);
        }
      }
    });

    res.json({
      message:      `${results.sent.length} timesheet(s) distributed`,
      week_ending_date,
      results,
    });
  } catch (err) {
    console.error('bulkDistribute:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/:id/resend ─────────────────────────────────────────
// Resends a single timesheet to the crew member. Only available on
// amendment_requested timesheets. Advances status back to distributed.
const resendTimesheet = async (req, res) => {
  try {
    const { rows: [ts] } = await db.query(
      `SELECT t.*,
              cm.first_name, cm.last_name, cm.email, cm.crew_number,
              cm.crew_trade, cm.crew_rank, cm.employment_status, cm.company_name,
              p.name AS prod_name
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id  = p.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
    if (ts.status !== 'amendment_requested')
      return res.status(409).json({ error: 'Only amendment_requested timesheets can be resent' });
    if (!ts.email)
      return res.status(400).json({ error: 'Crew member has no email address on file' });

    const { rows: entries } = await db.query(
      'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
      [req.params.id]
    );

    await sendTimesheetEmail(ts, entries);
    await db.query(`UPDATE timesheets SET status = 'distributed' WHERE id = $1`, [req.params.id]);
    await logEmail('timesheet_distribution', ts.id, ts.email, `${ts.first_name} ${ts.last_name}`, true);

    res.json({ message: 'Timesheet resent to crew member', timesheet_id: ts.id });
  } catch (err) {
    console.error('resendTimesheet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/:id/send ───────────────────────────────────────────
// Sends a single timesheet to the crew member.
const sendSingleTimesheet = async (req, res) => {
  try {
    const { rows: [ts] } = await db.query(
      `SELECT t.*,
              cm.first_name, cm.last_name, cm.email, cm.crew_number,
              cm.crew_trade, cm.crew_rank, cm.employment_status, cm.company_name,
              p.name AS prod_name
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id  = p.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });

    if (!ts.email) {
      if (ts.status === 'draft' || ts.status === 'amendment_requested') {
        await db.query(`UPDATE timesheets SET status = 'distributed' WHERE id = $1`, [ts.id]);
        return res.json({ message: 'Marked as distributed (crew member has no email address)', timesheet_id: ts.id });
      }
      return res.status(400).json({ error: 'Crew member has no email address on file' });
    }

    const { rows: entries } = await db.query(
      'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
      [req.params.id]
    );

    await sendTimesheetEmail(ts, entries);
    
    // Move to distributed if it was draft or amendment_requested
    if (ts.status === 'draft' || ts.status === 'amendment_requested') {
      await db.query(`UPDATE timesheets SET status = 'distributed' WHERE id = $1`, [req.params.id]);
    }
    
    await logEmail('timesheet_distribution', ts.id, ts.email, `${ts.first_name} ${ts.last_name}`, true);

    res.json({ message: 'Timesheet sent to crew member', timesheet_id: ts.id });
  } catch (err) {
    console.error('sendSingleTimesheet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/:id/attach-invoice ──────────────────────────────────
const attachInvoice = async (req, res) => {
  let invoice_attachment_url  = req.body.invoice_attachment_url;
  let invoice_attachment_name = req.body.invoice_attachment_name;

  try {
    if (req.file) {
      const { url } = await fileStorage.store(req.file);
      invoice_attachment_url  = url;
      invoice_attachment_name = req.file.originalname;
    }

    if (!invoice_attachment_url)
      return res.status(400).json({ error: 'Provide a file upload or invoice_attachment_url' });

    const { rows: [existing] } = await db.query('SELECT status FROM timesheets WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Timesheet not found' });
    const newStatus = existing.status; // invoice attachment does not change status in the current workflow

    const { rows: [ts] } = await db.query(
      `UPDATE timesheets
       SET invoice_attachment_url = $1, invoice_attachment_name = $2, status = $3
       WHERE id = $4
       RETURNING *`,
      [invoice_attachment_url, invoice_attachment_name, newStatus, req.params.id]
    );
    res.json({ message: 'Invoice attached', timesheet: ts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/chase-invoices ─────────────────────────────────────
// Chases self-employed crew with no invoice on distributed timesheets.
// Skips crew members already chased today (duplicate prevention via email_log).
const chaseInvoices = async (req, res) => {
  const { week_ending_date } = req.body;
  try {
    const conditions = [
      "t.status IN ('distributed', 'amendment_requested')",
      't.invoice_attachment_url IS NULL',
      "cm.employment_status = 'self_employed'",  // PAYE crew do not invoice
    ];
    const params = [];
    if (week_ending_date) { conditions.push(`t.week_ending_date = $1`); params.push(week_ending_date); }

    const { rows } = await db.query(
      `SELECT t.id, t.week_ending_date, t.grand_total,
              cm.first_name, cm.last_name, cm.email
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       WHERE ${conditions.join(' AND ')}`,
      params
    );

    if (!rows.length) return res.json({ message: 'No outstanding invoices to chase', chased_count: 0 });

    const today = new Date().toISOString().split('T')[0];
    const results = { sent: [], already_chased_today: [], no_email: [] };

    for (const t of rows) {
      const crewName = `${t.first_name} ${t.last_name}`;

      if (!t.email) { results.no_email.push(crewName); continue; }

      // Duplicate prevention — skip if already chased today
      const { rows: recentChase } = await db.query(
        `SELECT id FROM email_log
         WHERE module = 'invoice_chase'
           AND recipient_email = $1
           AND sent_at >= $2::date`,
        [t.email, today]
      );
      if (recentChase.length) { results.already_chased_today.push(crewName); continue; }

      try {
        await sendEmail({
          replyTo: 'invoice@constructscenery.co.uk',
          to:      t.email,
          ...templates.invoiceChase(crewName, t.week_ending_date, t.grand_total),
        });
        await logEmail('invoice_chase', t.id, t.email, crewName, true);
        results.sent.push(crewName);
      } catch (emailErr) {
        console.error(`Chase email failed for ${crewName}:`, emailErr.message);
        await logEmail('invoice_chase', t.id, t.email, crewName, false, emailErr.message);
      }
    }

    res.json({
      message:     `Invoice chase sent to ${results.sent.length} crew member(s)`,
      week_ending_date: week_ending_date || null,
      results,
    });
  } catch (err) {
    console.error('chaseInvoices:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/:id/verify ─────────────────────────────────────────
// Finalises a timesheet and locks it from further editing.
//   - Status must be distributed or amendment_requested.
//   - PAYE crew: no invoice needed → always allowed.
//   - Self-employed crew: invoice must be attached → 409 INVOICE_REQUIRED if not.
const verifyTimesheet = async (req, res) => {
  try {
    const { rows: [ts] } = await db.query(
      `SELECT t.id, t.status, t.invoice_attachment_url,
              cm.employment_status
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });

    const readyStatuses = ['distributed', 'amendment_requested'];
    if (!readyStatuses.includes(ts.status))
      return res.status(409).json({
        error: 'Timesheet must be distributed (or amendment_requested) before it can be finalised',
      });

    if (ts.employment_status === 'self_employed' && !ts.invoice_attachment_url)
      return res.status(409).json({
        error:    'INVOICE_REQUIRED',
        message:  'An invoice must be attached before finalising a self-employed timesheet',
      });

    const { rows: [updated] } = await db.query(
      `UPDATE timesheets SET status = 'finalised' WHERE id = $1 RETURNING *`,  // TimesheetStatus.FINALISED
      [req.params.id]
    );
    res.json({ message: 'Timesheet verified', timesheet: updated });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      productionId: updated.production_id,
      category: 'payroll',
      action: 'timesheet_finalised',
      entityType: 'timesheet',
      entityId: updated.id,
      details: `Finalised and verified timesheet for week ending ${updated.week_ending_date}`,
      metadata: { timesheet_id: updated.id, week_ending_date: updated.week_ending_date, crew_member_id: updated.crew_member_id },
    });
  } catch (err) {
    console.error('verifyTimesheet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/timesheets/:id ────────────────────────────────────────────────
const patchTimesheet = async (req, res) => {
  const VALID_STATUSES = ['draft', 'distributed', 'amendment_requested', 'finalised'];  // TimesheetStatus
  const { status } = req.body;

  if (!status)
    return res.status(400).json({ error: 'No updatable fields provided' });
  if (!VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });

  if (status === 'finalised')
    return res.status(400).json({ error: 'Use POST /:id/verify to finalise a timesheet' });

  try {
    const { rows: [existing] } = await db.query(
      'SELECT id, status FROM timesheets WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Timesheet not found' });
    if (existing.status === 'finalised')
      return res.status(403).json({ error: 'Finalised timesheets are locked — status cannot be changed' });

    const { rows: [updated] } = await db.query(
      'UPDATE timesheets SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(updated);
  } catch (err) {
    console.error('patchTimesheet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/verification-pack ───────────────────────────────────
// Returns an XLSX workbook in the weekly timesheet grid format.
// First 3 columns (Crew No., Name, Company) are highlighted in light blue.
// All timesheets for the week must be verified — returns 409 if any are not.
// Filename: VerificationPack_[ProductionName]_w-e-[WeekEndingDate].xlsx
const generateVerificationPackPdf = async (req, res) => {
  const { week_ending_date, production_id } = req.body;
  if (!week_ending_date || !production_id)
    return res.status(400).json({ error: 'week_ending_date and production_id are required' });

  try {
    const { rows: timesheets } = await db.query(
      `SELECT t.*,
              cm.crew_number, cm.first_name, cm.last_name,
              cm.employment_status, cm.company_name, cm.crew_trade, cm.crew_rank,
              cm.vat_registration_number,
              p.name AS prod_name,
              (SELECT br.daily_rate    FROM bectu_rates br
               WHERE  br.trade = cm.crew_trade
               AND    br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER  BY br.effective_from DESC LIMIT 1) AS daily_rate,
              (SELECT br.overtime_rate FROM bectu_rates br
               WHERE  br.trade = cm.crew_trade
               AND    br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER  BY br.effective_from DESC LIMIT 1) AS overtime_rate
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id  = p.id
       WHERE t.week_ending_date = $1 AND t.production_id = $2
       ORDER BY cm.crew_trade, cm.last_name, cm.first_name`,
      [week_ending_date, production_id]
    );

    if (!timesheets.length)
      return res.status(404).json({ error: 'No timesheets found for this week and production' });

    const notVerified = timesheets.filter(t => t.status !== 'finalised');
    if (notVerified.length)
      return res.status(409).json({
        error:        `${notVerified.length} timesheet(s) are not yet verified`,
        not_verified: notVerified.map(t => `${t.first_name} ${t.last_name}`),
      });

    // Attach entries to each timesheet row
    const withEntries = await Promise.all(timesheets.map(async ts => {
      const { rows: entries } = await db.query(
        'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
        [ts.id]
      );
      return { ...ts, entries };
    }));

    const prodName = timesheets[0]?.prod_name || 'Production';

    // ── Week commencing (Monday) ───────────────────────────────────────────────
    const sunday = new Date(week_ending_date + 'T00:00:00Z');
    const monday = new Date(sunday);
    monday.setUTCDate(sunday.getUTCDate() - 6);
    const wc = monday.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const DAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

    // ── Build XLSX workbook ───────────────────────────────────────────────────
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Verification Pack');

    // Colours
    const BLUE_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };  // col header bg
    const BLUE_DATA   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };  // first-3 col data bg
    const GREY_TRADE  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };  // trade group row
    const YELLOW_TOT  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };  // grand total row
    const WHITE_FONT  = { color: { argb: 'FFFFFFFF' }, bold: true };
    const BOLD        = { bold: true };

    // Row 1-2: meta
    ws.addRow([`Production: ${prodName}`]).getCell(1).font = BOLD;
    ws.addRow([`W/C: ${wc}`]).getCell(1).font = BOLD;
    ws.addRow([]);  // blank

    // Column headers
    const dayHeaders = DAY_SHORT.flatMap(d => [`${d} IN`, `${d} OT`, `${d} TRAVEL £`]);
    const headers = [
      'CREW NO.', 'NAME', 'COMPANY', 'TRADE', 'RANK',
      ...dayHeaders,
      'TOTAL DAYS', 'TOTAL OT HRS', 'TOTAL TRAVEL £', 'MILEAGE £', 'PER DIEM £', 'AD HOC £',
      'DAILY RATE', 'OT RATE', 'NET TOTAL', 'VAT', 'GROSS',
    ];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell, colNum) => {
      cell.fill = BLUE_HEADER;
      cell.font = WHITE_FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF2F5597' } } };
    });

    // Helper: apply first-3-column highlight to a data row
    const highlightIdCols = (row) => {
      [1, 2, 3].forEach(c => {
        row.getCell(c).fill = BLUE_DATA;
        row.getCell(c).font = { bold: true };
      });
    };

    // Group by trade
    const byTrade = {};
    withEntries.forEach(ts => {
      const trade = ts.crew_trade || 'Other';
      if (!byTrade[trade]) byTrade[trade] = [];
      byTrade[trade].push(ts);
    });

    let grandNet = 0, grandVat = 0, grandGross = 0;

    for (const [trade, crew] of Object.entries(byTrade)) {
      ws.addRow([]);
      const tradeRow = ws.addRow([trade.toUpperCase()]);
      tradeRow.getCell(1).fill = GREY_TRADE;
      tradeRow.getCell(1).font = BOLD;

      for (const ts of crew) {
        const entryByDay = {};
        (ts.entries || []).forEach(e => { entryByDay[e.day_of_week] = e; });

        const dayCols = DAYS.flatMap(day => {
          const e = entryByDay[day];
          const worked = e?.full_day_worked ? 'X' : '';
          const ot     = e ? (parseFloat(e.overtime_hours || 0) || '') : '';
          const travel = e ? (parseFloat(e.travel || 0) > 0 ? parseFloat(e.travel || 0) : '') : '';
          return [worked, ot, travel];
        });

        const totalDays    = (ts.entries || []).filter(e => e.full_day_worked).length;
        const totalOT      = (ts.entries || []).reduce((s, e) => s + parseFloat(e.overtime_hours || 0), 0);
        const totalTravel  = (ts.entries || []).reduce((s, e) => s + parseFloat(e.travel || 0), 0);
        const totalMileage = (ts.entries || []).reduce((s, e) => s + parseFloat(e.mileage || 0), 0);
        const totalPerDiem = (ts.entries || []).reduce((s, e) => s + parseFloat(e.per_diem || 0), 0);
        const totalAdHoc   = (ts.entries || []).reduce((s, e) => s + parseFloat(e.ad_hoc_reimbursement || 0), 0);
        const netTotal     = parseFloat(ts.gross_total  || 0);
        const vat          = parseFloat(ts.vat          || 0);
        const gross        = parseFloat(ts.grand_total  || 0);
        const dailyRate    = parseFloat(ts.daily_rate   || 0);
        const otRate       = parseFloat(ts.overtime_rate || 0);

        grandNet   += netTotal;
        grandVat   += vat;
        grandGross += gross;

        const dataRow = ws.addRow([
          ts.crew_number,
          `${ts.first_name} ${ts.last_name}`,
          ts.company_name || '',
          ts.crew_trade   || '',
          ts.crew_rank    || '',
          ...dayCols,
          totalDays,
          totalOT    > 0 ? totalOT    : 0,
          totalTravel > 0 ? totalTravel : 0,
          totalMileage > 0 ? totalMileage : 0,
          totalPerDiem > 0 ? totalPerDiem : 0,
          totalAdHoc   > 0 ? totalAdHoc   : 0,
          dailyRate > 0 ? dailyRate : '',
          otRate    > 0 ? otRate    : '',
          netTotal,
          vat > 0 ? vat : '',
          gross,
        ]);
        highlightIdCols(dataRow);
      }
    }

    // Grand total row
    ws.addRow([]);
    const blankDayCols = Array(21).fill('');
    const totalRow = ws.addRow([
      '', 'TOTAL', '', '', '', ...blankDayCols,
      '', '', '', '', '', '', '', '',
      grandNet, grandVat > 0 ? grandVat : '', grandGross,
    ]);
    totalRow.eachCell(cell => { cell.fill = YELLOW_TOT; cell.font = BOLD; });

    // Column widths
    ws.getColumn(1).width = 12;   // CREW NO.
    ws.getColumn(2).width = 22;   // NAME
    ws.getColumn(3).width = 20;   // COMPANY
    ws.getColumn(4).width = 14;   // TRADE
    ws.getColumn(5).width = 14;   // RANK
    for (let c = 6; c <= 26; c++) ws.getColumn(c).width = 9;  // day cols
    for (let c = 27; c <= 37; c++) ws.getColumn(c).width = 13; // totals

    // Freeze top 4 rows and first 5 columns
    ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 4 }];

    const safeName = prodName.replace(/[^a-zA-Z0-9]+/g, '_');
    const filename = `VerificationPack_${safeName}_w-e-${week_ending_date}.xlsx`;
    const buffer = await wb.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Pack-Summary', JSON.stringify({ crew_count: withEntries.length }));
    res.send(buffer);
  } catch (err) {
    console.error('generateVerificationPackPdf:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/timesheets/verification-pack-pdf ───────────────────────────────
// Returns a merged PDF containing all timesheets and invoices for the week.
// All timesheets must be finalised.
const generateVerificationPackCombinedPdf = async (req, res) => {
  const { week_ending_date, production_id } = req.body;
  if (!week_ending_date || !production_id)
    return res.status(400).json({ error: 'week_ending_date and production_id are required' });

  try {
    const { rows: timesheets } = await db.query(
      `SELECT t.*,
              cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
              cm.employment_status, cm.company_name, cm.vat_registration_number,
              p.name AS prod_name,
              (SELECT br.daily_rate
               FROM bectu_rates br
               WHERE br.trade = cm.crew_trade
                 AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER BY br.effective_from DESC
               LIMIT 1) AS daily_rate,
              (SELECT br.overtime_rate
               FROM bectu_rates br
               WHERE br.trade = cm.crew_trade
                 AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER BY br.effective_from DESC
               LIMIT 1) AS overtime_rate
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id  = p.id
       WHERE t.week_ending_date = $1 AND t.production_id = $2
       ORDER BY cm.crew_trade, cm.last_name, cm.first_name`,
      [week_ending_date, production_id]
    );

    if (!timesheets.length)
      return res.status(404).json({ error: 'No timesheets found for this week and production' });

    const notVerified = timesheets.filter(t => t.status !== 'finalised');
    if (notVerified.length)
      return res.status(409).json({
        error:        `${notVerified.length} timesheet(s) are not yet verified`,
        not_verified: notVerified.map(t => `${t.first_name} ${t.last_name}`),
      });

    const enrichedTimesheets = await Promise.all(timesheets.map(async ts => {
      const { rows: entries } = await db.query(
        'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
        [ts.id]
      );
      return {
        ...enrichTimesheetSummary(ts, entries),
        entries,
      };
    }));

    const prodName = timesheets[0]?.prod_name || 'Production';
    const pack = await generateVerificationPack(enrichedTimesheets, prodName);

    const safeProd = prodName.replace(/[^a-zA-Z0-9]+/g, '_');
    const filename = `VerificationPack_${safeProd}_w-e-${week_ending_date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Pack-Summary', JSON.stringify({ crew_count: enrichedTimesheets.length, timesheet_page_count: pack.timesheetPageCount, invoice_page_count: pack.invoicePageCount }));
    res.send(Buffer.from(pack.pdfBytes));
  } catch (err) {
    console.error('generateVerificationPackCombinedPdf:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/timesheets/:id/verification-pack ────────────────────────────────
const getTimesheetVerificationPack = async (req, res) => {
  try {
    const { rows: [ts] } = await db.query(
      `SELECT t.*,
              cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
              cm.employment_status, cm.company_name, cm.vat_registration_number,
              p.id AS prod_id, p.name AS prod_name,
              (SELECT br.daily_rate
               FROM bectu_rates br
               WHERE br.trade = cm.crew_trade
                 AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER BY br.effective_from DESC
               LIMIT 1) AS daily_rate,
              (SELECT br.overtime_rate
               FROM bectu_rates br
               WHERE br.trade = cm.crew_trade
                 AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER BY br.effective_from DESC
               LIMIT 1) AS overtime_rate
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id   = p.id
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });

    const { rows: entries } = await db.query(
      'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
      [req.params.id]
    );

    const pack = await generateVerificationPack([
      {
        ...enrichTimesheetSummary(ts, entries),
        entries,
      },
    ], ts.prod_name);

    const safeCrew = `${ts.first_name || 'Crew'}_${ts.last_name || 'Member'}`.replace(/[^a-zA-Z0-9]+/g, '_');
    const filename = `VerificationPack_${safeCrew}_w-e-${ts.week_ending_date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Pack-Summary', JSON.stringify({ crew_count: 1, timesheet_page_count: pack.timesheetPageCount, invoice_page_count: pack.invoicePageCount }));
    res.send(Buffer.from(pack.pdfBytes));
  } catch (err) {
    console.error('getTimesheetVerificationPack:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/timesheets/:id/draft-pdf ──────────────────────────────────────
const getDraftPdf = async (req, res) => {
  try {
    const { rows: [ts] } = await db.query(
      `SELECT t.*,
              cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank,
              cm.employment_status, cm.company_name, cm.vat_registration_number,
              p.id AS prod_id, p.name AS prod_name,
              (SELECT br.daily_rate
               FROM bectu_rates br
               WHERE br.trade = cm.crew_trade
                 AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER BY br.effective_from DESC
               LIMIT 1) AS daily_rate,
              (SELECT br.overtime_rate
               FROM bectu_rates br
               WHERE br.trade = cm.crew_trade
                 AND br.rank  = COALESCE(t.rank_override, cm.crew_rank)
               ORDER BY br.effective_from DESC
               LIMIT 1) AS overtime_rate
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions p   ON t.production_id   = p.id
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });

    const { rows: entries } = await db.query(
      'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
      [req.params.id]
    );

    const pdfBuffer = await generateTimesheetPdf(enrichTimesheetSummary(ts, entries), entries);

    const safeCrew = `${ts.first_name || 'Crew'}_${ts.last_name || 'Member'}`.replace(/[^a-zA-Z0-9]+/g, '_');
    const safeProd = (ts.prod_name || 'Production').replace(/[^a-zA-Z0-9]+/g, '_');
    const filename = `Timesheet_Draft_${safeCrew}_${safeProd}_w-e-${ts.week_ending_date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('getDraftPdf:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/timesheets/verification-pack/:weekEndingDate/:productionId ──────
const getVerificationPack = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.*,
              cm.crew_number, cm.first_name, cm.last_name, cm.crew_trade, cm.crew_rank, cm.employment_status
       FROM   timesheets t
       JOIN   crew_members cm ON t.crew_member_id = cm.id
       WHERE  t.week_ending_date = $1
         AND  t.production_id    = $2
         AND  t.invoice_attachment_url IS NOT NULL
       ORDER BY cm.last_name`,
      [req.params.weekEndingDate, req.params.productionId]
    );

    const pack = await Promise.all(rows.map(async ts => {
      const { rows: entries } = await db.query(
        'SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date',
        [ts.id]
      );
      return {
        crew_member:      `${ts.first_name} ${ts.last_name}`,
        crew_number:       ts.crew_number,
        crew_trade:        ts.crew_trade,
        crew_rank:         ts.crew_rank,
        week_ending_date:  ts.week_ending_date,
        grand_total:       ts.grand_total,
        timesheet:        { ...ts, timesheet_entries: entries },
        invoice_url:       ts.invoice_attachment_url,
      };
    }));

    res.json({
      week_ending_date: req.params.weekEndingDate,
      total_crew:       pack.length,
      total_gross:      pack.reduce((s, p) => s + parseFloat(p.grand_total || 0), 0),
      records:          pack,
    });
  } catch (err) {
    console.error('getVerificationPack:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAllTimesheets, exportTimesheetsCSV, exportTimesheetsPDF,
  createTimesheet, getTimesheetById,
  saveEntries, patchTimesheet,
  bulkDistribute, resendTimesheet, sendSingleTimesheet, submitTimesheet,
  attachInvoice, chaseInvoices, verifyTimesheet,
  generateVerificationPackPdf, generateVerificationPackCombinedPdf, getVerificationPack, getTimesheetVerificationPack, getDraftPdf,
};
