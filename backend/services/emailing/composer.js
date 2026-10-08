/**
 * Builds personalised messages from a template and puts them on the queue.
 * Used by the Emailing tab (individual + group sends), automations and
 * submission review notifications.
 */
const db = require('../../config/db');
const { MESSAGE_TYPES, SENDABLE_MESSAGE_TYPES } = require('./constants');
const {
  ensureDefaultTemplates, getDefaultTemplate, renderTemplate, buildContext,
  portalUrl, redact, ACTION_LABELS,
} = require('./templates');
const { getSendPolicy } = require('./settings');
const { enqueueEmail } = require('./queue');
const { loadCrewByIds, eligibility } = require('./recipients');
const { isSunday } = require('./dates');

const DEFAULT_KEY_BY_TYPE = {
  [MESSAGE_TYPES.TIMESHEET_REMINDER]:  'timesheet_reminder_default',
  [MESSAGE_TYPES.INVOICE_REQUEST]:     'invoice_request_default',
  [MESSAGE_TYPES.AVAILABILITY_POLL]:   'availability_poll_default',
  [MESSAGE_TYPES.MANUAL]:              'manual_default',
  [MESSAGE_TYPES.SUBMISSION_APPROVED]: 'submission_approved_default',
  [MESSAGE_TYPES.SUBMISSION_RETURNED]: 'submission_returned_default',
  [MESSAGE_TYPES.SUBMISSION_DECLINED]: 'submission_declined_default',
};

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** Loads a template by id, by key, or the default for a message type. */
async function resolveTemplate({ templateId, templateKey, messageType }) {
  await ensureDefaultTemplates();
  if (templateId) {
    const { rows: [t] } = await db.query('SELECT * FROM email_templates WHERE id = $1', [templateId]);
    if (!t) throw badRequest('Template not found');
    return t;
  }
  const key = templateKey || DEFAULT_KEY_BY_TYPE[messageType];
  if (key) {
    const { rows: [t] } = await db.query('SELECT * FROM email_templates WHERE template_key = $1', [key]);
    if (t) return t;
    const fallback = getDefaultTemplate(key);
    if (fallback) return { id: null, ...fallback };
  }
  throw badRequest('No template available for this message type');
}

async function loadProductions(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { rows } = await db.query('SELECT id, name, status FROM productions WHERE id = ANY($1::uuid[])', [unique]);
  return new Map(rows.map((p) => [p.id, p]));
}

async function loadPoll(pollId) {
  if (!pollId) return null;
  const { rows: [poll] } = await db.query('SELECT * FROM availability_polls WHERE id = $1', [pollId]);
  return poll || null;
}

/** Portal deep link (with token marker) for a message type. */
function actionUrlFor(messageType, { productionId, weekEndingDate, pollId, tab }) {
  switch (messageType) {
    case MESSAGE_TYPES.TIMESHEET_REMINDER:
      return portalUrl({ tab: 'timesheet', production: productionId, week: weekEndingDate });
    case MESSAGE_TYPES.INVOICE_REQUEST:
      return portalUrl({ tab: 'invoices', production: productionId, week: weekEndingDate });
    case MESSAGE_TYPES.AVAILABILITY_POLL:
      return portalUrl({ tab: 'availability', poll: pollId });
    case MESSAGE_TYPES.SUBMISSION_RETURNED:
      return portalUrl({ tab: tab || 'timesheet', production: productionId, week: weekEndingDate });
    case MESSAGE_TYPES.MANUAL:
      return portalUrl({});
    default:
      return null;
  }
}

function validateSendRequest({ messageType, recipients, pollId }) {
  if (!SENDABLE_MESSAGE_TYPES.includes(messageType)) throw badRequest(`message_type must be one of: ${SENDABLE_MESSAGE_TYPES.join(', ')}`);
  if (!Array.isArray(recipients) || !recipients.length) throw badRequest('Select at least one recipient');
  if (recipients.length > 500) throw badRequest('A single send is limited to 500 recipients');
  for (const r of recipients) {
    if (!r || !r.crewMemberId) throw badRequest('Each recipient needs a crew_member_id');
    if ([MESSAGE_TYPES.TIMESHEET_REMINDER, MESSAGE_TYPES.INVOICE_REQUEST].includes(messageType)) {
      if (!r.productionId) throw badRequest('Timesheet reminders and invoice requests need a production for each recipient');
      if (!isSunday(r.weekEndingDate)) throw badRequest('week_ending_date must be a Sunday (YYYY-MM-DD)');
    }
  }
  if (messageType === MESSAGE_TYPES.AVAILABILITY_POLL && !pollId) throw badRequest('poll_id is required for availability requests');
}

