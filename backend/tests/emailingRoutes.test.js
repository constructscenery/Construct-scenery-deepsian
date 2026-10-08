/**
 * Emailing tab API — permissions, validation and submission review.
 */
const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/emailing/composer', () => ({
  previewMessages: jest.fn(),
  sendMessages: jest.fn(),
  sendSubmissionNotice: jest.fn().mockResolvedValue({ status: 'queued' }),
  resolveTemplate: jest.fn(),
}));
jest.mock('../services/auditService', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../Controllers/timesheetsController', () => ({
  createTimesheet: jest.fn(),
  saveEntries: jest.fn(),
  verifyTimesheet: jest.fn(),
  attachInvoice: jest.fn(),
}));

const composer = require('../services/emailing/composer');
const timesheets = require('../Controllers/timesheetsController');
const app = makeApp(['/api/emailing', require('../routes/emailing')]);

const CREW = '22222222-2222-2222-2222-222222222222';
const PROD = '33333333-3333-3333-3333-333333333333';
const SUB = '44444444-4444-4444-4444-444444444444';
const TS = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
});

describe('access', () => {
  test('unauthenticated requests are rejected', async () => {
    const res = await request(app).get('/api/emailing/messages');
    expect(res.status).toBe(401);
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can send messages', async (role) => {
    composer.sendMessages.mockResolvedValue({ batch_id: 'b1', summary: { queued: 1 }, results: [] });
    const res = await request(app)
      .post('/api/emailing/send')
      .set(authHeader(role))
      .send({ message_type: 'manual', recipients: [{ crew_member_id: CREW }], subject: 'Hi', body: 'Hello', client_request_id: 'req_12345678' });
    expect(res.status).toBe(201);
    expect(composer.sendMessages).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'manual',
      idempotencyScope: 'req-req_12345678',
      recipients: [expect.objectContaining({ crewMemberId: CREW })],
    }));
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can view communication history', async (role) => {
    dbMock.respond([{ id: 'm1', status: 'sent' }], [{ total: '1' }]);
    const res = await request(app).get(`/api/emailing/messages?crew_member_id=${CREW}`).set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(dbMock.query.mock.calls[0][1]).toContain(CREW);
  });
});

