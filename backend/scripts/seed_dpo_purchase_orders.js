/**
 * Seed Finalized Purchase Orders from "Import DPO.csv"
 * 
 * Rules:
 * 1. Fixed 20% VAT: vat = round(net * 0.20, 2), gross = net + vat.
 * 2. Finalized PO selection: group by (Production code, PurchaseOrderNumber),
 *    sort by creation date & file row index, taking the latest/last row.
 * 3. Match suppliers from DB to enrich email, address, and supplier_id.
 *    Auto-create any missing suppliers in the suppliers table.
 * 4. Match expenditure types. If not present, auto-add to expenditure_types.
 * 5. Link production_id by production_code.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

// CSV parser supporting quoted newlines and escaped quotes
function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      cur.push(field);
      field = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field);
      field = '';
      if (cur.length > 1 || (cur.length === 1 && cur[0] !== '')) {
        rows.push(cur);
      }
      cur = [];
    } else {
      field += c;
    }
  }
  if (field || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

// Convert "DD/MM/YYYY" to Date timestamp
function parseDateDDMMYYYY(str) {
  if (!str) return 0;
  const parts = str.trim().split('/').map(Number);
  if (parts.length === 3) {
    return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
  }
  return 0;
}

// Convert "DD/MM/YYYY" to "YYYY-MM-DD"
function formatToISO(str) {
  if (!str) return new Date().toISOString().split('T')[0];
  const parts = str.trim().split('/');
  if (parts.length === 3) {
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }
  return new Date().toISOString().split('T')[0];
}

async function runSeed() {
  const client = await pool.connect();

  try {
    console.log('🚀 Starting DPO Purchase Orders Seeding...');

    const csvPath = path.join(__dirname, '../../Import DPO.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found at: ${csvPath}`);
    }

    const rawCSV = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(rawCSV);
    const headers = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1);

    console.log(`📄 Total raw rows in CSV: ${dataRows.length}`);

    const prodCodeIdx = headers.indexOf('Production code');
    const poNumIdx = headers.indexOf('PurchaseOrderNumber');
    const supplierIdx = headers.indexOf('Supplier');
    const netIdx = headers.indexOf('NetPrice');
    const dateIdx = headers.indexOf('CreatedDate');
    const descIdx = headers.indexOf('Description');
    const expIdx = headers.indexOf('ItemExpenditure');

    if (prodCodeIdx === -1 || poNumIdx === -1 || supplierIdx === -1) {
      throw new Error('Required headers missing in CSV');
    }

    // 1. Group by `${prodCode}_${poNum}` to find the finalized version
    const poGroups = new Map();
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const prodCode = r[prodCodeIdx]?.trim();
      const poNum = r[poNumIdx]?.trim();
      if (!prodCode || !poNum) continue;

      const key = `${prodCode}_${poNum}`;
      if (!poGroups.has(key)) {
        poGroups.set(key, []);
      }
      poGroups.get(key).push({
        rowIndex: i,
        dateMs: parseDateDDMMYYYY(r[dateIdx]),
        row: r
      });
    }

    console.log(`📦 Grouped into ${poGroups.size} unique POs.`);

    // Pick the finalized version: sort by dateMs ASC, then rowIndex ASC; take the last item
    const finalizedPOs = [];
    let amendedCount = 0;

    for (const [key, versions] of poGroups.entries()) {
      if (versions.length > 1) {
        amendedCount++;
        // Sort chronologically and by original file order
        versions.sort((a, b) => {
          if (a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
          return a.rowIndex - b.rowIndex;
        });
      }
      const finalVersion = versions[versions.length - 1];
      finalizedPOs.push(finalVersion.row);
    }

    console.log(`✨ Finalized POs selected: ${finalizedPOs.length} (deduplicated from ${amendedCount} amended sets)`);

    // 2. Fetch Productions from DB
    const prodRes = await client.query('SELECT id, production_code, name FROM productions');
    const prodMap = new Map();
    for (const p of prodRes.rows) {
      if (p.production_code) {
        prodMap.set(String(p.production_code).trim(), p.id);
      }
    }
    console.log(`🎬 Loaded ${prodMap.size} productions from DB.`);

    // 3. Fetch & Update Expenditure Types
    const expRes = await client.query('SELECT id, code, expenditure_type FROM expenditure_types');
    const expMap = new Map();
    const existingCodes = new Set();
    for (const e of expRes.rows) {
      expMap.set(e.expenditure_type.trim().toUpperCase(), e.code.trim().toUpperCase());
      existingCodes.add(e.code.trim().toUpperCase());
    }

    // Check for any missing expenditure types and add them
    for (const r of finalizedPOs) {
      const expName = r[expIdx]?.trim().toUpperCase();
      if (expName && !expMap.has(expName)) {
        // Generate a 3-letter code
        let code = expName.replace(/[^A-Z]/g, '').slice(0, 3);
        if (!code || existingCodes.has(code)) {
          let suffix = 1;
          while (existingCodes.has(`${code.slice(0, 2)}${suffix}`)) {
            suffix++;
          }
          code = `${code.slice(0, 2)}${suffix}`;
        }
        console.log(`➕ Adding new expenditure type: "${expName}" with code "${code}"`);
        const insRes = await client.query(
          'INSERT INTO expenditure_types (code, expenditure_type) VALUES ($1, $2) RETURNING code',
          [code, expName]
        );
        expMap.set(expName, insRes.rows[0].code);
        existingCodes.add(code);
      }
    }

    // 4. Fetch & Manage Suppliers
    const supRes = await client.query('SELECT id, name, email, street_name, city, county, zip_code FROM suppliers');
    const supplierMap = new Map();
    for (const s of supRes.rows) {
      supplierMap.set(s.name.trim().toLowerCase(), s);
    }

    // Alias map for slight discrepancies
    const supplierAliases = {
      'power tool centre/spare part world': 'power tool centre',
      'j group': 'j group glazing group ltd',
      'cobweb rigg': 'cobweb rigging ltd'
    };

    // Auto-create any missing suppliers
    let createdSuppliersCount = 0;
    for (const r of finalizedPOs) {
      const sName = r[supplierIdx]?.trim();
      if (!sName) continue;
      const lower = sName.toLowerCase();
      const targetName = supplierAliases[lower] || lower;

      if (!supplierMap.has(targetName)) {
        console.log(`🏢 Adding missing supplier to DB: "${sName}"`);
        const insSup = await client.query(
          'INSERT INTO suppliers (name, category) VALUES ($1, $2) RETURNING id, name, email, street_name, city, county, zip_code',
          [sName, 'Other']
        );
        const newSup = insSup.rows[0];
        supplierMap.set(lower, newSup);
        createdSuppliersCount++;
      }
    }
    console.log(`🤝 Total suppliers in lookup: ${supplierMap.size} (auto-created ${createdSuppliersCount})`);

    // 5. Begin Seeding Purchase Orders in Transaction
    await client.query('BEGIN');

    // Remove any previously seeded dummy/test POs if desired, or verify count
    const existingCountRes = await client.query('SELECT COUNT(*) FROM purchase_orders');
    console.log(`Current PO count in DB: ${existingCountRes.rows[0].count}`);

    let insertedCount = 0;
    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;

    const batchSize = 100;
    for (let i = 0; i < finalizedPOs.length; i += batchSize) {
      const batch = finalizedPOs.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const r of batch) {
        const prodCode = r[prodCodeIdx]?.trim();
        const poNum = r[poNumIdx]?.trim();
        const prodId = prodMap.get(prodCode);

        if (!prodId) {
          throw new Error(`Production code "${prodCode}" not found in DB!`);
        }

        const formattedPoNumber = `PO-${prodCode}-${poNum.padStart(4, '0')}`;
        const netStr = (r[netIdx] || '0').replace(/,/g, '').trim();
        const net = Math.max(0, parseFloat(netStr) || 0);
        const vat = Number((net * 0.20).toFixed(2));
        const gross = Number((net + vat).toFixed(2));

        totalNet += net;
        totalVat += vat;
        totalGross += gross;

        const dateOfPo = formatToISO(r[dateIdx]);
        const rawDesc = (r[descIdx] || '').trim();
        const cleanDesc = rawDesc.replace(/\s*\|\s*/g, '\n');
        const title = rawDesc.split('|')[0].trim().slice(0, 100) || 'Purchase Order';

        const expName = r[expIdx]?.trim().toUpperCase();
        const accountCode = expMap.get(expName) || null;

        const sName = r[supplierIdx]?.trim();
        const lower = sName.toLowerCase();
        const targetKey = supplierAliases[lower] || lower;
        const sup = supplierMap.get(targetKey);

        const supplierId = sup?.id || null;
        const supplierName = sup?.name || sName;
        const supplierEmail = sup?.email || null;
        const streetName = sup?.street_name || null;
        const city = sup?.city || null;
        const county = sup?.county || null;
        const zipCode = sup?.zip_code || null;
        const supplierAddress = [streetName, city, county, zipCode].filter(Boolean).join(', ') || null;

        const rowPlaceholders = [];
        for (let p = 0; p < 19; p++) {
          rowPlaceholders.push(`$${paramIdx++}`);
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`);

        values.push(
          formattedPoNumber,
          prodId,
          supplierId,
          supplierName,
          supplierEmail,
          supplierAddress,
          streetName,
          city,
          county,
          zipCode,
          dateOfPo,
          accountCode,
          title,
          cleanDesc,
          net,
          vat,
          gross,
          'supplier_account',
          'approved'
        );
      }

      const queryText = `
        INSERT INTO purchase_orders (
          po_number,
          production_id,
          supplier_id,
          supplier_name,
          supplier_email,
          supplier_address,
          street_name,
          city,
          county,
          zip_code,
          date_of_po,
          account_code,
          title,
          description,
          net_amount,
          vat,
          gross_amount,
          paid_from,
          status
        ) VALUES ${placeholders.join(', ')}
      `;

      await client.query(queryText, values);
      insertedCount += batch.length;
      process.stdout.write(`\r💾 Inserted ${insertedCount} / ${finalizedPOs.length} purchase orders...`);
    }

    await client.query('COMMIT');
    console.log('\n\n✅ Transaction committed successfully!');

    // Validation checks
    const countCheck = await client.query('SELECT COUNT(*) FROM purchase_orders');
    const vatCheck = await client.query('SELECT COUNT(*) FROM purchase_orders WHERE vat != ROUND(net_amount * 0.20, 2)');
    const emailCheck = await client.query('SELECT COUNT(*) FROM purchase_orders WHERE supplier_email IS NOT NULL');
    const addrCheck = await client.query('SELECT COUNT(*) FROM purchase_orders WHERE supplier_address IS NOT NULL');

    console.log('\n================ SEEDING SUMMARY ================');
    console.log(`Total Finalized POs Seeded:   ${countCheck.rows[0].count}`);
    console.log(`POs with 20% VAT Verified:   ${countCheck.rows[0].count - vatCheck.rows[0].count} / ${countCheck.rows[0].count}`);
    console.log(`POs with Supplier Email:      ${emailCheck.rows[0].count}`);
    console.log(`POs with Supplier Address:    ${addrCheck.rows[0].count}`);
    console.log(`Total Net Amount:             £${totalNet.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Total VAT (20%):              £${totalVat.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Total Gross Amount:           £${totalGross.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('=================================================\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding purchase orders:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed().catch(() => process.exit(1));
