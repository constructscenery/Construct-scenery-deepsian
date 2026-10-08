/**
 * Emailing tab — staff API (/api/emailing). Authenticated + policy checked.
 *
 * Covers: overview, settings & internal test group, provider status, templates,
 * recipients & suggested groups, preview + send (individual / group), message
 * history, retries, suppressions, crew submission review (timesheets + invoices),
 * availability polls, portal links and manual automation runs.
 */
const db = require('../config/db');
const fileStorage = require('../services/fileStorage');
const { logAudit } = require('../services/auditService');
const settingsSvc = require('../services/emailing/settings');
const templatesSvc = require('../services/emailing/templates');
const composer = require('../services/emailing/composer');
const recipientsSvc = require('../services/emailing/recipients');
const queue = require('../services/emailing/queue');
const ses = require('../services/emailing/sesSender');
const portalLinks = require('../services/emailing/portalLinks');
const review = require('../services/emailing/submissionReview');
const { runAutomation, AUTOMATIONS } = require('../services/emailing/automations');
const {
  MESSAGE_TYPES, SENDABLE_MESSAGE_TYPES, DELIVERY_STATUS, SUBMISSION_STATUS,
  CREW_AVAILABILITY_STATUSES, SUPPRESSION_REASONS, PORTAL_TOKEN_MARKER,
} = require('../services/emailing/constants');
const { isIsoDate, isSunday } = require('../services/emailing/dates');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.code === '42P01') {
      // Emailing tables missing — migration not run yet.
      console.error('[emailing] tables missing — run `npm run migration:run` in backend/ or restart the API so the schema guard creates them.');
      return res.status(503).json({ error: 'Emailing is not set up on this database yet. Restart the backend (it creates the tables on start) or run `npm run migration:run` in backend/.', code: 'EMAILING_NOT_MIGRATED' });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(`[emailing] ${req.method} ${req.originalUrl}:`, err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message, ...(err.code ? { code: err.code } : {}) });
  }
};
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message = 'Not found') => Object.assign(new Error(message), { status: 404 });
const requireUuid = (value, label = 'id') => { if (!isUuid(value)) throw badRequest(`Invalid ${label}`); return value; };
const pageParams = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
};

// Body text is redacted (no portal tokens are ever stored), but strip the marker for display too.
const presentLog = (row) => ({
  ...row,
  status: row.status || (row.success ? DELIVERY_STATUS.SENT : DELIVERY_STATUS.FAILED),
  body_html: templatesSvc.redact(row.body_html),
  body_text: templatesSvc.redact(row.body_text),
});

// ─── Overview ────────────────────────────────────────────────────────────────
const getOverview = handle(async (_req, res) => {
  const settings = await settingsSvc.getSettings();
  const [{ rows: [counts] }, { rows: [subs] }, { rows: [supp] }, { rows: [polls] }] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','sending'))                                   AS queued,
        COUNT(*) FILTER (WHERE status IN ('sent','delivered') AND created_at >= NOW() - INTERVAL '7 days') AS sent_7d,
        COUNT(*) FILTER (WHERE status = 'delivered' AND created_at >= NOW() - INTERVAL '7 days') AS delivered_7d,
        COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '7 days')   AS failed_7d,
        COUNT(*) FILTER (WHERE status IN ('bounced','soft_bounced','complained','rejected') AND created_at >= NOW() - INTERVAL '30 days') AS problems_30d
      FROM email_log WHERE message_type IS NOT NULL`),
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM crew_timesheet_submissions WHERE status = 'submitted') AS timesheets_pending,
        (SELECT COUNT(*) FROM crew_invoice_submissions   WHERE status = 'submitted') AS invoices_pending`),
    db.query(`SELECT COUNT(*) AS suppressed FROM email_suppressions WHERE cleared_at IS NULL`),
    db.query(`SELECT COUNT(*) AS open_polls FROM availability_polls WHERE closed_at IS NULL`),
  ]);
  const toInt = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, parseInt(v, 10) || 0]));
  res.json({
    settings,
    messages: toInt(counts),
    submissions: toInt(subs),
    suppressions: toInt(supp),
    polls: toInt(polls),
  });
});

// ─── Settings & test group ───────────────────────────────────────────────────
const getSettings = handle(async (_req, res) => {
  const [settings, testRecipients] = await Promise.all([
    settingsSvc.getSettings({ fresh: true }),
    settingsSvc.listTestRecipients(),
  ]);
  res.json({ settings, test_recipients: testRecipients, automations: AUTOMATIONS });
});