describe('validation', () => {
  test('rejects unknown message types', async () => {
    const res = await request(app).post('/api/emailing/send').set(authHeader()).send({ message_type: 'spam', recipients: [{ crew_member_id: CREW }] });
    expect(res.status).toBe(400);
  });

  test('rejects malformed crew ids', async () => {
    const res = await request(app).post('/api/emailing/preview').set(authHeader()).send({ message_type: 'manual', recipients: [{ crew_member_id: 'x' }] });
    expect(res.status).toBe(400);
  });

  test('settings reject non-boolean toggles', async () => {
    dbMock.respond([]); // current settings
    const res = await request(app).put('/api/emailing/settings').set(authHeader()).send({ live_sending_enabled: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('timesheet submission review', () => {
  const submission = {
    id: SUB, crew_member_id: CREW, production_id: PROD, week_ending_date: '2026-10-11', status: 'submitted', revision: 1,
    first_name: 'Sam', last_name: 'Crew', employment_status: 'paye', production_name: 'Test Prod',
  };
  const entry = { date: '2026-10-05', day_of_week: 'Monday', full_day_worked: true, overtime_hours: '1.50', travel: '0', mileage: '0', per_diem: '0', ad_hoc_reimbursement: '0', meal_breakfast: false, meal_lunch: true, meal_supper: false };

  test('approve creates the timesheet via the existing handlers and marks it crew-confirmed', async () => {
    dbMock.respond(
      [submission],                       // loadSubmission
      [entry],                            // entries
      [],                                 // findTimesheet → none
      [{ ...submission, status: 'approved', timesheet_id: TS }], // claimForReview
      { rows: [], rowCount: 1 },          // draft → distributed
      { rows: [], rowCount: 1 },          // review record
    );
    timesheets.createTimesheet.mockImplementation(async (req, res) => res.status(201).json({ id: TS, status: 'draft' }));
    timesheets.saveEntries.mockImplementation(async (req, res) => res.json({ id: req.params.id }));

    const res = await request(app).post(`/api/emailing/submissions/timesheets/${SUB}/approve`).set(authHeader('accountant')).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ timesheet_id: TS, timesheet_created: true }));
    expect(timesheets.createTimesheet.mock.calls[0][0].body).toEqual({ crew_member_id: CREW, production_id: PROD, week_ending_date: '2026-10-11' });
    const savedBody = timesheets.saveEntries.mock.calls[0][0].body;
    expect(savedBody.entries[0]).toEqual(expect.objectContaining({ date: '2026-10-05', overtime_hours: 1.5, meal_lunch: true }));
    expect(dbMock.query.mock.calls.some(([sql]) => sql.includes("SET status = 'distributed'"))).toBe(true);
  });

  test('approve is blocked when the week is already finalised', async () => {
    dbMock.respond([submission], [entry], [{ id: TS, status: 'finalised' }]);
    const res = await request(app).post(`/api/emailing/submissions/timesheets/${SUB}/approve`).set(authHeader()).send({});
    expect(res.status).toBe(409);
    expect(timesheets.saveEntries).not.toHaveBeenCalled();
  });

  test('approve surfaces errors from the existing timesheet rules', async () => {
    dbMock.respond([submission], [entry], []);
    timesheets.createTimesheet.mockImplementation(async (req, res) => res.status(400).json({ error: 'CREW_INACTIVE', message: 'Sam Crew is deactivated.' }));
    const res = await request(app).post(`/api/emailing/submissions/timesheets/${SUB}/approve`).set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('deactivated');
  });

  test('return requires notes and notifies the crew member', async () => {
    let res = await request(app).post(`/api/emailing/submissions/timesheets/${SUB}/return`).set(authHeader()).send({});
    expect(res.status).toBe(400);

    dbMock.respond([submission], [{ ...submission, status: 'returned', reviewer_notes: 'Fix Tuesday' }], { rows: [], rowCount: 1 });
    res = await request(app).post(`/api/emailing/submissions/timesheets/${SUB}/return`).set(authHeader()).send({ notes: 'Fix Tuesday' });
    expect(res.status).toBe(200);
    expect(composer.sendSubmissionNotice).toHaveBeenCalledWith(expect.objectContaining({ action: 'returned', kind: 'timesheet', reviewerNotes: 'Fix Tuesday' }));
  });

  test('a submission cannot be reviewed twice', async () => {
    dbMock.respond([submission], []); // claim returns nothing
    const res = await request(app).post(`/api/emailing/submissions/timesheets/${SUB}/decline`).set(authHeader()).send({ notes: 'Duplicate' });
    expect(res.status).toBe(409);
  });
});

describe('invoice submission review', () => {
  const inv = { id: SUB, crew_member_id: CREW, production_id: PROD, week_ending_date: '2026-10-11', status: 'submitted', file_url: 'https://b.s3/x.pdf', file_name: 'inv.pdf', revision: 1, first_name: 'Sam', last_name: 'Crew' };

  test('approve attaches the invoice to the timesheet using the existing handler', async () => {
    dbMock.respond([inv], [{ id: TS, status: 'distributed' }], [{ ...inv, status: 'approved' }], { rows: [], rowCount: 1 });
    timesheets.attachInvoice.mockImplementation(async (req, res) => res.json({ message: 'Invoice attached' }));
    const res = await request(app).post(`/api/emailing/submissions/invoices/${SUB}/approve`).set(authHeader()).send({});
    expect(res.status).toBe(200);
    expect(timesheets.attachInvoice.mock.calls[0][0]).toEqual(expect.objectContaining({
      params: { id: TS },
      body: { invoice_attachment_url: 'https://b.s3/x.pdf', invoice_attachment_name: 'inv.pdf' },
    }));
  });

  test('approve needs a timesheet for that week first', async () => {
    dbMock.respond([inv], []);
    const res = await request(app).post(`/api/emailing/submissions/invoices/${SUB}/approve`).set(authHeader()).send({});
    expect(res.status).toBe(409);
  });
});
