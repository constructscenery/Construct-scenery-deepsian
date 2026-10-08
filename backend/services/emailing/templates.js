/**
 * Editable email templates + renderer.
 *
 * Template bodies are plain text with merge fields ({{first_name}} etc.), so office
 * staff never write HTML. Rendering escapes every value, turns blank-line separated
 * blocks into paragraphs and {{action_button}} into a branded button that links to
 * the crew member's secure portal.
 *
 * Portal URLs are rendered with PORTAL_TOKEN_MARKER in place of the real token.
 * The queue worker swaps in the real token just before sending, so the token is
 * never stored in email_log and never appears in previews or history.
 */
const db = require('../../config/db');
const { MESSAGE_TYPES, PORTAL_TOKEN_MARKER } = require('./constants');
const { formatUkDate } = require('./dates');

const DEFAULT_TEMPLATES = [
  {
    template_key: 'timesheet_reminder_default',
    name: 'Timesheet reminder',
    message_type: MESSAGE_TYPES.TIMESHEET_REMINDER,
    subject: 'Timesheet due — week ending {{week_ending}} ({{production_name}})',
    body: `Hi {{first_name}},

Please submit your timesheet for {{production_name}} for the week ending {{week_ending}}.

Use the button below to choose the week, fill in your days, overtime and allowances, and send it to the office. The office will approve it, or send it back with notes if anything needs changing.

{{action_button}}

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'timesheet_reminder_followup',
    name: 'Timesheet reminder — follow-up',
    message_type: MESSAGE_TYPES.TIMESHEET_REMINDER,
    subject: 'Reminder: timesheet still outstanding — week ending {{week_ending}}',
    body: `Hi {{first_name}},

We haven't received your timesheet for {{production_name}} for the week ending {{week_ending}} yet.

Please submit it as soon as possible so it can be approved in time for the pay run.

{{action_button}}

If you've already sent it, please ignore this message.

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'invoice_request_default',
    name: 'Invoice request',
    message_type: MESSAGE_TYPES.INVOICE_REQUEST,
    subject: 'Invoice required — week ending {{week_ending}} ({{production_name}})',
    body: `Hi {{first_name}},

Your timesheet for {{production_name}} for the week ending {{week_ending}} has been approved. Please upload your invoice for this week{{amount_sentence}}.

Quote your crew number {{crew_number}} on the invoice. You can upload a PDF, JPEG or PNG using the button below.

{{action_button}}

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'availability_poll_default',
    name: 'Availability request',
    message_type: MESSAGE_TYPES.AVAILABILITY_POLL,
    subject: 'Are you available? {{poll_title}} ({{poll_dates}})',
    body: `Hi {{first_name}},

We're planning crew for {{poll_title}} — {{poll_dates}}.

{{poll_message}}

Please let us know whether you're available using the button below{{poll_deadline_sentence}}.

{{action_button}}

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'manual_default',
    name: 'General message',
    message_type: MESSAGE_TYPES.MANUAL,
    subject: 'Message from Construct Scenery',
    body: `Hi {{first_name}},

Write your message here.

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'submission_returned_default',
    name: 'Submission returned for changes',
    message_type: MESSAGE_TYPES.SUBMISSION_RETURNED,
    subject: 'Please update your {{submission_label}} — week ending {{week_ending}}',
    body: `Hi {{first_name}},

Your {{submission_label}} for {{production_name}} for the week ending {{week_ending}} needs a few changes before it can be approved.

Notes from the office:
{{reviewer_notes}}

Please make the changes and resubmit using the button below.

{{action_button}}

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'submission_declined_default',
    name: 'Submission declined',
    message_type: MESSAGE_TYPES.SUBMISSION_DECLINED,
    subject: 'Your {{submission_label}} was declined — week ending {{week_ending}}',
    body: `Hi {{first_name}},

Your {{submission_label}} for {{production_name}} for the week ending {{week_ending}} has been declined.

Reason:
{{reviewer_notes}}

If you think this is a mistake, please reply to this email.

Thanks,
Construct Scenery`,
  },
  {
    template_key: 'submission_approved_default',
    name: 'Submission approved',
    message_type: MESSAGE_TYPES.SUBMISSION_APPROVED,
    subject: 'Your {{submission_label}} has been approved — week ending {{week_ending}}',
    body: `Hi {{first_name}},

Your {{submission_label}} for {{production_name}} for the week ending {{week_ending}} has been approved.

Thanks,
Construct Scenery`,
  },
];

/** Merge fields shown to staff in the template editor. */
const MERGE_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'full_name', label: 'Full name' },
  { key: 'crew_number', label: 'Crew number' },
  { key: 'production_name', label: 'Production' },
  { key: 'week_ending', label: 'Week ending (e.g. 12 Oct 2026)' },
  { key: 'amount_sentence', label: 'Invoice amount sentence (invoice requests)' },
  { key: 'poll_title', label: 'Availability title' },
  { key: 'poll_dates', label: 'Availability dates' },
  { key: 'poll_message', label: 'Availability message' },
  { key: 'poll_deadline_sentence', label: 'Availability reply-by sentence' },
  { key: 'submission_label', label: 'Submission label (timesheet / invoice)' },
  { key: 'reviewer_notes', label: 'Office notes (returned / declined)' },
  { key: 'portal_link', label: 'Secure portal link (plain link)' },
  { key: 'action_button', label: 'Action button (secure portal link)' },
];

