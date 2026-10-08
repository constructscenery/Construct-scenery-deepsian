/**
 * Crew self-service portal — public API (/api/public/crew-portal/:token).
 *
 * Access is by the crew member's secure portal link only (no login). A crew member
 * can only ever see and change their own submissions. Everything submitted here is
 * held for office review in the Emailing tab — nothing is written to timesheets,
 * invoices or pay runs until a user approves it.
 */
const db = require('../config/db');
const fileStorage = require('../services/fileStorage');
const portalLinks = require('../services/emailing/portalLinks');
const { SUBMISSION_STATUS, AVAILABILITY_RESPONSES, TIMESHEET_PRODUCTION_STATUSES, WEEK_DAYS } = require('../services/emailing/constants');
const { isSunday, weekDays, recentWeekEndings } = require('../services/emailing/dates');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const fail = (status, message) => Object.assign(new Error(message), { status });
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'The crew portal is not available yet. Please contact the office.' });
    const status = err.status || 500;
    if (status >= 500) console.error(`[crew-portal] ${req.method} ${req.path}:`, err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again or contact the office.' : err.message });
  }
};

/** Middleware: resolves :token → req.crew. */
const loadPortal = async (req, res, next) => {
  try {
    const result = await portalLinks.resolveToken(req.params.token);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    req.crew = result.crew;
    req.portalLink = result.link;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  } catch (err) {
    console.error('[crew-portal] token resolution failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again or contact the office.' });
  }
};

/** Productions this crew member can submit for (active productions only). */
async function portalProductions(crewId) {
  const { rows } = await db.query(
    `SELECT DISTINCT p.id, p.name
     FROM productions p
     WHERE p.status = ANY($2::text[])
       AND (
         EXISTS (SELECT 1 FROM production_crew pc WHERE pc.production_id = p.id AND pc.crew_member_id = $1)
         OR EXISTS (SELECT 1 FROM timesheets t WHERE t.production_id = p.id AND t.crew_member_id = $1 AND t.week_ending_date >= CURRENT_DATE - 120)
         OR EXISTS (SELECT 1 FROM crew_timesheet_submissions s WHERE s.production_id = p.id AND s.crew_member_id = $1)
       )
     ORDER BY p.name`,
    [crewId, TIMESHEET_PRODUCTION_STATUSES]
  );
  if (rows.length) return { productions: rows, linked: true };
  // No assignment on record yet — offer every active production.
  const { rows: all } = await db.query(
    'SELECT id, name FROM productions WHERE status = ANY($1::text[]) ORDER BY name',
    [TIMESHEET_PRODUCTION_STATUSES]
  );
  return { productions: all, linked: false };
}

async function assertProduction(crewId, productionId) {
  if (!isUuid(productionId)) throw fail(400, 'Choose a production');
  const { productions } = await portalProductions(crewId);
  if (!productions.some((p) => p.id === productionId)) throw fail(400, 'That production is not open for submissions');
}

// ─── GET / ───────────────────────────────────────────────────────────────────
const getPortal = handle(async (req, res) => {
  const crew = req.crew;
  const [{ productions, linked }, { rows: [counts] }] = await Promise.all([
    portalProductions(crew.id),
    db.query(
      `SELECT
         (SELECT COUNT(*) FROM availability_poll_recipients r JOIN availability_polls ap ON ap.id = r.poll_id
          WHERE r.crew_member_id = $1 AND ap.closed_at IS NULL AND r.response IS NULL) AS polls_awaiting,
         (SELECT COUNT(*) FROM crew_timesheet_submissions WHERE crew_member_id = $1 AND status = 'returned') AS timesheets_returned,
         (SELECT COUNT(*) FROM crew_invoice_submissions WHERE crew_member_id = $1 AND status = 'returned') AS invoices_returned`,
      [crew.id]
    ),
  ]);
  res.json({
    crew: {
      first_name: crew.first_name,
      last_name: crew.last_name,
      crew_number: crew.crew_number,
      employment_status: crew.employment_status,
      needs_invoices: crew.employment_status === 'self_employed',
    },
    productions,
    productions_linked: linked,
    weeks: recentWeekEndings(6),
    link_expires_at: req.portalLink.expires_at,
    alerts: {
      polls_awaiting: parseInt(counts.polls_awaiting, 10) || 0,
      timesheets_returned: parseInt(counts.timesheets_returned, 10) || 0,
      invoices_returned: parseInt(counts.invoices_returned, 10) || 0,
    },
  });
});

