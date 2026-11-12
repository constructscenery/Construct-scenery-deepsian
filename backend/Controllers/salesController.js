const db = require('../config/db');
const { logAudit } = require('../services/auditService');
const { round2 } = require('../services/quoteCalculations');
const { getInvoiceNotes } = require('../services/xeroService');

// Addendum 6 — Sales module (read-only view of Xero sales invoices + production allocation).
// Reads the local xero_invoices cache, filled by services/xeroService.js. Only invoices from the
// connected (or last connected) Xero organisation are shown.
//
// SalesInvoiceStatus is derived, never stored:
//   paid        — Xero status PAID, or nothing left to pay
//   overdue     — amount due and due date before today (UK)
//   outstanding — amount due, not yet due
// Only AUTHORISED and PAID invoices are shown; DRAFT, SUBMITTED, VOIDED and DELETED are hidden
// (XeroInvoiceStatus — open client question 6 in the implementation plan).

const SALES_STATUSES = ['outstanding', 'overdue', 'paid'];
const VISIBLE_XERO_STATUSES = ['authorised', 'paid'];
const UNALLOCATED_REMINDER_DAYS = 7;

const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
/** A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30, which JS would roll over). */
const validDate = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

const UK_TODAY = "(NOW() AT TIME ZONE 'Europe/London')::date";
const STATUS_SQL = `
  CASE
    WHEN xi.xero_status = 'paid' OR xi.amount_due <= 0 THEN 'paid'
    WHEN xi.due_date IS NOT NULL AND xi.due_date < ${UK_TODAY} THEN 'overdue'
    ELSE 'outstanding'
  END`;

/** Visible invoices with derived status and production name. */
const INVOICES_CTE = `
  WITH inv AS (
    SELECT xi.*, ${STATUS_SQL} AS sales_status,
           p.name AS production_name, p.production_code
    FROM xero_invoices xi
    JOIN xero_connection xc ON xc.singleton = true AND xc.tenant_id = xi.tenant_id
    LEFT JOIN productions p ON p.id = xi.production_id
    WHERE xi.xero_status = ANY('{${VISIBLE_XERO_STATUSES.join(',')}}'::text[])
  )`;

/** Build the filtered invoice query shared by the list and the CSV export. */
const buildInvoiceQuery = query => {
  const { status, production_id, date_from, date_to, search } = query;
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status && status !== 'all') {
    const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
    if (!statuses.length || !statuses.every(s => SALES_STATUSES.includes(s))) {
      return { error: `Status must be one or more of: ${SALES_STATUSES.join(', ')}` };
    }
    conditions.push(`sales_status = ANY($${idx++}::text[])`);
    params.push(statuses);
  }
  if (production_id) {
    if (production_id === 'unallocated') {
      conditions.push('production_id IS NULL');
    } else if (validId(production_id)) {
      conditions.push(`production_id = $${idx++}`);
      params.push(production_id);
    } else {
      return { error: 'Invalid production filter' };
    }
  }
  if (date_from) {
    if (!validDate(date_from)) return { error: 'Invalid date_from' };
    conditions.push(`invoice_date >= $${idx++}`);
    params.push(date_from);
  }
  if (date_to) {
    if (!validDate(date_to)) return { error: 'Invalid date_to' };
    conditions.push(`invoice_date <= $${idx++}`);
    params.push(date_to);
  }
  if (date_from && date_to && date_from > date_to) return { error: 'date_from cannot be after date_to' };
  if (search && String(search).trim()) {
    conditions.push(`invoice_number ILIKE $${idx++}`);
    params.push(`%${String(search).trim()}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return {
    sql: `${INVOICES_CTE} SELECT * FROM inv ${where} ORDER BY invoice_date DESC NULLS LAST, invoice_number DESC`,
    params,
  };
};

// GET /api/sales/invoices
const getInvoices = async (req, res) => {
  const q = buildInvoiceQuery(req.query);
  if (q.error) return res.status(400).json({ error: q.error });
  try {
    const { rows } = await db.query(q.sql, q.params);
    res.json(rows);
  } catch (err) {
    console.error('getInvoices error:', err);
    res.status(500).json({ error: 'Unable to load invoices' });
  }
};

const csvCell = v => {
  if (v == null) return '';
  let s = String(v);
  // Text from Xero (contact, reference) must not run as a formula when opened in Excel.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const STATUS_LABEL = { outstanding: 'Outstanding', overdue: 'Overdue', paid: 'Paid' };

// GET /api/sales/invoices/export  — current filtered view as CSV
const exportInvoicesCsv = async (req, res) => {
  const q = buildInvoiceQuery(req.query);
  if (q.error) return res.status(400).json({ error: q.error });
  try {
    const { rows } = await db.query(q.sql, q.params);
    const header = ['Invoice No.', 'Production', 'Contact', 'Invoice Date', 'Due Date', 'Total', 'Amount Due', 'Status', 'Reference'];
    const lines = rows.map(r => [
      r.invoice_number,
      r.production_name || 'Unallocated',
      r.contact_name,
      r.invoice_date,
      r.due_date,
      Number(r.total || 0).toFixed(2),
      Number(r.amount_due || 0).toFixed(2),
      STATUS_LABEL[r.sales_status] || r.sales_status,
      r.reference,
    ].map(csvCell).join(','));

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-invoices-${today}.csv"`);
    // BOM so Excel opens accented names (e.g. "Les Misérables") correctly
    res.send(`﻿${[header.join(','), ...lines].join('\r\n')}\r\n`);
  } catch (err) {
    console.error('exportInvoicesCsv error:', err);
    res.status(500).json({ error: 'Unable to export invoices' });
  }
};