const ACTION_LABELS = {
  [MESSAGE_TYPES.TIMESHEET_REMINDER]:  'Submit timesheet',
  [MESSAGE_TYPES.INVOICE_REQUEST]:     'Upload invoice',
  [MESSAGE_TYPES.AVAILABILITY_POLL]:   'Confirm availability',
  [MESSAGE_TYPES.SUBMISSION_RETURNED]: 'Update and resubmit',
  [MESSAGE_TYPES.MANUAL]:              'Open crew portal',
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ensured = false;
/** Inserts any missing system templates (idempotent; keyed by template_key). */
async function ensureDefaultTemplates() {
  if (ensured) return;
  for (const t of DEFAULT_TEMPLATES) {
    await db.query(
      `INSERT INTO email_templates (template_key, name, message_type, subject, body, is_system)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (template_key) DO NOTHING`,
      [t.template_key, t.name, t.message_type, t.subject, t.body]
    );
  }
  ensured = true;
}

function getDefaultTemplate(templateKey) {
  return DEFAULT_TEMPLATES.find((t) => t.template_key === templateKey) || null;
}

/** Base URL of the frontend that hosts /crew-portal/[token]. */
function portalBaseUrl() {
  const raw = process.env.CREW_PORTAL_URL || process.env.APP_URL || (process.env.CLIENT_URL || '').split(',')[0] || 'http://localhost:3000';
  return raw.trim().replace(/\/+$/, '');
}

/** Portal URL with the token marker; query params pre-select the relevant tab/week/poll. */
function portalUrl(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return `${portalBaseUrl()}/crew-portal/${PORTAL_TOKEN_MARKER}${qs ? `?${qs}` : ''}`;
}

/** Context values for merge fields. */
function buildContext({ crew = {}, production = null, weekEndingDate = null, poll = null, amount = null, submissionLabel = null, reviewerNotes = null }) {
  const pollDates = poll ? `${formatUkDate(poll.start_date)} – ${formatUkDate(poll.end_date)}` : '';
  return {
    first_name: crew.first_name || 'there',
    last_name: crew.last_name || '',
    full_name: [crew.first_name, crew.last_name].filter(Boolean).join(' '),
    crew_number: crew.crew_number || '',
    production_name: production?.name || 'your production',
    week_ending: weekEndingDate ? formatUkDate(weekEndingDate) : '',
    amount_sentence: amount != null && Number(amount) > 0 ? ` (timesheet total £${Number(amount).toFixed(2)})` : '',
    poll_title: poll?.title || '',
    poll_dates: pollDates,
    poll_message: poll?.message || '',
    poll_deadline_sentence: poll?.response_deadline ? ` by ${formatUkDate(poll.response_deadline)}` : '',
    submission_label: submissionLabel || 'submission',
    reviewer_notes: reviewerNotes || '',
  };
}

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Renders a plain-text template into { subject, html, text }.
 * Unknown merge fields render as empty strings.
 */
function renderTemplate({ subject, body, context = {}, actionUrl = null, actionLabel = 'Open crew portal', fromName = 'Construct Scenery' }) {
  const value = (key) => (key in context ? String(context[key] ?? '') : '');

  const renderedSubject = String(subject || '')
    .replace(TOKEN_RE, (_, key) => (key === 'action_button' || key === 'portal_link' ? '' : value(key)))
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 300);

  const button = actionUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0"><tr><td style="border-radius:6px;background:#2563eb"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px">${escapeHtml(actionLabel)} &rarr;</a></td></tr></table>`
    : '';
  const link = actionUrl ? `<a href="${escapeHtml(actionUrl)}" style="color:#2563eb">${escapeHtml(actionUrl)}</a>` : '';

  const htmlBody = String(body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^\{\{\s*action_button\s*\}\}$/.test(block)) return button;
      const inner = escapeHtml(block)
        .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => {
          if (key === 'action_button') return button;
          if (key === 'portal_link') return link;
          return escapeHtml(value(key)).replace(/\n/g, '<br/>');
        })
        .replace(/\n/g, '<br/>');
      return inner.trim() ? `<p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.6">${inner}</p>` : '';
    })
    .join('\n');

  const footerLink = actionUrl
    ? `<p style="color:#64748b;font-size:12px;margin:18px 0 0;line-height:1.5">If the button doesn't work, copy this link into your browser:<br/>${link}<br/>This link is personal to you — please don't forward it.</p>`
    : '';

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <div style="background:#0f172a;padding:16px 24px"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px">${escapeHtml(fromName)}</span><span style="color:#94a3b8;font-size:11px;margin-left:10px">Construct Scenery Limited</span></div>
  <div style="padding:24px">
${htmlBody}
${footerLink}
  </div>
  <div style="background:#f8fafc;padding:12px 24px;border-top:1px solid #e2e8f0"><p style="color:#94a3b8;font-size:11px;margin:0">Construct Scenery Limited · Unit 4C Canal Wharf, Station Road, Langley, SL3 6EG</p></div>
</div>`;

  const text = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(TOKEN_RE, (_, key) => {
      if (key === 'action_button') return actionUrl ? `${actionLabel}: ${actionUrl}` : '';
      if (key === 'portal_link') return actionUrl || '';
      return value(key);
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { subject: renderedSubject, html, text };
}

/** Replace the token marker with a real token (send time only). */
const materialise = (content, token) => (content ? String(content).split(PORTAL_TOKEN_MARKER).join(token) : content);
/** Hide the token marker for previews / history. */
const redact = (content) => (content ? String(content).split(PORTAL_TOKEN_MARKER).join('••••••••') : content);

module.exports = {
  DEFAULT_TEMPLATES, MERGE_FIELDS, ACTION_LABELS,
  ensureDefaultTemplates, getDefaultTemplate,
  portalBaseUrl, portalUrl, buildContext, renderTemplate,
  materialise, redact, escapeHtml,
  _resetEnsured: () => { ensured = false; },
};
