/**
 * Office review of crew portal submissions.
 *
 * Nothing a crew member submits reaches the timesheet / pay run until a user
 * approves it. Approval reuses the EXISTING timesheet handlers (unchanged) so
 * rates, totals, VAT, status gates and audit behaviour stay identical:
 *
 *   Timesheet approve → timesheetsController.createTimesheet (if none exists for the
 *                       crew/production/week) → timesheetsController.saveEntries
 *                       (recalculates totals from the rate card) → draft becomes
 *                       'distributed' (crew-confirmed, ready to verify) → optional
 *                       timesheetsController.verifyTimesheet to finalise.
 *   Invoice approve   → timesheetsController.attachInvoice with the uploaded file URL
 *                       → optional verifyTimesheet.
 *
 *   Return  → crew can edit and resubmit (same submission, revision + 1), with notes.
 *   Decline → closed; crew may start a new submission for that week.
 */
const db = require('../../config/db');
const timesheetsController = require('../../Controllers/timesheetsController');
const { logAudit } = require('../auditService');
const { SUBMISSION_STATUS, MESSAGE_TYPES } = require('./constants');
const { sendSubmissionNotice, sendMessages } = require('./composer');

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Runs an Express handler in-process and captures its response. */
function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); return this; },
      send(body) { resolve({ statusCode: this.statusCode, body }); return this; },
      end() { resolve({ statusCode: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler({ params: {}, query: {}, body: {}, headers: {}, ...req }, res)).catch(reject);
  });
}

const errorFrom = (result, fallback) => {
  const b = result.body || {};
  return httpError(result.statusCode >= 400 ? result.statusCode : 500, b.message || b.error || fallback, { code: b.error });
};

async function recordReview({ kind, submissionId, action, notes, revision, userId }) {
  await db.query(
    `INSERT INTO crew_submission_reviews (${kind === 'invoice' ? 'invoice_submission_id' : 'timesheet_submission_id'}, action, notes, revision, actor_type, actor_user_id)
     VALUES ($1, $2, $3, $4, 'staff', $5)`,
    [submissionId, action, notes || null, revision || 1, userId || null]
  );
}

const TABLE = { timesheet: 'crew_timesheet_submissions', invoice: 'crew_invoice_submissions' };

async function loadSubmission(kind, id) {
  const { rows: [s] } = await db.query(
    `SELECT s.*, cm.first_name, cm.last_name, cm.email, cm.employment_status, p.name AS production_name
     FROM ${TABLE[kind]} s
     JOIN crew_members cm ON cm.id = s.crew_member_id
     JOIN productions p ON p.id = s.production_id
     WHERE s.id = $1`,
    [id]
  );
  if (!s) throw httpError(404, 'Submission not found');
  return s;
}

/** Atomically moves a submission out of 'submitted' (prevents double review). */
async function claimForReview(kind, id, nextStatus, notes, userId, timesheetId = null) {
  const { rows: [row] } = await db.query(
    `UPDATE ${TABLE[kind]}
     SET status = $2, reviewer_notes = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW(),
         timesheet_id = COALESCE($5, timesheet_id)
     WHERE id = $1 AND status = $6
     RETURNING *`,
    [id, nextStatus, notes || null, userId || null, timesheetId, SUBMISSION_STATUS.SUBMITTED]
  );
  if (!row) throw httpError(409, 'This submission has already been reviewed or is no longer waiting for review');
  return row;
}

async function findTimesheet(crewMemberId, productionId, weekEndingDate) {
  const { rows: [ts] } = await db.query(
    `SELECT id, status, invoice_attachment_url FROM timesheets
     WHERE crew_member_id = $1 AND production_id = $2 AND week_ending_date = $3`,
    [crewMemberId, productionId, weekEndingDate]
  );
  return ts || null;
}

async function maybeFinalise(timesheetId, user) {
  const result = await invokeHandler(timesheetsController.verifyTimesheet, { params: { id: timesheetId }, user });
  if (result.statusCode >= 400) {
    const b = result.body || {};
    return { finalised: false, reason: b.message || b.error || 'Could not finalise' };
  }
  return { finalised: true };
}

// ─── Timesheets ──────────────────────────────────────────────────────────────

