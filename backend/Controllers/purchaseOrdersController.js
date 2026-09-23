const db                              = require('../config/db');
const { sendEmail, templates }        = require('../config/email');
const fileStorage                     = require('../services/fileStorage');
const { generatePoPdf }               = require('../services/poPdfService');
const { recordSupplierCost, softDeleteEntry } = require('../services/costReportService');
const { generatePoListPdf }                   = require('../services/poPdfService');
const { logAudit }                            = require('../services/auditService');

// ─── Helper: build shared WHERE conditions for PO list queries ────────────────
const buildPoFilterConditions = (query) => {
  const conditions = [];
  const params     = [];
  let   i          = 1;

  if (query.production_id) { conditions.push(`po.production_id = $${i++}`);      params.push(query.production_id); }
  if (query.status)        { conditions.push(`po.status = $${i++}`);              params.push(query.status); }
  if (query.supplier_name) { conditions.push(`po.supplier_name ILIKE $${i++}`);   params.push(`%${query.supplier_name}%`); }
  if (query.title)         { conditions.push(`(po.title ILIKE $${i} OR po.description ILIKE $${i++})`); params.push(`%${query.title}%`); }
  if (query.set_code)      { conditions.push(`po.set_code = $${i++}`);             params.push(query.set_code); }
  if (query.account_code)  { conditions.push(`po.account_code = $${i++}`);         params.push(query.account_code); }
  if (query.paid_from)     { conditions.push(`po.paid_from = $${i++}`);            params.push(query.paid_from); }
  if (query.date_from)     { conditions.push(`po.date_of_po >= $${i++}`);          params.push(query.date_from); }
  if (query.date_to)       { conditions.push(`po.date_of_po <= $${i++}`);          params.push(query.date_to); }
  if (query.department)    { conditions.push(`po.department = $${i++}`);           params.push(query.department); }
  if (query.amount_min)    { conditions.push(`po.gross_amount >= $${i++}`);        params.push(query.amount_min); }
  if (query.amount_max)    { conditions.push(`po.gross_amount <= $${i++}`);        params.push(query.amount_max); }
  if (query.net_amount_min){ conditions.push(`po.net_amount >= $${i++}`);          params.push(query.net_amount_min); }
  if (query.net_amount_max){ conditions.push(`po.net_amount <= $${i++}`);          params.push(query.net_amount_max); }

  if (query.search) {
    conditions.push(`(
      po.po_number ILIKE $${i} OR
      po.supplier_name ILIKE $${i} OR
      po.title ILIKE $${i} OR
      po.description ILIKE $${i} OR
      po.notes ILIKE $${i} OR
      p.name ILIKE $${i} OR
      po.set_code ILIKE $${i} OR
      po.account_code ILIKE $${i} OR
      po.department ILIKE $${i} OR
      po.supplier_email ILIKE $${i} OR
      po.supplier_code ILIKE $${i} OR
      po.street_name ILIKE $${i} OR
      po.city ILIKE $${i} OR
      po.zip_code ILIKE $${i} OR
      po.county ILIKE $${i} OR
      po.paid_from ILIKE $${i} OR
      po.status ILIKE $${i++}
    )`);
    params.push(`%${query.search}%`);
  }

  if (query.archived_only === 'true') {
    conditions.push(`(po.deleted_at IS NOT NULL OR po.is_archived = true)`);
  } else if (query.include_archived !== 'true') {
    conditions.push(`(po.deleted_at IS NULL AND po.is_archived = false)`);
    conditions.push(`p.status != $${i++}`);
    params.push('archived');
  }

  return { conditions, params };
};

