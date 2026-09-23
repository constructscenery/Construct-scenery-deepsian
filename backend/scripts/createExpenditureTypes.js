/**
 * Creates expenditure_types table and seeds all values.
 * Run: node scripts/createExpenditureTypes.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const EXPENDITURE_TYPES = [
  { code: 'ACC', expenditure_type: 'ACCOMMODATION' },
  { code: 'CNC', expenditure_type: 'CNC' },
  { code: 'COM', expenditure_type: 'COMMERCIAL - LENOR UNSTOPPABLES' },
  { code: 'CON', expenditure_type: 'CONSUMABLES' },
  { code: 'COV', expenditure_type: 'COVID' },
  { code: 'CRA', expenditure_type: 'CRAFT' },
  { code: 'DRG', expenditure_type: 'DRAWINGS/GRAPHICS' },
  { code: 'FAB', expenditure_type: 'FABRIC/DRAPES' },
  { code: 'FIX', expenditure_type: 'FIXINGS' },
  { code: 'GAL', expenditure_type: 'GALLOWGLASS CREW' },
  { code: 'GRW', expenditure_type: 'GROUNDWORKS' },
  { code: 'HSF', expenditure_type: 'HEALTH & SAFETY' },
  { code: 'ITS', expenditure_type: 'IT' },
  { code: 'MET', expenditure_type: 'METALWORK' },
  { code: 'OTH', expenditure_type: 'OTHER DEPTS' },
  { code: 'PNT', expenditure_type: 'PAINT' },
  { code: 'PER', expenditure_type: 'PERSPEX/GLASS' },
  { code: 'PLH', expenditure_type: 'PLANT HIRE' },
  { code: 'PLA', expenditure_type: 'PLASTER WORK' },
  { code: 'PST', expenditure_type: 'POSTAGE' },
  { code: 'REP', expenditure_type: 'REPAIRS' },
  { code: 'RIG', expenditure_type: 'RIGGING' },
  { code: 'RUB', expenditure_type: 'RUBBISH DISPOSAL' },
  { code: 'SCU', expenditure_type: 'SCULPT' },
  { code: 'STA', expenditure_type: 'STATIONERY' },
  { code: 'TIM', expenditure_type: 'TIMBER' },
  { code: 'TRN', expenditure_type: 'TRANSPORT' },
  { code: 'VIN', expenditure_type: 'VINYL WRAPPING' },
];

async function run() {
  const client = await pool.connect();
  try {
    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenditure_types (
        id               SERIAL PRIMARY KEY,
        code             TEXT NOT NULL UNIQUE,
        expenditure_type TEXT NOT NULL
      )
    `);
    console.log('✓ Table expenditure_types ready');

    // Seed with upsert
    for (const row of EXPENDITURE_TYPES) {
      await client.query(
        `INSERT INTO expenditure_types (code, expenditure_type)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET expenditure_type = EXCLUDED.expenditure_type`,
        [row.code, row.expenditure_type]
      );
    }
    console.log(`✓ Seeded ${EXPENDITURE_TYPES.length} expenditure types`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
