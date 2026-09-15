import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestoreLegacyModuleColumns1789475480273 implements MigrationInterface {
  name = 'RestoreLegacyModuleColumns1789475480273';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE productions
        ADD COLUMN IF NOT EXISTS rollback_notice TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE cost_plus_budgets
        ADD COLUMN IF NOT EXISTS notes TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE cost_plus_budget_lines
        ADD COLUMN IF NOT EXISTS bectu_rate NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS agreed_rate NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS line_margin_rate NUMERIC(5,4),
        ADD COLUMN IF NOT EXISTS is_above_line BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS set_id UUID,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS line_type TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE crew_members
        ADD COLUMN IF NOT EXISTS qualifications TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS company_utr TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE bectu_rates
        ADD COLUMN IF NOT EXISTS effective_from DATE,
        ADD COLUMN IF NOT EXISTS effective_to DATE,
        ADD COLUMN IF NOT EXISTS rate_type TEXT DEFAULT 'bectu'
    `);
    await queryRunner.query(`
      ALTER TABLE materials_catalogue
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE timesheets
        ADD COLUMN IF NOT EXISTS rate_override NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS rank_override TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_orders
        ADD COLUMN IF NOT EXISTS supplier_code TEXT,
        ADD COLUMN IF NOT EXISTS street_name TEXT,
        ADD COLUMN IF NOT EXISTS zip_code TEXT,
        ADD COLUMN IF NOT EXISTS city TEXT,
        ADD COLUMN IF NOT EXISTS county TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE production_documents
        ADD COLUMN IF NOT EXISTS file_size BIGINT,
        ADD COLUMN IF NOT EXISTS file_key TEXT,
        ADD COLUMN IF NOT EXISTS file_mime_type TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE timesheet_entries
        ADD COLUMN IF NOT EXISTS mileage NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS per_diem NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ad_hoc_reimbursement NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS meal_allowance_breakfast NUMERIC,
        ADD COLUMN IF NOT EXISTS meal_allowance_lunch NUMERIC,
        ADD COLUMN IF NOT EXISTS meal_allowance_supper NUMERIC
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE timesheet_entries
        DROP COLUMN IF EXISTS meal_allowance_supper,
        DROP COLUMN IF EXISTS meal_allowance_lunch,
        DROP COLUMN IF EXISTS meal_allowance_breakfast,
        DROP COLUMN IF EXISTS ad_hoc_reimbursement,
        DROP COLUMN IF EXISTS per_diem,
        DROP COLUMN IF EXISTS mileage
    `);
    await queryRunner.query(`
      ALTER TABLE production_documents
        DROP COLUMN IF EXISTS file_mime_type,
        DROP COLUMN IF EXISTS file_key,
        DROP COLUMN IF EXISTS file_size
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_orders
        DROP COLUMN IF EXISTS county,
        DROP COLUMN IF EXISTS city,
        DROP COLUMN IF EXISTS zip_code,
        DROP COLUMN IF EXISTS street_name,
        DROP COLUMN IF EXISTS supplier_code
    `);
    await queryRunner.query(`
      ALTER TABLE timesheets
        DROP COLUMN IF EXISTS rank_override,
        DROP COLUMN IF EXISTS rate_override
    `);
    await queryRunner.query(`ALTER TABLE materials_catalogue DROP COLUMN IF EXISTS deleted_at`);
    await queryRunner.query(`
      ALTER TABLE bectu_rates
        DROP COLUMN IF EXISTS rate_type,
        DROP COLUMN IF EXISTS effective_to,
        DROP COLUMN IF EXISTS effective_from
    `);
    await queryRunner.query(`
      ALTER TABLE crew_members
        DROP COLUMN IF EXISTS company_utr,
        DROP COLUMN IF EXISTS qualifications
    `);
    await queryRunner.query(`
      ALTER TABLE cost_plus_budget_lines
        DROP COLUMN IF EXISTS line_type,
        DROP COLUMN IF EXISTS notes,
        DROP COLUMN IF EXISTS set_id,
        DROP COLUMN IF EXISTS is_above_line,
        DROP COLUMN IF EXISTS line_margin_rate,
        DROP COLUMN IF EXISTS agreed_rate,
        DROP COLUMN IF EXISTS bectu_rate
    `);
    await queryRunner.query(`ALTER TABLE cost_plus_budgets DROP COLUMN IF EXISTS notes`);
    await queryRunner.query(`ALTER TABLE productions DROP COLUMN IF EXISTS rollback_notice`);
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS avatar_url,
        DROP COLUMN IF EXISTS is_active
    `);
  }
}