// ─── Helper: human-readable filter summary for PDF export header ──────────────
const buildFilterSummary = (query) => {
  const parts = [];
  if (query.supplier_name) parts.push(`Supplier: ${query.supplier_name}`);
  if (query.title)         parts.push(`Title: ${query.title}`);
  if (query.date_from || query.date_to)
    parts.push(`Date: ${query.date_from || '*'} → ${query.date_to || '*'}`);
  if (query.set_code)      parts.push(`Set: ${query.set_code}`);
  if (query.account_code)  parts.push(`Account: ${query.account_code}`);
  if (query.department)    parts.push(`Dept: ${query.department}`);
  if (query.paid_from)     parts.push(`Pmt: ${query.paid_from.replace(/_/g, ' ')}`);
  if (query.status)        parts.push(`Status: ${query.status}`);
  if (query.net_amount_min || query.net_amount_max)
    parts.push(`Net: £${query.net_amount_min || '0'} – £${query.net_amount_max || '∞'}`);
  return parts.length ? parts.join('  ·  ') : null;
};

// ─── Helper: generate unique PO number (global max, deletion-safe) ───────────
const generatePoNumber = async () => {
  const { rows } = await db.query(
    `SELECT MAX(CAST(SUBSTRING(po_number FROM 4) AS INTEGER)) AS max_num
     FROM purchase_orders
     WHERE po_number ~ '^PO-[0-9]+$'`
  );
  const max = parseInt(rows[0]?.max_num, 10) || 0;
  return `PO-${String(max + 1).padStart(4, '0')}`;
};

// ─── Helper: write a PO status transition to the audit log ───────────────────
const logStatusTransition = async (client, poId, productionId, fromStatus, toStatus, userId) => {
  await logAudit({
    userId,
    productionId,
    category: 'financial',
    action: `po_${toStatus}`,
    entityType: 'purchase_order',
    entityId: poId,
    details: `Purchase order ${poId} transitioned from ${fromStatus} to ${toStatus}`,
    metadata: { po_id: poId, from_status: fromStatus, to_status: toStatus },
    client,
  });
};

