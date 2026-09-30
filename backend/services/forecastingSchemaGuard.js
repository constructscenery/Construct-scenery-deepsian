const db = require('../config/db');

async function ensureForecastingTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cost_forecasts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        default_view VARCHAR(10) DEFAULT 'weekly',
        status VARCHAR(20) DEFAULT 'draft',
        version INT DEFAULT 1,
        parent_forecast_id UUID REFERENCES cost_forecasts(id) ON DELETE SET NULL,
        locked_at TIMESTAMPTZ,
        locked_by UUID REFERENCES users(id),
        rates_snapshot JSONB,
        total_crew_cost NUMERIC(14,2) DEFAULT 0,
        total_non_labour_cost NUMERIC(14,2) DEFAULT 0,
        grand_total_cost NUMERIC(14,2) DEFAULT 0,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cost_forecast_crew_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cost_forecast_id UUID NOT NULL REFERENCES cost_forecasts(id) ON DELETE CASCADE,
        section VARCHAR(50) NOT NULL,
        trade VARCHAR(100) NOT NULL,
        rank VARCHAR(100) NOT NULL,
        cost_code VARCHAR(20),
        bectu_rate_id UUID REFERENCES bectu_rates(id),
        unit_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
        units NUMERIC(8,2) DEFAULT 0,
        rate_unit VARCHAR(10) DEFAULT 'weekly',
        line_total NUMERIC(12,2) DEFAULT 0,
        sort_order INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS cost_forecast_non_labour_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cost_forecast_id UUID NOT NULL REFERENCES cost_forecasts(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        cost_code VARCHAR(20),
        description TEXT NOT NULL,
        unit_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
        quantity NUMERIC(8,2) DEFAULT 1,
        unit_type VARCHAR(20) DEFAULT 'weekly',
        line_total NUMERIC(12,2) DEFAULT 0,
        is_custom BOOLEAN DEFAULT false,
        sort_order INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS labour_flows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        num_weeks INT NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        version INT DEFAULT 1,
        parent_flow_id UUID REFERENCES labour_flows(id) ON DELETE SET NULL,
        locked_at TIMESTAMPTZ,
        locked_by UUID REFERENCES users(id),
        rates_snapshot JSONB,
        grand_total_cost NUMERIC(14,2) DEFAULT 0,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS labour_flow_rows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        labour_flow_id UUID NOT NULL REFERENCES labour_flows(id) ON DELETE CASCADE,
        section VARCHAR(50) NOT NULL,
        trade VARCHAR(100) NOT NULL,
        rank VARCHAR(100) NOT NULL,
        cost_code VARCHAR(20),
        bectu_rate_id UUID REFERENCES bectu_rates(id),
        weekly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
        headcounts JSONB NOT NULL DEFAULT '{}',
        row_total_units INT DEFAULT 0,
        row_total_cost NUMERIC(12,2) DEFAULT 0,
        sort_order INT DEFAULT 0
      );
    `);
    console.log('✅ Schema guard: Forecasting Addendum 4 tables ensured');
  } catch (err) {
    console.error('⚠️  Schema guard failed (Forecasting Addendum 4):', err.message);
  }
}

module.exports = { ensureForecastingTables };
