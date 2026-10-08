/**
 * Durable email queue on top of email_log.
 *
 *  enqueueEmail()   — validates the address, applies suppression + live-sending
 *                     gates, and inserts a 'queued' row. A unique idempotency_key
 *                     makes repeat calls (cron re-runs, double clicks) no-ops.
 *  processQueue()   — claims due rows with FOR UPDATE SKIP LOCKED (safe across
 *                     multiple instances), swaps the portal-token marker for the
 *                     real token, sends through SES and records the provider
 *                     MessageId. Transient errors are retried with backoff;
 *                     permanent errors mark the row failed.
 */
const db = require('../../config/db');
const { DELIVERY_STATUS, PORTAL_TOKEN_MARKER, RETRY_BACKOFF_SECONDS, SUPPRESSION_REASONS } = require('./constants');
const { getSendPolicy, getSettings, isValidEmail } = require('./settings');
const { materialise } = require('./templates');
const { getOrCreateActiveLink } = require('./portalLinks');
const ses = require('./sesSender');

const BATCH_LIMIT = Math.max(1, parseInt(process.env.EMAIL_QUEUE_BATCH_SIZE, 10) || 25);
const SEND_RATE_PER_SEC = Math.max(1, parseFloat(process.env.EMAIL_SEND_RATE_PER_SEC) || 5);
const STUCK_MINUTES = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function activeSuppression(email) {
  const { rows: [row] } = await db.query(
    `SELECT id, reason FROM email_suppressions WHERE LOWER(email) = LOWER($1) AND cleared_at IS NULL LIMIT 1`,
    [email]
  );
  return row || null;
}

async function flagInvalidAddress(email, detail) {
  try {
    await db.query(
      `INSERT INTO email_suppressions (email, reason, detail)
       VALUES ($1, $2, $3)
       ON CONFLICT ((LOWER(email))) WHERE cleared_at IS NULL DO NOTHING`,
      [email, SUPPRESSION_REASONS.INVALID_ADDRESS, detail]
    );
  } catch (err) {
    console.error('[emailing] flagInvalidAddress failed:', err.message);
  }
}

/**
 * @param {object} msg
 * @param {string} msg.messageType
 * @param {string} msg.to            recipient email
 * @param {string} [msg.recipientName]
 * @param {string} [msg.crewMemberId]
 * @param {string} [msg.productionId]
 * @param {string} [msg.weekEndingDate]
 * @param {string} [msg.relatedRecordType]
 * @param {string} [msg.relatedRecordId]
 * @param {string} [msg.templateId]
 * @param {string} [msg.batchId]
 * @param {string} msg.subject
 * @param {string} msg.html          may contain PORTAL_TOKEN_MARKER
 * @param {string} [msg.text]
 * @param {string} [msg.idempotencyKey]
 * @param {boolean} [msg.isAutomated]
 * @param {string} [msg.sentBy]      user id
 * @param {object} [msg.policy]      pre-fetched getSendPolicy() result
 * @returns {Promise<{ status: 'queued'|'duplicate'|'blocked'|'suppressed'|'invalid', id?: string, reason?: string }>}
 */
