const crypto = require('crypto');
const db = require('../config/db');
const { logAudit } = require('../services/auditService');
const { sendEmail, templates } = require('../config/email');
const { generateQuotePdf, pdfFileName } = require('../services/quotePdfService');
const {
  QUOTE_STATUSES, RECIPIENT_TYPES, LINE_TYPES, VAT_TREATMENTS, ALLOWED_TRANSITIONS, STATUS_TIMESTAMP_COLUMN,
  round2, lineTotal, computeTotals, validateDiscount, canTransition, formatQuoteReference,
} = require('../services/quoteCalculations');

// Addendum 6 — Quotes module.
// Enum references: QuoteStatus, QuoteRecipientType, QuoteLineType, VatTreatment, DiscountType, QuoteSendMethod (src/enums).

// QuoteSendMethod — the three ways to send a quote (Addendum 6 §8.2). Each one counts as sending.
const SEND_METHODS = ['email', 'download', 'link'];
const SEND_METHOD_TEXT = { email: 'emailed', download: 'downloaded for manual sending', link: 'shared by secure link' };

const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
/** A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30, which JS would roll over). */
const validDate = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};
// One address only: commas, semicolons and angle brackets would let a single field reach several inboxes.
const validEmail = e => typeof e === 'string' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e.trim());
const clean = v => (typeof v === 'string' ? v.trim() || null : v ?? null);

/** Today's date in the UK as YYYY-MM-DD. */
const todayUK = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const HEADER_FIELDS = [
  'title', 'quote_date', 'valid_until', 'recipient_type', 'production_id', 'department',
  'recipient_name', 'recipient_company', 'recipient_email', 'introduction', 'footer_notes',
  'discount_type', 'discount_value', 'vat_treatment',
];

const auditUser = req => ({ userId: req.user.id, userName: req.user.full_name, userRole: req.user.role });

