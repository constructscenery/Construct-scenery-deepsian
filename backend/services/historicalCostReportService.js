const db = require('../config/db');
const storage = require('./fileStorage');
const { buildFinalCostReportPdf } = require('../Controllers/costReportsController');

// ContractType, HistoricalCostReportType, HistoricalCostReportSource
const REPORT_TYPES = { on_a_price: 'type1', cost_plus: 'type2' };

async function withFinalCostReport(productionId, userId, expectedStatus, action) {
  const client = await db.connect();
  let stored;
  let commitStarted = false;
  let releaseError;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { rows: [production] } = await client.query('SELECT * FROM productions WHERE id = $1 FOR UPDATE', [productionId]);
    if (!production || production.status !== expectedStatus) throw Object.assign(new Error('Production status changed. Refresh and try again.'), { status: 409 });
    const reportType = REPORT_TYPES[production.contract_type];
    if (!reportType) throw new Error('Unsupported cost report contract type');
    const { rows: existing } = await client.query("SELECT id FROM historical_cost_reports WHERE production_id = $1 AND report_type = $2 AND source = 'automatic'", [productionId, reportType]);
    const result = await action(client);
    if (!existing.length) {
      const buffer = await buildFinalCostReportPdf(productionId, client);
      const date = new Date().toISOString().slice(0, 10);
      const filename = `Final_Cost_Report_${reportType}_${production.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${date}.pdf`;
      stored = await storage.store({ buffer, size: buffer.length, mimetype: 'application/pdf', originalname: filename });
      await client.query(`INSERT INTO historical_cost_reports (production_id, production_name, report_type, source, report_date, file_url, file_key, file_name, file_size, file_mime_type, created_by)
        VALUES ($1,$2,$3,'automatic',$4,$5,$6,$7,$8,'application/pdf',$9)`, [productionId, production.name, reportType, date, stored.url, stored.key, filename, buffer.length, userId]);
    }
    commitStarted = true;
    await client.query('COMMIT');
    return result;
  } catch (err) {
    const conflict = err.code === '40001' || err.code === '40P01';
    if (commitStarted && !conflict) {
      releaseError = err;
      console.error('Historical report commit outcome unknown; preserve PDF and verify database state', {
        productionId, fileKey: stored?.key, code: err.code,
      });
      throw Object.assign(new Error('Unable to confirm whether the production change was saved. Refresh the production and Finance archive before retrying.'), { status: 503 });
    }
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) { releaseError = rollbackError; }
    if (stored) await storage.deleteFile(stored.key).catch(() => {});
    if (conflict) throw Object.assign(new Error('Production changed during this request. Refresh and try again.'), { status: 409 });
    throw err;
  } finally { client.release(releaseError); }
}

module.exports = { withFinalCostReport };