const updateSettings = handle(async (req, res) => {
  const before = await settingsSvc.getSettings({ fresh: true });
  const settings = await settingsSvc.updateSettings(req.body, req.user.id);
  const changed = Object.keys(req.body || {}).filter((k) => before[k] !== settings[k]);
  if (changed.length) {
    await logAudit({
      userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
      category: 'general', action: 'email_settings_updated', entityType: 'email_settings',
      details: `Updated email settings: ${changed.map((k) => `${k} → ${settings[k]}`).join(', ')}`,
      metadata: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, settings[k]])) },
    });
  }
  res.json({ settings });
});

const listTestRecipients = handle(async (_req, res) => res.json(await settingsSvc.listTestRecipients()));
const addTestRecipient = handle(async (req, res) => res.status(201).json(await settingsSvc.addTestRecipient(req.body || {}, req.user.id)));
const removeTestRecipient = handle(async (req, res) => {
  requireUuid(req.params.id);
  if (!(await settingsSvc.removeTestRecipient(req.params.id))) throw notFound('Test recipient not found');
  res.json({ message: 'Removed from test group' });
});

const getProviderStatus = handle(async (_req, res) => res.json(await ses.getProviderStatus()));

// ─── Templates ───────────────────────────────────────────────────────────────
const listTemplates = handle(async (req, res) => {
  await templatesSvc.ensureDefaultTemplates();
  const params = [];
  let where = '';
  if (req.query.message_type) { params.push(req.query.message_type); where = 'WHERE t.message_type = $1'; }
  const { rows } = await db.query(
    `SELECT t.*, u.full_name AS updated_by_name
     FROM email_templates t LEFT JOIN users u ON u.id = t.updated_by
     ${where}
     ORDER BY t.message_type, t.is_system DESC, t.name`,
    params
  );
  res.json({ templates: rows, merge_fields: templatesSvc.MERGE_FIELDS });
});

const ALL_TEMPLATE_TYPES = Object.values(MESSAGE_TYPES);
function validateTemplateInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) throw badRequest('Name is required (max 120 characters)');
    out.name = name;
  }
  if (!partial || body.message_type !== undefined) {
    if (!ALL_TEMPLATE_TYPES.includes(body.message_type)) throw badRequest(`message_type must be one of: ${ALL_TEMPLATE_TYPES.join(', ')}`);
    out.message_type = body.message_type;
  }
  if (!partial || body.subject !== undefined) {
    const subject = String(body.subject || '').trim();
    if (!subject || subject.length > 300) throw badRequest('Subject is required (max 300 characters)');
    out.subject = subject;
  }
  if (!partial || body.body !== undefined) {
    const text = String(body.body || '').trim();
    if (!text || text.length > 20000) throw badRequest('Message body is required (max 20,000 characters)');
    out.body = text;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') throw badRequest('is_active must be true or false');
    out.is_active = body.is_active;
  }
  return out;
}

const createTemplate = handle(async (req, res) => {
  const t = validateTemplateInput(req.body || {});
  const { rows: [row] } = await db.query(
    `INSERT INTO email_templates (name, message_type, subject, body, is_active, is_system, created_by, updated_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, true), false, $6, $6) RETURNING *`,
    [t.name, t.message_type, t.subject, t.body, t.is_active ?? null, req.user.id]
  );
  res.status(201).json(row);
});

const updateTemplate = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [existing] } = await db.query('SELECT * FROM email_templates WHERE id = $1', [req.params.id]);
  if (!existing) throw notFound('Template not found');
  const t = validateTemplateInput(req.body || {}, { partial: true });
  if (existing.is_system && t.message_type && t.message_type !== existing.message_type) throw badRequest('The message type of a system template cannot be changed');
  const keys = Object.keys(t);
  if (!keys.length) throw badRequest('Nothing to update');
  const { rows: [row] } = await db.query(
    `UPDATE email_templates SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_by = $${keys.length + 2}, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id, ...keys.map((k) => t[k]), req.user.id]
  );
  res.json(row);
});

const deleteTemplate = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [existing] } = await db.query('SELECT is_system FROM email_templates WHERE id = $1', [req.params.id]);
  if (!existing) throw notFound('Template not found');
  if (existing.is_system) throw badRequest('System templates cannot be deleted — edit or reset them instead');
  await db.query('DELETE FROM email_templates WHERE id = $1', [req.params.id]);
  res.json({ message: 'Template deleted' });
});

const resetTemplate = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [existing] } = await db.query('SELECT template_key FROM email_templates WHERE id = $1', [req.params.id]);
  if (!existing) throw notFound('Template not found');
  const def = templatesSvc.getDefaultTemplate(existing.template_key);
  if (!def) throw badRequest('Only system templates can be reset');
  const { rows: [row] } = await db.query(
    `UPDATE email_templates SET name = $2, subject = $3, body = $4, is_active = true, updated_by = $5, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id, def.name, def.subject, def.body, req.user.id]
  );
  res.json(row);
});