// ─── Timesheets ──────────────────────────────────────────────────────────────
const SUBMISSION_PUBLIC_COLUMNS = 's.id, s.production_id, p.name AS production_name, s.week_ending_date, s.status, s.crew_notes, s.reviewer_notes, s.revision, s.submitted_at, s.reviewed_at';

const listTimesheets = handle(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${SUBMISSION_PUBLIC_COLUMNS},
            (SELECT COUNT(*) FILTER (WHERE e.full_day_worked) FROM crew_timesheet_submission_entries e WHERE e.submission_id = s.id) AS days_worked
     FROM crew_timesheet_submissions s JOIN productions p ON p.id = s.production_id
     WHERE s.crew_member_id = $1
     ORDER BY s.week_ending_date DESC, s.submitted_at DESC
     LIMIT 30`,
    [req.crew.id]
  );
  res.json(rows);
});

/** Current week view: the open submission (if any) or a prefilled blank week. */
const getTimesheetWeek = handle(async (req, res) => {
  const { production_id: productionId, week_ending_date: week } = req.query;
  await assertProduction(req.crew.id, productionId);
  if (!isSunday(week)) throw fail(400, 'Choose a week ending (Sunday)');

  const { rows: [submission] } = await db.query(
    `SELECT ${SUBMISSION_PUBLIC_COLUMNS}
     FROM crew_timesheet_submissions s JOIN productions p ON p.id = s.production_id
     WHERE s.crew_member_id = $1 AND s.production_id = $2 AND s.week_ending_date = $3
     ORDER BY (s.status IN ('submitted','returned','approved')) DESC, s.submitted_at DESC
     LIMIT 1`,
    [req.crew.id, productionId, week]
  );
  const { rows: [timesheet] } = await db.query(
    'SELECT id, status FROM timesheets WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3',
    [req.crew.id, productionId, week]
  );

  let entries = [];
  if (submission) {
    ({ rows: entries } = await db.query('SELECT * FROM crew_timesheet_submission_entries WHERE submission_id = $1 ORDER BY date', [submission.id]));
  } else if (timesheet) {
    ({ rows: entries } = await db.query('SELECT * FROM timesheet_entries WHERE timesheet_id = $1 ORDER BY date', [timesheet.id]));
  }
  const byDate = new Map(entries.map((e) => [String(e.date).slice(0, 10), e]));
  const days = weekDays(week).map(({ date, day_of_week }) => {
    const e = byDate.get(date) || {};
    return {
      date, day_of_week,
      full_day_worked: !!e.full_day_worked,
      overtime_hours: Number(e.overtime_hours || 0),
      set_number: e.set_number || '',
      site: e.site || '',
      travel: Number(e.travel || 0),
      mileage: Number(e.mileage || 0),
      per_diem: Number(e.per_diem || 0),
      ad_hoc_reimbursement: Number(e.ad_hoc_reimbursement || 0),
      meal_breakfast: !!e.meal_breakfast,
      meal_lunch: !!e.meal_lunch,
      meal_supper: !!e.meal_supper,
    };
  });

  const locked = timesheet?.status === 'finalised';
  const status = submission?.status || null;
  const editable = !locked && (!submission || [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RETURNED, SUBMISSION_STATUS.DECLINED].includes(status));
  res.json({
    submission: submission || null,
    days,
    editable,
    locked_reason: locked ? 'This week has been finalised by the office.' : status === SUBMISSION_STATUS.APPROVED ? 'This timesheet has been approved. Contact the office if something needs changing.' : null,
  });
});

const MONEY_MAX = 10000;
function parseEntries(rawEntries, week) {
  if (!Array.isArray(rawEntries) || rawEntries.length !== 7) throw fail(400, 'Send all 7 days of the week');
  const expected = weekDays(week);
  const money = (v, label, day) => {
    const n = v === '' || v == null ? 0 : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MONEY_MAX) throw fail(400, `${label} on ${day} must be between 0 and ${MONEY_MAX}`);
    return Math.round(n * 100) / 100;
  };
  const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

  const entries = expected.map(({ date, day_of_week }) => {
    const e = rawEntries.find((x) => x && x.date === date);
    if (!e) throw fail(400, `Missing entry for ${day_of_week} ${date}`);
    const ot = e.overtime_hours === '' || e.overtime_hours == null ? 0 : Number(e.overtime_hours);
    if (!Number.isFinite(ot) || ot < 0 || ot > 16) throw fail(400, `Overtime on ${day_of_week} must be between 0 and 16 hours`);
    const worked = e.full_day_worked === true;
    return {
      date, day_of_week,
      full_day_worked: worked,
      overtime_hours: Math.round(ot * 100) / 100,
      set_number: text(e.set_number, 50),
      site: text(e.site, 120),
      travel: money(e.travel, 'Travel', day_of_week),
      mileage: money(e.mileage, 'Mileage', day_of_week),
      per_diem: money(e.per_diem, 'Per diem', day_of_week),
      ad_hoc_reimbursement: money(e.ad_hoc_reimbursement, 'Expenses', day_of_week),
      meal_breakfast: e.meal_breakfast === true,
      meal_lunch: e.meal_lunch === true,
      meal_supper: e.meal_supper === true,
    };
  });
  for (const e of entries) {
    if (!e.full_day_worked && e.overtime_hours > 0) throw fail(400, `Overtime is entered on ${e.day_of_week} but the day isn't marked as worked`);
  }
  if (!entries.some((e) => e.full_day_worked)) throw fail(400, 'Mark at least one day as worked');
  if (!WEEK_DAYS.every((d, i) => entries[i].day_of_week === d)) throw fail(400, 'Invalid week');
  return entries;
}

