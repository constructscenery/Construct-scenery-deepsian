/**
 * Crew emailing — service-level tests (templates, queue, SES events).
 */
const crypto = require('crypto');
const { dbMock } = require('./setup');

jest.mock('../services/emailing/portalLinks', () => ({
  getOrCreateActiveLink: jest.fn().mockResolvedValue({ id: 'link-1', token: 'REAL_TOKEN_abcdefghijklmnopqrstuvwxyz0123456789' }),
  resolveToken: jest.fn(),
}));

const templates = require('../services/emailing/templates');
const settings = require('../services/emailing/settings');
const queue = require('../services/emailing/queue');
const ses = require('../services/emailing/sesSender');
const sesEvents = require('../services/emailing/sesEvents');
const { PORTAL_TOKEN_MARKER } = require('../services/emailing/constants');

const livePolicy = (overrides = {}) => ({
  live: true,
  testEmails: new Set(),
  allows: () => true,
  settings: { ...settings.DEFAULTS, live_sending_enabled: true, from_name: 'Construct Scenery', reply_to_address: 'invoice@constructscenery.co.uk' },
  ...overrides,
});

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
  settings._resetCache();
  ses.setTransportForTests(null);
});

describe('templates.renderTemplate', () => {
  test('escapes merge values, renders action button and plain-text fallback', () => {
    const out = templates.renderTemplate({
      subject: 'Timesheet — {{week_ending}}',
      body: 'Hi {{first_name}},\n\nPlease submit.\n\n{{action_button}}\n\nThanks',
      context: { first_name: '<b>Sam</b>', week_ending: '11 Oct 2026' },
      actionUrl: templates.portalUrl({ tab: 'timesheet', week: '2026-10-11' }),
      actionLabel: 'Submit timesheet',
    });
    expect(out.subject).toBe('Timesheet — 11 Oct 2026');
    expect(out.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
    expect(out.html).not.toContain('<b>Sam</b>');
    expect(out.html).toContain('Submit timesheet &rarr;');
    expect(out.html).toContain(PORTAL_TOKEN_MARKER);
    expect(out.text).toContain(`Submit timesheet: `);
    expect(out.text).toContain('tab=timesheet');
  });

  test('redact hides the token marker and materialise swaps in the real token', () => {
    const html = `<a href="https://x/crew-portal/${PORTAL_TOKEN_MARKER}">x</a>`;
    expect(templates.redact(html)).not.toContain(PORTAL_TOKEN_MARKER);
    expect(templates.materialise(html, 'abc')).toContain('/crew-portal/abc');
  });

  test('unknown merge fields render empty and subjects collapse to one line', () => {
    const out = templates.renderTemplate({ subject: 'Hello {{nope}}\nthere', body: '{{nope}}Body', context: {} });
    expect(out.subject).toBe('Hello there');
    expect(out.text).toBe('Body');
  });
});

describe('queue.enqueueEmail', () => {
  const base = { messageType: 'manual', subject: 'S', html: '<p>h</p>', text: 't', crewMemberId: 'crew-1' };

  test('rejects and flags an invalid address', async () => {
    const res = await queue.enqueueEmail({ ...base, to: 'not-an-email', policy: livePolicy() });
    expect(res).toEqual({ status: 'invalid', reason: 'invalid_email' });
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO email_suppressions'), expect.arrayContaining(['not-an-email', 'invalid_address']));
  });

  test('blocks non-test recipients while live sending is off', async () => {
    const policy = livePolicy({ live: false, allows: (e) => e === 'qa@cs.com' });
    const res = await queue.enqueueEmail({ ...base, to: 'crew@example.com', policy });
    expect(res).toEqual({ status: 'blocked', reason: 'live_sending_disabled' });
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  test('queues a message and records subject, content, crew and production', async () => {
    dbMock.respond([], [{ id: 'log-1' }]); // suppression lookup, insert
    const res = await queue.enqueueEmail({ ...base, to: 'crew@example.com', productionId: 'prod-1', weekEndingDate: '2026-10-11', idempotencyKey: 'k1', policy: livePolicy() });
    expect(res).toEqual({ status: 'queued', id: 'log-1' });
    const [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toContain('INSERT INTO email_log');
    expect(sql).toContain('ON CONFLICT (idempotency_key)');
    expect(params).toEqual(expect.arrayContaining(['manual', 'crew@example.com', 'crew-1', 'prod-1', '2026-10-11', 'S', '<p>h</p>', 'queued', 'k1']));
  });

  test('returns duplicate when the idempotency key already exists', async () => {
    dbMock.respond([], []);
    const res = await queue.enqueueEmail({ ...base, to: 'crew@example.com', idempotencyKey: 'k1', policy: livePolicy() });
    expect(res.status).toBe('duplicate');
  });

  test('records suppressed addresses without sending', async () => {
    dbMock.respond([{ id: 's1', reason: 'hard_bounce' }], [{ id: 'log-2' }]);
    const res = await queue.enqueueEmail({ ...base, to: 'gone@example.com', policy: livePolicy() });
    expect(res).toEqual({ status: 'suppressed', id: 'log-2', reason: 'hard_bounce' });
    expect(dbMock.query.mock.calls[1][1]).toContain('suppressed');
  });
});

describe('queue.processQueue', () => {
  const row = {
    id: 'log-1', recipient_email: 'crew@example.com', crew_member_id: 'crew-1', message_type: 'timesheet_reminder',
    subject: 'S', body_html: `<a href="https://app/crew-portal/${PORTAL_TOKEN_MARKER}">go</a>`, body_text: `go https://app/crew-portal/${PORTAL_TOKEN_MARKER}`,
    attempts: 1, max_attempts: 5, reply_to: 'invoice@constructscenery.co.uk',
  };

  // processQueue: recoverStuck, settings, test recipients, claim, [per row: suppression, ..., update]
  const queueResponses = (claimed, ...rest) => dbMock.respond(
    [], // recoverStuck
    [{ key: 'live_sending_enabled', value: 'true' }], // settings
    [], // test recipients
    claimed,
    ...rest,
  );

  test('sends with the real portal token and stores the SES message id', async () => {
    const transport = jest.fn().mockResolvedValue({ messageId: 'ses-123' });
    ses.setTransportForTests(transport);
    queueResponses([row], [], { rows: [], rowCount: 1 });
    const res = await queue.processQueue();
    expect(res.processed).toBe(1);
    const sent = transport.mock.calls[0][0];
    expect(sent.html).toContain('/crew-portal/REAL_TOKEN_');
    expect(sent.html).not.toContain(PORTAL_TOKEN_MARKER);
    expect(sent.tags.email_log_id).toBe('log-1');
    const update = dbMock.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE email_log SET status'));
    expect(update[1]).toEqual(expect.arrayContaining(['log-1', 'sent', true, 'ses-123']));
  }, 15000);

  test('re-queues transient failures with backoff', async () => {
    ses.setTransportForTests(jest.fn().mockRejectedValue(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' })));
    queueResponses([row], [], { rows: [], rowCount: 1 });
    await queue.processQueue();
    const update = dbMock.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE email_log SET status'));
    expect(update[1][1]).toBe('queued');
    expect(update[1][4]).toBeInstanceOf(Date);
  }, 15000);

  test('marks permanent failures as failed', async () => {
    ses.setTransportForTests(jest.fn().mockRejectedValue(Object.assign(new Error('Email address is not verified'), { name: 'MessageRejected' })));
    queueResponses([row], [], { rows: [], rowCount: 1 });
    await queue.processQueue();
    const update = dbMock.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE email_log SET status'));
    expect(update[1][1]).toBe('failed');
    expect(update[1][3]).toContain('MessageRejected');
  }, 15000);
});

describe('SES events via SNS', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const CERT_URL = 'https://sns.eu-north-1.amazonaws.com/SimpleNotificationService-abc.pem';

  const signed = (msg) => {
    const full = { SignatureVersion: '2', SigningCertURL: CERT_URL, Timestamp: '2026-10-08T10:00:00.000Z', TopicArn: 'arn:aws:sns:eu-north-1:1:ses-events', ...msg };
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(sesEvents.stringToSign(full));
    return { ...full, Signature: signer.sign(privateKey, 'base64') };
  };

  beforeEach(() => {
    sesEvents._setFetchForTests(jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => pem }));
  });

  test('rejects messages with a bad signature', async () => {
    const msg = { ...signed({ Type: 'Notification', MessageId: 'm1', Message: '{}' }), Message: '{"tampered":true}' };
    const res = await sesEvents.handleSnsRequest(JSON.stringify(msg));
    expect(res.status).toBe(403);
  });

  test('rejects certificate URLs that are not on amazonaws.com', async () => {
    const msg = signed({ Type: 'Notification', MessageId: 'm1', Message: '{}', SigningCertURL: 'https://evil.example.com/cert.pem' });
    const res = await sesEvents.handleSnsRequest(JSON.stringify(msg));
    expect(res.status).toBe(403);
  });

  test('permanent bounce marks the message bounced and suppresses the address', async () => {
    const evt = {
      eventType: 'Bounce',
      mail: { messageId: 'ses-123', tags: { email_log_id: ['11111111-1111-1111-1111-111111111111'] } },
      bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'gone@example.com', diagnosticCode: '550 user unknown' }] },
    };
    dbMock.respond(
      [{ id: '11111111-1111-1111-1111-111111111111' }], // find by tag
      [{ id: 'evt-1' }],                                 // event insert
      { rows: [], rowCount: 1 },                         // suppression insert
      [{ status: 'sent' }],                              // advanceStatus read
      { rows: [], rowCount: 1 },                         // advanceStatus update
    );
    const res = await sesEvents.handleSnsRequest(JSON.stringify(signed({ Type: 'Notification', MessageId: 'sns-1', Message: JSON.stringify(evt) })));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ handled: true, type: 'bounce' }));
    const supp = dbMock.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO email_suppressions'));
    expect(supp[1]).toEqual(expect.arrayContaining(['gone@example.com', 'hard_bounce']));
    const update = dbMock.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE email_log SET status'));
    expect(update[1]).toContain('bounced');
  });

  test('delivery never downgrades a bounced message', async () => {
    const evt = { eventType: 'Delivery', mail: { messageId: 'ses-123', destination: ['a@b.com'] }, delivery: { recipients: ['a@b.com'] } };
    dbMock.respond(
      [{ id: 'log-1' }],       // find by provider id
      [{ id: 'evt-2' }],       // event insert
      [{ status: 'bounced' }], // advanceStatus read
    );
    await sesEvents.handleSnsRequest(JSON.stringify(signed({ Type: 'Notification', MessageId: 'sns-2', Message: JSON.stringify(evt) })));
    expect(dbMock.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE email_log SET status'))).toBe(false);
  });

  test('duplicate SNS deliveries are ignored', async () => {
    const evt = { eventType: 'Complaint', mail: { messageId: 'ses-9' }, complaint: { complainedRecipients: [{ emailAddress: 'x@y.com' }] } };
    dbMock.respond([{ id: 'log-9' }], [], [{ status: 'complained' }]);
    const res = await sesEvents.handleSnsRequest(JSON.stringify(signed({ Type: 'Notification', MessageId: 'sns-3', Message: JSON.stringify(evt) })));
    expect(res.body.duplicates).toBe(1);
    expect(dbMock.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO email_suppressions'))).toBe(false);
  });

  test('confirms SNS subscriptions only for amazonaws.com SubscribeURLs', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => pem });
    sesEvents._setFetchForTests(fetchMock);
    const msg = signed({ Type: 'SubscriptionConfirmation', MessageId: 'm', Message: 'confirm', Token: 't', SubscribeURL: 'https://sns.eu-north-1.amazonaws.com/?Action=ConfirmSubscription' });
    const res = await sesEvents.handleSnsRequest(JSON.stringify(msg));
    expect(res.body.confirmed).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith('https://sns.eu-north-1.amazonaws.com/?Action=ConfirmSubscription');
  });
});
