const db = require('../config/db');
const fileStorage = require('../services/fileStorage');

const selectColumns = `i.id, i.material_id, i.material_name, i.description, i.category,
  i.quantity, i.quantity_purchased, i.unit_of_measure, i.production_id, p.name AS production_name,
  i.location, i.notes, (i.photo_key IS NOT NULL) AS has_photo, i.created_at, i.updated_at`;
const returningColumns = `id, material_id, material_name, description, category,
  quantity, quantity_purchased, unit_of_measure, production_id, location, notes,
  (photo_key IS NOT NULL) AS has_photo, created_at, updated_at`;
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];

const getInventory = async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${selectColumns}
      FROM materials_inventory i
      LEFT JOIN productions p ON p.id = i.production_id
      ORDER BY i.material_name, i.location
    `);
    res.json(rows);
  } catch (err) {
    console.error('getInventory:', err);
    res.status(500).json({ error: err.message });
  }
};

const getInventorySummary = async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT i.material_id, i.material_name, i.unit_of_measure,
             i.production_id, p.name AS production_name,
             SUM(i.quantity_purchased) AS total_bought,
             SUM(i.quantity) AS remaining_stock
      FROM materials_inventory i
      LEFT JOIN productions p ON p.id = i.production_id
      GROUP BY i.material_id, i.material_name, i.unit_of_measure, i.production_id, p.name
      ORDER BY i.material_name, p.name NULLS FIRST
    `);
    res.json(rows);
  } catch (err) {
    console.error('getInventorySummary:', err);
    res.status(500).json({ error: err.message });
  }
};

const saveInventory = async (req, res, isUpdate) => {
  const { material_id, quantity, production_id, location, notes } = req.body;
  const numericQuantity = Number(quantity);
  if (!material_id || quantity === undefined || quantity === null || quantity === '' || !Number.isFinite(numericQuantity) || numericQuantity < 0) {
    return res.status(400).json({ error: 'material_id and a non-negative quantity are required' });
  }
  try {
    const { rows: [material] } = await db.query(`
      SELECT material_name, description, category, unit_of_measure
      FROM materials_catalogue WHERE id = $1 AND deleted_at IS NULL
    `, [material_id]);
    if (!material) return res.status(404).json({ error: 'Catalogue material not found' });
    if (production_id) {
      const { rows: [production] } = await db.query('SELECT id FROM productions WHERE id = $1', [production_id]);
      if (!production) return res.status(400).json({ error: 'Production not found' });
    }

    const values = [material_id, material.material_name, material.description, material.category, numericQuantity, material.unit_of_measure, production_id || null, location?.trim() || null, notes?.trim() || null];
    const query = isUpdate
      ? `UPDATE materials_inventory SET material_id=$1, material_name=$2, description=$3, category=$4, quantity=$5, unit_of_measure=$6, production_id=$7, location=$8, notes=$9, updated_at=NOW() WHERE id=$10 RETURNING ${returningColumns}`
      : `INSERT INTO materials_inventory (material_id, material_name, description, category, quantity, quantity_purchased, unit_of_measure, production_id, location, notes) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9) RETURNING ${returningColumns}`;
    const params = isUpdate ? [...values, req.params.id] : values;
    const { rows } = await db.query(`
      ${query}
    `, params);
    if (!rows.length) return res.status(404).json({ error: 'Inventory record not found' });
    res.status(isUpdate ? 200 : 201).json(rows[0]);
  } catch (err) {
    console.error(isUpdate ? 'updateInventory:' : 'createInventory:', err);
    res.status(500).json({ error: err.message });
  }
};

const restockInventory = async (req, res) => {
  const quantity = Number(req.body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Restock quantity must be greater than zero' });
  }
  try {
    const { rows } = await db.query(`
      UPDATE materials_inventory
      SET quantity = quantity + $1,
          quantity_purchased = quantity_purchased + $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING ${returningColumns}
    `, [quantity, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Inventory record not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('restockInventory:', err);
    res.status(500).json({ error: err.message });
  }
};

const createInventory = (req, res) => saveInventory(req, res, false);
const updateInventory = (req, res) => saveInventory(req, res, true);
const deleteInventory = async (req, res) => {
  try {
    const { rows: [deleted] } = await db.query('DELETE FROM materials_inventory WHERE id = $1 RETURNING photo_key', [req.params.id]);
    if (!deleted) return res.status(404).json({ error: 'Inventory record not found' });
    if (deleted.photo_key) await fileStorage.deleteFile(deleted.photo_key);
    res.json({ message: 'Inventory record deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/materials-inventory/:id/photo (one photo per stock item; replaces any existing)
const uploadInventoryPhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo first' });
  if (!PHOTO_MIME_TYPES.includes(req.file.mimetype)) return res.status(400).json({ error: 'Photo must be a JPEG or PNG image' });
  let stored;
  try {
    fileStorage.validate(req.file.mimetype, req.file.size);
    const { rows: [existing] } = await db.query('SELECT photo_key FROM materials_inventory WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Inventory record not found' });
    stored = await fileStorage.store(req.file);
    const { rows: [updated] } = await db.query(
      `UPDATE materials_inventory SET photo_key = $1, photo_name = $2, photo_mime_type = $3, updated_at = NOW()
       WHERE id = $4 RETURNING ${returningColumns}`,
      [stored.key, req.file.originalname, req.file.mimetype, req.params.id]
    );
    if (!updated) {
      await fileStorage.deleteFile(stored.key);
      return res.status(404).json({ error: 'Inventory record not found' });
    }
    if (existing.photo_key) await fileStorage.deleteFile(existing.photo_key);
    res.json(updated);
  } catch (err) {
    console.error('uploadInventoryPhoto:', err);
    if (stored) await fileStorage.deleteFile(stored.key);
    res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'Unable to upload photo' });
  }
};

// ─── GET /api/materials-inventory/:id/photo ─────────────────────────────────────
const viewInventoryPhoto = async (req, res) => {
  try {
    const { rows: [item] } = await db.query('SELECT photo_key, photo_name, photo_mime_type FROM materials_inventory WHERE id = $1', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Inventory record not found' });
    if (!item.photo_key) return res.status(404).json({ error: 'No photo attached' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await fileStorage.streamToResponse(item.photo_key, res, item.photo_name, item.photo_mime_type);
  } catch (err) {
    console.error('viewInventoryPhoto:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Unable to open photo' });
  }
};

// ─── DELETE /api/materials-inventory/:id/photo ────────────────────────────────
const deleteInventoryPhoto = async (req, res) => {
  try {
    const { rows: [item] } = await db.query('SELECT photo_key FROM materials_inventory WHERE id = $1', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Inventory record not found' });
    if (!item.photo_key) return res.status(404).json({ error: 'No photo attached' });
    const { rows: [updated] } = await db.query(
      `UPDATE materials_inventory SET photo_key = NULL, photo_name = NULL, photo_mime_type = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING ${returningColumns}`,
      [req.params.id]
    );
    await fileStorage.deleteFile(item.photo_key);
    res.json(updated);
  } catch (err) {
    console.error('deleteInventoryPhoto:', err);
    res.status(500).json({ error: 'Unable to remove photo' });
  }
};

module.exports = { getInventory, getInventorySummary, createInventory, updateInventory, restockInventory, deleteInventory, uploadInventoryPhoto, viewInventoryPhoto, deleteInventoryPhoto };