const db = require('../config/db');

// GET /api/assets-plant
const getAssets = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM assets ORDER BY name ASC');
    res.json({ assets: rows });
  } catch (err) {
    console.error('getAssets error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/assets-plant/:id
const getAssetById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM assets WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
    res.json({ asset: rows[0] });
  } catch (err) {
    console.error('getAssetById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/assets-plant
const createAsset = async (req, res) => {
  // Accept both camelCase and snake_case
  const {
    name,
    category,
    description,
    make, model, serial_number, assignment_type,
    purchase_date, purchaseDate,
    cost,
    condition,
    assigned_to, assignedTo,
    maintenance_schedule, maintenanceSchedule,
    depreciation,
    notes,
  } = req.body;

  const resolvedPurchaseDate       = purchase_date        ?? purchaseDate;
  const resolvedAssignedTo         = assigned_to          ?? assignedTo;
  const resolvedMaintenanceSchedule = maintenance_schedule ?? maintenanceSchedule;

  if (!name) {
    return res.status(400).json({ error: 'Asset name is required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO assets (
        name, category, description, make, model, serial_number, purchase_date, cost, condition, assigned_to, assignment_type,
        maintenance_schedule, depreciation, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        name.trim(),
        category ? category.trim() : null,
        description ? description.trim() : null,
        make ? make.trim() : null,
        model ? model.trim() : null,
        serial_number ? serial_number.trim() : null,
        resolvedPurchaseDate || null,
        cost !== undefined && cost !== null ? parseFloat(cost) : null,
        condition ? condition.trim() : null,
        resolvedAssignedTo ? resolvedAssignedTo.trim() : null,
        assignment_type || 'location',
        resolvedMaintenanceSchedule ? JSON.stringify(resolvedMaintenanceSchedule) : null,
        depreciation ? JSON.stringify(depreciation) : null,
        notes ? notes.trim() : null,
      ]
    );

    res.status(201).json({ message: 'Asset created successfully', asset: rows[0] });
  } catch (err) {
    console.error('createAsset error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/assets-plant/:id
const updateAsset = async (req, res) => {
  const { id } = req.params;
  // Accept both camelCase and snake_case
  const {
    name,
    category,
    description,
    make, model, serial_number, assignment_type,
    purchase_date, purchaseDate,
    cost,
    condition,
    assigned_to, assignedTo,
    maintenance_schedule, maintenanceSchedule,
    depreciation,
    notes,
  } = req.body;

  const resolvedPurchaseDate        = purchase_date        !== undefined ? purchase_date        : purchaseDate;
  const resolvedAssignedTo          = assigned_to          !== undefined ? assigned_to          : assignedTo;
  const resolvedMaintenanceSchedule = maintenance_schedule !== undefined ? maintenance_schedule : maintenanceSchedule;

  try {
    const { rows } = await db.query(
      `UPDATE assets SET
        name = COALESCE($1, name),
        category = $2,
        description = $3,
        make = $4,
        model = $5,
        serial_number = $6,
        purchase_date = $7,
        cost = $8,
        condition = $9,
        assigned_to = $10,
        assignment_type = $11,
        maintenance_schedule = $12,
        depreciation = $13,
        notes = $14,
        updated_at = NOW()
      WHERE id = $15
      RETURNING *`,
      [
        name?.trim(),
        category !== undefined ? category : undefined,
        description !== undefined ? description : undefined,
        make !== undefined ? make : undefined,
        model !== undefined ? model : undefined,
        serial_number !== undefined ? serial_number : undefined,
        resolvedPurchaseDate !== undefined ? resolvedPurchaseDate : undefined,
        cost !== undefined ? (cost !== null ? parseFloat(cost) : null) : undefined,
        condition !== undefined ? condition : undefined,
        resolvedAssignedTo !== undefined ? resolvedAssignedTo : undefined,
        assignment_type !== undefined ? assignment_type : undefined,
        resolvedMaintenanceSchedule !== undefined ? (resolvedMaintenanceSchedule ? JSON.stringify(resolvedMaintenanceSchedule) : null) : undefined,
        depreciation !== undefined ? (depreciation ? JSON.stringify(depreciation) : null) : undefined,
        notes !== undefined ? notes : undefined,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: 'Asset updated successfully', asset: rows[0] });
  } catch (err) {
    console.error('updateAsset error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/assets-plant/:id
const deleteAsset = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM assets WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: 'Asset deleted successfully' });
  } catch (err) {
    console.error('deleteAsset error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAssets,
  getAssetById,
  createAsset,
  updateAsset,
  deleteAsset,
};
