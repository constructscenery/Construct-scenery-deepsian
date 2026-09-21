/**
 * DataSyncService — Automated & On-demand Excel Export & AWS S3 Sync
 * Generates individual clean Excel workbooks (e.g. Backup_Suppliers.xlsx,
 * Backup_Productions.xlsx, Backup_Crew.xlsx) stored within versioned S3 folders
 * (e.g. backups/version_YYYY-MM-DD_HH-mm/), plus a master Backup_All_Data.xlsx workbook.
 * Every sheet displays ACTUAL records immediately with styled headers.
 */

require('dotenv').config();
const ExcelJS = require('exceljs');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const db = require('../config/db');
const { decrypt } = require('../config/crypto');

const BUCKET = process.env.AWS_S3_BUCKET || 'deepsiant-assets-prod';
const REGION = process.env.AWS_REGION || 'eu-north-1';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Format raw cell values for Excel
 */
function formatCellValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return val;
}

/**
 * Configure and style a worksheet with headers, autofit widths, and frozen header row
 */
function populateWorksheet(worksheet, rows, sheetTitle) {
  if (!rows || rows.length === 0) {
    worksheet.columns = [{ header: 'NOTE', key: 'note', width: 35 }];
    const hRow = worksheet.getRow(1);
    hRow.height = 24;
    hRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    worksheet.addRow({ note: `No records found in database for ${sheetTitle}` });
    return;
  }

  const keys = Object.keys(rows[0]);
  
  // Define columns
  worksheet.columns = keys.map(key => ({
    header: key.replace(/_/g, ' ').toUpperCase(),
    key: key,
    width: Math.max(14, Math.min(45, key.length + 4)),
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.height = 25;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate-900
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add actual data rows
  for (const row of rows) {
    const formattedRow = {};
    for (const k of keys) {
      formattedRow[k] = formatCellValue(row[k]);
    }
    worksheet.addRow(formattedRow);
  }

  // Freeze top row for easy scrolling
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Auto-adjust column widths based on actual data
  worksheet.columns.forEach(column => {
    let maxLength = column.header ? column.header.length : 10;
    const sampleRows = rows.slice(0, 60);
    sampleRows.forEach(r => {
      const v = r[column.key];
      const len = v !== null && v !== undefined ? String(v).length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.min(50, Math.max(12, maxLength + 3));
  });
}

/**
 * Build a standalone single-table workbook
 */
async function buildSingleWorkbook(sheetTitle, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CS HQ Database Sync';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetTitle);
  populateWorksheet(ws, rows, sheetTitle);
  return await wb.xlsx.writeBuffer();
}

/**
 * Execute a complete database export and sync to AWS S3
 * Creates versioned directory backups/version_YYYY-MM-DD_HH-mm/ containing:
 * - Backup_Suppliers.xlsx
 * - Backup_Productions.xlsx
 * - Backup_Crew.xlsx
 * - ...
 * - Backup_All_Data.xlsx
 */
async function executeDataSync({
  triggeredByType = 'MANUAL',
  userId = null,
  userName = null,
} = {}) {
  const startTime = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${startTime.getUTCFullYear()}-${pad(startTime.getUTCMonth() + 1)}-${pad(startTime.getUTCDate())}_${pad(startTime.getUTCHours())}-${pad(startTime.getUTCMinutes())}`;
  
  const versionFolderName = `version_${dateStr}`;
  const s3Prefix = `backups/${versionFolderName}`;
  const masterFilename = 'Backup_All_Data.xlsx';
  const masterS3Key = `${s3Prefix}/${masterFilename}`;
  const masterS3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${masterS3Key}`;

  console.log(`[DATA-SYNC] Starting sync to ${s3Prefix} triggered by ${triggeredByType} (${userName || 'System'})...`);

  let syncRecordId = null;

  try {
    const initRes = await db.query(
      `INSERT INTO data_sync_history 
        (filename, s3_key, s3_url, status, triggered_by_type, triggered_by_user_id, triggered_by_user_name, created_at)
       VALUES ($1, $2, $3, 'IN_PROGRESS', $4, $5, $6, $7)
       RETURNING id`,
      [versionFolderName, s3Prefix, masterS3Url, triggeredByType, userId, userName, startTime]
    );
    syncRecordId = initRes.rows[0].id;
  } catch (err) {
    console.warn('[DATA-SYNC] Could not insert initial sync record:', err.message);
  }

  try {
    // List of all database tables to export
    const dataQueries = [
      {
        sheetName: 'Productions',
        fileBaseName: 'Productions',
        query: `SELECT * FROM productions ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Sets',
        fileBaseName: 'Sets',
        query: `SELECT s.*, p.name AS production_name 
                FROM sets s 
                LEFT JOIN productions p ON s.production_id = p.id 
                ORDER BY s.created_at DESC`,
      },
      {
        sheetName: 'Purchase Orders',
        fileBaseName: 'Purchase_Orders',
        query: `SELECT po.*, p.name AS production_name, s.name AS supplier_name 
                FROM purchase_orders po 
                LEFT JOIN productions p ON po.production_id = p.id 
                LEFT JOIN suppliers s ON po.supplier_id = s.id 
                ORDER BY po.created_at DESC`,
      },
      {
        sheetName: 'Cost Report Entries',
        fileBaseName: 'Cost_Report_Entries',
        query: `SELECT * FROM cost_report_entries ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Crew',
        fileBaseName: 'Crew',
        query: `SELECT * FROM crew_members ORDER BY created_at DESC`,
        transform: (rows) => rows.map(r => ({
          ...r,
          home_address: decrypt(r.home_address),
          account_name: decrypt(r.account_name),
          account_number: decrypt(r.account_number),
          sort_code: decrypt(r.sort_code),
          emergency_contact_phone: decrypt(r.emergency_contact_phone),
        })),
      },
      {
        sheetName: 'Freelancers',
        fileBaseName: 'Freelancers',
        query: `SELECT * FROM freelancer_contacts ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Crew Registration Requests',
        fileBaseName: 'Crew_Registration_Requests',
        query: `SELECT * FROM crew_registration_requests ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Timesheets',
        fileBaseName: 'Timesheets',
        query: `SELECT t.*, p.name AS production_name 
                FROM timesheets t 
                LEFT JOIN productions p ON t.production_id = p.id 
                ORDER BY t.created_at DESC`,
      },
      {
        sheetName: 'Timesheet Entries',
        fileBaseName: 'Timesheet_Entries',
        query: `SELECT te.*, CONCAT(cm.first_name, ' ', cm.last_name) AS crew_member_name 
                FROM timesheet_entries te 
                LEFT JOIN timesheets t ON te.timesheet_id = t.id 
                LEFT JOIN crew_members cm ON t.crew_member_id = cm.id 
                ORDER BY te.created_at DESC`,
      },
      {
        sheetName: 'Pay Runs',
        fileBaseName: 'Pay_Runs',
        query: `SELECT pr.*, p.name AS production_name 
                FROM pay_runs pr 
                LEFT JOIN productions p ON pr.production_id = p.id 
                ORDER BY pr.created_at DESC`,
      },
      {
        sheetName: 'Pay Run Items',
        fileBaseName: 'Pay_Run_Items',
        query: `SELECT pri.*, CONCAT(cm.first_name, ' ', cm.last_name) AS crew_member_name 
                FROM pay_run_items pri 
                LEFT JOIN crew_members cm ON pri.crew_member_id = cm.id 
                ORDER BY pri.created_at DESC`,
        transform: (rows) => rows.map(r => ({
          ...r,
          sort_code: decrypt(r.sort_code),
          account_number: decrypt(r.account_number),
          account_name: decrypt(r.account_name),
        })),
      },
      {
        sheetName: 'Suppliers',
        fileBaseName: 'Suppliers',
        query: `SELECT * FROM suppliers ORDER BY name ASC`,
      },
      {
        sheetName: 'Materials Catalogue',
        fileBaseName: 'Materials_Catalogue',
        query: `SELECT * FROM materials_catalogue ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Materials Inventory',
        fileBaseName: 'Materials_Inventory',
        query: `SELECT mi.*, p.name AS production_name 
                FROM materials_inventory mi 
                LEFT JOIN productions p ON mi.production_id = p.id 
                ORDER BY mi.created_at DESC`,
      },
      {
        sheetName: 'Vehicles',
        fileBaseName: 'Vehicles',
        query: `SELECT * FROM vehicles ORDER BY registration_number ASC`,
      },
      {
        sheetName: 'Buildings',
        fileBaseName: 'Buildings',
        query: `SELECT * FROM buildings ORDER BY name ASC`,
      },
      {
        sheetName: 'Plant Assets',
        fileBaseName: 'Plant_Assets',
        query: `SELECT * FROM assets ORDER BY name ASC`,
      },
      {
        sheetName: 'Hire Equipment',
        fileBaseName: 'Hire_Equipment',
        query: `SELECT he.*, s.name AS supplier_name 
                FROM hire_equipment he 
                LEFT JOIN suppliers s ON he.supplier_id = s.id 
                ORDER BY he.created_at DESC`,
      },
      {
        sheetName: 'IT Resources',
        fileBaseName: 'IT_Resources',
        query: `SELECT * FROM it_resources ORDER BY name ASC`,
      },
      {
        sheetName: 'Safety & Health Docs',
        fileBaseName: 'Safety_Health',
        query: `SELECT * FROM safety_health_documents ORDER BY uploaded_at DESC`,
      },
      {
        sheetName: 'Forecasts',
        fileBaseName: 'Forecasts',
        query: `SELECT f.*, p.name AS production_name 
                FROM forecasts f 
                LEFT JOIN productions p ON f.production_id = p.id 
                ORDER BY f.created_at DESC`,
      },
      {
        sheetName: 'Forecast Labour',
        fileBaseName: 'Forecast_Labour',
        query: `SELECT * FROM forecast_labour_items ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Forecast Materials',
        fileBaseName: 'Forecast_Materials',
        query: `SELECT * FROM forecast_materials_items ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Cost Plus Budgets',
        fileBaseName: 'Cost_Plus_Budgets',
        query: `SELECT * FROM cost_plus_budgets ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Cost Plus Budget Lines',
        fileBaseName: 'Cost_Plus_Budget_Lines',
        query: `SELECT * FROM cost_plus_budget_lines ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Cost Report Invoices',
        fileBaseName: 'Cost_Report_Invoices',
        query: `SELECT * FROM cost_report_invoices ORDER BY created_at DESC`,
      },
      {
        sheetName: 'Cost Report Weekly P&L',
        fileBaseName: 'Cost_Report_Weekly_PL',
        query: `SELECT * FROM cost_report_weekly_pl ORDER BY week_ending_date DESC`,
      },
      {
        sheetName: 'Percentometer Ratios',
        fileBaseName: 'Percentometer_Ratios',
        query: `SELECT * FROM percentometer_ratios ORDER BY created_at DESC`,
      },
      {
        sheetName: 'BECTU Rates',
        fileBaseName: 'BECTU_Rates',
        query: `SELECT * FROM bectu_rates ORDER BY effective_from DESC`,
      },
      {
        sheetName: 'Users',
        fileBaseName: 'Users',
        query: `SELECT id, email, full_name, role, is_active, avatar_url, created_at 
                FROM users 
                ORDER BY created_at DESC`,
      },
    ];

    // Master multi-tab workbook (all datasets as tabs, starting directly with Productions)
    const masterWorkbook = new ExcelJS.Workbook();
    masterWorkbook.creator = 'CS HQ Database Sync';
    masterWorkbook.created = startTime;

    const summaryMeta = {};
    const fileList = [];
    let totalRecords = 0;
    let tablesSynced = 0;
    let totalBytesSum = 0;

    // Fetch and process each table
    for (const item of dataQueries) {
      try {
        const result = await db.query(item.query);
        let rows = result.rows || [];
        if (item.transform) {
          rows = item.transform(rows);
        }

        const count = rows.length;
        summaryMeta[item.sheetName] = count;
        totalRecords += count;
        tablesSynced += 1;

        // 1. Add worksheet to master workbook (ACTUAL rows, no counts summary tab!)
        const ws = masterWorkbook.addWorksheet(item.sheetName);
        populateWorksheet(ws, rows, item.sheetName);

        // 2. Generate individual standalone workbook (e.g. Backup_Suppliers.xlsx)
        const singleBuffer = await buildSingleWorkbook(item.sheetName, rows);
        totalBytesSum += singleBuffer.length;

        const singleFileName = `Backup_${item.fileBaseName}.xlsx`;
        const singleS3Key = `${s3Prefix}/${singleFileName}`;
        fileList.push({
          name: singleFileName,
          key: singleS3Key,
          size: singleBuffer.length,
          records: count,
        });

        // Upload individual file to S3 in version folder
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: singleS3Key,
          Body: singleBuffer,
          ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          Metadata: {
            'cshq-table': item.sheetName,
            'cshq-records': String(count),
            'cshq-version': versionFolderName,
          },
        }));
      } catch (tableErr) {
        console.warn(`[DATA-SYNC] Warning fetching ${item.sheetName}:`, tableErr.message);
        summaryMeta[item.sheetName] = `Error: ${tableErr.message}`;
      }
    }

    // 3. Generate & upload master combined workbook: Backup_All_Data.xlsx
    const masterBuffer = await masterWorkbook.xlsx.writeBuffer();
    totalBytesSum += masterBuffer.length;
    fileList.unshift({
      name: masterFilename,
      key: masterS3Key,
      size: masterBuffer.length,
      records: totalRecords,
      isMaster: true,
    });

    console.log(`[DATA-SYNC] Uploading master workbook ${masterFilename} (${(masterBuffer.length / 1024).toFixed(1)} KB) to ${masterS3Key}...`);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: masterS3Key,
      Body: masterBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Metadata: {
        'cshq-sync-type': triggeredByType,
        'cshq-sync-time': startTime.toISOString(),
        'cshq-tables': String(tablesSynced),
        'cshq-records': String(totalRecords),
        'cshq-version': versionFolderName,
      },
    }));

    // Maintain latest copy
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: 'backups/latest/Backup_All_Data.xlsx',
        Body: masterBuffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
    } catch (latestErr) {
      console.warn('[DATA-SYNC] Could not write latest copy:', latestErr.message);
    }

    const completedAt = new Date();

    const fullMetadata = {
      versionFolder: versionFolderName,
      folderPath: s3Prefix,
      tables: summaryMeta,
      files: fileList,
    };

    // 4. Update data_sync_history
    if (syncRecordId) {
      const updateRes = await db.query(
        `UPDATE data_sync_history
         SET filename = $1,
             s3_key = $2,
             s3_url = $3,
             file_size = $4,
             tables_synced = $5,
             total_records = $6,
             metadata = $7,
             status = 'SUCCESS',
             completed_at = $8
         WHERE id = $9
         RETURNING *`,
        [versionFolderName, s3Prefix, masterS3Url, totalBytesSum, tablesSynced, totalRecords, JSON.stringify(fullMetadata), completedAt, syncRecordId]
      );
      console.log(`[DATA-SYNC] ✅ Sync completed: ${versionFolderName} (${tablesSynced} tables, ${totalRecords} records) in ${completedAt - startTime}ms!`);
      return updateRes.rows[0];
    } else {
      const insertRes = await db.query(
        `INSERT INTO data_sync_history 
          (filename, s3_key, s3_url, file_size, tables_synced, total_records, metadata, status, triggered_by_type, triggered_by_user_id, triggered_by_user_name, created_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUCCESS', $8, $9, $10, $11, $12)
         RETURNING *`,
        [versionFolderName, s3Prefix, masterS3Url, totalBytesSum, tablesSynced, totalRecords, JSON.stringify(fullMetadata), triggeredByType, userId, userName, startTime, completedAt]
      );
      console.log(`[DATA-SYNC] ✅ Sync completed: ${versionFolderName} in ${completedAt - startTime}ms!`);
      return insertRes.rows[0];
    }
  } catch (err) {
    console.error('[DATA-SYNC] ❌ Sync failed:', err);
    if (syncRecordId) {
      await db.query(
        `UPDATE data_sync_history
         SET status = 'FAILED',
             error_message = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [err.message, syncRecordId]
      ).catch(() => {});
    }
    throw err;
  }
}

/**
 * Get sync history
 */
async function getSyncHistory({ limit = 30 } = {}) {
  const res = await db.query(
    `SELECT * FROM data_sync_history 
     ORDER BY created_at DESC 
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

/**
 * Get overall sync status & stats
 */
async function getSyncStatus() {
  const latestRes = await db.query(
    `SELECT * FROM data_sync_history 
     WHERE status = 'SUCCESS'
     ORDER BY created_at DESC 
     LIMIT 1`
  );
  const countRes = await db.query(
    `SELECT 
       COUNT(*) as total_syncs,
       COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_syncs,
       COUNT(*) FILTER (WHERE triggered_by_type = 'SCHEDULED') as scheduled_syncs
     FROM data_sync_history`
  );

  const latest = latestRes.rows[0] || null;
  const counts = countRes.rows[0] || {};

  return {
    latestSync: latest,
    totalSyncs: parseInt(counts.total_syncs || '0', 10),
    successfulSyncs: parseInt(counts.successful_syncs || '0', 10),
    scheduledSyncs: parseInt(counts.scheduled_syncs || '0', 10),
    cronSchedule: '0 2 * * 0', // Every Sunday at 02:00 UTC
    cronScheduleHuman: 'Every Sunday at 02:00 UTC',
    bucket: BUCKET,
    region: REGION,
  };
}

/**
 * Stream an S3 backup file to response.
 * Allows downloading either a specific file (e.g. Backup_Suppliers.xlsx)
 * or the master Backup_All_Data.xlsx by default.
 */
async function streamSyncFile(id, res, requestedFile) {
  const check = await db.query(`SELECT * FROM data_sync_history WHERE id = $1`, [id]);
  if (!check.rows.length) {
    throw Object.assign(new Error('Sync record not found'), { status: 404 });
  }

  const record = check.rows[0];
  let targetKey = record.s3_key;
  let targetFilename = record.filename;

  if (requestedFile) {
    const cleanFileName = requestedFile.replace(/[^a-zA-Z0-9._-]/g, '');
    if (targetKey.endsWith('.xlsx')) {
      targetKey = targetKey.substring(0, targetKey.lastIndexOf('/')) + '/' + cleanFileName;
    } else {
      targetKey = `${targetKey.replace(/\/+$/, '')}/${cleanFileName}`;
    }
    targetFilename = cleanFileName;
  } else if (!targetKey.endsWith('.xlsx')) {
    targetKey = `${targetKey.replace(/\/+$/, '')}/Backup_All_Data.xlsx`;
    targetFilename = 'Backup_All_Data.xlsx';
  } else {
    targetFilename = targetKey.split('/').pop() || 'Backup_All_Data.xlsx';
  }

  console.log(`[DATA-SYNC] Streaming file from S3: Bucket=${BUCKET}, Key=${targetKey}`);

  const response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: targetKey,
  }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${targetFilename}"`);
  if (response.ContentLength) {
    res.setHeader('Content-Length', response.ContentLength);
  }

  if (response.Body && typeof response.Body.pipe === 'function') {
    response.Body.pipe(res);
  } else {
    const bytes = await response.Body.transformToByteArray();
    res.send(Buffer.from(bytes));
  }
}

module.exports = {
  executeDataSync,
  getSyncHistory,
  getSyncStatus,
  streamSyncFile,
};