const submitTimesheet = handle(async (req, res) => {
  const { production_id: productionId, week_ending_date: week, entries: rawEntries } = req.body || {};
  await assertProduction(req.crew.id, productionId);
  if (!isSunday(week)) throw fail(400, 'Choose a week ending (Sunday)');
  const latestAllowed = recentWeekEndings(1)[0];
  if (week > latestAllowed) throw fail(400, 'You can’t submit a timesheet for a future week');
  const entries = parseEntries(rawEntries, week);
  const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 2000) : null;

  const { rows: [ts] } = await db.query(
    'SELECT status FROM timesheets WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3',
    [req.crew.id, productionId, week]
  );
  if (ts?.status === 'finalised') throw fail(409, 'This week has already been finalised by the office.');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [open] } = await client.query(
      `SELECT id, status, revision FROM crew_timesheet_submissions
       WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3
         AND status IN ('submitted','returned','approved')
       FOR UPDATE`,
      [req.crew.id, productionId, week]
    );
    if (open?.status === SUBMISSION_STATUS.APPROVED) {
      await client.query('ROLLBACK');
      throw fail(409, 'This timesheet has already been approved. Contact the office if something needs changing.');
    }

    let submission;
    let action = 'submitted';
    if (open) {
      action = open.status === SUBMISSION_STATUS.RETURNED ? 'resubmitted' : 'submitted';
      ({ rows: [submission] } = await client.query(
        `UPDATE crew_timesheet_submissions
         SET status = 'submitted', crew_notes = $2, revision = revision + $3, submitted_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [open.id, notes, open.status === SUBMISSION_STATUS.RETURNED ? 1 : 0]
      ));
      await client.query('DELETE FROM crew_timesheet_submission_entries WHERE submission_id = $1', [open.id]);
    } else {
      ({ rows: [submission] } = await client.query(
        `INSERT INTO crew_timesheet_submissions (crew_member_id, production_id, week_ending_date, crew_notes)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.crew.id, productionId, week, notes]
      ));
    }

    const cols = ['submission_id', 'date', 'day_of_week', 'full_day_worked', 'overtime_hours', 'set_number', 'site', 'travel', 'mileage', 'per_diem', 'ad_hoc_reimbursement', 'meal_breakfast', 'meal_lunch', 'meal_supper'];
    const values = [];
    const placeholders = entries.map((e, i) => {
      values.push(submission.id, e.date, e.day_of_week, e.full_day_worked, e.overtime_hours, e.set_number, e.site, e.travel, e.mileage, e.per_diem, e.ad_hoc_reimbursement, e.meal_breakfast, e.meal_lunch, e.meal_supper);
      return `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`;
    });
    await client.query(`INSERT INTO crew_timesheet_submission_entries (${cols.join(',')}) VALUES ${placeholders.join(',')}`, values);

    await client.query(
      `INSERT INTO crew_submission_reviews (timesheet_submission_id, action, notes, revision, actor_type)
       VALUES ($1, $2, $3, $4, 'crew')`,
      [submission.id, action, notes, submission.revision]
    );
    await client.query('COMMIT');
    res.status(open ? 200 : 201).json({ message: 'Timesheet sent to the office for approval', submission: { id: submission.id, status: submission.status, revision: submission.revision } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw fail(409, 'A timesheet for this week was just submitted. Refresh and try again.');
    throw err;
  } finally {
    client.release();
  }
});

