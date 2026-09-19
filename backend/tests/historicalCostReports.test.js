jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/costReportService', () => ({ getSupplierCosts: jest.fn(), getLabourCosts: jest.fn(), getSummaryMetrics: jest.fn() }));
jest.mock('../services/costReportPdfService', () => ({ generateCostReportPdf: jest.fn() }));
jest.mock('../services/costReportType2PdfService', () => ({ generateCostReportType2Pdf: jest.fn() }));
jest.mock('../services/fileStorage', () => ({ validate: jest.fn(), store: jest.fn(), deleteFile: jest.fn(), streamToResponse: jest.fn() }));

const db = require('../config/db');
const costs = require('../services/costReportService');
const { generateCostReportPdf } = require('../services/costReportPdfService');
const { generateCostReportType2Pdf } = require('../services/costReportType2PdfService');
const { buildFinalCostReportPdf } = require('../Controllers/costReportsController');
const { withFinalCostReport } = require('../services/historicalCostReportService');
const storage = require('../services/fileStorage');
const productions = require('../Controllers/productionsController');
const request = require('supertest');
const express = require('express');
const { checkPolicy } = require('../Middleware/roleCheck');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { if (req.headers['x-test-role']) req.user = { id: 'user-1', role: req.headers['x-test-role'] }; next(); });
app.use(checkPolicy);
app.use('/api/cost-reports', require('../routes/costReports'));
app.use('/api/productions', require('../routes/productions'));

beforeEach(() => jest.resetAllMocks());
afterEach(() => jest.restoreAllMocks());

test('final Type 1 PDF uses the complete unfiltered cost data on the supplied connection', async () => {
  const production = { id: 'production-1', name: 'Example', contract_type: 'on_a_price' };
  const client = { query: jest.fn().mockResolvedValue({ rows: [production] }) };
  costs.getSupplierCosts.mockResolvedValue([{ net_amount: 100 }]);
  costs.getLabourCosts.mockResolvedValue([]);
  costs.getSummaryMetrics.mockResolvedValue({ total_costs_to_date: 100 });
  generateCostReportPdf.mockResolvedValue(Buffer.from('final-pdf'));
  expect(await buildFinalCostReportPdf(production.id, client)).toEqual(Buffer.from('final-pdf'));
  expect(costs.getSupplierCosts).toHaveBeenCalledWith(production.id, {}, client);
  expect(costs.getLabourCosts).toHaveBeenCalledWith(production.id, {}, client);
  expect(generateCostReportPdf).toHaveBeenCalledWith({ production, supplierEntries: [{ net_amount: 100 }], labourEntries: [], metrics: { total_costs_to_date: 100 } });
  expect(generateCostReportType2Pdf).not.toHaveBeenCalled();
});

test('missing productions cannot generate final reports', async () => {
  db.query.mockResolvedValue({ rows: [] });
  await expect(buildFinalCostReportPdf('missing')).rejects.toMatchObject({ status: 404 });
});

test('Type 2 uses the Cost Plus generator and all nine sections', async () => {
  const production = { id: 'production-2', name: 'Cost Plus', contract_type: 'cost_plus' };
  const client = { query: jest.fn(async sql => ({ rows: sql.includes('FROM productions') ? [production] : [] })) };
  costs.getSupplierCosts.mockResolvedValue([]);
  costs.getLabourCosts.mockResolvedValue([]);
  generateCostReportType2Pdf.mockResolvedValue(Buffer.from('type2-pdf'));
  expect(await buildFinalCostReportPdf(production.id, client)).toEqual(Buffer.from('type2-pdf'));
  expect(generateCostReportType2Pdf).toHaveBeenCalledWith(expect.objectContaining({ production, mainCostReport: expect.any(Array), posAndBilling: [], labourToSend: [], materialsToSend: [], omittedLabour: [], omittedMaterials: [], weeklyInvoiceSummary: [], weeklyPL: [], summary: expect.any(Object) }));
  expect(generateCostReportPdf).not.toHaveBeenCalled();
});

