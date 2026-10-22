'use strict';

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const crewRouter = require('../routes/crew');
const forecastingRouter = require('../routes/forecasting');

const app = makeApp(
  ['/api/crew', crewRouter],
  ['/api/forecasting', forecastingRouter]
);

beforeEach(() => dbMock.reset());

describe('Feature 1: Crew Earnings Report', () => {
  const crewId = 'c0000000-0000-0000-0000-000000000001';

  test('GET /api/crew/:id/earnings-report calculates totals and breakdown', async () => {
    // 1. Crew lookup
    dbMock.respond([{
      id: crewId,
      first_name: 'John',
      last_name: 'Smith',
      email: 'john@example.com',
      trade: 'Carpenters',
      rank: 'Carpenter',
      phone: '07123456789',
    }]);

    // 2. Timesheet rows breakdown
    dbMock.respond([
      {
        id: 'ts-01',
        production_id: 'p-01',
        production_name: 'Production Alpha',
        production_code: 'ALPHA',
        week_ending_date: '2026-06-07',
        status: 'approved',
        payment_status: 'paid',
        rate_type: 'weekly',
        weekly_rate: 1500,
        sixth_day_payment: 0,
        seventh_day_payment: 0,
        overtime_amount: 90,
        meal_allowance_total: 70,
        mileage_and_travel: 50,
        vat: 342,
        gross_total: 1710,
        grand_total: 2052,
        days_worked: 5,
        overtime_hours: 2,
        travel_allowance: 30,
        mileage_allowance: 20,
        subsistence_allowance: 70,
      },
    ]);

    const res = await request(app)
      .get(`/api/crew/${crewId}/earnings-report?start_date=2026-06-01&end_date=2026-06-30`)
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body.crew.name).toBe('John Smith');
    expect(res.body.summary.timesheet_count).toBe(1);
    expect(res.body.summary.total_days_worked).toBe(5);
    expect(res.body.summary.total_gross).toBe(1710);
    expect(res.body.breakdown).toHaveLength(1);
    expect(res.body.breakdown[0].production_name).toBe('Production Alpha');
  });

  test('POST /api/crew/:id/earnings-report/send requires recipient email or crew on record', async () => {
    // 1. Crew query returns empty -> 404
    dbMock.respond([]);

    const res = await request(app)
      .post(`/api/crew/non-existent-id/earnings-report/send`)
      .set(authHeader('md'))
      .send({ start_date: '2026-06-01', end_date: '2026-06-30' });

    expect(res.status).toBe(404);
  });
});

describe('Feature 2: Weekly Custom Estimator (Forecaster)', () => {
  const estimateId = 'e0000000-0000-0000-0000-000000000001';

  test('GET /api/forecasting/weekly-custom-estimates/rates/lookup returns rates & presets', async () => {
    dbMock.respond([
      { id: 'rate-1', trade: 'Carpenters', rank: 'Carpenter', daily_rate: 300, weekly_rate: 1500, overtime_rate: 45 },
    ]);

    const res = await request(app)
      .get('/api/forecasting/weekly-custom-estimates/rates/lookup')
      .set(authHeader('coordinator'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rates');
    expect(res.body).toHaveProperty('presets');
    expect(res.body.presets.vehicles).toBeDefined();
    expect(res.body.presets.defaultMarginPercentage).toBe(10);
  });

  test('POST /api/forecasting/weekly-custom-estimates creates custom estimate with weeks config', async () => {
    dbMock.respond([{
      id: estimateId,
      title: '3-Week Set Build Quote',
      production_id: null,
      num_weeks: 3,
      start_date: '2026-07-01',
      margin_enabled: true,
      margin_percentage: 10.0,
      weeks_config: [
        {
          week_number: 1,
          roles: [
            {
              rank: 'Carpenter',
              quantity: 4,
              unit_type: 'weeks',
              overtime_hours: 2,
              saturday_ot_hours: 4,
              sunday_ot_hours: 2,
            },
          ],
        },
      ],
      summary_totals: { grand_total_with_margin: 15400, subtotal_ot_general: 360, subtotal_ot_saturday: 720, subtotal_ot_sunday: 480 },
      notes: 'Initial test quote with Weekend OT',
    }]);

    const res = await request(app)
      .post('/api/forecasting/weekly-custom-estimates')
      .set(authHeader('accountant'))
      .send({
        title: '3-Week Set Build Quote',
        num_weeks: 3,
        start_date: '2026-07-01',
        margin_enabled: true,
        margin_percentage: 10,
        weeks_config: [
          {
            week_number: 1,
            roles: [
              {
                rank: 'Carpenter',
                quantity: 4,
                unit_type: 'weeks',
                overtime_hours: 2,
                saturday_ot_hours: 4,
                sunday_ot_hours: 2,
              },
            ],
          },
        ],
        summary_totals: { grand_total_with_margin: 15400, subtotal_ot_general: 360, subtotal_ot_saturday: 720, subtotal_ot_sunday: 480 },
        notes: 'Initial test quote with Weekend OT',
      });

    expect(res.status).toBe(201);
    expect(res.body.estimate.title).toBe('3-Week Set Build Quote');
    expect(res.body.estimate.margin_enabled).toBe(true);
    expect(res.body.estimate.summary_totals.subtotal_ot_saturday).toBe(720);
  });

  test('GET /api/forecasting/weekly-custom-estimates lists estimates', async () => {
    dbMock.respond([{
      id: estimateId,
      title: '3-Week Set Build Quote',
      num_weeks: 3,
    }]);

    const res = await request(app)
      .get('/api/forecasting/weekly-custom-estimates')
      .set(authHeader('guest'));

    expect(res.status).toBe(200);
    expect(res.body.estimates).toHaveLength(1);
  });

  test('PUT /api/forecasting/weekly-custom-estimates/:id updates estimate', async () => {
    // 1. Existing check
    dbMock.respond([{ id: estimateId, title: 'Old Title', num_weeks: 3, margin_enabled: true, margin_percentage: 10 }]);
    // 2. Update query
    dbMock.respond([{ id: estimateId, title: 'Updated Title', num_weeks: 4, margin_enabled: true, margin_percentage: 12 }]);

    const res = await request(app)
      .put(`/api/forecasting/weekly-custom-estimates/${estimateId}`)
      .set(authHeader('md'))
      .send({ title: 'Updated Title', num_weeks: 4, margin_percentage: 12 });

    expect(res.status).toBe(200);
    expect(res.body.estimate.title).toBe('Updated Title');
  });

  test('DELETE /api/forecasting/weekly-custom-estimates/:id removes estimate', async () => {
    dbMock.respond([{ id: estimateId, title: 'To Delete' }]);

    const res = await request(app)
      .delete(`/api/forecasting/weekly-custom-estimates/${estimateId}`)
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('deleted');
  });
});