async function approveTimesheet(id, { user, notes, finalise = false, requestInvoice = true }) {
  const submission = await loadSubmission('timesheet', id);
  if (submission.status !== SUBMISSION_STATUS.SUBMITTED) throw httpError(409, 'Only submissions waiting for review can be approved');

  const { rows: entries } = await db.query(
    'SELECT * FROM crew_timesheet_submission_entries WHERE submission_id = $1 ORDER BY date',
    [id]
  );
  if (!entries.length) throw httpError(400, 'This submission has no daily entries');

  let timesheet = await findTimesheet(submission.crew_member_id, submission.production_id, submission.week_ending_date);
  if (timesheet?.status === 'finalised') {
    throw httpError(409, 'The timesheet for this week is already finalised in Timesheets. Decline this submission or amend the timesheet there.');
  }

  let createdTimesheetId = null;
  if (!timesheet) {
    const created = await invokeHandler(timesheetsController.createTimesheet, {
      body: { crew_member_id: submission.crew_member_id, production_id: submission.production_id, week_ending_date: submission.week_ending_date },
      user,
    });
    if (created.statusCode !== 201) throw errorFrom(created, 'Could not create the timesheet');
    createdTimesheetId = created.body.id;
    timesheet = { id: created.body.id, status: created.body.status };
  }

  const saved = await invokeHandler(timesheetsController.saveEntries, {
    params: { id: timesheet.id },
    body: {
      entries: entries.map((e) => ({
        date: e.date,
        day_of_week: e.day_of_week,
        full_day_worked: e.full_day_worked,
        overtime_hours: Number(e.overtime_hours || 0),
        set_number: e.set_number,
        site: e.site,
        travel: Number(e.travel || 0),
        mileage: Number(e.mileage || 0),
        per_diem: Number(e.per_diem || 0),
        ad_hoc_reimbursement: Number(e.ad_hoc_reimbursement || 0),
        meal_breakfast: e.meal_breakfast,
        meal_lunch: e.meal_lunch,
        meal_supper: e.meal_supper,
      })),
    },
    user,
  });
  if (saved.statusCode >= 400) {
    if (createdTimesheetId) await db.query('DELETE FROM timesheets WHERE id = $1 AND status = $2', [createdTimesheetId, 'draft']).catch(() => {});
    throw errorFrom(saved, 'Could not save the timesheet entries');
  }

  let updated;
  try {
    updated = await claimForReview('timesheet', id, SUBMISSION_STATUS.APPROVED, notes, user?.id, timesheet.id);
  } catch (err) {
    if (createdTimesheetId) await db.query('DELETE FROM timesheets WHERE id = $1 AND status = $2', [createdTimesheetId, 'draft']).catch(() => {});
    throw err;
  }

  // Crew-confirmed: a draft timesheet becomes 'distributed' so it can be verified (TimesheetStatus.DISTRIBUTED).
  await db.query(`UPDATE timesheets SET status = 'distributed' WHERE id = $1 AND status = 'draft'`, [timesheet.id]);

  const finaliseResult = finalise ? await maybeFinalise(timesheet.id, user) : { finalised: false };
  await recordReview({ kind: 'timesheet', submissionId: id, action: 'approved', notes, revision: updated.revision, userId: user?.id });

  await logAudit({
    userId: user?.id, userName: user?.full_name, userRole: user?.role,
    productionId: submission.production_id, category: 'payroll', action: 'crew_timesheet_submission_approved',
    entityType: 'timesheet', entityId: timesheet.id,
    details: `Approved crew-submitted timesheet for ${submission.first_name} ${submission.last_name}, week ending ${submission.week_ending_date}`,
    metadata: { submission_id: id, timesheet_id: timesheet.id, created_timesheet: !!createdTimesheetId, finalised: finaliseResult.finalised },
  });

  // Self-employed crew: ask for the invoice straight away (repeat-safe per timesheet).
  let invoiceRequest = null;
  if (requestInvoice && submission.employment_status === 'self_employed' && !finaliseResult.finalised) {
    const { rows: [ts] } = await db.query('SELECT grand_total, invoice_attachment_url FROM timesheets WHERE id = $1', [timesheet.id]);
    if (ts && !ts.invoice_attachment_url) {
      try {
        invoiceRequest = await sendMessages({
          messageType: MESSAGE_TYPES.INVOICE_REQUEST,
          recipients: [{
            crewMemberId: submission.crew_member_id, productionId: submission.production_id,
            weekEndingDate: submission.week_ending_date, amount: Number(ts.grand_total || 0),
            relatedRecordType: 'timesheet', relatedRecordId: timesheet.id,
          }],
          userId: user?.id,
          idempotencyScope: `on-approval-${timesheet.id}`,
        });
      } catch (err) {
        invoiceRequest = { error: err.message };
      }
    }
  }

  return {
    submission: updated,
    timesheet_id: timesheet.id,
    timesheet_created: !!createdTimesheetId,
    finalise: finaliseResult,
    invoice_request: invoiceRequest ? (invoiceRequest.summary || invoiceRequest) : null,
  };
}

