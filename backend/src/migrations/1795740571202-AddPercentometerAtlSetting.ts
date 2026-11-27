import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FB-07 — Percentometer "above the line" fixed costs (ADR-09), from Ben's Percentometer FINAL.xlsx.
 *
 * app_settings.percentometer_atl_pct (default 25): share of the estimated total construction cost
 *   taken by above-the-line fixed costs (construction manager, accountant, coordinator, buyer, HODs,
 *   box rental, runaround). Every department share is scaled by (1 − ATL).
 * forecasts.percentometer_atl_pct: the ATL % a saved scenario was calculated with, so old scenarios
 *   stay reproducible when the setting changes. NULL = saved before this change (no ATL).
 */
export class AddPercentometerAtlSetting1795740571202 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO app_settings (key, value) VALUES ('percentometer_atl_pct', '25'::jsonb)
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(`
      ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS percentometer_atl_pct DECIMAL(5,2)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE forecasts DROP COLUMN IF EXISTS percentometer_atl_pct`);
    await queryRunner.query(`DELETE FROM app_settings WHERE key = 'percentometer_atl_pct'`);
  }
}
