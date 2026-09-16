const db = require('../config/db');

const selectColumns = `i.id, i.material_id, i.material_name, i.description, i.category,
  i.quantity, i.quantity_purchased, i.unit_of_measure, i.production_id, p.name AS production_name,
  i.location, i.notes, i.created_at, i.updated_at`;
const returningColumns = `id, material_id, material_name, description, category,
  quantity, quantity_purchased, unit_of_measure, production_id, location, notes,
  created_at, updated_at`;

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
    const { rowCount } = await db.query('DELETE FROM materials_inventory WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Inventory record not found' });
    res.json({ message: 'Inventory record deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getInventory, getInventorySummary, createInventory, updateInventory, restockInventory, deleteInventory };