/** Map a pg error onto a 4xx where it is the caller's fault. */
const pgErrorResponse = (err, res, fallback) => {
  if (err.code === '23503') return res.status(400).json({ error: 'Linked production or rate not found' });
  if (err.code === '23514' || err.code === '22003') return res.status(400).json({ error: 'Value out of allowed range' });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Normalise and validate a full quote header (create, or existing row merged with a PATCH).
 * Returns { value } or { error }.
 */
const validateHeader = (input, subtotal = Infinity) => {
  const h = {};
  for (const f of HEADER_FIELDS) h[f] = clean(input[f]);

  if (!h.title) return { error: 'Quote title is required' };
  if (!validDate(h.quote_date)) return { error: 'Quote date must be a valid date (YYYY-MM-DD)' };
  if (!validDate(h.valid_until)) return { error: 'Valid until must be a valid date (YYYY-MM-DD)' };
  if (h.valid_until < h.quote_date) return { error: 'Valid until cannot be earlier than the quote date' };
  if (!RECIPIENT_TYPES.includes(h.recipient_type)) {
    return { error: `Recipient type must be one of: ${RECIPIENT_TYPES.join(', ')}` };
  }

  if (h.production_id && !validId(h.production_id)) return { error: 'Invalid production ID' };

  if (h.recipient_type === 'internal') {
    if (!h.production_id) return { error: 'Production is required for an internal quote' };
    if (!h.department) return { error: 'Department is required for an internal quote' };
    h.recipient_name = null;
    h.recipient_company = null;
    h.recipient_email = null;
  } else {
    if (!h.recipient_name) return { error: 'Recipient name is required for an external quote' };
    if (!h.recipient_company) return { error: 'Company is required for an external quote' };
    if (!h.recipient_email) return { error: 'Email is required for an external quote' };
    if (!validEmail(h.recipient_email)) return { error: 'Email address is not valid' };
    h.department = null;
  }

  h.vat_treatment = h.vat_treatment || 'standard';
  if (!VAT_TREATMENTS.includes(h.vat_treatment)) {
    return { error: `VAT treatment must be one of: ${VAT_TREATMENTS.join(', ')}` };
  }

  if (!h.discount_type) {
    h.discount_type = null;
    h.discount_value = 0;
  } else {
    const discountError = validateDiscount(h.discount_type, h.discount_value, subtotal);
    if (discountError) return { error: discountError };
    h.discount_value = round2(h.discount_value); // stored as NUMERIC(12,2)
  }

  return { value: h };
};

/** Validate a line (new, or existing merged with a PATCH). Returns { value } or { error }. */
const validateLine = input => {
  const l = {
    line_type: clean(input.line_type),
    description: clean(input.description),
    bectu_rate_id: clean(input.bectu_rate_id),
    quantity: input.quantity,
    unit: clean(input.unit),
    unit_rate: input.unit_rate,
    note: clean(input.note),
  };

  if (!LINE_TYPES.includes(l.line_type)) return { error: `Line type must be one of: ${LINE_TYPES.join(', ')}` };
  if (!l.description) return { error: 'Description is required' };
  if (l.bectu_rate_id && !validId(l.bectu_rate_id)) return { error: 'Invalid rate card ID' };
  if (l.line_type !== 'labour_grade') l.bectu_rate_id = null;

  // Misc lines are a lump sum: quantity 1, the amount is the rate.
  if (l.line_type === 'misc' && (l.quantity == null || l.quantity === '')) l.quantity = 1;

  // Rounded to 2 dp up front so the stored values (NUMERIC(12,2)) and the line total always agree.
  const qty = round2(l.quantity);
  if (l.quantity == null || l.quantity === '' || !Number.isFinite(Number(l.quantity)) || qty <= 0) {
    return { error: 'Quantity must be more than 0' };
  }
  const rate = round2(l.unit_rate);
  if (l.unit_rate == null || l.unit_rate === '' || !Number.isFinite(Number(l.unit_rate)) || rate < 0) {
    return { error: 'Rate must be 0 or more' };
  }

  l.quantity = qty;
  l.unit_rate = rate;
  l.line_total = lineTotal(qty, rate);
  return { value: l };
};

const QUOTE_SELECT = `
  SELECT q.*, p.name AS production_name, p.production_code, u.full_name AS created_by_name
  FROM quotes q
  LEFT JOIN productions p ON p.id = q.production_id
  LEFT JOIN users u ON u.id = q.created_by
`;

/**
 * The secure-link token is a capability (anyone holding it can open the quote), so it never
 * goes out in list/detail responses — only to the user who shares by link (sendQuote).
 */
const withoutToken = ({ share_token, ...row }) => row;

/** Header + ordered lines + send history. `runner` is the pool or a transaction client. */
const loadQuote = async (runner, id) => {
  const { rows: [row] } = await runner.query(`${QUOTE_SELECT} WHERE q.id = $1`, [id]);
  if (!row) return null;
  const quote = withoutToken(row);
  const { rows: lines } = await runner.query(
    'SELECT * FROM quote_lines WHERE quote_id = $1 ORDER BY sort_order ASC, created_at ASC',
    [id]
  );
  const { rows: sends } = await runner.query(
    `SELECT s.id, s.revision, s.method, s.sent_to, s.sent_at, u.full_name AS sent_by_name
     FROM quote_sends s LEFT JOIN users u ON u.id = s.sent_by
     WHERE s.quote_id = $1 ORDER BY s.sent_at DESC`,
    [id]
  );
  return { ...quote, lines, sends };
};

/** The quote as a document (what the PDF shows): header and lines, no send history. */
const toDocument = ({ sends, ...doc }) => doc;

/** Recalculate and store the quote's totals from its lines. */
const recalcTotals = async (client, quote) => {
  const { rows: lines } = await client.query(
    'SELECT quantity, unit_rate FROM quote_lines WHERE quote_id = $1',
    [quote.id]
  );
  const t = computeTotals(lines, quote);
  await client.query(
    `UPDATE quotes SET subtotal = $2, discount_amount = $3, vat_amount = $4, total = $5, updated_at = NOW()
     WHERE id = $1`,
    [quote.id, t.subtotal, t.discount_amount, t.vat_amount, t.total]
  );
  return t;
};

/** Run fn inside a transaction with the quote row locked. Refuses unless status is Draft when draftOnly. */
const withLockedQuote = async (id, { draftOnly }, fn) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [quote] } = await client.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [id]);
    if (!quote) throw httpError(404, 'Quote not found');
    if (draftOnly && quote.status !== 'draft') {
      throw httpError(409, 'Only a Draft quote can be changed');
    }
    const result = await fn(client, quote);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// ─── Quotes ───────────────────────────────────────────────────────────────────

