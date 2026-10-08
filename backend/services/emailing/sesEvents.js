/**
 * Amazon SES delivery / bounce / complaint events, delivered through SNS.
 *
 * Every SNS message is signature-verified against the AWS signing certificate
 * before it is trusted. Supports both SES event publishing (configuration set →
 * SNS, `eventType`) and identity notifications (`notificationType`).
 *
 * Effects:
 *   Delivery           → email_log.status = delivered
 *   Bounce (Permanent) → status = bounced + address suppressed (hard_bounce)
 *   Bounce (Transient) → status = soft_bounced (address kept)
 *   Complaint          → status = complained + address suppressed
 *   Reject / Delay     → rejected / delayed
 * Every event is stored in email_events (deduplicated by SNS MessageId + recipient).
 *
 * Env: SES_SNS_TOPIC_ARN — optional comma-separated allow-list of topic ARNs.
 */
const crypto = require('crypto');
const db = require('../../config/db');
const { DELIVERY_STATUS, SUPPRESSION_REASONS } = require('./constants');

const CERT_URL_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/[A-Za-z0-9/_-]+\.pem$/;
const SUBSCRIBE_URL_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\//;
const certCache = new Map();

let fetchImpl = (...args) => fetch(...args);

function allowedTopic(topicArn) {
  const allow = (process.env.SES_SNS_TOPIC_ARN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !allow.length || allow.includes(topicArn);
}

function stringToSign(msg) {
  const keys = msg.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys
    .filter((k) => msg[k] !== undefined && msg[k] !== null)
    .map((k) => `${k}\n${msg[k]}\n`)
    .join('');
}

async function getCertificate(url) {
  if (certCache.has(url)) return certCache.get(url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not download SNS signing certificate (${res.status})`);
  const pem = await res.text();
  if (!pem.includes('-----BEGIN ')) throw new Error('Invalid SNS signing certificate');
  certCache.set(url, pem);
  return pem;
}

/** Verifies an SNS message signature. Resolves true/false. */
async function verifySnsMessage(msg) {
  try {
    if (!msg || typeof msg !== 'object') return false;
    if (!['1', '2'].includes(String(msg.SignatureVersion))) return false;
    if (!CERT_URL_RE.test(msg.SigningCertURL || '')) return false;
    if (!msg.Signature) return false;
    const pem = await getCertificate(msg.SigningCertURL);
    const algorithm = String(msg.SignatureVersion) === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
    const verifier = crypto.createVerify(algorithm);
    verifier.update(stringToSign(msg), 'utf8');
    return verifier.verify(pem, msg.Signature, 'base64');
  } catch (err) {
    console.error('[ses-events] signature verification error:', err.message);
    return false;
  }
}

const STATUS_RANK = {
  queued: 0, sending: 1, sent: 2, delayed: 3, soft_bounced: 3, delivered: 4,
  rejected: 5, bounced: 6, complained: 7,
};

/** Updates email_log status without ever moving it "backwards". */
async function advanceStatus(emailLogId, nextStatus, extra = {}) {
  if (!emailLogId) return;
  const { rows: [row] } = await db.query('SELECT status FROM email_log WHERE id = $1', [emailLogId]);
  if (!row) return;
  const current = STATUS_RANK[row.status] ?? 2;
  if ((STATUS_RANK[nextStatus] ?? 0) < current) return;
  const fields = { status: nextStatus, ...extra };
  const keys = Object.keys(fields);
  await db.query(
    `UPDATE email_log SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, status_updated_at = NOW() WHERE id = $1`,
    [emailLogId, ...keys.map((k) => fields[k])]
  );
}

async function suppress(email, reason, detail, eventId) {
  await db.query(
    `INSERT INTO email_suppressions (email, reason, detail, email_event_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ((LOWER(email))) WHERE cleared_at IS NULL DO NOTHING`,
    [email, reason, detail ? String(detail).slice(0, 1000) : null, eventId || null]
  );
}

async function findEmailLog(mail) {
  const tags = mail?.tags || {};
  const tagId = Array.isArray(tags.email_log_id) ? tags.email_log_id[0] : null;
  if (tagId && /^[0-9a-f-]{36}$/i.test(tagId)) {
    const { rows: [row] } = await db.query('SELECT id FROM email_log WHERE id = $1', [tagId]);
    if (row) return row.id;
  }
  if (mail?.messageId) {
    const { rows: [row] } = await db.query('SELECT id FROM email_log WHERE provider_message_id = $1 LIMIT 1', [mail.messageId]);
    if (row) return row.id;
  }
  return null;
}

async function recordEvent({ emailLogId, messageId, eventType, recipient, bounceType, bounceSubtype, diagnostic, occurredAt, snsMessageId, raw }) {
  const { rows } = await db.query(
    `INSERT INTO email_events (email_log_id, provider_message_id, event_type, recipient_email, bounce_type, bounce_subtype, diagnostic, occurred_at, sns_message_id, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9, $10)
     ON CONFLICT (sns_message_id, (COALESCE(recipient_email, ''))) WHERE sns_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [emailLogId, messageId || null, eventType, recipient || null, bounceType || null, bounceSubtype || null,
      diagnostic ? String(diagnostic).slice(0, 2000) : null, occurredAt || null, snsMessageId || null, raw]
  );
  return rows[0]?.id || null; // null → duplicate delivery of the same SNS message
}

/**
 * Applies one SES event object (the parsed SNS `Message`).
 * @returns {{ handled: boolean, type: string, duplicates: number }}
 */
async function processSesEvent(evt, snsMessageId = null) {
  const type = String(evt?.eventType || evt?.notificationType || '').toLowerCase();
  const mail = evt?.mail || {};
  const emailLogId = await findEmailLog(mail);
  const raw = JSON.stringify(evt).slice(0, 20000);
  let duplicates = 0;

  if (type === 'delivery') {
    const recipients = evt.delivery?.recipients || mail.destination || [];
    for (const recipient of recipients.length ? recipients : [null]) {
      const id = await recordEvent({ emailLogId, messageId: mail.messageId, eventType: 'delivery', recipient, occurredAt: evt.delivery?.timestamp, snsMessageId, raw });
      if (!id) duplicates += 1;
    }
    if (duplicates < Math.max(recipients.length, 1)) {
      await advanceStatus(emailLogId, DELIVERY_STATUS.DELIVERED, { delivered_at: new Date(evt.delivery?.timestamp || Date.now()), success: true });
    }
    return { handled: true, type, duplicates };
  }

  if (type === 'bounce') {
    const bounce = evt.bounce || {};
    const permanent = bounce.bounceType === 'Permanent';
    for (const r of bounce.bouncedRecipients || []) {
      const id = await recordEvent({
        emailLogId, messageId: mail.messageId, eventType: 'bounce', recipient: r.emailAddress,
        bounceType: bounce.bounceType, bounceSubtype: bounce.bounceSubType, diagnostic: r.diagnosticCode || r.status,
        occurredAt: bounce.timestamp, snsMessageId, raw,
      });
      if (!id) { duplicates += 1; continue; }
      if (permanent) await suppress(r.emailAddress, SUPPRESSION_REASONS.HARD_BOUNCE, r.diagnosticCode || bounce.bounceSubType, id);
    }
    await advanceStatus(emailLogId, permanent ? DELIVERY_STATUS.BOUNCED : DELIVERY_STATUS.SOFT_BOUNCED, {
      error_message: `Bounce: ${bounce.bounceType || ''} ${bounce.bounceSubType || ''}`.trim(),
      success: false,
    });
    return { handled: true, type, duplicates };
  }

  if (type === 'complaint') {
    const complaint = evt.complaint || {};
    for (const r of complaint.complainedRecipients || []) {
      const id = await recordEvent({
        emailLogId, messageId: mail.messageId, eventType: 'complaint', recipient: r.emailAddress,
        diagnostic: complaint.complaintFeedbackType, occurredAt: complaint.timestamp, snsMessageId, raw,
      });
      if (!id) { duplicates += 1; continue; }
      await suppress(r.emailAddress, SUPPRESSION_REASONS.COMPLAINT, complaint.complaintFeedbackType || 'Recipient marked the message as spam', id);
    }
    await advanceStatus(emailLogId, DELIVERY_STATUS.COMPLAINED, { error_message: 'Recipient complaint (marked as spam)' });
    return { handled: true, type, duplicates };
  }

  if (type === 'reject') {
    const id = await recordEvent({ emailLogId, messageId: mail.messageId, eventType: 'reject', diagnostic: evt.reject?.reason, snsMessageId, raw });
    if (id) await advanceStatus(emailLogId, DELIVERY_STATUS.REJECTED, { error_message: `Rejected by SES: ${evt.reject?.reason || 'unknown'}`, success: false });
    return { handled: true, type, duplicates: id ? 0 : 1 };
  }

  if (type === 'deliverydelay') {
    const delay = evt.deliveryDelay || {};
    for (const r of delay.delayedRecipients || [{}]) {
      const id = await recordEvent({ emailLogId, messageId: mail.messageId, eventType: 'delivery_delay', recipient: r.emailAddress, diagnostic: r.diagnosticCode || delay.delayType, occurredAt: delay.timestamp, snsMessageId, raw });
      if (!id) duplicates += 1;
    }
    await advanceStatus(emailLogId, DELIVERY_STATUS.DELAYED);
    return { handled: true, type, duplicates };
  }

  const known = { send: 'send', renderingfailure: 'rendering_failure', open: 'open', click: 'click', subscription: 'subscription' };
  if (known[type]) {
    await recordEvent({ emailLogId, messageId: mail.messageId, eventType: known[type], snsMessageId, raw });
    if (type === 'renderingfailure') await advanceStatus(emailLogId, DELIVERY_STATUS.REJECTED, { error_message: 'SES rendering failure', success: false });
    return { handled: true, type, duplicates };
  }

  return { handled: false, type, duplicates };
}

/**
 * Entry point for the public webhook. `body` is the raw request body string.
 * @returns {{ status: number, body: object }}
 */
async function handleSnsRequest(body) {
  let msg;
  try {
    msg = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }
  if (!msg || !msg.Type) return { status: 400, body: { error: 'Not an SNS message' } };
  if (!allowedTopic(msg.TopicArn)) return { status: 403, body: { error: 'Topic not allowed' } };
  if (!(await verifySnsMessage(msg))) return { status: 403, body: { error: 'Invalid SNS signature' } };

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!SUBSCRIBE_URL_RE.test(msg.SubscribeURL || '')) return { status: 400, body: { error: 'Invalid SubscribeURL' } };
    const res = await fetchImpl(msg.SubscribeURL);
    console.log(`[ses-events] SNS subscription confirmation for ${msg.TopicArn}: HTTP ${res.status}`);
    return { status: 200, body: { confirmed: res.ok } };
  }
  if (msg.Type === 'UnsubscribeConfirmation') {
    console.warn(`[ses-events] SNS topic unsubscribed: ${msg.TopicArn}`);
    return { status: 200, body: { ok: true } };
  }
  if (msg.Type !== 'Notification') return { status: 400, body: { error: `Unsupported SNS message type ${msg.Type}` } };

  let evt;
  try {
    evt = JSON.parse(msg.Message);
  } catch {
    return { status: 200, body: { ignored: 'Message is not JSON' } };
  }
  if (evt?.notificationType === 'AmazonSnsSubscriptionSucceeded') return { status: 200, body: { ok: true } };
  const result = await processSesEvent(evt, msg.MessageId);
  return { status: 200, body: result };
}

function _setFetchForTests(fn) { fetchImpl = fn; certCache.clear(); }

module.exports = { verifySnsMessage, processSesEvent, handleSnsRequest, stringToSign, _setFetchForTests };