async function rejectSubmission(kind, id, action, { user, notes, notify = true }) {
  if (!notes || !String(notes).trim()) throw httpError(400, action === 'returned' ? 'Add a note telling the crew member what to change' : 'Add a reason for declining');
  const nextStatus = action === 'returned' ? SUBMISSION_STATUS.RETURNED : SUBMISSION_STATUS.DECLINED;
  const submission = await loadSubmission(kind, id);
  const updated = await claimForReview(kind, id, nextStatus, String(notes).trim(), user?.id);
  await recordReview({ kind, submissionId: id, action, notes, revision: updated.revision, userId: user?.id });
  await logAudit({
    userId: user?.id, userName: user?.full_name, userRole: user?.role,
    productionId: submission.production_id, category: 'payroll', action: `crew_${kind}_submission_${action}`,
    entityType: TABLE[kind], entityId: id,
    details: `${action === 'returned' ? 'Returned' : 'Declined'} crew ${kind} for ${submission.first_name} ${submission.last_name}, week ending ${submission.week_ending_date}`,
    metadata: { notes },
  });
  const notice = notify ? await sendSubmissionNotice({ action, kind, submission: updated, reviewerNotes: String(notes).trim(), userId: user?.id }) : null;
  return { submission: updated, notification: notice };
}

// ─── Invoices ────────────────────────────────────────────────────────────────

async function approveInvoice(id, { user, notes, finalise = false }) {
  const submission = await loadSubmission('invoice', id);
  if (submission.status !== SUBMISSION_STATUS.SUBMITTED) throw httpError(409, 'Only submissions waiting for review can be approved');

  const timesheet = await findTimesheet(submission.crew_member_id, submission.production_id, submission.week_ending_date);
  if (!timesheet) {
    throw httpError(409, 'There is no timesheet for this crew member, production and week yet. Approve their timesheet first, then approve the invoice.');
  }

  const attached = await invokeHandler(timesheetsController.attachInvoice, {
    params: { id: timesheet.id },
    body: { invoice_attachment_url: submission.file_url, invoice_attachment_name: submission.file_name },
    user,
  });
  if (attached.statusCode >= 400) throw errorFrom(attached, 'Could not attach the invoice to the timesheet');

  const updated = await claimForReview('invoice', id, SUBMISSION_STATUS.APPROVED, notes, user?.id, timesheet.id);
  const finaliseResult = finalise ? await maybeFinalise(timesheet.id, user) : { finalised: false };
  await recordReview({ kind: 'invoice', submissionId: id, action: 'approved', notes, revision: updated.revision, userId: user?.id });
  await logAudit({
    userId: user?.id, userName: user?.full_name, userRole: user?.role,
    productionId: submission.production_id, category: 'payroll', action: 'crew_invoice_submission_approved',
    entityType: 'timesheet', entityId: timesheet.id,
    details: `Approved crew-uploaded invoice for ${submission.first_name} ${submission.last_name}, week ending ${submission.week_ending_date}`,
    metadata: { submission_id: id, finalised: finaliseResult.finalised, invoice_number: submission.invoice_number },
  });
  return { submission: updated, timesheet_id: timesheet.id, finalise: finaliseResult };
}

module.exports = {
  invokeHandler,
  approveTimesheet,
  returnTimesheet: (id, opts) => rejectSubmission('timesheet', id, 'returned', opts),
  declineTimesheet: (id, opts) => rejectSubmission('timesheet', id, 'declined', opts),
  approveInvoice,
  returnInvoice: (id, opts) => rejectSubmission('invoice', id, 'returned', opts),
  declineInvoice: (id, opts) => rejectSubmission('invoice', id, 'declined', opts),
};