function renderFor({ messageType, template, subject, body, crew, production, weekEndingDate, poll, amount, submissionLabel, reviewerNotes, fromName, tab }) {
  const context = buildContext({ crew, production, weekEndingDate, poll, amount, submissionLabel, reviewerNotes });
  const actionUrl = actionUrlFor(messageType, { productionId: production?.id, weekEndingDate, pollId: poll?.id, tab });
  return renderTemplate({
    subject: subject ?? template.subject,
    body: body ?? template.body,
    context,
    actionUrl,
    actionLabel: ACTION_LABELS[messageType] || 'Open crew portal',
    fromName,
  });
}

/**
 * Preview for one recipient (portal token redacted) plus eligibility of every recipient.
 */
async function previewMessages({ messageType, recipients, subject, body, templateId, pollId }) {
  validateSendRequest({ messageType, recipients, pollId });
  const template = await resolveTemplate({ templateId, messageType });
  const policy = await getSendPolicy();
  const crewRows = await loadCrewByIds([...new Set(recipients.map((r) => r.crewMemberId))]);
  const crewById = new Map(crewRows.map((c) => [c.id, c]));
  const productions = await loadProductions(recipients.map((r) => r.productionId));
  const poll = await loadPoll(pollId);
  if (messageType === MESSAGE_TYPES.AVAILABILITY_POLL && !poll) throw badRequest('Availability request not found');

  const first = recipients.find((r) => crewById.has(r.crewMemberId)) || recipients[0];
  const rendered = renderFor({
    messageType, template, subject, body,
    crew: crewById.get(first.crewMemberId) || {},
    production: productions.get(first.productionId) || null,
    weekEndingDate: first.weekEndingDate, poll, amount: first.amount,
    fromName: policy.settings.from_name,
  });

  const checks = recipients.map((r) => {
    const crew = crewById.get(r.crewMemberId);
    const { eligible, reason } = eligibility(crew, policy);
    return {
      crew_member_id: r.crewMemberId,
      production_id: r.productionId || null,
      week_ending_date: r.weekEndingDate || null,
      name: crew ? `${crew.first_name} ${crew.last_name}` : null,
      email: crew?.email || null,
      eligible,
      reason,
    };
  });

  return {
    subject: rendered.subject,
    html: redact(rendered.html),
    text: redact(rendered.text),
    live_sending_enabled: policy.live,
    recipients: checks,
    summary: { total: checks.length, eligible: checks.filter((c) => c.eligible).length },
  };
}

/**
 * Renders and enqueues one message per recipient, grouped under an email_batches row.
 * @param {object} opts
 * @param {string} [opts.idempotencyScope] — makes the send repeat-safe (e.g. a client
 *        request id, or 'auto:initial' for automations). Combined with the recipient,
 *        production and week into email_log.idempotency_key.
 */
