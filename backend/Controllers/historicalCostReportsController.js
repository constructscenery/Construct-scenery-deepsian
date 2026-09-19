const db = require('../config/db');
const storage = require('../services/fileStorage');

// HistoricalCostReportType
const REPORT_TYPES = new Set(['type1', 'type2']);
const columns = 'id, production_id, production_name, report_type, source, is_legacy, report_date::text AS report_date, file_name, file_size, file_mime_type, created_at';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value;

const listReports = async (req, res) => {
  const { search, report_type, date_from, date_to } = req.query;
  if (search !== undefined && (typeof search !== 'string' || search.length > 200)) return res.status(400).json({ error: 'Invalid production search' });
  if (report_type && !REPORT_TYPES.has(report_type)) return res.status(400).json({ error: 'Select Type 1 or Type 2' });
  if ((date_from && !validDate(date_from)) || (date_to && !validDate(date_to)) || (date_from && date_to && date_from > date_to)) return res.status(400).json({ error: 'Invalid report date range' });
  try {
    const conditions = ['deleted_at IS NULL'];
    const params = [];
    const add = (condition, value) => { params.push(value); conditions.push(`${condition} $${params.length}`); };
    if (search?.trim()) add('production_name ILIKE', `%${search.trim()}%`);
    if (report_type) add('report_type =', report_type);
    if (date_from) add('report_date >=', date_from);
    if (date_to) add('report_date <=', date_to);
    const { rows } = await db.query(`SELECT ${columns} FROM historical_cost_reports ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY report_date DESC, created_at DESC, id DESC`, params);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Unable to load historical cost reports' }); }
};

const uploadReport = async (req, res) => {
  const { production_id, production_name, report_type, report_date, is_legacy } = req.body;
  const productionId = production_id || null;
  if (productionId && (typeof productionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productionId))) return res.status(400).json({ error: 'Invalid production ID' });
  if (!productionId && (typeof production_name !== 'string' || !production_name.trim() || production_name.length > 200)) return res.status(400).json({ error: 'Select a production or enter a production name (maximum 200 characters)' });
  if (is_legacy !== undefined && ![true, false, 'true', 'false'].includes(is_legacy)) return res.status(400).json({ error: 'Legacy must be true or false' });
  const isLegacy = is_legacy === true || is_legacy === 'true';
  if (!REPORT_TYPES.has(report_type)) return res.status(400).json({ error: 'Select Type 1 or Type 2' });
  if (!validDate(report_date)) return res.status(400).json({ error: 'A valid report date is required' });
  if (!req.file || req.file.mimetype !== 'application/pdf' || req.file.buffer.subarray(0, 1024).indexOf('%PDF-') < 0) return res.status(400).json({ error: 'Upload a PDF cost report' });
  let stored;
  try {
    storage.validate(req.file.mimetype, req.file.size);
    let productionName = productionId ? null : production_name.trim();
    if (productionId) {
      const { rows: [production] } = await db.query('SELECT name FROM productions WHERE id = $1 AND deleted_at IS NULL', [productionId]);
      if (!production) return res.status(404).json({ error: 'Selected production not found' });
      productionName = production.name;
    }
    stored = await storage.store(req.file);
    // HistoricalCostReportSource.MANUAL_UPLOAD
    const { rows: [report] } = await db.query(`INSERT INTO historical_cost_reports (production_name, report_type, source, report_date, file_url, file_key, file_name, file_size, file_mime_type, created_by, production_id, is_legacy)
      VALUES ($1,$2,'manual_upload',$3,$4,$5,$6,$7,'application/pdf',$8,$9,$10) RETURNING ${columns}`, [productionName, report_type, report_date, stored.url, stored.key, req.file.originalname, req.file.size, req.user.id, productionId, isLegacy]);
    res.status(201).json(report);
  } catch (err) {
    if (stored) await storage.deleteFile(stored.key).catch(() => {});
    res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'Unable to store historical report' });
  }
};

const viewReport = async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.reportId)) return res.status(400).json({ error: 'Invalid report ID' });
  try {
    const { rows: [report] } = await db.query('SELECT file_key, file_name FROM historical_cost_reports WHERE id = $1 AND deleted_at IS NULL', [req.params.reportId]);
    if (!report?.file_key) return res.status(404).json({ error: 'Stored report not found' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await storage.streamToResponse(report.file_key, res, report.file_name, 'application/pdf');
  } catch {
    if (!res.headersSent) res.status(500).json({ error: 'Unable to open historical report' });
  }
};

const deleteReport = async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.reportId)) return res.status(400).json({ error: 'Invalid report ID' });
  try {
    const { rows } = await db.query('UPDATE historical_cost_reports SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [req.params.reportId]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Unable to delete report' }); }
};

module.exports = { listReports, uploadReport, viewReport, deleteReport };