describe('automatic immutable storage', () => {
  let client;
  let production;
  beforeEach(() => {
    production = { id: 'production-1', name: 'Example', contract_type: 'on_a_price', status: 'strike' };
    client = { query: jest.fn(async sql => ({ rows: sql.includes('FROM productions') ? [production] : [] })), release: jest.fn() };
    db.connect.mockResolvedValue(client);
    costs.getSupplierCosts.mockResolvedValue([]);
    costs.getLabourCosts.mockResolvedValue([]);
    costs.getSummaryMetrics.mockResolvedValue({});
    generateCostReportPdf.mockResolvedValue(Buffer.from('final-pdf'));
    storage.store.mockResolvedValue({ key: 'uploads/final.pdf', url: '/final.pdf' });
    storage.deleteFile.mockResolvedValue();
  });

  test('status change and stored report commit together', async () => {
    const action = jest.fn().mockResolvedValue({ status: 'complete' });
    expect(await withFinalCostReport(production.id, 'user-1', 'strike', action)).toEqual({ status: 'complete' });
    expect(action).toHaveBeenCalledWith(client);
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO historical_cost_reports'));
    expect(insert[1]).toEqual(expect.arrayContaining(['production-1', 'Example', 'type1', 'uploads/final.pdf', 'user-1']));
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test.each([null, '2026-09-19T00:00:00Z'])('archive preserves the existing report including deleted reports (%s)', async deletedAt => {
    production.status = 'complete';
    client.query.mockImplementation(async sql => ({ rows: sql.includes('FROM productions') ? [production] : sql.includes('FROM historical_cost_reports') ? [{ id: 'existing-report', deleted_at: deletedAt }] : [] }));
    const action = jest.fn().mockResolvedValue({ status: 'archived' });
    await withFinalCostReport(production.id, 'user-1', 'complete', action);
    expect(action).toHaveBeenCalledWith(client);
    expect(storage.store).not.toHaveBeenCalled();
    expect(generateCostReportPdf).not.toHaveBeenCalled();
    expect(client.query.mock.calls.find(([sql]) => sql.includes('FROM historical_cost_reports'))[0]).not.toContain('deleted_at IS NULL');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  test('upload failure rolls back the production change', async () => {
    storage.store.mockRejectedValue(new Error('Storage unavailable'));
    await expect(withFinalCostReport(production.id, 'user-1', 'strike', jest.fn())).rejects.toThrow('Storage unavailable');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });

  test('database failure removes the uploaded file and rolls back', async () => {
    client.query.mockImplementation(async sql => {
      if (sql.includes('INSERT INTO historical_cost_reports')) throw new Error('Insert failed');
      return { rows: sql.includes('FROM productions') ? [production] : [] };
    });
    await expect(withFinalCostReport(production.id, 'user-1', 'strike', jest.fn())).rejects.toThrow('Insert failed');
    expect(storage.deleteFile).toHaveBeenCalledWith('uploads/final.pdf');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  test.each([true, false])('uncertain COMMIT preserves the PDF even when the server committed: %s', async serverCommitted => {
    const connectionError = Object.assign(new Error('Connection terminated'), { code: 'ECONNRESET' });
    let persistedFile = null;
    client.query.mockImplementation(async sql => {
      if (sql === 'COMMIT') {
        if (serverCommitted) persistedFile = 'uploads/final.pdf';
        throw connectionError;
      }
      return { rows: sql.includes('FROM productions') ? [production] : [] };
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(withFinalCostReport(production.id, 'user-1', 'strike', jest.fn())).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Refresh') });
    expect(persistedFile).toBe(serverCommitted ? 'uploads/final.pdf' : null);
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(connectionError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('outcome unknown'), expect.objectContaining({ fileKey: 'uploads/final.pdf' }));
  });

  test.each(['40001', '40P01'])('confirmed transaction abort at COMMIT (%s) cleans up and returns conflict', async code => {
    client.query.mockImplementation(async sql => {
      if (sql === 'COMMIT') throw Object.assign(new Error('Transaction aborted'), { code });
      return { rows: sql.includes('FROM productions') ? [production] : [] };
    });
    await expect(withFinalCostReport(production.id, 'user-1', 'strike', jest.fn())).rejects.toMatchObject({ status: 409 });
    expect(storage.deleteFile).toHaveBeenCalledWith('uploads/final.pdf');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  test('failed rollback discards the connection and preserves the original error', async () => {
    const rollbackError = new Error('Rollback connection lost');
    client.query.mockImplementation(async sql => {
      if (sql === 'ROLLBACK') throw rollbackError;
      if (sql.includes('INSERT INTO historical_cost_reports')) throw new Error('Insert failed');
      return { rows: sql.includes('FROM productions') ? [production] : [] };
    });
    await expect(withFinalCostReport(production.id, 'user-1', 'strike', jest.fn())).rejects.toThrow('Insert failed');
    expect(client.release).toHaveBeenCalledWith(rollbackError);
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });

  test.each(['transitionStatus', 'archiveProduction'])('%s returns 409 for concurrent updates without generating a PDF', async handler => {
    production.status = handler === 'transitionStatus' ? 'strike' : 'complete';
    db.query.mockResolvedValue({ rows: [production] });
    client.query.mockImplementation(async sql => {
      if (sql.includes('FOR UPDATE')) throw Object.assign(new Error('Concurrent update'), { code: '40001' });
      return { rows: [] };
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const background = jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions[handler]({ params: { id: production.id }, user: { id: 'user-1', role: 'managing_director' }, body: { to_status: 'complete', checklist_confirmed: true } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Refresh') });
    expect(storage.store).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(background).not.toHaveBeenCalled();
  });

  test('stale concurrent transition does not change production or generate a file', async () => {
    const action = jest.fn();
    await expect(withFinalCostReport(production.id, 'user-1', 'complete', action)).rejects.toMatchObject({ status: 409 });
    expect(action).not.toHaveBeenCalled();
    expect(storage.store).not.toHaveBeenCalled();
  });

  test.each(['type1', 'type2'])('completion endpoint stores the final %s report with the status and audit', async reportType => {
    production.contract_type = reportType === 'type1' ? 'on_a_price' : 'cost_plus';
    generateCostReportType2Pdf.mockResolvedValue(Buffer.from('cost-plus-pdf'));
    db.query.mockResolvedValue({ rows: [production] });
    client.query.mockImplementation(async sql => ({ rows: sql.includes('FROM productions') ? [production] : sql.includes('UPDATE productions') ? [{ ...production, status: 'complete' }] : [] }));
    jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    const req = { params: { id: production.id }, user: { id: 'user-1', role: 'construction_coordinator' }, body: { to_status: 'complete', checklist_confirmed: true } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions.transitionStatus(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ production: expect.objectContaining({ status: 'complete' }) }));
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(true);
    expect(client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO historical_cost_reports'))[1][2]).toBe(reportType);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('archiving a previously completed production captures a missing final report', async () => {
    production.status = 'complete';
    db.query.mockResolvedValue({ rows: [production] });
    client.query.mockImplementation(async sql => ({ rows: sql.includes('FROM productions') ? [production] : sql.includes('UPDATE productions') ? [{ ...production, status: 'archived' }] : [] }));
    jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions.archiveProduction({ params: { id: production.id }, user: { id: 'user-1', role: 'construction_accountant' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ production: expect.objectContaining({ status: 'archived' }) }));
    expect(storage.store).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  test('completion reports storage failure and never commits the status change', async () => {
    db.query.mockResolvedValue({ rows: [production] });
    storage.store.mockRejectedValue(new Error('Storage unavailable'));
    const background = jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions.transitionStatus({ params: { id: production.id }, user: { id: 'user-1', role: 'managing_director' }, body: { to_status: 'complete', checklist_confirmed: true } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Storage unavailable' });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(background).not.toHaveBeenCalled();
  });
});

describe('initial production status', () => {
  test.each(['complete', 'archived', 'strike', 'invalid', ''])('rejects %j before any database write', async status => {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions.createProduction({ body: { name: 'Example', contract_type: 'on_a_price', status }, user: { id: 'user-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });

  test.each([undefined, 'pre_production', 'active_build'])('allows initial status %j', async status => {
    const initialStatus = status ?? 'pre_production';
    db.query.mockResolvedValue({ rows: [{ id: 'production-1', status: initialStatus }] });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions.createProduction({ body: { name: 'Example', contract_type: 'on_a_price', status }, user: { id: 'user-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(db.query.mock.calls[0][1][7]).toBe(initialStatus);
  });
});

describe('historical report API', () => {
  const reportId = '11111111-1111-1111-1111-111111111111';
  const path = '/api/cost-reports/historical';
  const report = { id: reportId, production_name: 'Legacy production', report_type: 'type2', report_date: '2020-01-01', source: 'manual_upload', file_name: 'legacy.pdf' };
  const roles = ['managing_director', 'construction_accountant', 'construction_coordinator'];
  test.each(roles)('%s can link an upload to an existing production and mark it legacy', async role => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'Registered production' }] }).mockResolvedValueOnce({ rows: [{ ...report, production_id: reportId, is_legacy: true }] });
    storage.store.mockResolvedValue({ key: 'uploads/legacy.pdf', url: '/legacy.pdf' });
    const response = await request(app).post(`${path}/upload`).set('x-test-role', role).field('production_id', reportId).field('production_name', 'Untrusted name').field('is_legacy', 'true').field('report_type', 'type2').field('report_date', '2020-01-01').attach('file', Buffer.from('%PDF-1.4\n'), 'legacy.pdf');
    expect(response.status).toBe(201);
    expect(response.body.is_legacy).toBe(true);
    expect(db.query.mock.calls[0]).toEqual([expect.stringContaining('deleted_at IS NULL'), [reportId]]);
    expect(db.query.mock.calls[1][1][0]).toBe('Registered production');
    expect(db.query.mock.calls[1][1].slice(-2)).toEqual([reportId, true]);
  });

  test.each(['true', 'false'])('manual names support explicit legacy flag %s', async legacy => {
    db.query.mockResolvedValue({ rows: [report] });
    storage.store.mockResolvedValue({ key: 'uploads/legacy.pdf', url: '/legacy.pdf' });
    const response = await request(app).post(`${path}/upload`).set('x-test-role', roles[0]).field('production_name', '  Historical name  ').field('is_legacy', legacy).field('report_type', 'type1').field('report_date', '2020-01-01').attach('file', Buffer.from('%PDF-1.4\n'), 'legacy.pdf');
    expect(response.status).toBe(201);
    expect(db.query.mock.calls[0][1][0]).toBe('Historical name');
    expect(db.query.mock.calls[0][1].slice(-2)).toEqual([null, legacy === 'true']);
  });

  test.each([{ production_id: 'invalid' }, { production_name: 'Example', is_legacy: 'yes' }, {}])('rejects invalid production/legacy metadata %j', async fields => {
    let upload = request(app).post(`${path}/upload`).set('x-test-role', roles[0]).field('report_type', 'type1').field('report_date', '2020-01-01');
    for (const [key, value] of Object.entries(fields)) upload = upload.field(key, value);
    const response = await upload.attach('file', Buffer.from('%PDF-1.4\n'), 'legacy.pdf');
    expect(response.status).toBe(400);
    expect(storage.store).not.toHaveBeenCalled();
  });

  test('missing or deleted selected production fails before file upload', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const response = await request(app).post(`${path}/upload`).set('x-test-role', roles[0]).field('production_id', reportId).field('report_type', 'type1').field('report_date', '2020-01-01').attach('file', Buffer.from('%PDF-1.4\n'), 'legacy.pdf');
    expect(response.status).toBe(404);
    expect(storage.store).not.toHaveBeenCalled();
  });
  test.each(roles)('%s can list, upload and view', async role => {
    db.query.mockResolvedValue({ rows: [report] });
    storage.store.mockResolvedValue({ key: 'uploads/legacy.pdf', url: '/legacy.pdf' });
    expect((await request(app).get(path).set('x-test-role', role)).body).toEqual([report]);
    const uploaded = await request(app).post(`${path}/upload`).set('x-test-role', role).field('production_name', report.production_name).field('report_type', report.report_type).field('report_date', report.report_date).attach('file', Buffer.from('%PDF-1.4\n'), 'legacy.pdf');
    expect(uploaded.status).toBe(201);
    expect(db.query.mock.calls.at(-1)[1].slice(0, 3)).toEqual(['Legacy production', 'type2', '2020-01-01']);
    expect(db.query.mock.calls.at(-1)[1].slice(-2)).toEqual([null, false]);
    db.query.mockResolvedValue({ rows: [{ file_key: 'uploads/legacy.pdf', file_name: 'legacy.pdf' }] });
    storage.streamToResponse.mockImplementation(async (_key, res) => res.type('application/pdf').send('pdf'));
    expect((await request(app).get(`${path}/${reportId}/view`).set('x-test-role', role)).status).toBe(200);
  });

  test('filters by production name, date range and report type', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const response = await request(app).get(path).query({ search: 'Example', report_type: 'type1', date_from: '2020-01-01', date_to: '2020-12-31' }).set('x-test-role', roles[0]);
    expect(response.status).toBe(200);
    expect(db.query.mock.calls[0][1]).toEqual(['%Example%', 'type1', '2020-01-01', '2020-12-31']);
  });

  test.each([{ report_type: 'manual' }, { date_from: '2026-02-30' }, { date_from: '2026-01-02', date_to: '2026-01-01' }])('rejects invalid filters %j', async query => {
    expect((await request(app).get(path).query(query).set('x-test-role', roles[0])).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each(['put', 'patch'])('stored reports expose no %s endpoint', async method => {
    const response = await request(app)[method](`${path}/${reportId}`).set('x-test-role', roles[0]).send({ production_name: 'Changed' });
    expect([403, 404]).toContain(response.status);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('manual PDF upload cleans up after metadata failure', async () => {
    storage.store.mockResolvedValue({ key: 'uploads/failed.pdf' });
    storage.deleteFile.mockResolvedValue();
    db.query.mockRejectedValue(new Error('DB unavailable'));
    const response = await request(app).post(`${path}/upload`).set('x-test-role', roles[0]).field('production_name', 'Legacy').field('report_type', 'type1').field('report_date', '2020-01-01').attach('file', Buffer.from('%PDF-1.4\n'), 'legacy.pdf');
    expect(response.status).toBe(500);
    expect(storage.deleteFile).toHaveBeenCalledWith('uploads/failed.pdf');
  });

  test('rejects a non-PDF upload', async () => {
    const response = await request(app).post(`${path}/upload`).set('x-test-role', roles[0]).field('production_name', 'Legacy').field('report_type', 'type1').field('report_date', '2020-01-01').attach('file', Buffer.from('not a PDF'), 'legacy.pdf');
    expect(response.status).toBe(400);
    expect(storage.store).not.toHaveBeenCalled();
  });

  test('requires authentication', async () => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  test.each(roles)('%s can remove reports and archived productions without erasing files or history', async role => {
    db.query.mockResolvedValue({ rows: [{ id: reportId }] });
    expect((await request(app).delete(`${path}/${reportId}`).set('x-test-role', role)).status).toBe(204);
    expect(db.query.mock.calls[0][0]).toContain('UPDATE historical_cost_reports SET deleted_at');
    expect((await request(app).delete(`/api/productions/${reportId}`).set('x-test-role', role)).status).toBe(204);
    expect(db.query.mock.calls.at(-1)[0]).toContain("status = 'archived'");
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM'))).toBe(false);
  });

  test('active productions cannot be deleted', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: reportId }] }).mockResolvedValueOnce({ rows: [] });
    expect((await request(app).delete(`/api/productions/${reportId}`).set('x-test-role', roles[0])).status).toBe(409);
  });

  test.each(['get', 'delete', 'post'])('deleted productions reject %s access', async method => {
    db.query.mockResolvedValue({ rows: [] });
    const route = `/api/productions/${reportId}${method === 'post' ? '/unarchive' : ''}`;
    expect((await request(app)[method](route).set('x-test-role', roles[0])).status).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('deleted_at IS NULL');
  });

  test('deleted reports cannot be viewed or deleted again', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect((await request(app).get(`${path}/${reportId}/view`).set('x-test-role', roles[0])).status).toBe(404);
    expect((await request(app).delete(`${path}/${reportId}`).set('x-test-role', roles[0])).status).toBe(404);
    expect(storage.streamToResponse).not.toHaveBeenCalled();
    expect(db.query.mock.calls.every(([sql]) => sql.includes('deleted_at IS NULL'))).toBe(true);
  });

  test('both lists exclude deleted records even with archived productions included', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await request(app).get(path).set('x-test-role', roles[0]);
    await request(app).get('/api/productions?include_archived=true').set('x-test-role', roles[0]);
    expect(db.query.mock.calls.every(([sql]) => sql.includes('deleted_at IS NULL'))).toBe(true);
  });

  test('deletion failure is reported and retains storage', async () => {
    db.query.mockRejectedValue(new Error('DB unavailable'));
    expect((await request(app).delete(`${path}/${reportId}`).set('x-test-role', roles[0])).status).toBe(500);
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  test.each(['/api/productions', '/api/cost-reports/historical'])('%s deletion requires authentication and a valid ID', async base => {
    expect((await request(app).delete(`${base}/${reportId}`)).status).toBe(401);
    expect((await request(app).delete(`${base}/invalid`).set('x-test-role', roles[0])).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a concurrent deletion cannot be undone by unarchiving', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: reportId, status: 'archived' }] }).mockResolvedValueOnce({ rows: [] });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await productions.unarchiveProduction({ params: { id: reportId }, user: { id: 'user-1', role: roles[0] } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(db.query.mock.calls[1][0]).toContain('deleted_at IS NULL');
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(false);
  });
});