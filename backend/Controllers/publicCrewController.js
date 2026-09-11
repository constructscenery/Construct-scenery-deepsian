const db = require('../config/db');
const { encrypt } = require('../config/crypto');

// ─── Trade / rank reference data ──────────────────────────────────────────────
const BECTU_TRADES = {
  Carpenters:          ['HOD', 'Supervisor', 'Chargehand', 'Carpenter'],
  Machinists:          ['HOD', 'Supervisor', 'Chargehand', 'Machinist'],
  Stagehands:          ['HOD', 'Supervisor', 'Chargehand', 'Stagehand NVQ/BLSS', 'Stagehand'],
  Riggers:             ['HOD', 'Supervisor', 'Chargehand', 'Rigger'],
  Plasterers:          ['HOD', 'Supervisor', 'Chargehand', 'Plasterer'],
  'Scenic Painters':   ['HOD', 'Supervisor', 'Chargehand', 'Painter'],
  Sculptors:           ['HOD', 'Supervisor', 'Chargehand', 'Sculptor', 'Sculptor Modeller'],
  'Metal Workers':     ['HOD', 'Supervisor', 'Chargehand', 'Metal Worker'],
  'Plasterers Lab':    ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker'],
  'Painters Lab':      ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker'],
  'Sculptors Lab':     ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker'],
  'Metal Workers Lab': ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker'],
};

const NON_BECTU_ROLES = [
  'Construction Accountant', 'Construction Coordinator', 'Construction Manager', 'Luton Driver',
];

// Helper to ensure table exists in database
let tableEnsured = false;
async function ensureRequestsTable() {
  if (tableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS crew_registration_requests (
        id                              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        status                          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        first_name                      TEXT NOT NULL,
        last_name                       TEXT NOT NULL,
        date_of_birth                   DATE,
        home_address                    TEXT,
        email                           TEXT NOT NULL,
        phone                           TEXT,
        employment_status               TEXT NOT NULL CHECK (employment_status IN ('paye', 'self_employed')),
        crew_trade                      TEXT NOT NULL,
        company_name                    TEXT,
        company_registration_number     TEXT,
        vat_registration_number         TEXT,
        company_utr                     TEXT,
        account_name                    TEXT,
        account_number                  TEXT,
        sort_code                       TEXT,
        emergency_contact_name          TEXT,
        emergency_contact_relationship  TEXT,
        emergency_contact_phone         TEXT,
        qualifications                  TEXT[] DEFAULT '{}',
        notes                           TEXT,
        reviewed_by                     UUID REFERENCES users(id),
        reviewed_at                     TIMESTAMPTZ,
        rejection_reason                TEXT,
        created_crew_member_id          UUID REFERENCES crew_members(id),
        created_at                      TIMESTAMPTZ DEFAULT NOW(),
        updated_at                      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    tableEnsured = true;
  } catch (err) {
    console.warn('ensureRequestsTable error:', err.message);
  }
}

// ─── GET /api/public/crew/trades ──────────────────────────────────────────────
const getTrades = (req, res) => {
  res.json({ bectu: BECTU_TRADES, non_bectu: NON_BECTU_ROLES });
};

// ─── POST /api/public/crew/register ───────────────────────────────────────────
const registerCrew = async (req, res) => {
  await ensureRequestsTable();

  const {
    first_name,
    last_name,
    date_of_birth,
    home_address,
    email,
    phone,
    employment_status,
    crew_trade,
    company_name,
    company_registration_number,
    vat_registration_number,
    company_utr,
    account_name,
    account_number,
    sort_code,
    emergency_contact_name,
    emergency_contact_relationship,
    emergency_contact_phone,
    qualifications,
    notes,
  } = req.body;

  // Validate required candidate fields
  if (!first_name || !last_name || !email || !employment_status || !crew_trade) {
    return res.status(400).json({
      error: 'First name, last name, email, employment status, and trade are required.',
    });
  }

  if (!['paye', 'self_employed'].includes(employment_status)) {
    return res.status(400).json({
      error: 'Employment status must be either PAYE or Self-Employed.',
    });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO crew_registration_requests
         (first_name, last_name, date_of_birth, home_address, email, phone,
          employment_status, crew_trade,
          company_name, company_registration_number, vat_registration_number, company_utr,
          account_name, account_number, sort_code,
          emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
          qualifications, notes, status)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'pending')
       RETURNING id, first_name, last_name, email, status, created_at`,
      [
        first_name.trim(),
        last_name.trim(),
        date_of_birth || null,
        encrypt(home_address?.trim()) || null,
        email.trim().toLowerCase(),
        phone?.trim() || null,
        employment_status,
        crew_trade.trim(),
        company_name?.trim() || null,
        company_registration_number?.trim() || null,
        vat_registration_number?.trim() || null,
        company_utr?.trim() || null,
        encrypt(account_name?.trim()) || null,
        encrypt(account_number?.trim()) || null,
        encrypt(sort_code?.trim()) || null,
        emergency_contact_name?.trim() || null,
        emergency_contact_relationship?.trim() || null,
        encrypt(emergency_contact_phone?.trim()) || null,
        Array.isArray(qualifications) ? qualifications : [],
        notes?.trim() || null,
      ]
    );

    res.status(201).json({
      message: 'Registration submitted successfully. It has been queued for Construct Scenery review.',
      id: rows[0].id,
    });
  } catch (err) {
    console.error('registerCrew error:', err);
    res.status(500).json({ error: 'Failed to submit crew registration. Please try again later.' });
  }
};

module.exports = {
  getTrades,
  registerCrew,
  BECTU_TRADES,
  NON_BECTU_ROLES,
  ensureRequestsTable,
};
