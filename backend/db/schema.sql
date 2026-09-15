-- ============================================================
-- CS HQ — PostgreSQL Schema
-- Construct Scenery Limited
-- Target: Render PostgreSQL (PG 15+)
-- ============================================================

-- ─── USERS & AUTH ────────────────────────────────────────────────────────────
-- Replaces Supabase auth.users + user_profiles.
-- Passwords are hashed with bcrypt (cost 12) — never stored in plain text.
CREATE TABLE users (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (
                  'managing_director',
                  'construction_accountant',
                  'construction_coordinator'
                )),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Opaque refresh tokens (UUID v4, 7-day TTL, one-time use / rotated on each refresh)
CREATE TABLE refresh_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_token   ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);


-- ─── MODULE 7: PRODUCTIONS ───────────────────────────────────────────────────
CREATE TABLE productions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  production_company  TEXT,
  production_designer TEXT,
  production_type     TEXT,  -- 'Feature Film', 'TV Series', 'SVOD', etc.
  start_date          DATE,
  end_date            DATE,
  contract_type       TEXT NOT NULL CHECK (contract_type IN ('on_a_price', 'cost_plus')),
  status              TEXT NOT NULL DEFAULT 'pre_production'
                        CHECK (status IN (
                          'pre_production', 'active_build', 'strike', 'complete', 'archived'
                        )),
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Sets / set tracker within each production
CREATE TABLE sets (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id     UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  set_number        TEXT,
  set_name          TEXT NOT NULL,
  shoot_week        TEXT,
  handover_date     DATE,
  completion_status TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (completion_status IN (
                        'not_started', 'in_progress', 'nearing_completion', 'complete', 'handed_over'
                      )),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Documents attached to a production (shooting schedules, drawings, contracts, etc.)
CREATE TABLE production_documents (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id   UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  document_type   TEXT,  -- 'shooting_schedule', 'drawing', 'contract', 'sign_off', 'other'
  file_url        TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);


-- ─── MODULE 2: CREW DATABASE ─────────────────────────────────────────────────
CREATE TABLE crew_members (
  id                              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  crew_number                     TEXT UNIQUE NOT NULL,  -- CSC-XXXX, auto-generated
  first_name                      TEXT NOT NULL,
  last_name                       TEXT NOT NULL,
  date_of_birth                   DATE,
  home_address                    TEXT,

  -- Employment & Classification
  employment_status               TEXT NOT NULL CHECK (employment_status IN ('paye', 'self_employed')),
  crew_trade                      TEXT NOT NULL,  -- e.g. 'Carpenters', 'Riggers'
  crew_rank                       TEXT NOT NULL,  -- e.g. 'HOD', 'Supervisor', 'Carpenter'
  paye_withholding_rate           DECIMAL(5,2) DEFAULT 0,  -- percentage, e.g. 20.00 = 20%

  -- Self-employed details (nullable unless self_employed)
  company_name                    TEXT,
  company_registration_number     TEXT,
  vat_registration_number         TEXT,

  -- Contact
  email                           TEXT,   -- used for timesheet distribution & invoice chasing

  -- Bank details (for pay run CSV)
  account_name                    TEXT,
  account_number                  TEXT,
  sort_code                       TEXT,

  -- Emergency contact
  emergency_contact_name          TEXT,
  emergency_contact_relationship  TEXT,
  emergency_contact_phone         TEXT,

  -- Professional
  qualifications                  TEXT[] DEFAULT '{}',
  company_utr                     TEXT,

  is_active                       BOOLEAN DEFAULT TRUE,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

-- Junction: crew member ↔ production (with start/end dates and contract)
CREATE TABLE production_crew (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id   UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  crew_member_id  UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  start_date      DATE,
  end_date        DATE,
  contract_url    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(production_id, crew_member_id)
);

-- Documents attached to a crew member (ID docs, contracts per production)
CREATE TABLE crew_documents (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  crew_member_id  UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL CHECK (document_type IN ('government_id', 'contract', 'other')),
  production_id   UUID REFERENCES productions(id),  -- only populated for contract documents
  file_url        TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);


-- ─── MODULE 1: PURCHASE ORDERS ───────────────────────────────────────────────
CREATE TABLE purchase_orders (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  po_number                 TEXT UNIQUE NOT NULL,  -- CS-YYYY-NNNN, auto-generated
  supplier_name             TEXT NOT NULL,
  supplier_email            TEXT,   -- used to email PO to supplier on submit
  supplier_address          TEXT,
  date_of_po                DATE NOT NULL DEFAULT CURRENT_DATE,
  production_id             UUID NOT NULL REFERENCES productions(id),
  set_code                  TEXT,
  account_code              TEXT,
  description               TEXT,
  net_amount                DECIMAL(12,2) NOT NULL,
  vat                       DECIMAL(12,2) DEFAULT 0,
  gross_amount              DECIMAL(12,2) NOT NULL,
  paid_from                 TEXT CHECK (paid_from IN (
                              'supplier_account',
                              'arbuthnot_current_account',
                              'charge_card',
                              'pleo_charge_card'
                            )),
  invoice_attachment_url    TEXT,
  invoice_attachment_name   TEXT,
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN (
                                'draft', 'submitted', 'issued', 'invoice_received', 'approved'
                              )),
  created_by                UUID REFERENCES users(id),
  approved_by               UUID REFERENCES users(id),
  approved_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);


-- ─── MODULE 3: TIMESHEETS ────────────────────────────────────────────────────
CREATE TABLE timesheets (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  crew_member_id            UUID NOT NULL REFERENCES crew_members(id),
  production_id             UUID NOT NULL REFERENCES productions(id),
  week_ending_date          DATE NOT NULL,  -- always a Sunday

  -- Status flow: draft → sent → reviewed → invoice_received → verified
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN (
                                'draft', 'sent', 'reviewed', 'invoice_received', 'verified'
                              )),

  -- Invoice attachment
  invoice_attachment_url    TEXT,
  invoice_attachment_name   TEXT,

  -- Auto-calculated weekly totals (populated by saveEntries controller)
  weekly_rate               DECIMAL(12,2) DEFAULT 0,
  sixth_day_payment         DECIMAL(12,2) DEFAULT 0,
  seventh_day_payment       DECIMAL(12,2) DEFAULT 0,
  overtime_amount           DECIMAL(12,2) DEFAULT 0,
  meal_allowance_total      DECIMAL(12,2) DEFAULT 0,
  mileage_and_travel        DECIMAL(12,2) DEFAULT 0,
  vat                       DECIMAL(12,2) DEFAULT 0,  -- self-employed crew only
  gross_total               DECIMAL(12,2) DEFAULT 0,
  grand_total               DECIMAL(12,2) DEFAULT 0,

  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(crew_member_id, production_id, week_ending_date)
);