// GET /api/quotes
const getQuotes = async (req, res) => {
  try {
    const { status, production_id, recipient_type, date_from, date_to, search } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status && status !== 'all') {
      const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
      if (!statuses.length || !statuses.every(s => QUOTE_STATUSES.includes(s))) {
        return res.status(400).json({ error: `Status must be one or more of: ${QUOTE_STATUSES.join(', ')}` });
      }
      conditions.push(`q.status = ANY($${idx++}::text[])`);
      params.push(statuses);
    }
    if (production_id) {
      if (!validId(production_id)) return res.status(400).json({ error: 'Invalid production ID' });
      conditions.push(`q.production_id = $${idx++}`);
      params.push(production_id);
    }
    if (recipient_type && recipient_type !== 'all') {
      if (!RECIPIENT_TYPES.includes(recipient_type)) return res.status(400).json({ error: 'Invalid recipient type' });
      conditions.push(`q.recipient_type = $${idx++}`);
      params.push(recipient_type);
    }
    if (date_from) {
      if (!validDate(date_from)) return res.status(400).json({ error: 'Invalid date_from' });
      conditions.push(`q.quote_date >= $${idx++}`);
      params.push(date_from);
    }
    if (date_to) {
      if (!validDate(date_to)) return res.status(400).json({ error: 'Invalid date_to' });
      conditions.push(`q.quote_date <= $${idx++}`);
      params.push(date_to);
    }
    if (search && String(search).trim()) {
      conditions.push(`(q.reference ILIKE $${idx} OR q.title ILIKE $${idx})`);
      params.push(`%${String(search).trim()}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `${QUOTE_SELECT} ${where} ORDER BY q.quote_date DESC, q.created_at DESC`,
      params
    );
    res.json(rows.map(withoutToken));
  } catch (err) {
    console.error('getQuotes error:', err);
    res.status(500).json({ error: 'Unable to load quotes' });
  }
};

// GET /api/quotes/:id
const getQuoteById = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid quote ID' });
  try {
    const quote = await loadQuote(db, req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    console.error('getQuoteById error:', err);
    res.status(500).json({ error: 'Unable to load quote' });
  }
};

// POST /api/quotes
const createQuote = async (req, res) => {
  const body = req.body || {};
  const quoteDate = body.quote_date || todayUK();
  const input = {
    ...body,
    quote_date: quoteDate,
    valid_until: body.valid_until || (validDate(quoteDate) ? addDays(quoteDate, 30) : null),
  };
  // A new quote has no lines, so a fixed discount can't be checked against a subtotal yet.
  const { value: h, error } = validateHeader(input, Infinity);
  if (error) return res.status(400).json({ error });

  try {
    const { rows: [{ n }] } = await db.query("SELECT nextval('quote_reference_seq') AS n");
    const reference = formatQuoteReference(n);

    const { rows: [created] } = await db.query(
      `INSERT INTO quotes (
        reference, title, quote_date, valid_until, recipient_type, production_id, department,
        recipient_name, recipient_company, recipient_email, introduction, footer_notes,
        discount_type, discount_value, vat_treatment, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        reference, h.title, h.quote_date, h.valid_until, h.recipient_type, h.production_id, h.department,
        h.recipient_name, h.recipient_company, h.recipient_email, h.introduction, h.footer_notes,
        h.discount_type, h.discount_value, h.vat_treatment, req.user.id,
      ]
    );

    await logAudit({
      ...auditUser(req),
      productionId: created.production_id,
      category: 'financial',
      action: 'quote_created',
      entityType: 'quote',
      entityId: created.reference,
      details: `Created quote ${created.reference} — ${created.title}`,
      metadata: { quote_id: created.id },
    });

    res.status(201).json({ ...withoutToken(created), lines: [], sends: [] });
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to create quote');
  }
};