// ─── Recipients ──────────────────────────────────────────────────────────────
const listRecipients = handle(async (req, res) => {
  const productionId = req.query.production_id && isUuid(req.query.production_id) ? req.query.production_id : null;
  const [rows, policy] = await Promise.all([
    recipientsSvc.searchCrew({ search: req.query.search ? String(req.query.search).slice(0, 100) : null, productionId, limit: req.query.limit }),
    settingsSvc.getSendPolicy(),
  ]);
  res.json(rows.map((c) => ({ ...c, ...recipientsSvc.eligibility(c, policy) })));
});

const getRecipientGroup = handle(async (req, res) => {
  const { group } = req.query;
  const productionId = req.query.production_id && isUuid(req.query.production_id) ? req.query.production_id : null;
  const policy = await settingsSvc.getSendPolicy();
  let rows;
  if (group === 'timesheet_missing') {
    if (!isSunday(req.query.week_ending_date)) throw badRequest('week_ending_date must be a Sunday (YYYY-MM-DD)');
    rows = (await recipientsSvc.timesheetMissing({ weekEndingDate: req.query.week_ending_date, productionId }))
      .map((r) => ({ ...r, week_ending_date: req.query.week_ending_date }));
  } else if (group === 'invoice_missing') {
    if (req.query.week_ending_date && !isSunday(req.query.week_ending_date)) throw badRequest('week_ending_date must be a Sunday (YYYY-MM-DD)');
    rows = await recipientsSvc.invoiceMissing({ weekEndingDate: req.query.week_ending_date || null, productionId });
  } else if (group === 'poll_non_responders') {
    requireUuid(req.query.poll_id, 'poll_id');
    rows = await recipientsSvc.pollNonResponders(req.query.poll_id);
  } else {
    throw badRequest('group must be timesheet_missing, invoice_missing or poll_non_responders');
  }
  res.json(rows.map((c) => ({ ...c, ...recipientsSvc.eligibility(c, policy) })));
});

// ─── Preview & send ──────────────────────────────────────────────────────────
function parseSendBody(body = {}) {
  const messageType = body.message_type;
  if (!SENDABLE_MESSAGE_TYPES.includes(messageType)) throw badRequest(`message_type must be one of: ${SENDABLE_MESSAGE_TYPES.join(', ')}`);
  const raw = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = raw.map((r) => ({
    crewMemberId: isUuid(r?.crew_member_id) ? r.crew_member_id : null,
    productionId: r?.production_id ? (isUuid(r.production_id) ? r.production_id : 'invalid') : (isUuid(body.production_id) ? body.production_id : null),
    weekEndingDate: r?.week_ending_date || body.week_ending_date || null,
    amount: r?.amount != null && Number.isFinite(Number(r.amount)) ? Number(r.amount) : undefined,
  }));
  if (recipients.some((r) => !r.crewMemberId)) throw badRequest('Every recipient needs a valid crew_member_id');
  if (recipients.some((r) => r.productionId === 'invalid')) throw badRequest('Invalid production_id');
  if (body.poll_id && !isUuid(body.poll_id)) throw badRequest('Invalid poll_id');
  if (body.template_id && !isUuid(body.template_id)) throw badRequest('Invalid template_id');
  if (body.client_request_id && !/^[A-Za-z0-9_-]{8,64}$/.test(body.client_request_id)) throw badRequest('Invalid client_request_id');
  return {
    messageType,
    recipients,
    subject: typeof body.subject === 'string' ? body.subject : undefined,
    body: typeof body.body === 'string' ? body.body : undefined,
    templateId: body.template_id || undefined,
    pollId: body.poll_id || undefined,
    clientRequestId: body.client_request_id || null,
  };
}

