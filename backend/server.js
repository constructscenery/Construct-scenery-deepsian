require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cron    = require('node-cron');

const { authenticate } = require('./Middleware/auth');
const { checkPolicy  } = require('./Middleware/roleCheck');

const app = express();

// ─── CORS + BODY PARSER ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, server-to-server, curl)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.trim().replace(/\/+$/, '');

    // Always allow localhost, 127.0.0.1, and local network IPs (e.g. 192.168.x.x)
    if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(cleanOrigin)) {
      return callback(null, true);
    }

    // Always allow Vercel domains (*.vercel.app), Render domains (*.onrender.com), and constructscenery domains
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)*(vercel\.app|onrender\.com|constructscenery\.co\.uk)(:\d+)?$/.test(cleanOrigin)) {
      return callback(null, true);
    }

    // Check custom configured CLIENT_URL
    if (allowedOrigins.length > 0) {
      if (allowedOrigins.includes(cleanOrigin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
    }

    // In non-production, default allow
    if (process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) {
      return callback(null, true);
    }

    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ─── REQUEST LOGGER ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ─── STATIC FILE SERVING — uploaded documents ────────────────────────────────
// Serves files from backend/uploads/ at GET /uploads/<filename>
// Replace with cloud storage URL when moving off local disk
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── HEALTH CHECK (public) ────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name:    'Deepsian API',
    version: '1.0.0',
    status:  'running',
    modules: [
      'Auth                        → /api/auth',
      'Module 1: Purchase Orders   → /api/purchase-orders',
      'Module 2: Crew Database     → /api/crew',
      'Module 3: Timesheets        → /api/timesheets',
      'Module 3: Pay Runs          → /api/pay-runs',
      'Module 4: Cost Reports      → /api/cost-reports',
      'Module 5: Forecasting       → /api/forecasting',
      'Module 5: Materials Catalogue→ /api/materials-catalogue',
      'Module 5: Supplier Database → /api/suppliers',
      'Module 5: Percentometer     → /api/percentometer',
      'Module 6: Dashboard         → /api/dashboard',
      'Module 7: Productions       → /api/productions',
    ],
  });
});

// ─── AUTH ROUTES (public — signup / login / refresh bypass global middleware) ─
// logout + /me handle their own authenticate internally
app.use('/api/auth', require('./routes/auth'));

// ─── PUBLIC CREW REGISTRATION (public — no auth required) ───────────────────
app.use('/api/public/crew', require('./routes/publicCrew'));
app.use('/api/public/safety-health', require('./routes/publicSafetyHealth'));

// ─── GLOBAL MIDDLEWARE (applied to every route BELOW this line) ───────────────
// 1. Verify JWT access token → populates req.user
// 2. Policy check via policies.json → enforces RBAC per role
app.use(authenticate);
app.use(checkPolicy);

