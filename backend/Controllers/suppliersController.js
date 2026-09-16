const db = require('../config/db');

// ─── GET /api/suppliers/names ──────────────────────────────────────────────────
// Distinct active supplier names — used for autocomplete in forms.
const getSupplierNames = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT name
       FROM suppliers
       ORDER BY name`
    );
    res.json(rows.map(r => r.name));
  } catch (err) {
    console.error('getSupplierNames:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/suppliers ────────────────────────────────────────────────────────
const getSuppliers = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, category, primary_contact_name, email, street_name, city, county, zip_code, phone, account_number, credit_terms, payment_terms, lead_times, notes, created_at, updated_at
       FROM suppliers
       ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error('getSuppliers:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/suppliers/:id ────────────────────────────────────────────────────
const getSupplierById = async (req, res) => {
  try {
    const { rows: [row] } = await db.query(
      `SELECT id, name, category, primary_contact_name, email, street_name, city, county, zip_code, phone, account_number, credit_terms, payment_terms, lead_times, notes, created_at, updated_at
       FROM suppliers
       WHERE id = $1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Supplier not found' });
    res.json(row);
  } catch (err) {
    console.error('getSupplierById:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/suppliers/:id/history
const getSupplierHistory = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT po.id, po.po_number, po.title, po.date_of_po, po.status,
             po.net_amount, po.vat, po.gross_amount, po.supplier_name,
             p.id AS production_id, p.name AS production_name, p.status AS production_status
      FROM purchase_orders po
      JOIN productions p ON p.id = po.production_id
      WHERE po.supplier_id = $1
        OR (po.supplier_id IS NULL AND LOWER(BTRIM(po.supplier_name)) = LOWER(BTRIM((SELECT name FROM suppliers WHERE id = $1))))
      ORDER BY po.date_of_po DESC, po.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('getSupplierHistory:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/suppliers/history
const getAllSupplierHistory = async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT po.id, po.po_number, po.title, po.date_of_po, po.status,
             po.net_amount, po.vat, po.gross_amount, po.supplier_id,
             po.supplier_name AS po_supplier_name,
             s.name AS supplier_record_name, s.category AS supplier_category,
             CONCAT_WS(', ', s.city, s.county) AS supplier_location,
             p.id AS production_id, p.name AS production_name, p.status AS production_status
      FROM purchase_orders po
      JOIN productions p ON p.id = po.production_id
      LEFT JOIN LATERAL (
        SELECT s.*
        FROM suppliers s
        WHERE s.id = po.supplier_id
           OR (po.supplier_id IS NULL AND LOWER(BTRIM(po.supplier_name)) = LOWER(BTRIM(s.name)))
        ORDER BY (s.id = po.supplier_id) DESC, s.id
        LIMIT 1
      ) s ON TRUE
      ORDER BY po.date_of_po DESC, po.created_at DESC
    `);
    res.json(rows.map(row => ({
      ...row,
      supplier_name: row.supplier_record_name || row.po_supplier_name,
    })));
  } catch (err) {
    console.error('getAllSupplierHistory:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/suppliers ───────────────────────────────────────────────────────
const createSupplier = async (req, res) => {
  const { name, category, primary_contact_name, email, street_name, city, county, zip_code, phone, account_number, credit_terms, payment_terms, lead_times, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO suppliers (name, category, primary_contact_name, email, street_name, city, county, zip_code, phone, account_number, credit_terms, payment_terms, lead_times, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [name.trim(), category || null, primary_contact_name || null, email || null, street_name || null, city || null, county || null, zip_code || null, phone || null, account_number || null, credit_terms || null, payment_terms || null, lead_times || null, notes || null]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('createSupplier:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/suppliers/:id ────────────────────────────────────────────────────
const updateSupplier = async (req, res) => {
  const allowed = ['name', 'category', 'primary_contact_name', 'email', 'street_name', 'city', 'county', 'zip_code', 'phone', 'account_number', 'credit_terms', 'payment_terms', 'lead_times', 'notes'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No updatable fields provided' });

  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  try {
    const { rows: [row] } = await db.query(
      `UPDATE suppliers
       SET ${setClause}, updated_at = NOW()
       WHERE id = $${fields.length + 1}
       RETURNING *`,
      [...values, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Supplier not found' });
    res.json(row);
  } catch (err) {
    console.error('updateSupplier:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/suppliers/:id ─────────────────────────────────────────────────
const deleteSupplier = async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deleted' });
  } catch (err) {
    console.error('deleteSupplier:', err);
    // Handle foreign key constraint error, though we don't have them yet
    if (err.code === '23503') {
       return res.status(400).json({ error: 'Cannot delete supplier because they are referenced elsewhere.' });
    }
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getSupplierNames,
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierHistory,
  getAllSupplierHistory
};