const preview = handle(async (req, res) => {
  const p = parseSendBody(req.body);
  res.json(await composer.previewMessages(p));
});

const send = handle(async (req, res) => {
  const p = parseSendBody(req.body);
  const result = await composer.sendMessages({
    ...p,
    userId: req.user.id,
    // Double-click / retry protection: the same client_request_id never sends twice.
    idempotencyScope: p.clientRequestId ? `req-${p.clientRequestId}` : null,
  });
  await logAudit({
    userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
    category: 'general', action: 'crew_email_sent', entityType: 'email_batch', entityId: result.batch_id,
    details: `Sent ${p.messageType.replace(/_/g, ' ')} to ${result.summary.queued || 0} recipient(s)`,
    metadata: { summary: result.summary, message_type: p.messageType },
  });
  res.status(201).json(result);
});

// ─── History ─────────────────────────────────────────────────────────────────
const listMessages = handle(async (req, res) => {
  const { limit, offset, page } = pageParams(req.query);
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.include_legacy !== 'true') where.push('el.message_type IS NOT NULL');
  if (req.query.crew_member_id) add('el.crew_member_id = ?', requireUuid(req.query.crew_member_id, 'crew_member_id'));
  if (req.query.production_id) add('el.production_id = ?', requireUuid(req.query.production_id, 'production_id'));
  if (req.query.batch_id) add('el.batch_id = ?', requireUuid(req.query.batch_id, 'batch_id'));
  if (req.query.message_type) add('COALESCE(el.message_type, el.module) = ?', String(req.query.message_type));
  if (req.query.status) add(`COALESCE(el.status, CASE WHEN el.success THEN 'sent' ELSE 'failed' END) = ?`, String(req.query.status));
  if (req.query.search) add(`(el.recipient_email ILIKE ? OR el.recipient_name ILIKE $${params.length + 1} OR el.subject ILIKE $${params.length + 1})`, `%${String(req.query.search).slice(0, 100)}%`);
  if (req.query.from && isIsoDate(req.query.from)) add('el.sent_at >= ?::date', req.query.from);
  if (req.query.to && isIsoDate(req.query.to)) add(`el.sent_at < (?::date + INTERVAL '1 day')`, req.query.to);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [{ rows }, { rows: [count] }] = await Promise.all([
    db.query(
      `SELECT el.id, el.module, el.message_type, el.subject, el.recipient_email, el.recipient_name,
              el.crew_member_id, el.production_id, el.week_ending_date, el.batch_id,
              el.related_record_type, el.related_record_id,
              COALESCE(el.status, CASE WHEN el.success THEN 'sent' ELSE 'failed' END) AS status,
              el.status_updated_at, el.attempts, el.error_message, el.provider_message_id,
              el.is_automated, el.is_test, el.sent_at, el.created_at, el.delivered_at,
              p.name AS production_name, u.full_name AS sent_by_name, cm.crew_number
       FROM email_log el
       LEFT JOIN productions p ON p.id = el.production_id
       LEFT JOIN users u ON u.id = el.sent_by
       LEFT JOIN crew_members cm ON cm.id = el.crew_member_id
       ${whereSql}
       ORDER BY COALESCE(el.created_at, el.sent_at) DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    db.query(`SELECT COUNT(*) AS total FROM email_log el ${whereSql}`, params),
  ]);
  res.json({ messages: rows, total: parseInt(count?.total, 10) || 0, page, limit });
});

const getMessage = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [row] } = await db.query(
    `SELECT el.*, p.name AS production_name, u.full_name AS sent_by_name, cm.crew_number, cm.first_name, cm.last_name
     FROM email_log el
     LEFT JOIN productions p ON p.id = el.production_id
     LEFT JOIN users u ON u.id = el.sent_by
     LEFT JOIN crew_members cm ON cm.id = el.crew_member_id
     WHERE el.id = $1`,
    [req.params.id]
  );
  if (!row) throw notFound('Message not found');
  const { rows: events } = await db.query(
    `SELECT id, event_type, recipient_email, bounce_type, bounce_subtype, diagnostic, occurred_at
     FROM email_events WHERE email_log_id = $1 ORDER BY occurred_at`,
    [req.params.id]
  );
  const { idempotency_key, ...rest } = row;
  res.json({ ...presentLog(rest), events });
});

const retryMessage = handle(async (req, res) => {
  requireUuid(req.params.id);
  if (!(await queue.retryEmail(req.params.id, req.user.id))) throw Object.assign(new Error('Only failed or cancelled messages can be retried'), { status: 409 });
  res.json({ message: 'Message queued for retry' });
});

const cancelMessage = handle(async (req, res) => {
  requireUuid(req.params.id);
  if (!(await queue.cancelEmail(req.params.id))) throw Object.assign(new Error('Only queued messages can be cancelled'), { status: 409 });
  res.json({ message: 'Message cancelled' });
});

const processQueueNow = handle(async (_req, res) => res.json(await queue.processQueue()));

// ─── Suppressions ────────────────────────────────────────────────────────────
const listSuppressions = handle(async (req, res) => {
  const includeCleared = req.query.include_cleared === 'true';
  const { rows } = await db.query(
    `SELECT s.*, cb.full_name AS cleared_by_name, crb.full_name AS created_by_name,
            (SELECT json_agg(json_build_object('id', cm.id, 'name', cm.first_name || ' ' || cm.last_name, 'crew_number', cm.crew_number))
             FROM crew_members cm WHERE LOWER(cm.email) = LOWER(s.email)) AS crew
     FROM email_suppressions s
     LEFT JOIN users cb ON cb.id = s.cleared_by
     LEFT JOIN users crb ON crb.id = s.created_by
     ${includeCleared ? '' : 'WHERE s.cleared_at IS NULL'}
     ORDER BY s.created_at DESC
     LIMIT 500`
  );
  res.json(rows);
});

const addSuppression = handle(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) throw badRequest('Email is required');
  const { rows } = await db.query(
    `INSERT INTO email_suppressions (email, reason, detail, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ((LOWER(email))) WHERE cleared_at IS NULL DO NOTHING
     RETURNING *`,
    [email, SUPPRESSION_REASONS.MANUAL, req.body?.detail ? String(req.body.detail).slice(0, 500) : null, req.user.id]
  );
  if (!rows.length) throw Object.assign(new Error('That address is already suppressed'), { status: 409 });
  res.status(201).json(rows[0]);
});

const clearSuppression = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows } = await db.query(
    `UPDATE email_suppressions SET cleared_at = NOW(), cleared_by = $2, cleared_note = $3
     WHERE id = $1 AND cleared_at IS NULL RETURNING *`,
    [req.params.id, req.user.id, req.body?.note ? String(req.body.note).slice(0, 500) : null]
  );
  if (!rows.length) throw notFound('Active suppression not found');
  await logAudit({
    userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
    category: 'general', action: 'email_suppression_cleared', entityType: 'email_suppression', entityId: req.params.id,
    details: `Cleared email suppression for ${rows[0].email}`,
  });
  res.json(rows[0]);
});

// ─── Submissions ─────────────────────────────────────────────────────────────
const SUBMISSION_TABLES = { timesheets: 'crew_timesheet_submissions', invoices: 'crew_invoice_submissions' };

function submissionListHandler(kind) {
  return handle(async (req, res) => {
    const table = SUBMISSION_TABLES[kind];
    const params = [];
    const where = [];
    const status = req.query.status || SUBMISSION_STATUS.SUBMITTED;
    if (status !== 'all') {
      if (!Object.values(SUBMISSION_STATUS).includes(status)) throw badRequest('Invalid status');
      params.push(status); where.push(`s.status = $${params.length}`);
    }
    if (req.query.production_id) { params.push(requireUuid(req.query.production_id, 'production_id')); where.push(`s.production_id = $${params.length}`); }
    if (req.query.week_ending_date && isIsoDate(req.query.week_ending_date)) { params.push(req.query.week_ending_date); where.push(`s.week_ending_date = $${params.length}`); }
    if (req.query.crew_member_id) { params.push(requireUuid(req.query.crew_member_id, 'crew_member_id')); where.push(`s.crew_member_id = $${params.length}`); }
    if (req.query.search) {
      params.push(`%${String(req.query.search).slice(0, 100)}%`);
      where.push(`((cm.first_name || ' ' || cm.last_name) ILIKE $${params.length} OR cm.crew_number ILIKE $${params.length})`);
    }
    const extra = kind === 'timesheets'
      ? `, (SELECT COUNT(*) FILTER (WHERE e.full_day_worked) FROM crew_timesheet_submission_entries e WHERE e.submission_id = s.id) AS days_worked,
         (SELECT COALESCE(SUM(e.overtime_hours), 0) FROM crew_timesheet_submission_entries e WHERE e.submission_id = s.id) AS overtime_hours`
      : '';
    const { rows } = await db.query(
      `SELECT s.*, cm.first_name, cm.last_name, cm.crew_number, cm.email, cm.employment_status, cm.crew_trade, cm.crew_rank,
              p.name AS production_name, u.full_name AS reviewed_by_name,
              t.status AS timesheet_status ${extra}
       FROM ${table} s
       JOIN crew_members cm ON cm.id = s.crew_member_id
       JOIN productions p ON p.id = s.production_id
       LEFT JOIN users u ON u.id = s.reviewed_by
       LEFT JOIN timesheets t ON t.crew_member_id = s.crew_member_id AND t.production_id = s.production_id AND t.week_ending_date = s.week_ending_date
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.submitted_at DESC
       LIMIT 300`,
      params
    );
    res.json(rows.map(({ file_key, ...r }) => r));
  });
}

async function loadReviews(kind, id) {
  const col = kind === 'invoices' ? 'invoice_submission_id' : 'timesheet_submission_id';
  const { rows } = await db.query(
    `SELECT r.id, r.action, r.notes, r.revision, r.actor_type, r.created_at, u.full_name AS actor_name
     FROM crew_submission_reviews r LEFT JOIN users u ON u.id = r.actor_user_id
     WHERE r.${col} = $1 ORDER BY r.created_at`,
    [id]
  );
  return rows;
}

const getTimesheetSubmission = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [s] } = await db.query(
    `SELECT s.*, cm.first_name, cm.last_name, cm.crew_number, cm.email, cm.employment_status, cm.crew_trade, cm.crew_rank,
            p.name AS production_name, p.status AS production_status, u.full_name AS reviewed_by_name,
            t.id AS existing_timesheet_id, t.status AS timesheet_status, t.grand_total AS timesheet_grand_total
     FROM crew_timesheet_submissions s
     JOIN crew_members cm ON cm.id = s.crew_member_id
     JOIN productions p ON p.id = s.production_id
     LEFT JOIN users u ON u.id = s.reviewed_by
     LEFT JOIN timesheets t ON t.crew_member_id = s.crew_member_id AND t.production_id = s.production_id AND t.week_ending_date = s.week_ending_date
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!s) throw notFound('Submission not found');
  const { rows: entries } = await db.query('SELECT * FROM crew_timesheet_submission_entries WHERE submission_id = $1 ORDER BY date', [req.params.id]);
  res.json({ ...s, entries, reviews: await loadReviews('timesheets', req.params.id) });
});

const getInvoiceSubmission = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [s] } = await db.query(
    `SELECT s.*, cm.first_name, cm.last_name, cm.crew_number, cm.email, cm.employment_status, cm.company_name, cm.vat_registration_number,
            p.name AS production_name, u.full_name AS reviewed_by_name,
            t.id AS existing_timesheet_id, t.status AS timesheet_status, t.grand_total AS timesheet_grand_total,
            t.invoice_attachment_url IS NOT NULL AS timesheet_has_invoice
     FROM crew_invoice_submissions s
     JOIN crew_members cm ON cm.id = s.crew_member_id
     JOIN productions p ON p.id = s.production_id
     LEFT JOIN users u ON u.id = s.reviewed_by
     LEFT JOIN timesheets t ON t.crew_member_id = s.crew_member_id AND t.production_id = s.production_id AND t.week_ending_date = s.week_ending_date
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!s) throw notFound('Submission not found');
  const { file_key, ...rest } = s;
  res.json({ ...rest, reviews: await loadReviews('invoices', req.params.id) });
});

const getInvoiceFile = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [s] } = await db.query('SELECT file_url, file_key, file_name, file_mime_type FROM crew_invoice_submissions WHERE id = $1', [req.params.id]);
  if (!s) throw notFound('Submission not found');
  await fileStorage.streamToResponse(s.file_key || s.file_url, res, s.file_name, s.file_mime_type);
});

const reviewOpts = (req) => ({
  user: req.user,
  notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : null,
  finalise: req.body?.finalise === true,
  notify: req.body?.notify !== false,
  requestInvoice: req.body?.request_invoice !== false,
});
const reviewAction = (fn) => handle(async (req, res) => {
  requireUuid(req.params.id);
  res.json(await fn(req.params.id, reviewOpts(req)));
});

// ─── Availability polls ──────────────────────────────────────────────────────
const listPolls = handle(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ap.*, p.name AS production_name, u.full_name AS created_by_name,
            COUNT(r.id) AS recipient_count,
            COUNT(r.id) FILTER (WHERE r.response IS NOT NULL) AS response_count,
            COUNT(r.id) FILTER (WHERE r.response = 'available') AS available_count,
            COUNT(r.id) FILTER (WHERE r.response = 'partial') AS partial_count,
            COUNT(r.id) FILTER (WHERE r.response = 'unavailable') AS unavailable_count
     FROM availability_polls ap
     LEFT JOIN productions p ON p.id = ap.production_id
     LEFT JOIN users u ON u.id = ap.created_by
     LEFT JOIN availability_poll_recipients r ON r.poll_id = ap.id
     ${req.query.status === 'closed' ? 'WHERE ap.closed_at IS NOT NULL' : req.query.status === 'all' ? '' : 'WHERE ap.closed_at IS NULL'}
     GROUP BY ap.id, p.name, u.full_name
     ORDER BY ap.created_at DESC
     LIMIT 200`
  );
  res.json(rows);
});