// ─── GET /api/purchase-orders ─────────────────────────────────────────────────
const getAllPOs = async (req, res) => {
  try {
    const { conditions, params } = buildPoFilterConditions(req.query);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT po.*, p.id AS prod_id, p.name AS prod_name, p.status AS prod_status
       FROM   purchase_orders po
       JOIN   productions p ON po.production_id = p.id
       ${where}
       ORDER BY po.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getAllPOs:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/purchase-orders/account-codes ───────────────────────────────────
const getAccountCodes = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT account_code 
       FROM purchase_orders 
       WHERE account_code IS NOT NULL AND account_code != ''
       ORDER BY account_code`
    );
    res.json(rows.map(r => r.account_code));
  } catch (err) {
    console.error('getAccountCodes:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/purchase-orders/export/csv ──────────────────────────────────────
const exportCSV = async (req, res) => {
  try {
    const { conditions, params } = buildPoFilterConditions(req.query);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT po.*, p.name AS prod_name,
              u.full_name AS approved_by_name
       FROM   purchase_orders po
       JOIN   productions p ON po.production_id = p.id
       LEFT JOIN users u ON po.approved_by = u.id
       ${where}
       ORDER BY po.created_at DESC`,
      params
    );

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '';

    const header = [
      'PO Number', 'Date', 'Supplier', 'Department', 'Description', 'Set Code', 'Account Code',
      'Net', 'VAT', 'Gross', 'Payment Method', 'Status', 'Approved By', 'Approved At',
    ];
    const lines = [header.map(esc).join(',')];
    rows.forEach(po => {
      lines.push([
        po.po_number,
        fmtD(po.date_of_po),
        po.supplier_name,
        po.department,
        po.description,
        po.set_code,
        po.account_code,
        po.net_amount,
        po.vat,
        po.gross_amount,
        (po.paid_from || '').replace(/_/g, ' '),
        po.status,
        po.approved_by_name,
        fmtD(po.approved_at),
      ].map(esc).join(','));
    });

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="purchase-orders-${date}.csv"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('exportCSV:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/purchase-orders/export/pdf ──────────────────────────────────────
const exportPDFList = async (req, res) => {
  try {
    const { conditions, params } = buildPoFilterConditions(req.query);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT po.*, p.name AS prod_name,
              u.full_name AS approved_by_name
       FROM   purchase_orders po
       JOIN   productions p ON po.production_id = p.id
       LEFT JOIN users u ON po.approved_by = u.id
       ${where}
       ORDER BY po.created_at DESC`,
      params
    );

    const filterSummary = buildFilterSummary(req.query);
    const pdfBuffer = await generatePoListPdf(rows, filterSummary);

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="purchase-orders-${date}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('exportPDFList:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/purchase-orders ────────────────────────────────────────────────
const createPO = async (req, res) => {
  const {
    supplier_id,
    supplier_name, supplier_email, supplier_address,
    street_name, zip_code, city, county,
    date_of_po, production_id,
    set_code, account_code, description, department, net_amount, vat, gross_amount, paid_from, title, notes,
  } = req.body;

  if (!supplier_name || !production_id || !net_amount)
    return res.status(400).json({ error: 'supplier_name, production_id, and net_amount are required' });

  try {
    // Block POs on complete or archived productions
    const { rows: [prod] } = await db.query(
      'SELECT status FROM productions WHERE id = $1', [production_id]
    );
    if (!prod) return res.status(400).json({ error: 'Production not found' });
    if (prod.status === 'complete')
      return res.status(400).json({ error: 'Cannot raise new POs on a completed production' });
    if (prod.status === 'archived')
      return res.status(400).json({ error: 'Cannot raise new POs on an archived production' });

    const po_number = await generatePoNumber();
    const net = parseFloat(net_amount);
    if (!Number.isFinite(net) || net < 0) return res.status(400).json({ error: 'net_amount must be a non-negative number' });
    // Auto-calculate VAT at 20% if not provided; auto-calculate gross if not provided
    const vatAmount   = vat          !== undefined ? parseFloat(vat)          : Math.round(net * 0.20 * 100) / 100;
    const grossAmount = gross_amount !== undefined ? parseFloat(gross_amount) : Math.round((net + vatAmount) * 100) / 100;
    if (!Number.isFinite(vatAmount) || vatAmount < 0 || !Number.isFinite(grossAmount) || grossAmount < 0) return res.status(400).json({ error: 'vat and gross_amount must be non-negative numbers' });

    const { rows } = await db.query(
      `INSERT INTO purchase_orders
         (po_number, supplier_id, supplier_name, supplier_email, supplier_address,
          street_name, zip_code, city, county,
          date_of_po, production_id,
          set_code, account_code, description, department, net_amount, vat, gross_amount, paid_from,
          status, created_by, title, notes)
      VALUES ($1,COALESCE($2, (SELECT id FROM suppliers WHERE LOWER(BTRIM(name)) = LOWER(BTRIM($3)) LIMIT 1)),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'draft',$20,$21,$22)
       RETURNING *`,
      [
        po_number, supplier_id || null, supplier_name.trim(), supplier_email || null,
        supplier_address || null,
        street_name || null, zip_code || null, city || null, county || null,
        date_of_po || new Date().toISOString().split('T')[0],
        production_id, set_code, account_code, description, department || null,
        net, vatAmount, grossAmount,
        paid_from,
        req.user.id,
        title,
        notes || null
      ]
    );
    res.status(201).json({ ...rows[0], message: 'Purchase order created successfully', purchase_order: rows[0] });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      productionId: rows[0].production_id,
      category: 'financial',
      action: 'po_created',
      entityType: 'purchase_order',
      entityId: rows[0].po_number,
      details: `Created Purchase Order ${rows[0].po_number} for ${rows[0].supplier_name} (£${parseFloat(rows[0].gross_amount || 0).toFixed(2)})`,
      metadata: { po_id: rows[0].id, po_number: rows[0].po_number, gross_amount: rows[0].gross_amount, supplier_name: rows[0].supplier_name },
    });
  } catch (err) {
    console.error('createPO:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/purchase-orders/:id ────────────────────────────────────────────
const getPOById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT po.*, p.id AS prod_id, p.name AS prod_name
       FROM   purchase_orders po
       JOIN   productions p ON po.production_id = p.id
       WHERE  po.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Purchase order not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT / PATCH /api/purchase-orders/:id ────────────────────────────────────
const updatePO = async (req, res) => {
  const allowed = [
    'supplier_id',
    'supplier_name', 'supplier_email', 'supplier_address',
    'street_name', 'zip_code', 'city', 'county',
    'date_of_po', 'production_id',
    'set_code', 'account_code', 'description', 'department', 'net_amount', 'vat', 'gross_amount', 'paid_from', 'title', 'notes'
  ];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No updatable fields provided' });

  try {
    const { rows: existing } = await db.query(
      'SELECT status FROM purchase_orders WHERE id = $1',
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Purchase order not found' });
    if (existing[0].status === 'approved')
      return res.status(403).json({ error: 'Cannot edit an approved purchase order' });

    const fields    = Object.keys(updates);
    const values    = Object.values(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const { rows } = await db.query(
      `UPDATE purchase_orders SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('updatePO:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/purchase-orders/:id/issue ─────────────────────────────────────
// Sends PO to supplier via email with PDF attachment; advances draft → issued.
const issuePO = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [po] } = await client.query(
      `SELECT po.*, p.name AS prod_name
       FROM purchase_orders po
       JOIN productions p ON po.production_id = p.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (!po)                     { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Purchase order not found' }); }
    if (po.status !== 'draft')   { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Only draft POs can be issued' }); }
    if (!po.supplier_email)      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Supplier email is required to issue a PO' }); }

    // Generate PDF
    const pdfBuffer = await generatePoPdf(po, po.prod_name);

    // Send email with PDF attachment
    const { subject, html } = templates.poIssued(po, po.prod_name);
    await sendEmail({
      to:      po.supplier_email,
      subject,
      html,
      attachments: [{ filename: `${po.po_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    // Advance status
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET status = 'issued' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    await logStatusTransition(client, po.id, po.production_id, 'draft', 'issued', req.user.id);

    await client.query('COMMIT');
    res.json({ message: 'PO issued to supplier', purchase_order: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('issuePO:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── POST /api/purchase-orders/:id/submit ────────────────────────────────────
// Advances draft → submitted and emails the PO PDF to the supplier if an email is set.
const submitPO = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [po] } = await client.query(
      `SELECT po.*, p.name AS prod_name
       FROM purchase_orders po
       JOIN productions p ON po.production_id = p.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (!po)                    { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Purchase order not found' }); }
    if (po.status !== 'draft')  { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Only draft purchase orders can be submitted' }); }

    const newStatus = po.invoice_attachment_url ? 'invoice_received' : 'submitted';
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET status = $1 WHERE id = $2 RETURNING *`,
      [newStatus, req.params.id]
    );
    await logStatusTransition(client, po.id, po.production_id, 'draft', newStatus, req.user.id);

    await client.query('COMMIT');

    // Send PO to supplier email in the background (non-blocking)
    if (po.supplier_email) {
      generatePoPdf(po, po.prod_name)
        .then(pdfBuffer => {
          const { subject, html } = templates.poIssued(po, po.prod_name);
          return sendEmail({
            to: po.supplier_email,
            subject,
            html,
            attachments: [{ filename: `${po.po_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
          });
        })
        .catch(emailErr => console.error('submitPO email failed:', emailErr.message));
    }

    res.json({ message: 'PO submitted for approval', purchase_order: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── POST /api/purchase-orders/:id/attach-invoice ────────────────────────────
const attachInvoice = async (req, res) => {
  let invoice_attachment_url  = req.body.invoice_attachment_url;
  let invoice_attachment_name = req.body.invoice_attachment_name;

  try {
    if (req.file) {
      const { url } = await fileStorage.store(req.file);
      invoice_attachment_url  = url;
      invoice_attachment_name = req.file.originalname;
    }

    if (!invoice_attachment_url)
      return res.status(400).json({ error: 'Provide a file upload or invoice_attachment_url' });

    const { rows: [existing] } = await db.query(
      'SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
    if (existing.status === 'approved')
      return res.status(400).json({ error: 'Cannot replace invoice on an approved purchase order' });

    const newStatus = (existing.status === 'submitted' || existing.status === 'issued') ? 'invoice_received' : existing.status;
    const { rows: [updated] } = await db.query(
      `UPDATE purchase_orders
       SET invoice_attachment_url  = $1,
           invoice_attachment_name = $2,
           status = $3
       WHERE id = $4
       RETURNING *`,
      [invoice_attachment_url, invoice_attachment_name, newStatus, req.params.id]
    );
    res.json({ message: 'Invoice attached successfully', purchase_order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/purchase-orders/:id/invoice/download ───────────────────────────
const downloadInvoice = async (req, res) => {
  try {
    const { rows: [po] } = await db.query(
      'SELECT invoice_attachment_url, invoice_attachment_name FROM purchase_orders WHERE id = $1',
      [req.params.id]
    );
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!po.invoice_attachment_url)
      return res.status(404).json({ error: 'No invoice attached to this purchase order' });

    res.json({ url: po.invoice_attachment_url, filename: po.invoice_attachment_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/purchase-orders/:id/invoice ─────────────────────────────────
const deleteInvoice = async (req, res) => {
  try {
    const { rows: [po] } = await db.query(
      'SELECT status, invoice_attachment_url FROM purchase_orders WHERE id = $1',
      [req.params.id]
    );
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status === 'approved')
      return res.status(403).json({ error: 'Cannot delete invoice on an approved purchase order' });
    if (!po.invoice_attachment_url)
      return res.status(404).json({ error: 'No invoice attached to this purchase order' });

    // If pending_approval, revert to issued since it's no longer ready for approval
    const revertStatus = po.status === 'pending_approval' ? 'issued' : po.status;
    await db.query(
      `UPDATE purchase_orders
       SET invoice_attachment_url = NULL, invoice_attachment_name = NULL, status = $1
       WHERE id = $2`,
      [revertStatus, req.params.id]
    );
    res.json({ message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/purchase-orders/:id/approve ───────────────────────────────────
// Accountant only. Runs inside a transaction — cost report write and approval are atomic.
const approvePO = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [po] } = await client.query(
      `SELECT po.*, p.name AS prod_name
       FROM purchase_orders po
       JOIN productions p ON po.production_id = p.id
       WHERE po.id = $1`,
      [req.params.id]
    );

    if (!po)                                                                         { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Purchase order not found' }); }
    if (po.status === 'approved')                                                    { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Purchase order is already approved' }); }
    if (po.status !== 'submitted' && po.status !== 'invoice_received')               { await client.query('ROLLBACK'); return res.status(409).json({ error: 'PO must be submitted before it can be approved' }); }


    // Update PO status
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, req.params.id]
    );

    // Feed cost into Cost Report (same transaction — rolls back on failure)
    await recordSupplierCost({ ...po, ...updated }, client);

    // Audit log
    await logStatusTransition(client, po.id, po.production_id, po.status, 'approved', req.user.id);

    await client.query('COMMIT');
    res.json({ message: 'PO approved. Costs fed into Cost Report.', purchase_order: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approvePO:', err);
    res.status(500).json({ error: 'Approval failed — cost report could not be updated. Please try again.' });
  } finally {
    client.release();
  }
};

// ─── DELETE /api/purchase-orders/:id (Soft-delete / Archive OR Permanent Delete)
const deletePO = async (req, res) => {
  const isPermanent = req.query.permanent === 'true';
  try {
    const { rows: [existing] } = await db.query(
      'SELECT id, po_number, status, supplier_name FROM purchase_orders WHERE id = $1',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
    if (existing.status === 'approved')
      return res.status(403).json({ error: 'Approved purchase orders cannot be deleted or archived directly' });

    if (isPermanent) {
      // Remove any related cost report entries
      await db.query(
        "DELETE FROM cost_report_entries WHERE source_id = $1 AND source_type = 'purchase_order'",
        [req.params.id]
      );

      // Permanently delete PO
      await db.query('DELETE FROM purchase_orders WHERE id = $1', [req.params.id]);

      await logAudit({
        userId: req.user?.id,
        userName: req.user?.full_name,
        userRole: req.user?.role,
        category: 'financial',
        action: 'po_permanently_deleted',
        entityType: 'purchase_order',
        entityId: req.params.id,
        details: `Permanently deleted purchase order ${existing.po_number || req.params.id} (${existing.supplier_name || 'N/A'})`,
        metadata: { po_id: req.params.id, po_number: existing.po_number },
      });

      return res.json({
        message: `Purchase order ${existing.po_number || ''} permanently deleted successfully`,
        permanently_deleted: true,
      });
    }

    await db.query(
      'UPDATE purchase_orders SET is_archived = true, deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Purchase order archived successfully', soft_deleted: true });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'financial',
      action: 'po_archived',
      entityType: 'purchase_order',
      entityId: req.params.id,
      details: `Archived purchase order ID ${req.params.id}`,
      metadata: { po_id: req.params.id },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/purchase-orders/:id/restore ───────────────────────────────────
const restorePO = async (req, res) => {
  try {
    const { rows: [existing] } = await db.query(
      'UPDATE purchase_orders SET is_archived = false, deleted_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING id, po_number',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ message: 'Purchase order restored successfully', purchase_order: existing });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'financial',
      action: 'po_restored',
      entityType: 'purchase_order',
      entityId: existing.po_number || existing.id,
      details: `Restored purchase order ${existing.po_number || existing.id}`,
      metadata: { po_id: existing.id, po_number: existing.po_number },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ─── POST /api/purchase-orders/:id/attach-confirmation ───────────────────────
const attachConfirmation = async (req, res) => {
  let confirmation_attachment_url  = req.body.confirmation_attachment_url;
  let confirmation_attachment_name = req.body.confirmation_attachment_name;

  try {
    if (req.file) {
      const { url } = await fileStorage.store(req.file);
      confirmation_attachment_url  = url;
      confirmation_attachment_name = req.file.originalname;
    }

    if (!confirmation_attachment_url)
      return res.status(400).json({ error: 'Provide a file upload or confirmation_attachment_url' });

    const { rows: [existing] } = await db.query(
      'SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Purchase order not found' });

    const { rows: [updated] } = await db.query(
      `UPDATE purchase_orders
       SET confirmation_attachment_url  = $1,
           confirmation_attachment_name = $2
       WHERE id = $3
       RETURNING *`,
      [confirmation_attachment_url, confirmation_attachment_name, req.params.id]
    );
    res.json({ message: 'Order confirmation attached successfully', purchase_order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const downloadConfirmation = async (req, res) => {
  try {
    const { rows: [po] } = await db.query(
      'SELECT confirmation_attachment_url, confirmation_attachment_name FROM purchase_orders WHERE id = $1',
      [req.params.id]
    );
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!po.confirmation_attachment_url) return res.status(404).json({ error: 'No order confirmation attached' });
    await fileStorage.streamToResponse(po.confirmation_attachment_url, res, po.confirmation_attachment_name || 'order-confirmation');
  } catch (err) {
    console.error('downloadConfirmation:', err);
    res.status(500).json({ error: 'Unable to download order confirmation' });
  }
};

// ─── GET /api/purchase-orders/:id/pdf ─────────────────────────────────────────
const downloadPdf = async (req, res) => {
  try {
    const { rows: [po] } = await db.query(
      `SELECT po.*, p.name AS prod_name
       FROM purchase_orders po
       JOIN productions p ON po.production_id = p.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    const pdfBuffer = await generatePoPdf(po, po.prod_name);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.po_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAccountCodes,
  getAllPOs, getPOById, updatePO,
  createPO,
  issuePO, submitPO,
  attachInvoice, downloadInvoice, deleteInvoice,
  attachConfirmation, downloadConfirmation,
  approvePO, deletePO, restorePO,
  exportCSV, exportPDFList, downloadPdf,
};