/** Productions whose code appears in the Xero reference (case-insensitive). */
const findSuggestedProductions = async reference => {
  if (!reference || !String(reference).trim()) return [];
  const { rows } = await db.query(
    `SELECT id, name, production_code
     FROM productions
     WHERE deleted_at IS NULL
       AND status <> 'archived'
       AND production_code IS NOT NULL AND TRIM(production_code) <> ''
       AND POSITION(LOWER(TRIM(production_code)) IN LOWER($1)) > 0
     ORDER BY name`,
    [String(reference).trim()]
  );
  return rows;
};

// GET /api/sales/invoices/:id   — invoice + suggested production for the allocation panel
const getInvoiceById = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
  try {
    const { rows: [invoice] } = await db.query(`${INVOICES_CTE} SELECT * FROM inv WHERE id = $1`, [req.params.id]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const matches = await findSuggestedProductions(invoice.reference);
    res.json({
      ...invoice,
      suggested_production: matches.length === 1 ? matches[0] : null,
      suggestion_count: matches.length,
    });
  } catch (err) {
    console.error('getInvoiceById error:', err);
    res.status(500).json({ error: 'Unable to load invoice' });
  }
};

// PATCH /api/sales/invoices/:id/allocation   body: { production_id: uuid | null }
const allocateInvoice = async (req, res) => {
  const { id } = req.params;
  const productionId = req.body?.production_id ?? null;
  if (!validId(id)) return res.status(400).json({ error: 'Invalid invoice ID' });
  if (productionId !== null && !validId(productionId)) return res.status(400).json({ error: 'Invalid production ID' });

  try {
    const { rows: [invoice] } = await db.query(
      `SELECT xi.id, xi.invoice_number, xi.production_id, p.name AS production_name
       FROM xero_invoices xi LEFT JOIN productions p ON p.id = xi.production_id
       WHERE xi.id = $1`,
      [id]
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    let production = null;
    if (productionId) {
      const { rows: [p] } = await db.query(
        'SELECT id, name FROM productions WHERE id = $1 AND deleted_at IS NULL',
        [productionId]
      );
      if (!p) return res.status(400).json({ error: 'Production not found' });
      production = p;
    }

    await db.query(
      `UPDATE xero_invoices
       SET production_id = $2,
           allocated_by = CASE WHEN $2::uuid IS NULL THEN NULL ELSE $3::uuid END,
           allocated_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE NOW() END,
           updated_at = NOW()
       WHERE id = $1`,
      [id, productionId, req.user.id]
    );

    await logAudit({
      userId: req.user.id,
      userName: req.user.full_name,
      userRole: req.user.role,
      productionId: productionId || invoice.production_id,
      category: 'financial',
      action: productionId ? 'sales_invoice_allocated' : 'sales_invoice_unallocated',
      entityType: 'xero_invoice',
      entityId: invoice.invoice_number,
      details: productionId
        ? `Allocated invoice ${invoice.invoice_number} to ${production.name}${invoice.production_name ? ` (was ${invoice.production_name})` : ''}`
        : `Unallocated invoice ${invoice.invoice_number}${invoice.production_name ? ` from ${invoice.production_name}` : ''}`,
      metadata: { invoice_id: id, from: invoice.production_id, to: productionId },
    });

    const { rows: [updated] } = await db.query(`${INVOICES_CTE} SELECT * FROM inv WHERE id = $1`, [id]);
    res.json(updated || null);
  } catch (err) {
    console.error('allocateInvoice error:', err);
    res.status(500).json({ error: 'Unable to allocate invoice' });
  }
};

// GET /api/sales/invoices/:id/notes  — comments left on the invoice in Xero (read live)
const getInvoiceComments = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
  try {
    const { rows: [inv] } = await db.query(`${INVOICES_CTE} SELECT xero_invoice_id FROM inv WHERE id = $1`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(await getInvoiceNotes(inv.xero_invoice_id));
  } catch (err) {
    console.error('getInvoiceComments error:', err);
    res.status(500).json({ error: 'Unable to load comments' });
  }
};

// GET /api/sales/summary  — What's Owed per allocated production (unallocated invoices are in the Unallocated filter)
const getSummary = async (req, res) => {
  try {
    const { rows } = await db.query(
      `${INVOICES_CTE}
       SELECT production_id, production_name, production_code,
              COUNT(*)::int AS invoice_count,
              COALESCE(SUM(total), 0) AS total_invoiced,
              COALESCE(SUM(amount_paid + amount_credited), 0) AS received,
              COALESCE(SUM(CASE WHEN sales_status = 'outstanding' THEN amount_due ELSE 0 END), 0) AS outstanding,
              COALESCE(SUM(CASE WHEN sales_status = 'overdue' THEN amount_due ELSE 0 END), 0) AS overdue
       FROM inv
       WHERE production_id IS NOT NULL
       GROUP BY production_id, production_name, production_code
       ORDER BY production_name ASC`
    );

    const toRow = r => ({
      production_id: r.production_id,
      production_name: r.production_name,
      production_code: r.production_code,
      invoice_count: Number(r.invoice_count),
      total_invoiced: round2(r.total_invoiced),
      received: round2(r.received),
      outstanding: round2(r.outstanding),
      overdue: round2(r.overdue),
    });

    const productions = rows.map(toRow);
    const totals = productions.reduce((t, r) => ({
      invoice_count: t.invoice_count + r.invoice_count,
      total_invoiced: round2(t.total_invoiced + r.total_invoiced),
      received: round2(t.received + r.received),
      outstanding: round2(t.outstanding + r.outstanding),
      overdue: round2(t.overdue + r.overdue),
    }), { invoice_count: 0, total_invoiced: 0, received: 0, outstanding: 0, overdue: 0 });

    res.json({ productions, totals });
  } catch (err) {
    console.error('getSummary error:', err);
    res.status(500).json({ error: 'Unable to load summary' });
  }
};

// GET /api/sales/unallocated-reminder  — invoices unallocated for more than 7 days since first synced
const getUnallocatedReminder = async (req, res) => {
  try {
    const { rows: [r] } = await db.query(
      `${INVOICES_CTE}
       SELECT COUNT(*)::int AS count FROM inv
       WHERE production_id IS NULL
         AND first_synced_at < NOW() - INTERVAL '${UNALLOCATED_REMINDER_DAYS} days'`
    );
    res.json({ count: Number(r?.count || 0), days: UNALLOCATED_REMINDER_DAYS });
  } catch (err) {
    console.error('getUnallocatedReminder error:', err);
    res.status(500).json({ error: 'Unable to load reminder' });
  }
};

module.exports = {
  getInvoices,
  exportInvoicesCsv,
  getInvoiceById,
  allocateInvoice,
  getInvoiceComments,
  getSummary,
  getUnallocatedReminder,
};
