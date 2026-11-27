import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FB-08 — Cost Forecast options (Ben's item 9, ADR-04).
 *
 * cost_forecasts: rate card (standard/commercial) + the multiplier priced with (frozen on lock),
 *   travel £/hr, per diem £/day, master margin toggle + margin %, and margin totals.
 *   total_crew_cost / total_non_labour_cost / grand_total_cost stay COST without margin
 *   (the dashboard forecast-vs-actual variance reads total_crew_cost).
 * cost_forecast_crew_lines: synced card rates (daily_rate, default_ot_rate) and the user's extras —
 *   OT hours, travel hours, per diem days, Saturday / Sunday days — with optional typed rate
 *   overrides (NULL = default) and a per-line margin toggle.
 * cost_forecast_non_labour_lines: per-line margin toggle + margin amount.
 *
 * These tables are created at start-up by services/forecastingSchemaGuard.js (which adds the same
 * columns), so every statement is guarded with IF EXISTS / IF NOT EXISTS and is safe in any order.
 * Defaults keep every existing forecast's totals unchanged (margin off, extras 0, standard card).
 */
export class ExtendCostForecasts1795740571203 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS cost_forecasts
        ADD COLUMN IF NOT EXISTS rate_card_type          TEXT          NOT NULL DEFAULT 'standard',
        ADD COLUMN IF NOT EXISTS rate_multiplier         NUMERIC(5,4)  NOT NULL DEFAULT 1.0000,
        ADD COLUMN IF NOT EXISTS travel_hourly_rate      NUMERIC(10,2) NOT NULL DEFAULT 25.00,
        ADD COLUMN IF NOT EXISTS per_diem_rate           NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS margin_enabled          BOOLEAN       NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS margin_pct              NUMERIC(6,2)  NOT NULL DEFAULT 10.00,
        ADD COLUMN IF NOT EXISTS margin_total            NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS grand_total_with_margin NUMERIC(14,2)
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.cost_forecasts') IS NOT NULL THEN
          ALTER TABLE cost_forecasts DROP CONSTRAINT IF EXISTS cost_forecasts_rate_card_type_check;
          ALTER TABLE cost_forecasts ADD CONSTRAINT cost_forecasts_rate_card_type_check
            CHECK (rate_card_type IN ('standard', 'commercial'));
          -- existing forecasts: no margin yet, so "with margin" = cost
          UPDATE cost_forecasts SET grand_total_with_margin = grand_total_cost WHERE grand_total_with_margin IS NULL;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS cost_forecast_crew_lines
        ADD COLUMN IF NOT EXISTS daily_rate      NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS default_ot_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ot_hours        NUMERIC(8,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ot_rate         NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS travel_hours    NUMERIC(8,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS per_diem_days   NUMERIC(8,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS saturday_days   NUMERIC(8,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS saturday_rate   NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS sunday_days     NUMERIC(8,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS sunday_rate     NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS margin_applied  BOOLEAN       NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS margin_amount   NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS cost_forecast_non_labour_lines
        ADD COLUMN IF NOT EXISTS margin_applied BOOLEAN       NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS margin_amount  NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS cost_forecast_non_labour_lines
        DROP COLUMN IF EXISTS margin_amount,
        DROP COLUMN IF EXISTS margin_applied
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS cost_forecast_crew_lines
        DROP COLUMN IF EXISTS margin_amount,
        DROP COLUMN IF EXISTS margin_applied,
        DROP COLUMN IF EXISTS sunday_rate,
        DROP COLUMN IF EXISTS sunday_days,
        DROP COLUMN IF EXISTS saturday_rate,
        DROP COLUMN IF EXISTS saturday_days,
        DROP COLUMN IF EXISTS per_diem_days,
        DROP COLUMN IF EXISTS travel_hours,
        DROP COLUMN IF EXISTS ot_rate,
        DROP COLUMN IF EXISTS ot_hours,
        DROP COLUMN IF EXISTS default_ot_rate,
        DROP COLUMN IF EXISTS daily_rate
    `);
    await queryRunner.query(`ALTER TABLE IF EXISTS cost_forecasts DROP CONSTRAINT IF EXISTS cost_forecasts_rate_card_type_check`);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS cost_forecasts
        DROP COLUMN IF EXISTS grand_total_with_margin,
        DROP COLUMN IF EXISTS margin_total,
        DROP COLUMN IF EXISTS margin_pct,
        DROP COLUMN IF EXISTS margin_enabled,
        DROP COLUMN IF EXISTS per_diem_rate,
        DROP COLUMN IF EXISTS travel_hourly_rate,
        DROP COLUMN IF EXISTS rate_multiplier,
        DROP COLUMN IF EXISTS rate_card_type
    `);
  }
}