-- Daily entries within a timesheet (Mon–Sun, one row per day worked)
CREATE TABLE timesheet_entries (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timesheet_id    UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  day_of_week     TEXT NOT NULL,  -- 'Monday', 'Tuesday', etc.
  full_day_worked BOOLEAN DEFAULT FALSE,
  overtime_hours  DECIMAL(4,2) DEFAULT 0,
  set_number      TEXT,
  site            TEXT,
  travel          DECIMAL(8,2) DEFAULT 0,
  mileage         DECIMAL(8,2) DEFAULT 0,
  per_diem        DECIMAL(8,2) DEFAULT 0,
  ad_hoc_reimbursement DECIMAL(8,2) DEFAULT 0,
  meal_breakfast  BOOLEAN DEFAULT FALSE,
  meal_lunch      BOOLEAN DEFAULT FALSE,
  meal_supper     BOOLEAN DEFAULT FALSE,
  meal_allowance_breakfast DECIMAL(8,2),
  meal_allowance_lunch     DECIMAL(8,2),
  meal_allowance_supper    DECIMAL(8,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Pay runs (processed once all timesheets for a week are verified)
CREATE TABLE pay_runs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id    UUID NOT NULL REFERENCES productions(id),
  week_ending_date DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processed')),
  created_by       UUID REFERENCES users(id),
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(production_id, week_ending_date)
);

-- Individual line items within a pay run
CREATE TABLE pay_run_items (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pay_run_id         UUID NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  timesheet_id       UUID NOT NULL REFERENCES timesheets(id),
  crew_member_id     UUID NOT NULL REFERENCES crew_members(id),
  employment_type    TEXT,          -- 'paye' or 'self_employed'
  gross_amount       DECIMAL(12,2) NOT NULL,
  withholding_amount DECIMAL(12,2) DEFAULT 0,
  net_amount         DECIMAL(12,2) NOT NULL,
  sort_code          TEXT,
  account_number     TEXT,
  account_name       TEXT,
  reference          TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);


-- ─── MODULE 4: COST REPORT ───────────────────────────────────────────────────

-- Invoices raised TO production (Type 1 — On a Price)
CREATE TABLE cost_report_invoices (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id       UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  invoice_description TEXT,
  po_number           TEXT,
  date                DATE,
  invoice_number      TEXT,
  amount              DECIMAL(12,2) NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Master budget for Cost Plus productions (Type 2)
CREATE TABLE cost_plus_budgets (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id    UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE UNIQUE,
  total_budget     DECIMAL(14,2),
  margin_rate      DECIMAL(5,4) DEFAULT 0.10,  -- 0.10 = 10%
  contracted_weeks INTEGER DEFAULT 0,
  budget_lines     JSONB,  -- array of {account_code, description, weekly_cost, weeks, total}
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);


-- ─── MODULE 5: FORECASTING & JOB COSTING ────────────────────────────────────

-- Saved forecast scenarios
CREATE TABLE forecasts (
  id                            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                          TEXT NOT NULL,
  production_id                 UUID REFERENCES productions(id),  -- nullable: pre-production forecast
  total_labour_cost             DECIMAL(14,2) DEFAULT 0,
  total_materials_cost          DECIMAL(14,2) DEFAULT 0,
  total_forecast_cost           DECIMAL(14,2) DEFAULT 0,
  percentometer_carpenter_cost  DECIMAL(14,2),
  percentometer_total           DECIMAL(14,2),
  created_by                    UUID REFERENCES users(id),
  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW()
);

-- Labour line items within a forecast
CREATE TABLE forecast_labour_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  forecast_id     UUID NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  crew_type       TEXT NOT NULL,       -- e.g. 'Carpenter', 'Rigger HOD'
  number_of_crew  INTEGER DEFAULT 1,
  number_of_weeks INTEGER DEFAULT 1,
  overtime_hours  DECIMAL(6,2) DEFAULT 0,
  weekly_rate     DECIMAL(10,2),
  overtime_rate   DECIMAL(10,2),
  subtotal        DECIMAL(14,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Supplier & materials price catalogue (maintained by Construction Coordinator)
-- Must be defined BEFORE forecast_materials_items which references it
CREATE TABLE supplier_catalogue (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_name       TEXT NOT NULL,
  product_description TEXT NOT NULL,
  unit_of_measure     TEXT,
  unit_price          DECIMAL(10,2) NOT NULL,
  notes               TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Materials line items within a forecast
CREATE TABLE forecast_materials_items (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  forecast_id           UUID NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  supplier_catalogue_id UUID REFERENCES supplier_catalogue(id),
  supplier_name         TEXT,
  product_description   TEXT,
  quantity              DECIMAL(10,2) DEFAULT 1,
  unit_price            DECIMAL(10,2),
  subtotal              DECIMAL(14,2),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Percentometer ratios (can be updated by MD as historical averages shift)
CREATE TABLE percentometer_ratios (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cost_type   TEXT NOT NULL UNIQUE,
  percentage  DECIMAL(5,4) NOT NULL,  -- 0.42 = 42%
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default Percentometer ratios
INSERT INTO percentometer_ratios (cost_type, percentage) VALUES
  ('Carpenters',  0.42),
  ('Painters',    0.18),
  ('Stagehands',  0.09),
  ('Riggers',     0.06),
  ('Timber',      0.09),
  ('Plasterwork', 0.06),
  ('Misc',        0.03),
  ('Sculptors',   0.02),
  ('Metalwork',   0.02),
  ('Paint',       0.02),
  ('Glass',       0.01);


-- ─── BECTU RATES (2026/27 Pact/BECTU Construction Crew Agreement) ─────────────
CREATE TABLE bectu_rates (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trade         TEXT NOT NULL,
  rank          TEXT NOT NULL,
  daily_rate    DECIMAL(10,2),
  overtime_rate DECIMAL(10,2),
  weekly_rate   DECIMAL(10,2),
  rate_year     TEXT DEFAULT '2026/27',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trade, rank, rate_year)
);

-- Seed BECTU structure (fill in actual daily/OT rates from the 2026/27 rate card)
INSERT INTO bectu_rates (trade, rank, daily_rate, overtime_rate) VALUES
  ('Carpenters',       'HOD',                0, 0),
  ('Carpenters',       'Supervisor',         0, 0),
  ('Carpenters',       'Chargehand',         0, 0),
  ('Carpenters',       'Carpenter',          0, 0),
  ('Machinists',       'HOD',                0, 0),
  ('Machinists',       'Supervisor',         0, 0),
  ('Machinists',       'Chargehand',         0, 0),
  ('Machinists',       'Machinist',          0, 0),
  ('Stagehands',       'HOD',                0, 0),
  ('Stagehands',       'Supervisor',         0, 0),
  ('Stagehands',       'Chargehand',         0, 0),
  ('Stagehands',       'Stagehand NVQ/BLSS', 0, 0),
  ('Stagehands',       'Stagehand',          0, 0),
  ('Riggers',          'HOD',                0, 0),
  ('Riggers',          'Supervisor',         0, 0),
  ('Riggers',          'Chargehand',         0, 0),
  ('Riggers',          'Rigger',             0, 0),
  ('Plasterers',       'HOD',                0, 0),
  ('Plasterers',       'Supervisor',         0, 0),
  ('Plasterers',       'Chargehand',         0, 0),
  ('Plasterers',       'Plasterer',          0, 0),
  ('Scenic Painters',  'HOD',                0, 0),
  ('Scenic Painters',  'Supervisor',         0, 0),
  ('Scenic Painters',  'Chargehand',         0, 0),
  ('Scenic Painters',  'Painter',            0, 0),
  ('Sculptors',        'HOD',                0, 0),
  ('Sculptors',        'Supervisor',         0, 0),
  ('Sculptors',        'Chargehand',         0, 0),
  ('Sculptors',        'Sculptor',           0, 0),
  ('Sculptors',        'Sculptor Modeller',  0, 0),
  ('Metal Workers',    'HOD',                0, 0),
  ('Metal Workers',    'Supervisor',         0, 0),
  ('Metal Workers',    'Chargehand',         0, 0),
  ('Metal Workers',    'Metal Worker',       0, 0),
  ('Plasterers Lab',   'HOD',                0, 0),
  ('Plasterers Lab',   'Supervisor',         0, 0),
  ('Plasterers Lab',   'Chargehand',         0, 0),
  ('Plasterers Lab',   'Lab Worker',         0, 0),
  ('Painters Lab',     'HOD',                0, 0),
  ('Painters Lab',     'Supervisor',         0, 0),
  ('Painters Lab',     'Chargehand',         0, 0),
  ('Painters Lab',     'Lab Worker',         0, 0),
  ('Sculptors Lab',    'HOD',                0, 0),
  ('Sculptors Lab',    'Supervisor',         0, 0),
  ('Sculptors Lab',    'Chargehand',         0, 0),
  ('Sculptors Lab',    'Lab Worker',         0, 0),
  ('Metal Workers Lab','HOD',                0, 0),
  ('Metal Workers Lab','Supervisor',         0, 0),
  ('Metal Workers Lab','Chargehand',         0, 0),
  ('Metal Workers Lab','Lab Worker',         0, 0);
INSERT INTO bectu_rates (trade, rank, daily_rate, overtime_rate) VALUES
  ('Non-BECTU', 'Construction Accountant',  0, 0),
  ('Non-BECTU', 'Construction Coordinator', 0, 0),
  ('Non-BECTU', 'Construction Manager',     0, 0),
  ('Non-BECTU', 'Luton Driver',             0, 0);


-- ─── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_purchase_orders_production   ON purchase_orders(production_id);
CREATE INDEX idx_purchase_orders_status       ON purchase_orders(status);
CREATE INDEX idx_purchase_orders_date         ON purchase_orders(date_of_po);
CREATE INDEX idx_timesheets_crew              ON timesheets(crew_member_id);
CREATE INDEX idx_timesheets_production        ON timesheets(production_id);
CREATE INDEX idx_timesheets_week              ON timesheets(week_ending_date);
CREATE INDEX idx_timesheet_entries_timesheet  ON timesheet_entries(timesheet_id);
CREATE INDEX idx_sets_production              ON sets(production_id);
CREATE INDEX idx_sets_handover                ON sets(handover_date);
CREATE INDEX idx_forecasts_production         ON forecasts(production_id);
CREATE INDEX idx_production_crew_production   ON production_crew(production_id);
CREATE INDEX idx_production_crew_member       ON production_crew(crew_member_id);


-- ─── UPDATED_AT TRIGGERS ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_productions_updated_at
  BEFORE UPDATE ON productions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_crew_members_updated_at
  BEFORE UPDATE ON crew_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_timesheets_updated_at
  BEFORE UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_forecasts_updated_at
  BEFORE UPDATE ON forecasts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_supplier_catalogue_updated_at
  BEFORE UPDATE ON supplier_catalogue FOR EACH ROW EXECUTE FUNCTION update_updated_at();
