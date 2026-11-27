import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RC-01 — editable commercial rates with version history (RATE_CARD_VERSIONING_PLAN.md).
 *
 * bectu_rates
 *   commercial_daily_rate / commercial_overtime_rate / commercial_weekly_rate
 *     NULL  = "Auto": standard rate × (1 + commercial_rate_uplift_pct), exactly as before.
 *     value = "Set": used as entered for commercial productions, never multiplied.
 *   created_by, change_note — who made a version and why.
 *   Each row is a version. An edit closes the current row (effective_to = day before) and inserts a new
 *   one, so the key becomes (trade, rank, rate_year, effective_from), with at most one current row per grade.
 *
 * timesheets
 *   applied_daily_rate / applied_overtime_rate — the rates a timesheet was last priced with (snapshot).
 *   Finalised timesheets are backfilled with exactly the rates they display today, so no old record changes.
 */
export class RateCardVersioningAndCommercialOverrides1795791330806 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // ── bectu_rates: columns ────────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE bectu_rates
        ADD COLUMN IF NOT EXISTS effective_from           DATE,
        ADD COLUMN IF NOT EXISTS effective_to             DATE,
        ADD COLUMN IF NOT EXISTS rate_type                TEXT DEFAULT 'bectu',
        ADD COLUMN IF NOT EXISTS commercial_daily_rate    NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS commercial_overtime_rate NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS commercial_weekly_rate   NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS change_note              TEXT
    `);
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS bectu_rates_commercial_rates_check`);
    await queryRunner.query(`
      ALTER TABLE bectu_rates ADD CONSTRAINT bectu_rates_commercial_rates_check CHECK (
        (commercial_daily_rate    IS NULL OR commercial_daily_rate    >= 0) AND
        (commercial_overtime_rate IS NULL OR commercial_overtime_rate >= 0) AND
        (commercial_weekly_rate   IS NULL OR commercial_weekly_rate   >= 0))
    `);
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS bectu_rates_change_note_check`);
    await queryRunner.query(`
      ALTER TABLE bectu_rates ADD CONSTRAINT bectu_rates_change_note_check
        CHECK (change_note IS NULL OR char_length(change_note) <= 500)
    `);
    // Same backfill as 1786900000000-EnsureAllModuleColumns (a version must have a start date).
    await queryRunner.query(`UPDATE bectu_rates SET effective_from = '2026-04-07'::date WHERE effective_from IS NULL`);

    // ── bectu_rates: keys ───────────────────────────────────────────────────────────────────────
    // Fail with a clear message rather than a raw index error if the data is not clean.
    const dupes: Array<{ trade: string; rank: string }> = await queryRunner.query(`
      SELECT trade, rank FROM bectu_rates WHERE effective_to IS NULL GROUP BY trade, rank HAVING COUNT(*) > 1
    `);
    if (dupes.length) {
      throw new Error(
        `bectu_rates has more than one current row for: ${dupes.map(d => `${d.trade} / ${d.rank}`).join(', ')}. ` +
        'Close the extra rows (set effective_to) before running this migration.'
      );
    }
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS "UQ_b5eb55e3a7ec27f48c53aed0914"`);
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS bectu_rates_trade_rank_rate_year_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS bectu_rates_trade_rank_effective`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bectu_rates_version ON bectu_rates (trade, rank, rate_year, effective_from)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bectu_rates_one_current ON bectu_rates (trade, rank) WHERE effective_to IS NULL
    `);

    // ── timesheets: rates actually used ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE timesheets
        ADD COLUMN IF NOT EXISTS applied_daily_rate    NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS applied_overtime_rate NUMERIC(10,2)
    `);

    // Backfill finalised timesheets with the rates they display TODAY. This is a frozen copy of the
    // pre-RC display rule (timesheetCalc.displayDailyRateSql/displayOvertimeRateSql for a finalised row):
    // the grade's row for the week's rate year, else the latest row; OT falls back to daily × 1.5 / 9.5;
    // the stored rate_multiplier is applied and rounded per rate.
    await queryRunner.query(`
      UPDATE timesheets t
         SET applied_daily_rate    = CASE WHEN p.m = 1 THEN p.d ELSE ROUND(p.d * p.m, 2) END,
             applied_overtime_rate = CASE WHEN p.m = 1 THEN p.o ELSE ROUND(p.o * p.m, 2) END
        FROM (
        SELECT t.id,
               COALESCE(t.rate_multiplier, 1) AS m,
               (SELECT br.daily_rate
                  FROM bectu_rates br
                 WHERE (br.trade = cm.crew_trade AND br.rank = COALESCE(t.rank_override, cm.crew_rank))
                    OR (br.trade = 'Non-BECTU' AND (br.rank = cm.crew_trade OR br.rank = COALESCE(t.rank_override, cm.crew_rank)))
                 ORDER BY (br.rate_year = ry.y) DESC, br.effective_from DESC NULLS LAST
                 LIMIT 1) AS d,
               (SELECT COALESCE(NULLIF(br.overtime_rate, 0), ROUND(br.daily_rate * 1.5 / 9.5, 2))
                  FROM bectu_rates br
                 WHERE (br.trade = cm.crew_trade AND br.rank = COALESCE(t.rank_override, cm.crew_rank))
                    OR (br.trade = 'Non-BECTU' AND (br.rank = cm.crew_trade OR br.rank = COALESCE(t.rank_override, cm.crew_rank)))
                 ORDER BY (br.rate_year = ry.y) DESC, br.effective_from DESC NULLS LAST
                 LIMIT 1) AS o
          FROM timesheets t
          JOIN crew_members cm ON cm.id = t.crew_member_id
          CROSS JOIN LATERAL (
            SELECT (CASE WHEN EXTRACT(MONTH FROM t.week_ending_date) >= 7 THEN EXTRACT(YEAR FROM t.week_ending_date)::int
                         ELSE EXTRACT(YEAR FROM t.week_ending_date)::int - 1 END)::text
                   || '/' ||
                   RIGHT(((CASE WHEN EXTRACT(MONTH FROM t.week_ending_date) >= 7 THEN EXTRACT(YEAR FROM t.week_ending_date)::int
                                ELSE EXTRACT(YEAR FROM t.week_ending_date)::int - 1 END) + 1)::text, 2) AS y
          ) ry
         WHERE t.status = 'finalised' -- TimesheetStatus.FINALISED
           AND t.applied_daily_rate IS NULL
        ) p
       WHERE t.id = p.id AND p.d IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Never throw history away silently: the old key allows one row per grade per rate year.
    const versions: Array<{ trade: string }> = await queryRunner.query(`
      SELECT trade FROM bectu_rates GROUP BY trade, rank, rate_year HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (versions.length) {
      throw new Error(
        'Cannot revert: bectu_rates holds more than one version of a rate in the same rate year. ' +
        'Reverting would require deleting rate history. Redeploy the previous build instead (the new columns are ignored by it).'
      );
    }
    await queryRunner.query(`ALTER TABLE timesheets DROP COLUMN IF EXISTS applied_overtime_rate`);
    await queryRunner.query(`ALTER TABLE timesheets DROP COLUMN IF EXISTS applied_daily_rate`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_bectu_rates_one_current`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_bectu_rates_version`);
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS "UQ_b5eb55e3a7ec27f48c53aed0914"`);
    await queryRunner.query(`
      ALTER TABLE bectu_rates ADD CONSTRAINT "UQ_b5eb55e3a7ec27f48c53aed0914" UNIQUE (trade, rank, rate_year)
    `);
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS bectu_rates_change_note_check`);
    await queryRunner.query(`ALTER TABLE bectu_rates DROP CONSTRAINT IF EXISTS bectu_rates_commercial_rates_check`);
    await queryRunner.query(`
      ALTER TABLE bectu_rates
        DROP COLUMN IF EXISTS change_note,
        DROP COLUMN IF EXISTS created_by,
        DROP COLUMN IF EXISTS commercial_weekly_rate,
        DROP COLUMN IF EXISTS commercial_overtime_rate,
        DROP COLUMN IF EXISTS commercial_daily_rate
    `);
    // effective_from / effective_to / rate_type pre-date this migration and are left in place.
  }
}