const createPoll = handle(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title || title.length > 150) throw badRequest('Title is required (max 150 characters)');
  if (!isIsoDate(b.start_date) || !isIsoDate(b.end_date)) throw badRequest('start_date and end_date are required (YYYY-MM-DD)');
  if (b.end_date < b.start_date) throw badRequest('end_date must be on or after start_date');
  if (b.response_deadline && !isIsoDate(b.response_deadline)) throw badRequest('response_deadline must be YYYY-MM-DD');
  if (b.production_id && !isUuid(b.production_id)) throw badRequest('Invalid production_id');
  const { rows: [poll] } = await db.query(
    `INSERT INTO availability_polls (title, message, start_date, end_date, production_id, response_deadline, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [title, b.message ? String(b.message).slice(0, 2000) : null, b.start_date, b.end_date, b.production_id || null, b.response_deadline || null, req.user.id]
  );
  res.status(201).json(poll);
});

const getPoll = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows: [poll] } = await db.query(
    `SELECT ap.*, p.name AS production_name FROM availability_polls ap LEFT JOIN productions p ON p.id = ap.production_id WHERE ap.id = $1`,
    [req.params.id]
  );
  if (!poll) throw notFound('Availability request not found');
  const { rows: recipients } = await db.query(
    `SELECT r.*, cm.first_name, cm.last_name, cm.crew_number, cm.email, cm.crew_trade, cm.availability_status,
            last_msg.status AS last_email_status, last_msg.created_at AS last_emailed_at
     FROM availability_poll_recipients r
     JOIN crew_members cm ON cm.id = r.crew_member_id
     LEFT JOIN LATERAL (
       SELECT el.status, el.created_at FROM email_log el
       WHERE el.crew_member_id = r.crew_member_id AND el.related_record_id = r.poll_id
       ORDER BY el.created_at DESC LIMIT 1
     ) last_msg ON true
     WHERE r.poll_id = $1
     ORDER BY r.response NULLS LAST, cm.last_name`,
    [req.params.id]
  );
  res.json({ ...poll, recipients });
});

const closePoll = handle(async (req, res) => {
  requireUuid(req.params.id);
  const { rows } = await db.query(
    `UPDATE availability_polls SET closed_at = NOW(), closed_by = $2 WHERE id = $1 AND closed_at IS NULL RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) throw Object.assign(new Error('Availability request not found or already closed'), { status: 409 });
  res.json(rows[0]);
});

