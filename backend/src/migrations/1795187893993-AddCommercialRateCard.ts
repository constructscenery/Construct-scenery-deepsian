import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS-08 — commercial rate card.
 *
 * productions.rate_card_type (RateCardType): 'standard' | 'commercial'. Commercial productions pay
 *   every rate-card day and OT rate plus app_settings.commercial_rate_uplift_pct (default 10%).
 * timesheets.rate_multiplier: the multiplier in force when the timesheet was last priced
 *   (1.0000 = standard). A snapshot, so changing a production later never rewrites a finalised week.
 */
export class AddCommercialRateCard1795187893993 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE productions ADD COLUMN IF NOT EXISTS rate_card_type TEXT NOT NULL DEFAULT 'standard'
    `);
    await queryRunner.query(`ALTER TABLE productions DROP CONSTRAINT IF EXISTS productions_rate_card_type_check`);
    await queryRunner.query(`
      ALTER TABLE productions ADD CONSTRAINT productions_rate_card_type_check
        CHECK (rate_card_type IN ('standard', 'commercial'))
    `);
    await queryRunner.query(`
      ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS rate_multiplier DECIMAL(5,4) NOT NULL DEFAULT 1.0000
    `);
    await queryRunner.query(`ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_rate_multiplier_check`);
    await queryRunner.query(`
      ALTER TABLE timesheets ADD CONSTRAINT timesheets_rate_multiplier_check CHECK (rate_multiplier > 0)
    `);
    await queryRunner.query(`
      INSERT INTO app_settings (key, value) VALUES ('commercial_rate_uplift_pct', '10'::jsonb)
      ON CONFLICT (key) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_settings WHERE key = 'commercial_rate_uplift_pct'`);
    await queryRunner.query(`ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_rate_multiplier_check`);
    await queryRunner.query(`ALTER TABLE timesheets DROP COLUMN IF EXISTS rate_multiplier`);
    await queryRunner.query(`ALTER TABLE productions DROP CONSTRAINT IF EXISTS productions_rate_card_type_check`);
    await queryRunner.query(`ALTER TABLE productions DROP COLUMN IF EXISTS rate_card_type`);
  }
}
