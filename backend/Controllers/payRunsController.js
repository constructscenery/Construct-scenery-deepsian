const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { recordWeeklyLabour } = require('../services/labourCostService');
const { logAudit } = require('../services/auditService');

// Derive a short production code from the production name.
// Takes the first letter of each word, uppercase, max 4 chars.
// e.g. "Star Wars: Episode IV" → "SWEI"
const prodShortCode = (name) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')
    .slice(0, 4) || 'PROD';

// ─── GET /api/pay-runs/available-weeks ────────────────────────────────────────
// Returns distinct week_ending_dates that have at least one finalised timesheet,
// plus whether a pay_run already exists for that week (and its status).
const getAvailableWeeks = async (req, res) => {
  const { production_id } = req.query;
  if (!production_id)
    return res.status(400).json({ error: 'production_id is required' });

  try {
    const { rows } = await db.query(
      `SELECT TO_CHAR(t.week_ending_date, 'YYYY-MM-DD') AS week_ending_date,
              COUNT(t.id)::int                                AS timesheet_count,
              pr.id                                           AS pay_run_id,
              pr.status                                       AS pay_run_status,
              pr.processed_at
       FROM timesheets t
       LEFT JOIN pay_runs pr
              ON pr.production_id    = t.production_id
             AND pr.week_ending_date = t.week_ending_date
       WHERE t.production_id = $1
         AND t.status = 'finalised'
       GROUP BY t.week_ending_date, pr.id, pr.status, pr.processed_at
       ORDER BY t.week_ending_date DESC`,
      [production_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('getAvailableWeeks:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/pay-runs/preview ────────────────────────────────────────────────
// Returns the pay run table data (calculated amounts, bank details) for a given
// week without creating or persisting a pay_run record.
const getPayRunPreview = async (req, res) => {
  const { production_id } = req.query;
  const week_ending_date = String(req.query.week_ending_date || '').split('T')[0];
  if (!production_id || !week_ending_date)
    return res.status(400).json({ error: 'production_id and week_ending_date are required' });

  try {
    const { rows: timesheets } = await db.query(
      `SELECT t.id, t.grand_total, t.week_ending_date,
              cm.first_name, cm.last_name, cm.crew_number, cm.employment_status,
              cm.paye_withholding_rate,
              cm.sort_code, cm.account_number, cm.account_name,
              p.name AS prod_name
       FROM timesheets t
       JOIN crew_members cm ON t.crew_member_id = cm.id
       JOIN productions  p  ON t.production_id  = p.id
       WHERE t.production_id    = $1
         AND t.week_ending_date = $2
         AND t.status = 'finalised'
       ORDER BY cm.last_name, cm.first_name`,
      [production_id, week_ending_date]
    );

    if (!timesheets.length)
      return res.status(404).json({ error: 'No finalised timesheets found for this week' });

    const prodName  = timesheets[0].prod_name;
    const shortCode = prodShortCode(prodName);

    const items = timesheets.map(ts => {
      const gross        = parseFloat(ts.grand_total || 0);
      const isPAYE       = ts.employment_status === 'paye';
      const withholdRate = isPAYE ? parseFloat(ts.paye_withholding_rate || 0) / 100 : 0;
      const withholdAmt  = Math.round(gross * withholdRate * 100) / 100;
      const netAmount    = Math.round((gross - withholdAmt) * 100) / 100;

      return {
        timesheet_id:       ts.id,
        crew_number:        ts.crew_number,
        crew_name:          `${ts.first_name} ${ts.last_name}`,
        employment_type:    ts.employment_status,
        sort_code:          decrypt(ts.sort_code),
        account_number:     decrypt(ts.account_number),
        account_name:       decrypt(ts.account_name),
        gross_amount:       gross,
        withholding_amount: withholdAmt,
        net_amount:         netAmount,
        payment_reference:  `${shortCode}-${week_ending_date}-${ts.crew_number}`,
      };
    });

    const total_gross = items.reduce((s, i) => s + i.gross_amount,       0);
    const total_net   = items.reduce((s, i) => s + i.net_amount,         0);

    res.json({
      production_id,
      week_ending_date,
      production_name: prodName,
      total_gross,
      total_net,
      summary: {
        total_crew:     items.length,
        total_gross,
        total_withheld: items.reduce((s, i) => s + i.withholding_amount, 0),
        total_net,
      },
      items,
    });
  } catch (err) {
    console.error('getPayRunPreview:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/pay-runs ────────────────────────────────────────────────────────
const getAllPayRuns = async (req, res) => {
  try {
    const conditions = [];
    const params     = [];
    let   i          = 1;

    if (req.query.production_id) { conditions.push(`pr.production_id = $${i++}`); params.push(req.query.production_id); }
    if (req.query.status)        { conditions.push(`pr.status = $${i++}`);         params.push(req.query.status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT pr.*, p.id AS prod_id, p.name AS prod_name
       FROM   pay_runs pr
       JOIN   productions p ON pr.production_id = p.id
       ${where}
       ORDER BY pr.week_ending_date DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/pay-runs ───────────────────────────────────────────────────────
const createPayRun = async (req, res) => {
  const { production_id } = req.body;
  const week_ending_date = String(req.body.week_ending_date || '').split('T')[0];
  if (!production_id || !week_ending_date)
    return res.status(400).json({ error: 'production_id and week_ending_date are required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 409 if this week has already been processed
    const { rows: [existing] } = await client.query(
      `SELECT id, status FROM pay_runs
       WHERE production_id = $1 AND week_ending_date = $2`,
      [production_id, week_ending_date]
    );
    if (existing?.status === 'processed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_PROCESSED', message: 'A pay run for this week has already been processed and cannot be reprocessed' });
    }
    // Delete any existing draft so we can recreate cleanly
    if (existing?.status === 'draft') {
      await client.query(`DELETE FROM pay_run_items WHERE pay_run_id = $1`, [existing.id]);
      await client.query(`DELETE FROM pay_runs WHERE id = $1`, [existing.id]);
    }

    // Get all timesheets with crew bank details (bank fields are encrypted at rest)
    const { rows: timesheets } = await client.query(
      `SELECT t.*,
              cm.employment_status, cm.paye_withholding_rate, cm.crew_number,
              cm.sort_code, cm.account_number, cm.account_name,
              p.name AS prod_name
       FROM   timesheets t
       JOIN   crew_members cm ON t.crew_member_id = cm.id
       JOIN   productions  p  ON t.production_id  = p.id
       WHERE  t.production_id = $1 AND t.week_ending_date = $2`,
      [production_id, week_ending_date]
    );

    if (!timesheets.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No timesheets found for this week' });
    }
    const unverified = timesheets.filter(t => t.status !== 'finalised');  // TimesheetStatus.FINALISED
    if (unverified.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `${unverified.length} timesheet(s) not yet finalised. All must be finalised before processing a pay run.`,
      });
    }

    const { rows: [payRun] } = await client.query(
      `INSERT INTO pay_runs (production_id, week_ending_date, status, created_by)
       VALUES ($1,$2,'draft',$3)
       RETURNING *`,
      [production_id, week_ending_date, req.user.id]
    );

    const prodName  = timesheets[0].prod_name;
    const shortCode = prodShortCode(prodName);

    // Decrypt bank details from crew_members, then re-encrypt for storage in pay_run_items
    const items = timesheets.map(ts => {
      const gross        = parseFloat(ts.grand_total || 0);
      const isPAYE       = ts.employment_status === 'paye';
      const withholdRate = isPAYE ? parseFloat(ts.paye_withholding_rate || 0) / 100 : 0;
      const withholdAmt  = Math.round(gross * withholdRate * 100) / 100;

      return {
        pay_run_id:         payRun.id,
        timesheet_id:       ts.id,
        crew_member_id:     ts.crew_member_id,
        employment_type:    ts.employment_status,
        gross_amount:       gross,
        withholding_amount: withholdAmt,
        net_amount:         Math.round((gross - withholdAmt) * 100) / 100,
        sort_code:          encrypt(decrypt(ts.sort_code)),
        account_number:     encrypt(decrypt(ts.account_number)),
        account_name:       encrypt(decrypt(ts.account_name)),
        reference:          `${shortCode}-${week_ending_date}-${ts.crew_number}`,
      };
    });

    if (items.length) {
      const valuePlaceholders = items.map((_, idx) => {
        const base = idx * 11;
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11})`;
      }).join(',');

      await client.query(
        `INSERT INTO pay_run_items
           (pay_run_id, timesheet_id, crew_member_id, employment_type,
            gross_amount, withholding_amount, net_amount, sort_code, account_number, account_name, reference)
         VALUES ${valuePlaceholders}`,
        items.flatMap(i => [
          i.pay_run_id, i.timesheet_id, i.crew_member_id, i.employment_type,
          i.gross_amount, i.withholding_amount, i.net_amount,
          i.sort_code, i.account_number, i.account_name, i.reference,
        ])
      );
    }

    await client.query('COMMIT');

    const { rows: itemsResult } = await db.query(
      `SELECT pri.*, cm.first_name, cm.last_name, cm.crew_number
       FROM pay_run_items pri
       JOIN crew_members cm ON pri.crew_member_id = cm.id
       WHERE pri.pay_run_id = $1`,
      [payRun.id]
    );

    // Decrypt bank details in response items
    const decryptedItems = itemsResult.map(item => ({
      ...item,
      sort_code:      decrypt(item.sort_code),
      account_number: decrypt(item.account_number),
      account_name:   decrypt(item.account_name),
    }));

    res.status(201).json({
      message:  'Pay run created successfully',
      pay_run:  { ...payRun, pay_run_items: decryptedItems },
      summary: {
        total_crew:     items.length,
        total_gross:    items.reduce((s, i) => s + i.gross_amount,       0),
        total_withheld: items.reduce((s, i) => s + i.withholding_amount, 0),
        total_net:      items.reduce((s, i) => s + i.net_amount,         0),
      },
    });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      productionId: payRun.production_id,
      category: 'payroll',
      action: 'pay_run_created',
      entityType: 'pay_run',
      entityId: payRun.id,
      details: `Created draft pay run for W/E ${payRun.week_ending_date} (${items.length} crew members, total £${items.reduce((s, i) => s + i.net_amount, 0).toFixed(2)})`,
      metadata: { pay_run_id: payRun.id, week_ending_date: payRun.week_ending_date, crew_count: items.length },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createPayRun:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── GET /api/pay-runs/:id ────────────────────────────────────────────────────
const getPayRunById = async (req, res) => {
  try {
    const { rows: [payRun] } = await db.query(
      `SELECT pr.*, p.id AS prod_id, p.name AS prod_name
       FROM pay_runs pr
       JOIN productions p ON pr.production_id = p.id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    if (!payRun) return res.status(404).json({ error: 'Pay run not found' });

    const { rows: items } = await db.query(
      `SELECT pri.*, cm.crew_number, cm.first_name, cm.last_name, cm.employment_status, cm.crew_trade, cm.crew_rank
       FROM pay_run_items pri
       JOIN crew_members cm ON pri.crew_member_id = cm.id
       WHERE pri.pay_run_id = $1`,
      [req.params.id]
    );

    const decryptedItems = items.map(item => ({
      ...item,
      sort_code:      decrypt(item.sort_code),
      account_number: decrypt(item.account_number),
      account_name:   decrypt(item.account_name),
    }));

    res.json({ ...payRun, pay_run_items: decryptedItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/pay-runs/:id/process ──────────────────────────────────────────
// Marks the pay run as processed and atomically records labour costs into the
// Cost Report. Returns 409 ALREADY_PROCESSED if the run was already processed.
const processPayRun = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [pr] } = await client.query(
      `UPDATE pay_runs SET status = 'processed', processed_at = NOW()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [req.params.id]
    );
    if (!pr) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_PROCESSED', message: 'This pay run has already been processed' });
    }

    // Feed labour costs into Cost Report (same transaction — rolls back on failure)
    await recordWeeklyLabour(pr.week_ending_date, pr.production_id, client);

    await client.query('COMMIT');
    res.json({ message: 'Pay run processed. Labour costs fed into Cost Report.', pay_run: pr });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      productionId: pr.production_id,
      category: 'payroll',
      action: 'pay_run_processed',
      entityType: 'pay_run',
      entityId: pr.id,
      details: `Processed pay run for W/E ${pr.week_ending_date}. Labour costs committed to live Cost Report.`,
      metadata: { pay_run_id: pr.id, week_ending_date: pr.week_ending_date },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('processPayRun:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── GET /api/pay-runs/:id/export-csv ────────────────────────────────────────
// Bank-upload ready CSV: no header row, no £ symbols, amounts as raw 2dp decimals.
// Filename: PayRun_[ProductionName]_w-e-[WeekEndingDate].csv
// Columns: Sort Code, Account Number, Account Name, Amount, Reference
const exportCsv = async (req, res) => {
  try {
    const { rows: [payRun] } = await db.query(
      `SELECT pr.*, p.name AS prod_name
       FROM pay_runs pr
       JOIN productions p ON pr.production_id = p.id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    if (!payRun) return res.status(404).json({ error: 'Pay run not found' });

    // COALESCE: if bank fields were NULL at pay run creation, fall back to current crew_members values
    const { rows: items } = await db.query(
      `SELECT COALESCE(pri.sort_code,      cm.sort_code)      AS sort_code,
              COALESCE(pri.account_number, cm.account_number) AS account_number,
              COALESCE(pri.account_name,   cm.account_name)   AS account_name,
              pri.net_amount, cm.crew_number
       FROM pay_run_items pri
       JOIN crew_members cm ON pri.crew_member_id = cm.id
       WHERE pri.pay_run_id = $1
       ORDER BY cm.crew_number`,
      [req.params.id]
    );

    const weekEnding = String(payRun.week_ending_date).split('T')[0];

    const header = 'Sort Code,Account Number,Account Name,Amount,Reference #';
    const csvRows = items.map(item => [
      decrypt(item.sort_code)      || '',
      decrypt(item.account_number) || '',
      decrypt(item.account_name)   || '',
      parseFloat(item.net_amount).toFixed(2),
      `${item.crew_number || ''}-${weekEnding}`,
    ].join(','));

    const safeName = (payRun.prod_name || 'Production').replace(/[^a-zA-Z0-9]+/g, '_');
    const filename = `PayRun_${safeName}_w-e-${payRun.week_ending_date}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send([header, ...csvRows].join('\r\n'));
  } catch (err) {
    console.error('exportCsv:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/pay-runs/:id/sync-labour ──────────────────────────────────────
// Picks up any finalised timesheets added after the pay run was processed and
// inserts missing cost_report_entries for them (idempotent — skips existing).
const syncLabourCosts = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [pr] } = await client.query(
      `SELECT * FROM pay_runs WHERE id = $1`,
      [req.params.id]
    );
    if (!pr) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pay run not found' });
    }
    await recordWeeklyLabour(pr.week_ending_date, pr.production_id, client);
    await client.query('COMMIT');
    res.json({ message: 'Labour costs synced to cost report.' });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      productionId: pr.production_id,
      category: 'payroll',
      action: 'pay_run_labour_synced',
      entityType: 'pay_run',
      entityId: pr.id,
      details: `Synced finalised labour costs for pay run W/E ${pr.week_ending_date} to cost report`,
      metadata: { pay_run_id: pr.id, week_ending_date: pr.week_ending_date },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('syncLabourCosts:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

module.exports = {
  getAvailableWeeks, getPayRunPreview,
  getAllPayRuns, createPayRun, getPayRunById,
  processPayRun, syncLabourCosts, exportCsv,
};