async function enqueueEmail(msg) {
  const to = String(msg.to || '').trim();
  if (!to) return { status: 'invalid', reason: 'no_email' };
  if (!isValidEmail(to)) {
    await flagInvalidAddress(to, 'Address failed format validation when sending');
    return { status: 'invalid', reason: 'invalid_email' };
  }

  const policy = msg.policy || await getSendPolicy();
  if (!policy.allows(to)) return { status: 'blocked', reason: 'live_sending_disabled' };

  const suppression = await activeSuppression(to);
  const status = suppression ? DELIVERY_STATUS.SUPPRESSED : DELIVERY_STATUS.QUEUED;
  const settings = policy.settings || await getSettings();

  const { rows } = await db.query(
    `INSERT INTO email_log (
       module, message_type, related_record_type, related_record_id,
       recipient_email, recipient_name, crew_member_id, production_id, week_ending_date,
       template_id, batch_id, subject, body_html, body_text, reply_to,
       provider, status, status_updated_at, success, error_message,
       attempts, next_attempt_at, idempotency_key, is_automated, is_test, sent_by
     ) VALUES (
       $1, $1, $2, $3,
       $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14,
       'ses', $15, NOW(), false, $16,
       0, NOW(), $17, $18, $19, $20
     )
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      msg.messageType, msg.relatedRecordType || null, msg.relatedRecordId || null,
      to, msg.recipientName || null, msg.crewMemberId || null, msg.productionId || null, msg.weekEndingDate || null,
      msg.templateId || null, msg.batchId || null, msg.subject, msg.html, msg.text || null, settings.reply_to_address,
      status, suppression ? `Address suppressed (${suppression.reason})` : null,
      msg.idempotencyKey || null, !!msg.isAutomated, !policy.live, msg.sentBy || null,
    ]
  );

  if (!rows.length) return { status: 'duplicate', reason: 'already_sent' };
  if (suppression) return { status: 'suppressed', id: rows[0].id, reason: suppression.reason };

  kickWorker();
  return { status: 'queued', id: rows[0].id };
}

// ─── Worker ──────────────────────────────────────────────────────────────────
let running = false;
let rerun = false;

function kickWorker() {
  if (process.env.NODE_ENV === 'test' || process.env.EMAIL_WORKER_ENABLED === 'false') return;
  setImmediate(() => { processQueue().catch((err) => console.error('[emailing] worker error:', err.message)); });
}

async function recoverStuck() {
  // A row stuck in 'sending' means the process died mid-send. The provider may or
  // may not have accepted it, so mark it failed (staff can retry) rather than risk a duplicate.
  await db.query(
    `UPDATE email_log
     SET status = $1, status_updated_at = NOW(),
         error_message = 'Send outcome unknown (worker interrupted). Check with the recipient before retrying.'
     WHERE status = $2 AND last_attempt_at < NOW() - ($3 || ' minutes')::interval`,
    [DELIVERY_STATUS.FAILED, DELIVERY_STATUS.SENDING, String(STUCK_MINUTES)]
  );
}

async function claimBatch(limit) {
  const { rows } = await db.query(
    `UPDATE email_log
     SET status = $1, attempts = attempts + 1, last_attempt_at = NOW(), status_updated_at = NOW()
     WHERE id IN (
       SELECT id FROM email_log
       WHERE status = $2 AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY created_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [DELIVERY_STATUS.SENDING, DELIVERY_STATUS.QUEUED, limit]
  );
  return rows;
}

async function markRow(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await db.query(
    `UPDATE email_log SET ${sets.join(', ')}, status_updated_at = NOW() WHERE id = $1`,
    [id, ...keys.map((k) => fields[k])]
  );
}

async function sendRow(row, policy) {
  const suppression = await activeSuppression(row.recipient_email);
  if (suppression) {
    return markRow(row.id, { status: DELIVERY_STATUS.SUPPRESSED, error_message: `Address suppressed (${suppression.reason})` });
  }
  if (!policy.allows(row.recipient_email)) {
    return markRow(row.id, { status: DELIVERY_STATUS.CANCELLED, error_message: 'Live sending was switched off before this message was sent' });
  }

  let html = row.body_html;
  let text = row.body_text;
  if ((html && html.includes(PORTAL_TOKEN_MARKER)) || (text && text.includes(PORTAL_TOKEN_MARKER))) {
    if (!row.crew_member_id) {
      return markRow(row.id, { status: DELIVERY_STATUS.FAILED, error_message: 'Portal link requested but no crew member is linked to this message' });
    }
    const link = await getOrCreateActiveLink(row.crew_member_id);
    html = materialise(html, link.token);
    text = materialise(text, link.token);
  }

  try {
    const { messageId } = await ses.sendEmail({
      fromName: policy.settings.from_name,
      to: row.recipient_email,
      replyTo: row.reply_to || policy.settings.reply_to_address,
      subject: row.subject,
      html,
      text,
      tags: { email_log_id: row.id, message_type: row.message_type || 'unknown' },
    });
    await markRow(row.id, {
      status: DELIVERY_STATUS.SENT, success: true, provider_message_id: messageId || null,
      sent_at: new Date(), error_message: null, next_attempt_at: null,
    });
  } catch (err) {
    const { transient, code, message } = ses.classifyError(err);
    const canRetry = transient && row.attempts < row.max_attempts;
    if (canRetry) {
      const delay = RETRY_BACKOFF_SECONDS[Math.min(row.attempts - 1, RETRY_BACKOFF_SECONDS.length - 1)];
      await markRow(row.id, {
        status: DELIVERY_STATUS.QUEUED, success: false,
        error_message: `${code}: ${message} (retry ${row.attempts}/${row.max_attempts - 1})`,
        next_attempt_at: new Date(Date.now() + delay * 1000),
      });
    } else {
      await markRow(row.id, { status: DELIVERY_STATUS.FAILED, success: false, error_message: `${code}: ${message}`, next_attempt_at: null });
    }
    console.error(`[emailing] send failed for ${row.id} (${code}) transient=${transient}:`, message);
  }
}

/** Sends due messages. Returns { processed }. Safe to call concurrently. */
async function processQueue({ limit = BATCH_LIMIT } = {}) {
  if (running) { rerun = true; return { processed: 0, skipped: 'already_running' }; }
  running = true;
  let processed = 0;
  try {
    await recoverStuck();
    do {
      rerun = false;
      const policy = await getSendPolicy();
      const rows = await claimBatch(limit);
      for (const row of rows) {
        try {
          await sendRow(row, policy);
        } catch (err) {
          console.error(`[emailing] unexpected error for ${row.id}:`, err.message);
          await markRow(row.id, { status: DELIVERY_STATUS.FAILED, success: false, error_message: err.message }).catch(() => {});
        }
        processed += 1;
        await sleep(1000 / SEND_RATE_PER_SEC);
      }
      if (rows.length === limit) rerun = true;
    } while (rerun);
  } finally {
    running = false;
  }
  return { processed };
}

/** Re-queues a failed / cancelled message. */
async function retryEmail(id, userId) {
  const { rows } = await db.query(
    `UPDATE email_log
     SET status = $2, attempts = 0, next_attempt_at = NOW(), error_message = NULL,
         status_updated_at = NOW(), sent_by = COALESCE(sent_by, $3)
     WHERE id = $1 AND status IN ($4, $5)
     RETURNING id`,
    [id, DELIVERY_STATUS.QUEUED, userId || null, DELIVERY_STATUS.FAILED, DELIVERY_STATUS.CANCELLED]
  );
  if (rows.length) kickWorker();
  return rows.length > 0;
}

async function cancelEmail(id) {
  const { rows } = await db.query(
    `UPDATE email_log SET status = $2, status_updated_at = NOW(), error_message = 'Cancelled by user'
     WHERE id = $1 AND status = $3 RETURNING id`,
    [id, DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.QUEUED]
  );
  return rows.length > 0;
}

module.exports = { enqueueEmail, processQueue, retryEmail, cancelEmail, activeSuppression, kickWorker };