// ─── Invoices ────────────────────────────────────────────────────────────────
const listInvoices = handle(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${SUBMISSION_PUBLIC_COLUMNS}, s.invoice_number, s.amount, s.file_name
     FROM crew_invoice_submissions s JOIN productions p ON p.id = s.production_id
     WHERE s.crew_member_id = $1
     ORDER BY s.week_ending_date DESC, s.submitted_at DESC
     LIMIT 30`,
    [req.crew.id]
  );
  // Weeks with an approved timesheet that still need an invoice (self-employed only).
  let outstanding = [];
  if (req.crew.employment_status === 'self_employed') {
    ({ rows: outstanding } = await db.query(
      `SELECT t.production_id, p.name AS production_name, t.week_ending_date, t.grand_total
       FROM timesheets t JOIN productions p ON p.id = t.production_id
       WHERE t.crew_member_id = $1 AND t.invoice_attachment_url IS NULL
         AND t.status IN ('distributed', 'amendment_requested')
         AND NOT EXISTS (SELECT 1 FROM crew_invoice_submissions i WHERE i.crew_member_id = t.crew_member_id
                         AND i.production_id = t.production_id AND i.week_ending_date = t.week_ending_date
                         AND i.status IN ('submitted','approved'))
       ORDER BY t.week_ending_date DESC LIMIT 20`,
      [req.crew.id]
    ));
  }
  res.json({ invoices: rows, outstanding });
});

const uploadInvoice = handle(async (req, res) => {
  const { production_id: productionId, week_ending_date: week } = req.body || {};
  if (!req.file) throw fail(400, 'Attach your invoice (PDF, JPEG or PNG)');
  fileStorage.validate(req.file.mimetype, req.file.size);
  await assertProduction(req.crew.id, productionId);
  if (!isSunday(week)) throw fail(400, 'Choose the week ending (Sunday) this invoice is for');
  const invoiceNumber = req.body.invoice_number ? String(req.body.invoice_number).trim().slice(0, 60) : null;
  let amount = null;
  if (req.body.amount !== undefined && req.body.amount !== '') {
    amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw fail(400, 'Invoice amount must be between £0.01 and £100,000');
    amount = Math.round(amount * 100) / 100;
  }
  const notes = req.body.notes ? String(req.body.notes).trim().slice(0, 2000) : null;

  const { rows: [open] } = await db.query(
    `SELECT id, status FROM crew_invoice_submissions
     WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3
       AND status IN ('submitted','returned','approved')`,
    [req.crew.id, productionId, week]
  );
  if (open?.status === SUBMISSION_STATUS.APPROVED) throw fail(409, 'An invoice for this week has already been approved. Contact the office if something needs changing.');

  const stored = await fileStorage.store(req.file);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let submission;
    let action = 'submitted';
    if (open) {
      action = open.status === SUBMISSION_STATUS.RETURNED ? 'resubmitted' : 'submitted';
      ({ rows: [submission] } = await client.query(
        `UPDATE crew_invoice_submissions
         SET status = 'submitted', invoice_number = $2, amount = $3, file_url = $4, file_key = $5, file_name = $6,
             file_size = $7, file_mime_type = $8, crew_notes = $9, revision = revision + $10,
             submitted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status IN ('submitted','returned') RETURNING *`,
        [open.id, invoiceNumber, amount, stored.url, stored.key, req.file.originalname.slice(0, 200), req.file.size, req.file.mimetype, notes,
          open.status === SUBMISSION_STATUS.RETURNED ? 1 : 0]
      ));
      if (!submission) throw fail(409, 'This invoice was just reviewed. Refresh and try again.');
    } else {
      ({ rows: [submission] } = await client.query(
        `INSERT INTO crew_invoice_submissions
           (crew_member_id, production_id, week_ending_date, invoice_number, amount, file_url, file_key, file_name, file_size, file_mime_type, crew_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.crew.id, productionId, week, invoiceNumber, amount, stored.url, stored.key, req.file.originalname.slice(0, 200), req.file.size, req.file.mimetype, notes]
      ));
    }
    await client.query(
      `INSERT INTO crew_submission_reviews (invoice_submission_id, action, notes, revision, actor_type)
       VALUES ($1, $2, $3, $4, 'crew')`,
      [submission.id, action, notes, submission.revision]
    );
    await client.query('COMMIT');
    res.status(open ? 200 : 201).json({ message: 'Invoice sent to the office for approval', submission: { id: submission.id, status: submission.status, revision: submission.revision } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await fileStorage.deleteFile(stored.key);
    if (err.code === '23505') throw fail(409, 'An invoice for this week was just submitted. Refresh and try again.');
    throw err;
  } finally {
    client.release();
  }
});

