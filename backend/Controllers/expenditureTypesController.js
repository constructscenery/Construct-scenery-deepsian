const db = require('../config/db');

// GET /api/expenditure-types — return all codes and types
const listExpenditureTypes = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT code, expenditure_type FROM expenditure_types ORDER BY code ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('listExpenditureTypes:', err);
    res.status(500).json({ error: 'Failed to fetch expenditure types' });
  }
};

module.exports = { listExpenditureTypes };
