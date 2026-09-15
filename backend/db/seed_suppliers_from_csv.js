/**
 * Seed Suppliers from legacy export (2).csv
 *
 * Requirements:
 * - Batched into 100 entries per batch.
 * - Atomicity per batch (independent transaction with BEGIN/COMMIT/ROLLBACK per batch).
 * - Idempotent (checks for existing suppliers by case-insensitive name to avoid duplicates).
 * - Data enrichment: contact email/phone fallback, postcode sanitization, and structured notes.
 *
 * Usage:
 *   node db/seed_suppliers_from_csv.js
 *   npm run seed:suppliers
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const BATCH_SIZE = 100;

// RFC 4180 multiline CSV parser
function parseCSV(content) {
  const records = [];
  let currentRecord = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRecord.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') i++;
      currentRecord.push(currentField);
      records.push(currentRecord);
      currentRecord = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRecord.length) {
    currentRecord.push(currentField);
    records.push(currentRecord);
  }
  return records;
}

// Clean and format supplier notes from extra metadata fields
function formatNotes(s) {
  const parts = [];

  const contactPieces = [];
  if (s.contactName) contactPieces.push(s.contactName);
  if (s.contactEmail) contactPieces.push(s.contactEmail);
  if (s.contactPhone) contactPieces.push(s.contactPhone);

  if (contactPieces.length > 0) {
    parts.push(`Contact: ${contactPieces.join(' | ')}`);
  }

  if (s.code) {
    parts.push(`Supplier Code: ${s.code}`);
  }

  if (s.country && s.country.toLowerCase() !== 'united kingdom' && s.country.toLowerCase() !== 'uk') {
    parts.push(`Country: ${s.country}`);
  }

  if (s.additional) {
    parts.push(`Notes: ${s.additional}`);
  }

  if (s.contactAdditional) {
    parts.push(`Contact Notes: ${s.contactAdditional}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

// Sanitize postal codes (e.g. remove trailing commas or extra punctuation)
function sanitizeZip(zip) {
  if (!zip) return null;
  const cleaned = zip.trim().replace(/[,;]+$/, '').trim();
  return cleaned || null;
}

async function runSeed() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('       Construct Scenery — Supplier Seeding Tool              ');
  console.log('══════════════════════════════════════════════════════════════\n');

  const defaultCsvPath = path.join(__dirname, '../export (2).csv');
  const fallbackCsvPath = path.join(__dirname, '../../export (2).csv');
  const csvPath = process.argv[2] || (fs.existsSync(defaultCsvPath) ? defaultCsvPath : fallbackCsvPath);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  console.log(`📂 Reading CSV from: ${csvPath}`);
  const content = fs.readFileSync(csvPath, 'utf8');
  const records = parseCSV(content);

  if (records.length < 2) {
    console.error('❌ CSV contains no data rows.');
    process.exit(1);
  }

  const header = records[0];
  const colMap = {};
  header.forEach((col, idx) => { colMap[col.trim()] = idx; });

  const getCol = (row, name) => {
    const idx = colMap[name];
    return idx !== undefined && row[idx] !== undefined ? row[idx].trim() : '';
  };

  // Group and deduplicate by normalized supplier name
  const suppliersMap = new Map();

  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    const rawName = getCol(row, 'Supplier');
    if (!rawName) continue;

    const normKey = rawName.toLowerCase();
    if (!suppliersMap.has(normKey)) {
      suppliersMap.set(normKey, {
        name: rawName,
        email: getCol(row, 'SupplierEMail'),
        phone: getCol(row, 'SupplierPhone'),
        street: getCol(row, 'SupplierStreet'),
        city: getCol(row, 'SupplierCity'),
        county: getCol(row, 'SupplierState'),
        zip: getCol(row, 'SupplierZip'),
        country: getCol(row, 'SupplierCountry'),
        code: getCol(row, 'SupplierCode'),
        additional: getCol(row, 'SupplierAdditional'),
        contactName: getCol(row, 'SupplierContactName'),
        contactEmail: getCol(row, 'SupplierContactEMail'),
        contactPhone: getCol(row, 'SupplierContactPhone'),
        contactAdditional: getCol(row, 'SupplierContactAdditional'),
        occurrences: 1,
      });
    } else {
      const s = suppliersMap.get(normKey);
      s.occurrences++;

      // Enrich fields if previously blank
      if (!s.email && getCol(row, 'SupplierEMail')) s.email = getCol(row, 'SupplierEMail');
      if (!s.phone && getCol(row, 'SupplierPhone')) s.phone = getCol(row, 'SupplierPhone');
      if (!s.street && getCol(row, 'SupplierStreet')) s.street = getCol(row, 'SupplierStreet');
      if (!s.city && getCol(row, 'SupplierCity')) s.city = getCol(row, 'SupplierCity');
      if (!s.county && getCol(row, 'SupplierState')) s.county = getCol(row, 'SupplierState');
      if (!s.zip && getCol(row, 'SupplierZip')) s.zip = getCol(row, 'SupplierZip');
      if (!s.country && getCol(row, 'SupplierCountry')) s.country = getCol(row, 'SupplierCountry');
      if (!s.code && getCol(row, 'SupplierCode')) s.code = getCol(row, 'SupplierCode');
      if (!s.additional && getCol(row, 'SupplierAdditional')) s.additional = getCol(row, 'SupplierAdditional');
      if (!s.contactName && getCol(row, 'SupplierContactName')) s.contactName = getCol(row, 'SupplierContactName');
      if (!s.contactEmail && getCol(row, 'SupplierContactEMail')) s.contactEmail = getCol(row, 'SupplierContactEMail');
      if (!s.contactPhone && getCol(row, 'SupplierContactPhone')) s.contactPhone = getCol(row, 'SupplierContactPhone');
      if (!s.contactAdditional && getCol(row, 'SupplierContactAdditional')) s.contactAdditional = getCol(row, 'SupplierContactAdditional');
    }
  }

  const suppliersList = Array.from(suppliersMap.values()).map(s => {
    // Primary email with contact email fallback
    const finalEmail = s.email || s.contactEmail || null;
    // Primary phone with contact phone fallback
    const finalPhone = s.phone || s.contactPhone || null;

    return {
      name: s.name,
      email: finalEmail ? finalEmail.toLowerCase().trim() : null,
      street_name: s.street || null,
      city: s.city || null,
      county: s.county || null,
      zip_code: sanitizeZip(s.zip),
      phone: finalPhone || null,
      notes: formatNotes(s),
    };
  });

  console.log(`✅ Extracted ${suppliersList.length} unique suppliers from ${records.length - 1} PO line items.`);
  console.log(`📦 Batching strategy: ${BATCH_SIZE} entries per batch with dedicated transaction per batch.\n`);

  // Split into batches
  const batches = [];
  for (let i = 0; i < suppliersList.length; i += BATCH_SIZE) {
    batches.push(suppliersList.slice(i, i + BATCH_SIZE));
  }

  console.log(`Total batches to process: ${batches.length}\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalUpdated = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchNum = b + 1;
    console.log(`─── Processing Batch ${batchNum}/${batches.length} (${batch.length} records) ───`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let batchInserted = 0;
      let batchSkipped = 0;

      for (const item of batch) {
        // Check if supplier already exists (case-insensitive name check)
        const checkRes = await client.query(
          'SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1',
          [item.name]
        );

        if (checkRes.rows.length > 0) {
          batchSkipped++;
          continue;
        }

        // Insert new supplier
        await client.query(
          `INSERT INTO suppliers (name, email, street_name, city, county, zip_code, phone, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            item.name,
            item.email,
            item.street_name,
            item.city,
            item.county,
            item.zip_code,
            item.phone,
            item.notes,
          ]
        );
        batchInserted++;
      }

      await client.query('COMMIT');
      totalInserted += batchInserted;
      totalSkipped += batchSkipped;

      console.log(`✅ Batch ${batchNum}/${batches.length} COMMITTED: +${batchInserted} inserted, ${batchSkipped} skipped (already in DB)\n`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌ Batch ${batchNum}/${batches.length} ROLLED BACK due to error:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('                   SEEDING COMPLETE SUMMARY                    ');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`Total Unique Suppliers Processed: ${suppliersList.length}`);
  console.log(`Successfully Inserted:            ${totalInserted}`);
  console.log(`Skipped (already existing):       ${totalSkipped}`);

  const countRes = await pool.query('SELECT COUNT(*) AS total FROM suppliers');
  console.log(`Total Suppliers Now in DB:        ${countRes.rows[0].total}`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

runSeed()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal seeding error:', err);
    pool.end();
    process.exit(1);
  });