// PATCH /api/quotes/:id  (Draft only)
const updateQuote = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid quote ID' });
  try {
    await withLockedQuote(req.params.id, { draftOnly: true }, async (client, existing) => {
      const merged = { ...existing };
      for (const f of HEADER_FIELDS) if (f in (req.body || {})) merged[f] = req.body[f];
      const { value: h, error } = validateHeader(merged, Number(existing.subtotal));
      if (error) throw httpError(400, error);

      await client.query(
        `UPDATE quotes SET
          title = $2, quote_date = $3, valid_until = $4, recipient_type = $5, production_id = $6,
          department = $7, recipient_name = $8, recipient_company = $9, recipient_email = $10,
          introduction = $11, footer_notes = $12, discount_type = $13, discount_value = $14,
          vat_treatment = $15, updated_at = NOW()
        WHERE id = $1`,
        [
          existing.id, h.title, h.quote_date, h.valid_until, h.recipient_type, h.production_id,
          h.department, h.recipient_name, h.recipient_company, h.recipient_email,
          h.introduction, h.footer_notes, h.discount_type, h.discount_value, h.vat_treatment,
        ]
      );
      await recalcTotals(client, { id: existing.id, ...h });
    });
    res.json(await loadQuote(db, req.params.id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to update quote');
  }
};

// DELETE /api/quotes/:id  (Draft only)
const deleteQuote = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid quote ID' });
  try {
    const deleted = await withLockedQuote(req.params.id, { draftOnly: true }, async (client, existing) => {
      if (existing.sent_at) throw httpError(409, 'This quote has been sent before, so it is kept for its history');
      await client.query('DELETE FROM quotes WHERE id = $1', [existing.id]);
      return existing;
    });
    await logAudit({
      ...auditUser(req),
      productionId: deleted.production_id,
      category: 'financial',
      action: 'quote_deleted',
      entityType: 'quote',
      entityId: deleted.reference,
      details: `Deleted draft quote ${deleted.reference} — ${deleted.title}`,
    });
    res.status(204).end();
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to delete quote');
  }
};

// ─── Lines (Draft only) ──────────────────────────────────────────────────────

