const db  = require('../config/db');
const csv = require('csv-parse/sync');

const TEMPLATE_HEADER = 'Material Name,Description,Category,Supplier Name,Unit of Measure,Current Unit Price,Price Updated Date,Notes\r\n';

const selectColumns = `id, material_name, description, category, supplier_name,
  product_description, unit_of_measure, unit_price, price_updated_date, notes,
  created_at, updated_at`;

// ─── GET /api/materials-catalogue ─────────────────────────────────────────────
// ?supplier=  ?search=
const getCatalogue = async (req, res) => {
  try {
    const conds  = [`deleted_at IS NULL`];
    const params = [];
    let   i      = 1;

    if (req.query.supplier) { conds.push(`supplier_name ILIKE $${i++}`); params.push(`%${req.query.supplier}%`); }
    if (req.query.category) { conds.push(`category ILIKE $${i++}`); params.push(`%${req.query.category}%`); }
    if (req.query.search) {
      conds.push(`(material_name ILIKE $${i} OR description ILIKE $${i} OR product_description ILIKE $${i} OR category ILIKE $${i})`);
      params.push(`%${req.query.search}%`);
      i++;
    }

    const { rows } = await db.query(
      `SELECT ${selectColumns}
       FROM materials_catalogue
       WHERE ${conds.join(' AND ')}
       ORDER BY material_name NULLS LAST, supplier_name, product_description`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getCatalogue:', err);
    res.status(500).json({ error: err.message });
  }
};

const getCatalogueSuppliers = async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT DISTINCT supplier_name FROM materials_catalogue WHERE supplier_name IS NOT NULL AND supplier_name != \'\' ORDER BY supplier_name');
    res.json(rows.map(row => row.supplier_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/materials-catalogue/template ─────────────────────────────────────
// Returns a blank CSV template for bulk import.
const getTemplate = (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="materials_catalogue_template.csv"');
  res.send(TEMPLATE_HEADER);
};

// ─── POST /api/materials-catalogue ────────────────────────────────────────────
const createEntry = async (req, res) => {
  const { material_name, description, category, supplier_name, product_description, unit_of_measure, unit_price, price_updated_date, notes } = req.body;
  const resolvedName = (material_name || product_description || '').trim();
  const resolvedDescription = (description || product_description || '').trim();
  const numericPrice = Number(unit_price);
  if (!resolvedName || !resolvedDescription || !supplier_name || !unit_of_measure || unit_price === undefined || unit_price === null || unit_price === '' || !Number.isFinite(numericPrice) || numericPrice < 0)
    return res.status(400).json({ error: 'material_name, description, supplier_name, unit_of_measure and unit_price are required' });

  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO materials_catalogue
         (material_name, description, category, supplier_name, product_description, unit_of_measure, unit_price, price_updated_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${selectColumns}`,
      [resolvedName, resolvedDescription, category?.trim() || null, supplier_name?.trim() || null, resolvedDescription, unit_of_measure.trim(), numericPrice, price_updated_date || null, notes?.trim() || null]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('createEntry:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/materials-catalogue/:id ───────────────────────────────────────
const updateEntry = async (req, res) => {
  const allowed = ['material_name', 'description', 'category', 'supplier_name', 'product_description', 'unit_of_measure', 'unit_price', 'price_updated_date', 'notes'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No updatable fields provided' });

  if (updates.unit_price !== undefined) {
    const numericPrice = Number(updates.unit_price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) return res.status(400).json({ error: 'unit_price must be a non-negative number' });
    updates.unit_price = numericPrice;
  }
  for (const field of ['material_name', 'description', 'supplier_name', 'unit_of_measure']) {
    if (updates[field] !== undefined && !String(updates[field]).trim()) return res.status(400).json({ error: `${field} cannot be empty` });
  }
  const fields    = Object.keys(updates);
  const values    = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  try {
    const { rows: [row] } = await db.query(
      `UPDATE materials_catalogue
       SET ${setClause}, updated_at = NOW()
       WHERE id = $${fields.length + 1} AND deleted_at IS NULL
       RETURNING ${selectColumns}`,
      [...values, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Catalogue entry not found' });
    res.json(row);
  } catch (err) {
    console.error('updateEntry:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/materials-catalogue/:id ──────────────────────────────────────
// Soft-delete: entry is hidden from list and forecaster dropdown.
// Any saved forecast row that referenced it retains its snapshotted price.
const deleteEntry = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'UPDATE materials_catalogue SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Catalogue entry not found' });
    res.json({ message: 'Entry deleted' });
  } catch (err) {
    console.error('deleteEntry:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/materials-catalogue/import ─────────────────────────────────────
// Atomic CSV import. Validates all rows before committing — no partial imports.
// CSV columns: Supplier Name, Product Description, Unit of Measure, Unit Price, Notes (optional)
const importCSV = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  let records;
  try {
    records = csv.parse(req.file.buffer.toString(), {
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
    });
  } catch (parseErr) {
    return res.status(400).json({ error: `CSV parse error: ${parseErr.message}` });
  }

  if (!records.length)
    return res.status(400).json({ error: 'CSV is empty' });

  // Flexible column mapper helper
  const getCol = (row, candidates) => {
    for (const name of candidates) {
      const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase());
      if (key && row[key] !== undefined && row[key] !== null) return String(row[key]);
    }
    return '';
  };

  // Validate every row before touching the DB
  const errors = [];
  const parsedRows = records.map((row, idx) => {
    const rowNum = idx + 2; // +2 because row 1 is header
    const material_name = getCol(row, ['Material Name', 'material_name', 'Product', 'Item', 'Product Description', 'product_description']).trim();
    const description = getCol(row, ['Description', 'description', 'Product Description', 'product_description', 'Product', 'Item']).trim() || material_name;
    const category = getCol(row, ['Category', 'category', 'Material Type', 'Type']).trim();
    const supplier_name = getCol(row, ['Supplier', 'Supplier Name', 'supplier_name', 'Vendor']).trim();
    const unit_of_measure = getCol(row, ['Unit of Measure', 'unit_of_measure', 'Unit', 'UOM', 'Measure']).trim();
    const priceRaw = getCol(row, ['Unit Price', 'unit_price', 'Price', 'Cost', 'Rate']).trim();
    const price_updated_date = getCol(row, ['Price Updated Date', 'price_updated_date', 'Date Price Last Updated', 'Updated Date']).trim();
    const notes = getCol(row, ['Notes', 'notes', 'Note', 'Comments', 'Comment']).trim();

    if (!material_name)       errors.push({ row: rowNum, field: 'Material Name',       message: 'required' });
    if (!description)         errors.push({ row: rowNum, field: 'Description',         message: 'required' });
    if (!supplier_name)       errors.push({ row: rowNum, field: 'Supplier Name',       message: 'required' });
    if (!unit_of_measure)     errors.push({ row: rowNum, field: 'Unit of Measure',     message: 'required' });
    const price = parseFloat(priceRaw);
    if (!priceRaw || isNaN(price) || price < 0) errors.push({ row: rowNum, field: 'Unit Price', message: 'must be a non-negative number' });

    return { material_name, description, category: category || null, supplier_name, unit_of_measure, unit_price: price, price_updated_date: price_updated_date || null, notes: notes || null };
  });

  if (errors.length) return res.status(400).json({ errors });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of parsedRows) {
      await client.query(
        `INSERT INTO materials_catalogue
           (material_name, description, category, supplier_name, product_description, unit_of_measure, unit_price, price_updated_date, notes)
         VALUES ($1,$2,$3,$4,$2,$5,$6,$7,$8)`,
        [r.material_name, r.description, r.category, r.supplier_name, r.unit_of_measure, r.unit_price, r.price_updated_date, r.notes]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ imported: parsedRows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('importCSV:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { getCatalogue, getCatalogueSuppliers, getTemplate, createEntry, updateEntry, deleteEntry, importCSV };
