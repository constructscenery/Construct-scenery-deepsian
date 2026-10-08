/**
 * Public crew portal — token access, timesheet submission and availability responses.
 */
const request = require('supertest');
const express = require('express');
const { dbMock } = require('./setup');

jest.mock('../services/emailing/portalLinks', () => ({ resolveToken: jest.fn() }));
jest.mock('../services/fileStorage', () => ({
  validate: jest.fn(),
  store: jest.fn().mockResolvedValue({ url: 'https://b.s3/inv.pdf', key: 'uploads/inv.pdf', size: 10 }),
  deleteFile: jest.fn(),
}));

const portalLinks = require('../services/emailing/portalLinks');
const ctrl = require('../Controllers/crewPortalController');
const { addDays, recentWeekEndings } = require('../services/emailing/dates');

const app = express();
app.use(express.json());
app.use('/api/public/crew-portal', require('../routes/crewPortal'));

const TOKEN = 'a'.repeat(43);
const CREW = { id: '22222222-2222-2222-2222-222222222222', first_name: 'Sam', last_name: 'Crew', crew_number: 'C-1', employment_status: 'self_employed' };
const PROD = '33333333-3333-3333-3333-333333333333';
const WEEK = recentWeekEndings(2)[1]; // last week's Sunday

const fullWeek = (overrides = {}) => [0, 1, 2, 3, 4, 5, 6].map((i) => ({
  date: addDays(WEEK, i - 6),
  full_day_worked: i < 5,
  overtime_hours: i === 0 ? 2 : 0,
  ...overrides,
}));

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
  portalLinks.resolveToken.mockResolvedValue({ ok: true, crew: CREW, link: { id: 'l1', expires_at: '2026-12-01T00:00:00Z' } });
});

test('invalid or expired links are refused', async () => {
  portalLinks.resolveToken.mockResolvedValue({ ok: false, status: 410, error: 'This link has expired.' });
  const res = await request(app).get(`/api/public/crew-portal/${TOKEN}`);
  expect(res.status).toBe(410);
  expect(res.body.error).toContain('expired');
});

test('portal home returns only the crew member’s own summary', async () => {
  dbMock.respond([{ id: PROD, name: 'Prod A' }], [{ polls_awaiting: '1', timesheets_returned: '0', invoices_returned: '0' }]);
  const res = await request(app).get(`/api/public/crew-portal/${TOKEN}`);
  expect(res.status).toBe(200);
  expect(res.body.crew).toEqual(expect.objectContaining({ first_name: 'Sam', needs_invoices: true }));
  expect(res.body.crew.email).toBeUndefined();
  expect(res.body.productions).toEqual([{ id: PROD, name: 'Prod A' }]);
  expect(res.headers['cache-control']).toBe('no-store');
});

describe('timesheet submission', () => {
  test('creates a submission held for review (does not touch timesheets)', async () => {
    dbMock.respond(
      [{ id: PROD, name: 'Prod A' }],   // portal productions
      [],                               // existing CMS timesheet
      [],                               // BEGIN
      [],                               // open submission (FOR UPDATE)
      [{ id: 'sub-1', status: 'submitted', revision: 1 }], // insert
      { rows: [], rowCount: 7 },        // entries
      { rows: [], rowCount: 1 },        // review row
      [],                               // COMMIT
    );
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/timesheets`).send({ production_id: PROD, week_ending_date: WEEK, entries: fullWeek(), notes: 'Thanks' });
    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe('submitted');
    const client = await dbMock.connect.mock.results[0].value;
    const allSql = [...dbMock.query.mock.calls, ...client.query.mock.calls].map(([sql]) => sql).join('\n');
    expect(allSql).toContain('INSERT INTO crew_timesheet_submissions');
    expect(allSql).not.toMatch(/INSERT INTO timesheets\b/);
  });

  test('rejects future weeks', async () => {
    dbMock.respond([{ id: PROD, name: 'Prod A' }]);
    const future = addDays(recentWeekEndings(1)[0], 7);
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/timesheets`).send({ production_id: PROD, week_ending_date: future, entries: fullWeek() });
    expect(res.status).toBe(400);
  });

  test('rejects productions the crew member is not linked to', async () => {
    dbMock.respond([{ id: PROD, name: 'Prod A' }]);
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/timesheets`).send({ production_id: '99999999-9999-9999-9999-999999999999', week_ending_date: WEEK, entries: fullWeek() });
    expect(res.status).toBe(400);
  });

  test('refuses when the office has already finalised the week', async () => {
    dbMock.respond([{ id: PROD, name: 'Prod A' }], [{ status: 'finalised' }]);
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/timesheets`).send({ production_id: PROD, week_ending_date: WEEK, entries: fullWeek() });
    expect(res.status).toBe(409);
  });

  test('entry validation', () => {
    expect(() => ctrl._parseEntries(fullWeek().slice(0, 6), WEEK)).toThrow('all 7 days');
    expect(() => ctrl._parseEntries(fullWeek({ full_day_worked: false, overtime_hours: 0 }), WEEK)).toThrow('at least one day');
    expect(() => ctrl._parseEntries(fullWeek({ overtime_hours: 30 }), WEEK)).toThrow('between 0 and 16');
    expect(() => ctrl._parseEntries(fullWeek({ travel: -5 }), WEEK)).toThrow('Travel');
    const ok = ctrl._parseEntries(fullWeek(), WEEK);
    expect(ok.map((e) => e.day_of_week)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(ok[0]).toEqual(expect.objectContaining({ full_day_worked: true, overtime_hours: 2 }));
  });
});

describe('availability', () => {
  test('partial availability needs a note', async () => {
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/availability/44444444-4444-4444-4444-444444444444`).send({ response: 'partial' });
    expect(res.status).toBe(400);
  });

  test('records a response for a poll sent to this crew member', async () => {
    dbMock.respond([{ id: 'r1', response: 'available', responded_at: '2026-10-08' }]);
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/availability/44444444-4444-4444-4444-444444444444`).send({ response: 'available' });
    expect(res.status).toBe(200);
    expect(dbMock.query.mock.calls[0][1]).toEqual(['44444444-4444-4444-4444-444444444444', CREW.id, 'available', null]);
  });

  test('closed or foreign polls return 404', async () => {
    dbMock.respond([]);
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/availability/44444444-4444-4444-4444-444444444444`).send({ response: 'unavailable' });
    expect(res.status).toBe(404);
  });
});

describe('invoice upload', () => {
  test('requires a file', async () => {
    const res = await request(app).post(`/api/public/crew-portal/${TOKEN}/invoices`).field('production_id', PROD).field('week_ending_date', WEEK);
    expect(res.status).toBe(400);
  });

  test('stores the file and holds the invoice for review', async () => {
    dbMock.respond(
      [{ id: PROD, name: 'Prod A' }],  // productions
      [],                              // open submission
      [],                              // BEGIN
      [{ id: 'inv-1', status: 'submitted', revision: 1 }],
      { rows: [], rowCount: 1 },       // review
      [],                              // COMMIT
    );
    const res = await request(app)
      .post(`/api/public/crew-portal/${TOKEN}/invoices`)
      .field('production_id', PROD)
      .field('week_ending_date', WEEK)
      .field('invoice_number', 'INV-7')
      .field('amount', '650')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'inv.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe('submitted');
  });
});
