/**
 * Amazon SES (v2) sender for crew emailing.
 *
 * Uses SendEmailCommand directly (rather than the nodemailer transport in
 * config/email.js) so the SES MessageId is returned reliably and the
 * configuration set + message tags needed for delivery/bounce/complaint events
 * are attached to every message.
 *
 * Env:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SES_FROM_EMAIL (existing)
 *   SES_CONFIGURATION_SET  — configuration set publishing events to the SNS topic
 */
const { SESv2Client, SendEmailCommand, GetAccountCommand, GetConfigurationSetCommand } = require('@aws-sdk/client-sesv2');

let client = null;
let transportOverride = null;

function getClient() {
  if (!client) {
    client = new SESv2Client({
      region: process.env.AWS_REGION || 'eu-north-1',
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
        : undefined,
    });
  }
  return client;
}

const sanitizeTag = (value) => String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'none';

/**
 * Sends one message. Resolves to { messageId }.
 */
async function sendEmail({ fromName, to, replyTo, subject, html, text, tags = {} }) {
  if (transportOverride) return transportOverride({ fromName, to, replyTo, subject, html, text, tags });

  const fromEmail = process.env.AWS_SES_FROM_EMAIL;
  if (!fromEmail) throw Object.assign(new Error('AWS_SES_FROM_EMAIL is not configured'), { name: 'ConfigurationError' });

  const command = new SendEmailCommand({
    FromEmailAddress: `"${String(fromName || 'Construct Scenery').replace(/"/g, '')}" <${fromEmail}>`,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
        },
      },
    },
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
    EmailTags: Object.entries(tags).map(([Name, Value]) => ({ Name: sanitizeTag(Name), Value: sanitizeTag(Value) })),
  });

  const result = await getClient().send(command);
  return { messageId: result.MessageId };
}

const TRANSIENT_NAMES = new Set([
  'ThrottlingException', 'Throttling', 'TooManyRequestsException', 'LimitExceededException',
  'ServiceUnavailable', 'ServiceUnavailableException', 'InternalFailure', 'InternalServiceErrorException',
  'RequestTimeout', 'RequestTimeoutException', 'TimeoutError', 'NetworkingError',
]);
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']);

/** Decides whether a send error is worth retrying. */
function classifyError(err) {
  const name = err?.name || err?.Code || '';
  const status = err?.$metadata?.httpStatusCode;
  const transient = TRANSIENT_NAMES.has(name) || TRANSIENT_CODES.has(err?.code) || (status >= 500 && status < 600) || status === 429;
  return { transient, code: name || err?.code || 'Error', message: err?.message || String(err) };
}

/** Account + configuration status for the Settings screen. */
async function getProviderStatus() {
  const status = {
    provider: 'ses',
    region: process.env.AWS_REGION || 'eu-north-1',
    from_email: process.env.AWS_SES_FROM_EMAIL || null,
    configuration_set: process.env.SES_CONFIGURATION_SET || null,
    sns_topic_arn: process.env.SES_SNS_TOPIC_ARN || null,
    credentials_configured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    production_access_enabled: null,
    sending_enabled: null,
    enforcement_status: null,
    send_quota: null,
    configuration_set_found: null,
    errors: [],
  };
  if (transportOverride) return { ...status, production_access_enabled: true, sending_enabled: true, test_transport: true };
  try {
    const account = await getClient().send(new GetAccountCommand({}));
    status.production_access_enabled = account.ProductionAccessEnabled ?? null;
    status.sending_enabled = account.SendingEnabled ?? null;
    status.enforcement_status = account.EnforcementStatus ?? null;
    status.send_quota = account.SendQuota
      ? { max_24_hour_send: account.SendQuota.Max24HourSend, max_send_rate: account.SendQuota.MaxSendRate, sent_last_24_hours: account.SendQuota.SentLast24Hours }
      : null;
  } catch (err) {
    status.errors.push(`GetAccount: ${err.name || ''} ${err.message}`.trim());
  }
  if (status.configuration_set) {
    try {
      await getClient().send(new GetConfigurationSetCommand({ ConfigurationSetName: status.configuration_set }));
      status.configuration_set_found = true;
    } catch (err) {
      status.configuration_set_found = false;
      status.errors.push(`Configuration set: ${err.name || ''} ${err.message}`.trim());
    }
  }
  return status;
}

/** Test hook: replace the SES call with a function returning { messageId }. */
function setTransportForTests(fn) { transportOverride = fn; }

module.exports = { sendEmail, classifyError, getProviderStatus, setTransportForTests };