const applyPollResponse = handle(async (req, res) => {
  requireUuid(req.params.id);
  requireUuid(req.params.recipientId, 'recipient id');
  const status = req.body?.availability_status;
  if (!CREW_AVAILABILITY_STATUSES.includes(status)) throw badRequest(`availability_status must be one of: ${CREW_AVAILABILITY_STATUSES.join(', ')}`);
  const { rows: [r] } = await db.query(
    'SELECT crew_member_id FROM availability_poll_recipients WHERE id = $1 AND poll_id = $2',
    [req.params.recipientId, req.params.id]
  );
  if (!r) throw notFound('Recipient not found');
  // CrewAvailabilityStatus — same column the Crew page's traffic-light uses.
  await db.query('UPDATE crew_members SET availability_status = $1, updated_at = NOW() WHERE id = $2', [status, r.crew_member_id]);
  const { rows: [updated] } = await db.query(
    `UPDATE availability_poll_recipients SET applied_status = $1, applied_at = NOW(), applied_by = $2 WHERE id = $3 RETURNING *`,
    [status, req.user.id, req.params.recipientId]
  );
  res.json(updated);
});

// ─── Portal links ────────────────────────────────────────────────────────────
const linkUrl = (token) => templatesSvc.portalUrl({}).replace(PORTAL_TOKEN_MARKER, token);