// ─── Availability ────────────────────────────────────────────────────────────
const listAvailability = handle(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ap.id, ap.title, ap.message, ap.start_date, ap.end_date, ap.response_deadline, ap.closed_at,
            p.name AS production_name, r.response, r.response_notes, r.responded_at
     FROM availability_poll_recipients r
     JOIN availability_polls ap ON ap.id = r.poll_id
     LEFT JOIN productions p ON p.id = ap.production_id
     WHERE r.crew_member_id = $1 AND (ap.closed_at IS NULL OR ap.closed_at > NOW() - INTERVAL '30 days')
     ORDER BY ap.closed_at NULLS FIRST, ap.start_date`,
    [req.crew.id]
  );
  res.json(rows);
});

const respondAvailability = handle(async (req, res) => {
  if (!isUuid(req.params.pollId)) throw fail(404, 'Availability request not found');
  const response = req.body?.response;
  if (!AVAILABILITY_RESPONSES.includes(response)) throw fail(400, 'Choose available, partly available or unavailable');
  const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 1000) : null;
  if (response === 'partial' && !notes) throw fail(400, 'Tell us which days you can do');
  const { rows: [row] } = await db.query(
    `UPDATE availability_poll_recipients r
     SET response = $3, response_notes = $4, responded_at = NOW()
     FROM availability_polls ap
     WHERE r.poll_id = ap.id AND r.poll_id = $1 AND r.crew_member_id = $2 AND ap.closed_at IS NULL
     RETURNING r.id, r.response, r.response_notes, r.responded_at`,
    [req.params.pollId, req.crew.id, response, notes]
  );
  if (!row) throw fail(404, 'This availability request is closed or was not sent to you');
  res.json({ message: 'Thanks — your availability has been sent to the office', response: row });
});

module.exports = {
  loadPortal, getPortal,
  listTimesheets, getTimesheetWeek, submitTimesheet,
  listInvoices, uploadInvoice,
  listAvailability, respondAvailability,
  _parseEntries: parseEntries,
};