async function sendMessages({
  messageType, recipients, subject, body, templateId, templateKey, pollId,
  userId = null, isAutomated = false, idempotencyScope = null,
}) {
  validateSendRequest({ messageType, recipients, pollId });
  const template = await resolveTemplate({ templateId, templateKey, messageType });
  const finalSubject = (subject ?? template.subject ?? '').trim();
  const finalBody = (body ?? template.body ?? '').trim();
  if (!finalSubject) throw badRequest('Subject is required');
  if (!finalBody) throw badRequest('Message body is required');
  if (finalSubject.length > 300) throw badRequest('Subject is too long (max 300 characters)');
  if (finalBody.length > 20000) throw badRequest('Message is too long (max 20,000 characters)');

  const policy = await getSendPolicy();
  const crewRows = await loadCrewByIds([...new Set(recipients.map((r) => r.crewMemberId))]);
  const crewById = new Map(crewRows.map((c) => [c.id, c]));
  const productions = await loadProductions(recipients.map((r) => r.productionId));
  const poll = await loadPoll(pollId);
  if (messageType === MESSAGE_TYPES.AVAILABILITY_POLL) {
    if (!poll) throw badRequest('Availability request not found');
    if (poll.closed_at) throw badRequest('This availability request is closed');
  }

  const singleProduction = new Set(recipients.map((r) => r.productionId || '')).size === 1 ? (recipients[0].productionId || null) : null;
  const singleWeek = new Set(recipients.map((r) => r.weekEndingDate || '')).size === 1 ? (recipients[0].weekEndingDate || null) : null;

  const { rows: [batch] } = await db.query(
    `INSERT INTO email_batches (message_type, template_id, subject, body, production_id, week_ending_date, availability_poll_id, is_automated, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [messageType, template.id || null, finalSubject, finalBody, singleProduction, singleWeek, poll?.id || null, isAutomated, userId]
  );

  const results = [];
  for (const r of recipients) {
    const crew = crewById.get(r.crewMemberId);
    const base = {
      crew_member_id: r.crewMemberId,
      production_id: r.productionId || null,
      week_ending_date: r.weekEndingDate || null,
      name: crew ? `${crew.first_name} ${crew.last_name}` : null,
      email: crew?.email || null,
    };
    const check = eligibility(crew, policy);
    if (!check.eligible && check.reason !== 'suppressed') {
      results.push({ ...base, status: 'skipped', reason: check.reason });
      continue;
    }

    if (poll) {
      await db.query(
        `INSERT INTO availability_poll_recipients (poll_id, crew_member_id)
         VALUES ($1, $2) ON CONFLICT (poll_id, crew_member_id) DO NOTHING`,
        [poll.id, crew.id]
      );
    }

    const production = productions.get(r.productionId) || null;
    const rendered = renderFor({
      messageType, template, subject: finalSubject, body: finalBody,
      crew, production, weekEndingDate: r.weekEndingDate, poll, amount: r.amount,
      fromName: policy.settings.from_name,
    });

    const idempotencyKey = idempotencyScope
      ? [messageType, idempotencyScope, crew.id, r.productionId || '-', r.weekEndingDate || '-', poll?.id || '-'].join(':')
      : null;

    const outcome = await enqueueEmail({
      messageType,
      to: crew.email,
      recipientName: base.name,
      crewMemberId: crew.id,
      productionId: r.productionId || null,
      weekEndingDate: r.weekEndingDate || null,
      relatedRecordType: r.relatedRecordType || (poll ? 'availability_poll' : null),
      relatedRecordId: r.relatedRecordId || poll?.id || null,
      templateId: template.id || null,
      batchId: batch.id,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey,
      isAutomated,
      sentBy: userId,
      policy,
    });
    results.push({ ...base, status: outcome.status, reason: outcome.reason || null, email_log_id: outcome.id || null });
  }

  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  return { batch_id: batch.id, live_sending_enabled: policy.live, summary, results };
}

/**
 * Notifies a crew member that a submission was returned / declined / approved.
 * Never throws — review actions must succeed even if the email can't be queued.
 */
async function sendSubmissionNotice({ action, kind, submission, reviewerNotes, userId }) {
  const messageType = {
    returned: MESSAGE_TYPES.SUBMISSION_RETURNED,
    declined: MESSAGE_TYPES.SUBMISSION_DECLINED,
    approved: MESSAGE_TYPES.SUBMISSION_APPROVED,
  }[action];
  try {
    const template = await resolveTemplate({ messageType });
    const policy = await getSendPolicy();
    const [crew] = await loadCrewByIds([submission.crew_member_id]);
    if (!crew) return { status: 'skipped', reason: 'not_found' };
    const check = eligibility(crew, policy);
    if (!check.eligible && check.reason !== 'suppressed') return { status: 'skipped', reason: check.reason };
    const production = (await loadProductions([submission.production_id])).get(submission.production_id) || null;
    const rendered = renderFor({
      messageType, template, crew, production,
      weekEndingDate: submission.week_ending_date,
      submissionLabel: kind === 'invoice' ? 'invoice' : 'timesheet',
      reviewerNotes,
      tab: kind === 'invoice' ? 'invoices' : 'timesheet',
      fromName: policy.settings.from_name,
    });
    return await enqueueEmail({
      messageType,
      to: crew.email,
      recipientName: `${crew.first_name} ${crew.last_name}`,
      crewMemberId: crew.id,
      productionId: submission.production_id,
      weekEndingDate: submission.week_ending_date,
      relatedRecordType: kind === 'invoice' ? 'crew_invoice_submission' : 'crew_timesheet_submission',
      relatedRecordId: submission.id,
      templateId: template.id || null,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `${messageType}:${submission.id}:r${submission.revision || 1}`,
      sentBy: userId,
      policy,
    });
  } catch (err) {
    console.error('[emailing] submission notice failed:', err.message);
    return { status: 'error', reason: err.message };
  }
}

module.exports = { resolveTemplate, previewMessages, sendMessages, sendSubmissionNotice, actionUrlFor, DEFAULT_KEY_BY_TYPE };