// ─── PROTECTED MODULE ROUTES ─────────────────────────────────────────────────
app.use('/api/productions',    require('./routes/productions'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/crew',           require('./routes/crew'));
app.use('/api/timesheets',     require('./routes/timesheets'));
app.use('/api/pay-runs',       require('./routes/payRuns'));
app.use('/api/cost-reports',   require('./routes/costReports'));
app.use('/api/forecasting',         require('./routes/forecasting'));
app.use('/api/materials-catalogue', require('./routes/materialsCatalogue'));
app.use('/api/materials-inventory', require('./routes/materialsInventory'));
app.use('/api/safety-health', require('./routes/safetyHealth'));
app.use('/api/suppliers',           require('./routes/suppliers'));
app.use('/api/percentometer',       require('./routes/percentometer'));
app.use('/api/dashboard',           require('./routes/dashboard'));
app.use('/api/crew-rates',          require('./routes/crewRates'));
app.use('/api/settings',            require('./routes/settings'));
app.use('/api/users',               require('./routes/users'));
app.use('/api/vehicles',            require('./routes/vehicles'));
app.use('/api/hire-equipment',      require('./routes/hireEquipment'));
app.use('/api/assets-hire',         require('./routes/assetsHire'));
app.use('/api/buildings',           require('./routes/buildings'));
app.use('/api/assets-plant',        require('./routes/assetsPlant'));
app.use('/api/it-resources',        require('./routes/itResources'));
app.use('/api/ladders',             require('./routes/ladders'));
app.use('/api/audit-log',           require('./routes/auditLog'));
app.use('/api/data-sync',           require('./routes/dataSync'));

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Multer file type / size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 20 MB.' });
  }
  if (err.message?.includes('not allowed')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START ────────────────────────────────────────────────────────────────────
const db   = require('./config/db');
const PORT = process.env.PORT || 5000;

async function start() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════╗
║       Deepsian API — Running          ║
║  Port  : ${PORT}                          ║
║  Auth  : JWT (bcrypt + pg)           ║
║  Policy: OPA-style policies.json     ║
╚══════════════════════════════════════╝
    `);
  });

  // Ensure any columns that might be missing from older DB instances exist
  // before the server accepts requests.
  try {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);
    console.log('✅ Schema guard: users.is_active and avatar_url ensured');
  } catch (err) {
    console.error('⚠️  Schema guard failed (users columns):', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE productions
        ADD COLUMN IF NOT EXISTS agreed_price DECIMAL(14,2),
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS archived_by UUID,
        ADD COLUMN IF NOT EXISTS post_production_percentometer DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS target_profit_pct DECIMAL(5,2);

      ALTER TABLE forecasts
        ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

      ALTER TABLE cost_report_weekly_pl
        ADD COLUMN IF NOT EXISTS luton_uplift DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS box_rental_uplift DECIMAL(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE forecast_labour_items
        ADD COLUMN IF NOT EXISTS daily_rate DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS ot_rate DECIMAL(10,2);

      ALTER TABLE forecast_materials_items
        ADD COLUMN IF NOT EXISTS quantity DECIMAL(10,3) NOT NULL DEFAULT 1;
    `);
    console.log('✅ Schema guard: dashboard and forecast columns ensured');
  } catch (err) {
    console.error('⚠️  Schema guard failed (dashboard columns):', err.message);
  }

  try {
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'crew_registration_requests'
        ) THEN
          ALTER TABLE crew_registration_requests
          DROP CONSTRAINT IF EXISTS crew_registration_requests_created_crew_member_id_fkey;

          ALTER TABLE crew_registration_requests
          ADD CONSTRAINT crew_registration_requests_created_crew_member_id_fkey
          FOREIGN KEY (created_crew_member_id)
          REFERENCES crew_members(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    console.log('✅ Schema guard: crew_registration_requests FK ON DELETE SET NULL ensured');
  } catch (err) {
    console.error('⚠️  Schema guard failed (crew_registration_requests FK):', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE timesheet_entries
        ADD COLUMN IF NOT EXISTS mileage DECIMAL(10,2) NOT NULL DEFAULT 0;

      ALTER TABLE buildings
        ADD COLUMN IF NOT EXISTS utilities       JSONB,
        ADD COLUMN IF NOT EXISTS insurance_policies JSONB;

      ALTER TABLE assets
        ADD COLUMN IF NOT EXISTS depreciation JSONB;

      ALTER TABLE it_resources
        ADD COLUMN IF NOT EXISTS credentials TEXT,
        ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'annual',
        ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS reminder_days INTEGER NOT NULL DEFAULT 30;

      ALTER TABLE assets
        ADD COLUMN IF NOT EXISTS make TEXT,
        ADD COLUMN IF NOT EXISTS model TEXT,
        ADD COLUMN IF NOT EXISTS serial_number TEXT,
        ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'location';
    `);
    console.log('✅ Schema guard: timesheet_entries.mileage and module columns ensured');
  } catch (err) {
    console.error('⚠️  Schema guard failed (module columns):', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

      ALTER TABLE purchase_orders
        ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

      ALTER TABLE crew_members
        ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
    `);
    console.log('✅ Schema guard: soft-delete/archive columns ensured for suppliers, purchase_orders, crew_members');
  } catch (err) {
    console.error('⚠️  Schema guard failed (soft-delete columns):', err.message);
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ladders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        barcode VARCHAR(100) NOT NULL,
        ladder_type VARCHAR(100) DEFAULT 'Step Ladder',
        inspection_date DATE NOT NULL,
        condition VARCHAR(100) NOT NULL DEFAULT 'Good',
        next_inspection_due DATE NOT NULL,
        location VARCHAR(255),
        inspector_name VARCHAR(255),
        reminder_days INTEGER DEFAULT 14,
        notes TEXT,
        is_archived BOOLEAN NOT NULL DEFAULT false,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Schema guard: ladders table ensured');
  } catch (err) {
    console.error('⚠️  Schema guard failed (ladders table):', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE audit_log ALTER COLUMN user_id DROP NOT NULL;
      ALTER TABLE audit_log 
        ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general',
        ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS entity_id TEXT,
        ADD COLUMN IF NOT EXISTS details TEXT,
        ADD COLUMN IF NOT EXISTS user_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS user_role VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log(category);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    `);
    console.log('✅ Schema guard: audit_log table enhanced');
  } catch (err) {
    console.error('⚠️  Schema guard failed (audit_log table):', err.message);
  }

  // ── Daily handover alert cron — 07:00 UTC every day ──────────────────────────
  const { runHandoverAlerts } = require('./Controllers/productionsController');
  cron.schedule('0 7 * * *', async () => {
    console.log(`[CRON] Running handover alerts — ${new Date().toISOString()}`);
    try {
      const result = await runHandoverAlerts();
      console.log(`[CRON] Handover alerts: sent=${result.sent} skipped=${result.skipped}`);
    } catch (err) {
      console.error('[CRON] Handover alerts failed:', err.message);
    }
  }, { timezone: 'UTC' });
  console.log('✅ Cron: handover alerts scheduled at 07:00 UTC daily');

  // ── Daily vehicle compliance reminder cron — 07:15 UTC every day ─────────────
  const { runVehicleComplianceAlerts } = require('./Controllers/assetsHireController');
  cron.schedule('15 7 * * *', async () => {
    console.log(`[CRON] Running vehicle compliance alerts — ${new Date().toISOString()}`);
    try {
      const result = await runVehicleComplianceAlerts();
      console.log(`[CRON] Vehicle compliance alerts: sent=${result.sent} skipped=${result.skipped}`);
    } catch (err) {
      console.error('[CRON] Vehicle compliance alerts failed:', err.message);
    }
  }, { timezone: 'UTC' });
  console.log('✅ Cron: vehicle compliance alerts scheduled at 07:15 UTC daily');

  // ── Daily asset/building reminders cron — 07:30 UTC every day ────────────────
  const { runAssetReminders } = require('./services/reminderService');
  cron.schedule('30 7 * * *', async () => {
    console.log(`[CRON] Running asset reminders — ${new Date().toISOString()}`);
    try {
      await runAssetReminders();
    } catch (err) {
      console.error('[CRON] Asset reminders failed:', err.message);
    }
  }, { timezone: 'UTC' });
  console.log('✅ Cron: asset reminders scheduled at 07:30 UTC daily');

  // ── Weekly database S3 sync cron — 02:00 UTC every Sunday ──────────────────
  const { executeDataSync } = require('./services/dataSyncService');
  cron.schedule('0 2 * * 0', async () => {
    console.log(`[CRON] Running weekly database S3 sync — ${new Date().toISOString()}`);
    try {
      const result = await executeDataSync({
        triggeredByType: 'SCHEDULED',
        userName: 'Weekly Cron Schedule',
      });
      console.log(`[CRON] Weekly S3 sync completed: ${result.filename} (${result.tables_synced} tables, ${result.total_records} records)`);
    } catch (err) {
      console.error('[CRON] Weekly S3 sync failed:', err.message);
    }
  }, { timezone: 'UTC' });
  console.log('✅ Cron: weekly database S3 sync scheduled at 02:00 UTC every Sunday');

  return server;
}

start();

module.exports = { app, start };