const getPortalLink = handle(async (req, res) => {
  requireUuid(req.params.crewId, 'crew id');
  const status = await portalLinks.getLinkStatus(req.params.crewId);
  if (req.query.reveal === 'true') {
    const link = await portalLinks.getOrCreateActiveLink(req.params.crewId, { userId: req.user.id });
    return res.json({ active: true, url: linkUrl(link.token), expires_at: link.expires_at, created_at: link.created_at });
  }
  res.json(status);
});

const rotatePortalLink = handle(async (req, res) => {
  requireUuid(req.params.crewId, 'crew id');
  const link = await portalLinks.rotateLink(req.params.crewId, req.user.id);
  await logAudit({
    userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
    category: 'general', action: 'crew_portal_link_rotated', entityType: 'crew_member', entityId: req.params.crewId,
    details: 'Issued a new crew portal link (previous link revoked)',
  });
  res.json({ active: true, url: linkUrl(link.token), expires_at: link.expires_at });
});

const revokePortalLink = handle(async (req, res) => {
  requireUuid(req.params.crewId, 'crew id');
  const revoked = await portalLinks.revokeLink(req.params.crewId, req.user.id);
  if (revoked) {
    await logAudit({
      userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
      category: 'general', action: 'crew_portal_link_revoked', entityType: 'crew_member', entityId: req.params.crewId,
      details: 'Revoked crew portal link',
    });
  }
  res.json({ revoked });
});