// POST /api/quotes/:id/lines
const addLine = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid quote ID' });
  const { value: l, error } = validateLine(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    await withLockedQuote(req.params.id, { draftOnly: true }, async (client, quote) => {
      const { rows: [{ next_order }] } = await client.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM quote_lines WHERE quote_id = $1',
        [quote.id]
      );
      await client.query(
        `INSERT INTO quote_lines
          (quote_id, line_type, sort_order, description, bectu_rate_id, quantity, unit, unit_rate, line_total, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [quote.id, l.line_type, next_order, l.description, l.bectu_rate_id, l.quantity, l.unit, l.unit_rate, l.line_total, l.note]
      );
      await recalcTotals(client, quote);
    });
    res.status(201).json(await loadQuote(db, req.params.id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to add line');
  }
};

// PATCH /api/quotes/:id/lines/:lineId
const updateLine = async (req, res) => {
  const { id, lineId } = req.params;
  if (!validId(id) || !validId(lineId)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    await withLockedQuote(id, { draftOnly: true }, async (client, quote) => {
      const { rows: [line] } = await client.query(
        'SELECT * FROM quote_lines WHERE id = $1 AND quote_id = $2',
        [lineId, quote.id]
      );
      if (!line) throw httpError(404, 'Line not found');

      const merged = { ...line };
      for (const f of ['line_type', 'description', 'bectu_rate_id', 'quantity', 'unit', 'unit_rate', 'note']) {
        if (f in (req.body || {})) merged[f] = req.body[f];
      }
      const { value: l, error } = validateLine(merged);
      if (error) throw httpError(400, error);

      await client.query(
        `UPDATE quote_lines SET line_type = $2, description = $3, bectu_rate_id = $4, quantity = $5,
          unit = $6, unit_rate = $7, line_total = $8, note = $9, updated_at = NOW()
         WHERE id = $1`,
        [lineId, l.line_type, l.description, l.bectu_rate_id, l.quantity, l.unit, l.unit_rate, l.line_total, l.note]
      );
      await recalcTotals(client, quote);
    });
    res.json(await loadQuote(db, id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to update line');
  }
};

// DELETE /api/quotes/:id/lines/:lineId
const deleteLine = async (req, res) => {
  const { id, lineId } = req.params;
  if (!validId(id) || !validId(lineId)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    await withLockedQuote(id, { draftOnly: true }, async (client, quote) => {
      const { rowCount } = await client.query(
        'DELETE FROM quote_lines WHERE id = $1 AND quote_id = $2',
        [lineId, quote.id]
      );
      if (!rowCount) throw httpError(404, 'Line not found');
      await recalcTotals(client, quote);
    });
    res.json(await loadQuote(db, id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to delete line');
  }
};

// PUT /api/quotes/:id/lines/reorder   body: { line_ids: [uuid, ...] } in the new order
const reorderLines = async (req, res) => {
  const { id } = req.params;
  const ids = req.body?.line_ids;
  if (!validId(id)) return res.status(400).json({ error: 'Invalid quote ID' });
  if (!Array.isArray(ids) || !ids.length || !ids.every(validId) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'line_ids must be a list of the quote\'s line IDs, each once' });
  }
  try {
    await withLockedQuote(id, { draftOnly: true }, async (client, quote) => {
      const { rows } = await client.query('SELECT id FROM quote_lines WHERE quote_id = $1', [quote.id]);
      const current = new Set(rows.map(r => r.id));
      if (current.size !== ids.length || !ids.every(x => current.has(x))) {
        throw httpError(400, 'line_ids must contain every line on the quote exactly once');
      }
      await client.query(
        `UPDATE quote_lines ql SET sort_order = o.ord, updated_at = NOW()
         FROM unnest($2::uuid[]) WITH ORDINALITY AS o(line_id, ord)
         WHERE ql.id = o.line_id AND ql.quote_id = $1`,
        [quote.id, ids]
      );
    });
    res.json(await loadQuote(db, id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to reorder lines');
  }
};

// ─── Status workflow ─────────────────────────────────────────────────────────

// POST /api/quotes/:id/status   body: { status, po_reference?, note? }
const changeStatus = async (req, res) => {
  const { id } = req.params;
  const { status, po_reference, note } = req.body || {};
  if (!validId(id)) return res.status(400).json({ error: 'Invalid quote ID' });
  if (!QUOTE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${QUOTE_STATUSES.join(', ')}` });
  }
  if (status === 'sent') {
    return res.status(400).json({ error: 'Use Send to send the quote (email, download or secure link)' });
  }

  try {
    const { before } = await withLockedQuote(id, { draftOnly: false }, async (client, quote) => {
      if (!canTransition(quote.status, status)) {
        const allowed = ALLOWED_TRANSITIONS[quote.status];
        throw httpError(409, allowed.length
          ? `A ${quote.status} quote can only move to: ${allowed.join(', ')}`
          : `A ${quote.status} quote cannot change status`);
      }

      const po = clean(po_reference) ?? quote.po_reference;
      if (status === 'invoice_raised' && !po) {
        throw httpError(400, 'Enter the PO reference before marking the quote Invoice Raised');
      }

      const tsColumn = STATUS_TIMESTAMP_COLUMN[status];
      await client.query(
        `UPDATE quotes SET status = $2, status_note = $3, po_reference = $4,
          ${tsColumn ? `${tsColumn} = NOW(),` : ''} updated_at = NOW()
         WHERE id = $1`,
        [quote.id, status, clean(note), po]
      );
      return { before: quote };
    });

    await logAudit({
      ...auditUser(req),
      productionId: before.production_id,
      category: 'financial',
      action: 'quote_status_changed',
      entityType: 'quote',
      entityId: before.reference,
      details: `Quote ${before.reference} moved from ${before.status} to ${status}`,
      metadata: { quote_id: before.id, from: before.status, to: status, note: clean(note) },
    });

    res.json(await loadQuote(db, id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to change quote status');
  }
};

// ─── Send, revise, PDF ───────────────────────────────────────────────────────

// POST /api/quotes/:id/send   body: { method: 'email' | 'download' | 'link', to? }
// Sends a Draft quote (→ Sent) or re-sends a Sent one. Every send stores a snapshot of
// exactly what went out, so the history can be re-opened later.
const sendQuote = async (req, res) => {
  const { id } = req.params;
  const method = req.body?.method;
  if (!validId(id)) return res.status(400).json({ error: 'Invalid quote ID' });
  if (!SEND_METHODS.includes(method)) {
    return res.status(400).json({ error: `Method must be one of: ${SEND_METHODS.join(', ')}` });
  }

  try {
    const sent = await withLockedQuote(id, { draftOnly: false }, async (client, quote) => {
      if (quote.status !== 'draft' && quote.status !== 'sent') {
        throw httpError(409, 'Only a Draft or Sent quote can be sent');
      }
      const current = await loadQuote(client, quote.id);
      if (!current.lines.length) throw httpError(400, 'Add at least one line before sending the quote');

      let to = null;
      if (method === 'email') {
        to = clean(req.body.to) ?? quote.recipient_email;
        if (!to) throw httpError(400, 'Enter the email address to send the quote to');
        if (!validEmail(to)) throw httpError(400, 'Email address is not valid');
      }
      const shareToken = method === 'link' && !quote.share_token
        ? crypto.randomBytes(24).toString('base64url')
        : quote.share_token;

      const document = { ...toDocument(current), status: 'sent' };
      await client.query(
        `UPDATE quotes SET status = 'sent', sent_at = NOW(), status_note = NULL, share_token = $2, updated_at = NOW() WHERE id = $1`,
        [quote.id, shareToken]
      );
      await client.query(
        `INSERT INTO quote_sends (quote_id, revision, method, sent_to, snapshot, sent_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [quote.id, quote.revision, method, to, JSON.stringify(document), req.user.id]
      );

      // Inside the transaction: if the email fails, nothing is recorded and the status stays put.
      if (method === 'email') {
        const pdf = await generateQuotePdf(document);
        const { subject, html } = templates.quoteSent(document);
        try {
          await sendEmail({
            to, subject, html,
            attachments: [{ filename: pdfFileName(document), content: pdf, contentType: 'application/pdf' }],
          });
        } catch (mailErr) {
          // Provider errors can carry account details, so they stay in the server log.
          console.error(`sendQuote: email for ${quote.reference} failed:`, mailErr.message);
          throw httpError(502, 'The email could not be sent. Try again, or use Download PDF or Copy secure link.');
        }
      }
      return { quote, to, shareToken };
    });

    const { quote, to, shareToken } = sent;
    await logAudit({
      ...auditUser(req),
      productionId: quote.production_id,
      category: 'financial',
      action: quote.status === 'draft' ? 'quote_sent' : 'quote_resent',
      entityType: 'quote',
      entityId: quote.reference,
      details: `${quote.status === 'draft' ? 'Sent' : 'Re-sent'} ${quote.reference} (rev ${quote.revision}) — ${SEND_METHOD_TEXT[method]}${to ? ` to ${to}` : ''}`,
      metadata: { quote_id: quote.id, revision: quote.revision, method, to },
    });

    const updated = await loadQuote(db, id);
    res.json(method === 'link' ? { ...updated, share_token: shareToken } : updated);
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to send quote');
  }
};

// POST /api/quotes/:id/revise — reopen a Sent quote as the next revision (Draft).
// What was sent before stays in the send history.
const reviseQuote = async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ error: 'Invalid quote ID' });
  try {
    const quote = await withLockedQuote(id, { draftOnly: false }, async (client, q) => {
      if (q.status !== 'sent') throw httpError(409, 'Only a Sent quote can be revised');
      await client.query(
        `UPDATE quotes SET status = 'draft', revision = revision + 1, status_note = NULL, updated_at = NOW() WHERE id = $1`,
        [q.id]
      );
      return q;
    });

    await logAudit({
      ...auditUser(req),
      productionId: quote.production_id,
      category: 'financial',
      action: 'quote_revised',
      entityType: 'quote',
      entityId: quote.reference,
      details: `Opened revision ${quote.revision + 1} of ${quote.reference} as a draft`,
      metadata: { quote_id: quote.id, from_revision: quote.revision },
    });

    res.json(await loadQuote(db, id));
  } catch (err) {
    pgErrorResponse(err, res, 'Unable to revise quote');
  }
};

const sendPdf = (res, document, disposition) => generateQuotePdf(document).then(pdf => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${pdfFileName(document)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
});

// GET /api/quotes/:id/pdf[?send_id=] — current quote, or exactly what was sent in a past send.
const getQuotePdf = async (req, res) => {
  const { id } = req.params;
  const sendId = req.query.send_id;
  if (!validId(id)) return res.status(400).json({ error: 'Invalid quote ID' });
  if (sendId && !validId(sendId)) return res.status(400).json({ error: 'Invalid send ID' });
  try {
    let document;
    if (sendId) {
      const { rows: [row] } = await db.query(
        'SELECT snapshot FROM quote_sends WHERE id = $1 AND quote_id = $2',
        [sendId, id]
      );
      document = row?.snapshot;
    } else {
      const quote = await loadQuote(db, id);
      document = quote && toDocument(quote);
    }
    if (!document) return res.status(404).json({ error: 'Quote not found' });
    await sendPdf(res, document, 'attachment');
  } catch (err) {
    console.error('getQuotePdf error:', err);
    res.status(500).json({ error: 'Unable to create the quote PDF' });
  }
};

// GET /api/public/quotes/:token — the secure preview link (no login). Shows the latest sent version.
const getSharedQuotePdf = async (req, res) => {
  const { token } = req.params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token || '')) return res.status(404).send('This quote link is not valid.');
  try {
    const { rows: [row] } = await db.query(
      `SELECT s.snapshot FROM quotes q
       JOIN quote_sends s ON s.quote_id = q.id
       WHERE q.share_token = $1
       ORDER BY s.sent_at DESC LIMIT 1`,
      [token]
    );
    if (!row) return res.status(404).send('This quote link is not valid.');
    res.setHeader('X-Robots-Tag', 'noindex');
    await sendPdf(res, row.snapshot, 'inline');
  } catch (err) {
    console.error('getSharedQuotePdf error:', err);
    res.status(500).send('Unable to show this quote right now.');
  }
};

module.exports = {
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  deleteQuote,
  addLine,
  updateLine,
  deleteLine,
  reorderLines,
  changeStatus,
  sendQuote,
  reviseQuote,
  getQuotePdf,
  getSharedQuotePdf,
  // exported for unit tests
  _validateHeader: validateHeader,
  _validateLine: validateLine,
};
