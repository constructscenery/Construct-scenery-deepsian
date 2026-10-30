const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/timesheetPdfService', () => ({
  generateTimesheetPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
}));

const app = makeApp(['/api/timesheets', require('../routes/timesheets')]);
const prodId = '11111111-1111-1111-1111-111111111111';
const tsId1 = '22222222-2222-2222-2222-222222222222';
const tsId2 = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
});

describe('POST /api/timesheets/bulk-distribute', () => {
  test('Distributes draft timesheets for a given week', async () => {
    // 1. SELECT timesheets (mock returns 1 draft timesheet with email)
    // 2. SELECT entries
    // 3. UPDATE timesheets SET status = 'distributed'
    dbMock.respond(
      [
        {
          id: tsId1,
          crew_member_id: 'cm-1',
          production_id: prodId,
          week_ending_date: '2026-10-18',
          status: 'draft',
          first_name: 'Alex',
          last_name: 'Smith',
          email: 'alex@example.com',
          crew_number: 'CSC-101',
          prod_name: 'Production 1',
          grand_total: '500.00',
        },
      ],
      [{ day_of_week: 'Monday', full_day_worked: true }],
      []
    );

    const res = await request(app)
      .post('/api/timesheets/bulk-distribute')
      .set(authHeader('md'))
      .send({ week_ending_date: '2026-10-18', production_id: prodId });

    expect(res.status).toBe(200);
    expect(res.body.results.sent).toContain('Alex Smith');
    expect(res.body.message).toContain('1 timesheet(s) distributed');
  });

  test('Distributes specifically selected timesheet_ids', async () => {
    dbMock.respond(
      [
        {
          id: tsId1,
          crew_member_id: 'cm-1',
          production_id: prodId,
          week_ending_date: '2026-10-18',
          status: 'draft',
          first_name: 'Alex',
          last_name: 'Smith',
          email: 'alex@example.com',
          crew_number: 'CSC-101',
          prod_name: 'Production 1',
          grand_total: '500.00',
        },
      ],
      [{ day_of_week: 'Monday', full_day_worked: true }],
      []
    );

    const res = await request(app)
      .post('/api/timesheets/bulk-distribute')
      .set(authHeader('md'))
      .send({ week_ending_date: '2026-10-18', timesheet_ids: [tsId1] });

    expect(res.status).toBe(200);
    expect(res.body.results.sent).toContain('Alex Smith');
  });

  test('Returns 400 when no draft/pending timesheets found', async () => {
    dbMock.respond([]);

    const res = await request(app)
      .post('/api/timesheets/bulk-distribute')
      .set(authHeader('md'))
      .send({ week_ending_date: '2026-10-18', production_id: prodId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No draft or pending timesheets found');
  });
});

describe('timesheetDistributed email template signature removal', () => {
  test('does not refer to a request for signature or signed timesheets', () => {
    const { templates } = jest.requireActual('../config/email');
    const tmpl = templates.timesheetDistributed('John Doe', '2026-10-18', 'Prod 1', 5, '1000.00');
    expect(tmpl.html).not.toMatch(/sign the timesheet/i);
    expect(tmpl.html).not.toMatch(/signed timesheet/i);
    expect(tmpl.html).toContain('invoice');
  });
});

describe('PUT /api/timesheets/:id/entries Saturday & Sunday rate rules', () => {
  test('Saturday is paid at normal day rate (no premium), Sunday has 2x premium', async () => {
    const mockTs = {
      id: tsId1,
      production_id: prodId,
      crew_member_id: 'cm-1',
      week_ending_date: '2026-10-18',
      crew_rank: 'Carpenter',
      crew_trade: 'Carpenters',
      employment_status: 'freelance',
      rate_override: 200,
    };

    const entries = [
      { date: '2026-10-12', day_of_week: 'Monday', full_day_worked: true },
      { date: '2026-10-17', day_of_week: 'Saturday', full_day_worked: true },
      { date: '2026-10-18', day_of_week: 'Sunday', full_day_worked: true },
    ];

    dbMock.respond(
      [], // 1. BEGIN
      [mockTs], // 2. SELECT timesheet
      [], // 3. UPDATE rank_override / rate_override
      [], // 4. DELETE timesheet_entries
      [], // 5. INSERT INTO timesheet_entries (batch)
      [{
        ...mockTs,
        weekly_rate: '400.00',
        sixth_day_payment: '0.00',
        seventh_day_payment: '400.00',
        gross_total: '800.00',
        grand_total: '800.00',
      }], // 6. UPDATE timesheets RETURNING *
      [] // 7. COMMIT
    );

    const res = await request(app)
      .put(`/api/timesheets/${tsId1}/entries`)
      .set(authHeader('md'))
      .send({ entries, rate_override: 200 });

    expect(res.status).toBe(200);
    expect(res.body.weekly_rate).toBe('400.00');
    expect(res.body.sixth_day_payment).toBe('0.00');
    expect(res.body.seventh_day_payment).toBe('400.00');
  });

  test('6 days worked (Monday through Saturday): standard days = 6, sixth_day_payment = 0', async () => {
    const mockTs = {
      id: tsId1,
      production_id: prodId,
      crew_member_id: 'cm-1',
      week_ending_date: '2026-10-18',
      crew_rank: 'Carpenter',
      crew_trade: 'Carpenters',
      employment_status: 'freelance',
      rate_override: 200,
    };

    const entries = [
      { date: '2026-10-12', day_of_week: 'Monday', full_day_worked: true },
      { date: '2026-10-13', day_of_week: 'Tuesday', full_day_worked: true },
      { date: '2026-10-14', day_of_week: 'Wednesday', full_day_worked: true },
      { date: '2026-10-15', day_of_week: 'Thursday', full_day_worked: true },
      { date: '2026-10-16', day_of_week: 'Friday', full_day_worked: true },
      { date: '2026-10-17', day_of_week: 'Saturday', full_day_worked: true },
    ];

    dbMock.respond(
      [], // BEGIN
      [mockTs], // SELECT timesheet
      [], // UPDATE rank_override / rate_override
      [], // DELETE timesheet_entries
      [], // INSERT INTO timesheet_entries (batch)
      [{
        ...mockTs,
        weekly_rate: '1200.00',
        sixth_day_payment: '0.00',
        seventh_day_payment: '0.00',
        gross_total: '1200.00',
        grand_total: '1200.00',
      }], // UPDATE timesheets RETURNING *
      [] // COMMIT
    );

    const res = await request(app)
      .put(`/api/timesheets/${tsId1}/entries`)
      .set(authHeader('md'))
      .send({ entries, rate_override: 200 });

    expect(res.status).toBe(200);
    expect(res.body.weekly_rate).toBe('1200.00');
    expect(res.body.sixth_day_payment).toBe('0.00');
    expect(res.body.seventh_day_payment).toBe('0.00');
  });

  test('Sunday worked alone: weekly_rate = 0, Sunday has 2x premium', async () => {
    const mockTs = {
      id: tsId1,
      production_id: prodId,
      crew_member_id: 'cm-1',
      week_ending_date: '2026-10-18',
      crew_rank: 'Carpenter',
      crew_trade: 'Carpenters',
      employment_status: 'freelance',
      rate_override: 200,
    };

    const entries = [
      { date: '2026-10-18', day_of_week: 'Sunday', full_day_worked: true },
    ];

    dbMock.respond(
      [], // BEGIN
      [mockTs], // SELECT timesheet
      [], // UPDATE rank_override / rate_override
      [], // DELETE timesheet_entries
      [], // INSERT INTO timesheet_entries (batch)
      [{
        ...mockTs,
        weekly_rate: '0.00',
        sixth_day_payment: '0.00',
        seventh_day_payment: '400.00',
        gross_total: '400.00',
        grand_total: '400.00',
      }], // UPDATE timesheets RETURNING *
      [] // COMMIT
    );

    const res = await request(app)
      .put(`/api/timesheets/${tsId1}/entries`)
      .set(authHeader('md'))
      .send({ entries, rate_override: 200 });

    expect(res.status).toBe(200);
    expect(res.body.weekly_rate).toBe('0.00');
    expect(res.body.sixth_day_payment).toBe('0.00');
    expect(res.body.seventh_day_payment).toBe('400.00');
  });
});