// ─── Automations ─────────────────────────────────────────────────────────────
const runAutomationNow = handle(async (req, res) => {
  const type = req.params.type;
  if (!AUTOMATIONS[type]) throw badRequest(`type must be one of: ${Object.keys(AUTOMATIONS).join(', ')}`);
  const dryRun = req.body?.dry_run !== false;
  const result = await runAutomation(type, { weekEndingDate: req.body?.week_ending_date || undefined, dryRun, userId: req.user.id });
  if (!dryRun) {
    await logAudit({
      userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
      category: 'general', action: 'crew_email_automation_run', entityType: 'email_batch', entityId: result.batch_id || null,
      details: `Ran ${AUTOMATIONS[type].label} manually for week ending ${result.week_ending_date}`,
      metadata: { summary: result.summary || null, count: result.count },
    });
  }
  res.json(result);
});

module.exports = {
  getOverview, getSettings, updateSettings, listTestRecipients, addTestRecipient, removeTestRecipient,
  getProviderStatus,
  listTemplates, createTemplate, updateTemplate, deleteTemplate, resetTemplate,
  listRecipients, getRecipientGroup, preview, send,
  listMessages, getMessage, retryMessage, cancelMessage, processQueueNow,
  listSuppressions, addSuppression, clearSuppression,
  listTimesheetSubmissions: submissionListHandler('timesheets'),
  getTimesheetSubmission,
  approveTimesheetSubmission: reviewAction(review.approveTimesheet),
  returnTimesheetSubmission: reviewAction(review.returnTimesheet),
  declineTimesheetSubmission: reviewAction(review.declineTimesheet),
  listInvoiceSubmissions: submissionListHandler('invoices'),
  getInvoiceSubmission, getInvoiceFile,
  approveInvoiceSubmission: reviewAction(review.approveInvoice),
  returnInvoiceSubmission: reviewAction(review.returnInvoice),
  declineInvoiceSubmission: reviewAction(review.declineInvoice),
  listPolls, createPoll, getPoll, closePoll, applyPollResponse,
  getPortalLink, rotatePortalLink, revokePortalLink,
  runAutomationNow,
};
