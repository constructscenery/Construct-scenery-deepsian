'use strict';
/**
 * Settings controller tests
 * Tests: getSettings, patchSetting
 * Access: GET → MD + Coordinator; PATCH → MD + Coordinator
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const router = require('../routes/settings');
const app = makeApp(['/api/settings', router]);

beforeEach(() => dbMock.reset());

// ─── GET /api/settings ────────────────────────────────────────────────────────
describe('GET /api/settings', () => {
  test('MD gets all settings — 200', async () => {
    dbMock.respond([
      { key: 'handover_alert_days', value: [14, 7], updated_at: '2026-06-01T00:00:00Z' },
    ]);
    const res = await request(app)
      .get('/api/settings')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('handover_alert_days');
    expect(res.body.handover_alert_days.value).toEqual([14, 7]);
  });

  test('Coordinator gets settings — 200', async () => {
    dbMock.respond([
      { key: 'handover_alert_days', value: [14, 7], updated_at: '2026-06-01T00:00:00Z' },
    ]);
    const res = await request(app)
      .get('/api/settings')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('Accountant can read settings (read-only access granted in policies) — 200', async () => {
    dbMock.respond([
      { key: 'handover_alert_days', value: [14, 7], updated_at: '2026-06-01T00:00:00Z' },
    ]);
    const res = await request(app)
      .get('/api/settings')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });

  test('No auth → 401', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/settings/:key ─────────────────────────────────────────────────
describe('PATCH /api/settings/:key', () => {
  test('MD updates handover_alert_days — 200', async () => {
    dbMock.respond([{ key: 'handover_alert_days', value: [14, 7, 3], updated_at: '2026-06-07T00:00:00Z' }]);
    const res = await request(app)
      .patch('/api/settings/handover_alert_days')
      .set(authHeader('md'))
      .send({ value: [14, 7, 3] });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('handover_alert_days');
    expect(res.body.value).toEqual([14, 7, 3]);
  });

  test('Coordinator can update settings — 200', async () => {
    dbMock.respond([{ key: 'handover_alert_days', value: [10, 5], updated_at: '2026-06-07T00:00:00Z' }]);
    const res = await request(app)
      .patch('/api/settings/handover_alert_days')
      .set(authHeader('coordinator'))
      .send({ value: [10, 5] });
    expect(res.status).toBe(200);
  });

  test('Accountant patches setting — 200', async () => {
    dbMock.respond([{ key: 'handover_alert_days', value: [14], updated_at: '2026-06-07T00:00:00Z' }]);
    const res = await request(app)
      .patch('/api/settings/handover_alert_days')
      .set(authHeader('accountant'))
      .send({ value: [14] });
    expect(res.status).toBe(200);
  });

  test('handover_alert_days with non-integers → 400', async () => {
    const res = await request(app)
      .patch('/api/settings/handover_alert_days')
      .set(authHeader('md'))
      .send({ value: [14, 'seven'] });
    expect(res.status).toBe(400);
  });

  test('handover_alert_days with negative number → 400', async () => {
    const res = await request(app)
      .patch('/api/settings/handover_alert_days')
      .set(authHeader('md'))
      .send({ value: [-1, 7] });
    expect(res.status).toBe(400);
  });

  test('Missing value → 400', async () => {
    const res = await request(app)
      .patch('/api/settings/handover_alert_days')
      .set(authHeader('md'))
      .send({});
    expect(res.status).toBe(400);
  });

  test('Custom key (non-handover) accepted — 200', async () => {
    dbMock.respond([{ key: 'custom_setting', value: 'foo', updated_at: '2026-06-07T00:00:00Z' }]);
    const res = await request(app)
      .patch('/api/settings/custom_setting')
      .set(authHeader('md'))
      .send({ value: 'foo' });
    expect(res.status).toBe(200);
  });
});
