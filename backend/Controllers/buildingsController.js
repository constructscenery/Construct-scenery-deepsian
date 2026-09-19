const db = require('../config/db');

// GET /api/buildings
const getBuildings = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM buildings ORDER BY name ASC');
    res.json({ buildings: rows });
  } catch (err) {
    console.error('getBuildings error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/buildings/:id
const getBuildingById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM buildings WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Building not found' });
    res.json({ building: rows[0] });
  } catch (err) {
    console.error('getBuildingById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/buildings
const createBuilding = async (req, res) => {
  // Accept both camelCase and snake_case from the request body
  const {
    name,
    address,
    ownership_status, ownershipStatus,
    lease_expiry, leaseExpiry,
    landlord_contact, landlordContact,
    access_code, accessCode,
    utilities,
    insurance_policies, insurancePolicies,
    notes,
  } = req.body;

  const resolvedOwnershipStatus = ownership_status ?? ownershipStatus;
  const resolvedLeaseExpiry     = lease_expiry     ?? leaseExpiry;
  const resolvedLandlordContact = landlord_contact ?? landlordContact;
  const resolvedAccessCode      = access_code      ?? accessCode;
  const resolvedInsurance       = insurance_policies ?? insurancePolicies;

  if (!name) {
    return res.status(400).json({ error: 'Building name is required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO buildings (
        name, address, ownership_status, lease_expiry, landlord_contact,
        access_code, utilities, insurance_policies, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        name.trim(),
        address ? address.trim() : null,
        resolvedOwnershipStatus ? resolvedOwnershipStatus.trim() : null,
        resolvedLeaseExpiry || null,
        resolvedLandlordContact ? resolvedLandlordContact.trim() : null,
        resolvedAccessCode ? resolvedAccessCode.trim() : null,
        utilities ? JSON.stringify(utilities) : null,
        resolvedInsurance ? JSON.stringify(resolvedInsurance) : null,
        notes ? notes.trim() : null,
      ]
    );

    res.status(201).json({ message: 'Building created successfully', building: rows[0] });
  } catch (err) {
    console.error('createBuilding error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/buildings/:id
const updateBuilding = async (req, res) => {
  const { id } = req.params;
  // Accept both camelCase and snake_case
  const {
    name,
    address,
    ownership_status, ownershipStatus,
    lease_expiry, leaseExpiry,
    landlord_contact, landlordContact,
    access_code, accessCode,
    utilities,
    insurance_policies, insurancePolicies,
    notes,
  } = req.body;

  const resolvedOwnershipStatus = ownership_status !== undefined ? ownership_status : ownershipStatus;
  const resolvedLeaseExpiry     = lease_expiry     !== undefined ? lease_expiry     : leaseExpiry;
  const resolvedLandlordContact = landlord_contact !== undefined ? landlord_contact : landlordContact;
  const resolvedAccessCode      = access_code      !== undefined ? access_code      : accessCode;
  const resolvedInsurance       = insurance_policies !== undefined ? insurance_policies : insurancePolicies;

  try {
    const { rows } = await db.query(
      `UPDATE buildings SET
        name = COALESCE($1, name),
        address = $2,
        ownership_status = $3,
        lease_expiry = $4,
        landlord_contact = $5,
        access_code = $6,
        utilities = $7,
        insurance_policies = $8,
        notes = $9,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *`,
      [
        name?.trim(),
        address !== undefined ? address : undefined,
        resolvedOwnershipStatus !== undefined ? resolvedOwnershipStatus : undefined,
        resolvedLeaseExpiry !== undefined ? resolvedLeaseExpiry : undefined,
        resolvedLandlordContact !== undefined ? resolvedLandlordContact : undefined,
        resolvedAccessCode !== undefined ? resolvedAccessCode : undefined,
        utilities !== undefined ? (utilities ? JSON.stringify(utilities) : null) : undefined,
        resolvedInsurance !== undefined ? (resolvedInsurance ? JSON.stringify(resolvedInsurance) : null) : undefined,
        notes !== undefined ? notes : undefined,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Building not found' });
    res.json({ message: 'Building updated successfully', building: rows[0] });
  } catch (err) {
    console.error('updateBuilding error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/buildings/:id
const deleteBuilding = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM buildings WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Building not found' });
    res.json({ message: 'Building deleted successfully' });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Delete attached documents before deleting this building' });
    console.error('deleteBuilding error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getBuildings,
  getBuildingById,
  createBuilding,
  updateBuilding,
  deleteBuilding,
};
