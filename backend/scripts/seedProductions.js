require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

function parseCsv(content) {
  const lines = content.trim().split('\n').filter(l => l.trim().length > 0);
  const rows = [];
  for (let line of lines) {
    const cols = [];
    let curr = '';
    let inQuotes = false;
    for (let c of line) {
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        cols.push(curr.trim());
        curr = '';
      } else {
        curr += c;
      }
    }
    cols.push(curr.trim());
    rows.push(cols);
  }
  return rows;
}

function parseUKDate(dStr) {
  if (!dStr) return null;
  const parts = dStr.trim().split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function mapContractType(val) {
  const norm = (val || '').toLowerCase().trim();
  if (norm === 'cost plus' || norm === 'cost_plus') return 'cost_plus';
  return 'on_a_price';
}

function mapStatus(val) {
  const norm = (val || '').toLowerCase().trim();
  if (norm === 'ongoing' || norm === 'active build' || norm === 'active_build') return 'active_build';
  if (norm === 'complete') return 'complete';
  if (norm === 'pre-production' || norm === 'pre_production') return 'pre_production';
  return 'complete';
}

async function run() {
  const csvPath = path.resolve(__dirname, '../../Productions.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('Productions.csv not found at:', csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  const headers = rows[0].map(h => h.trim());
  console.log('CSV Headers:', headers);

  let inserted = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = r[0];
    const code = r[1];
    const company = r[2] || null;
    const designer = r[3] || null;
    const type = r[7] || null;
    const status = mapStatus(r[8]);
    const startDate = parseUKDate(r[9]);
    const endDate = parseUKDate(r[10]);
    const contractType = mapContractType(r[11]);

    const res = await db.query(
      `INSERT INTO productions (
        name, production_code, production_company, production_designer,
        production_type, status, start_date, end_date, contract_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, production_code, name, status, contract_type`,
      [name, code, company, designer, type, status, startDate, endDate, contractType]
    );

    inserted++;
    console.log(`[${inserted}/28] Seeded: [${res.rows[0].production_code}] ${res.rows[0].name} (${res.rows[0].status})`);
  }

  console.log(`\n✅ Successfully seeded all ${inserted} productions from Productions.csv!`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error seeding productions:', err);
  process.exit(1);
});
