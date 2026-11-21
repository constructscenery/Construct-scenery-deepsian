import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS-03 — set codes.
 *
 * universal_set_codes — codes available on every production (e.g. management / above-the-line staff).
 *   category (SetCodeCategory): 'management'. Deactivate rather than delete: historic timesheets
 *   and POs keep referencing the code text.
 *
 * uq_sets_production_set_number — one set number per production (trimmed, case-insensitive).
 *   If duplicates already exist the index is skipped with a NOTICE instead of failing the deploy;
 *   the set import still prevents new duplicates in application code. Find existing duplicates with:
 *     SELECT production_id, LOWER(TRIM(set_number)), COUNT(*) FROM sets
 *     WHERE set_number IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;
 */
export class AddUniversalSetCodesAndSetUniqueness1795187892957 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS universal_set_codes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code        TEXT NOT NULL,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'management' CHECK (category IN ('management')),
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_universal_set_codes_code ON universal_set_codes (LOWER(TRIM(code)))
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM sets WHERE set_number IS NOT NULL AND TRIM(set_number) <> ''
          GROUP BY production_id, LOWER(TRIM(set_number)) HAVING COUNT(*) > 1
        ) THEN
          RAISE NOTICE 'uq_sets_production_set_number skipped: duplicate set numbers exist within a production';
        ELSE
          CREATE UNIQUE INDEX IF NOT EXISTS uq_sets_production_set_number
            ON sets (production_id, LOWER(TRIM(set_number)))
            WHERE set_number IS NOT NULL AND TRIM(set_number) <> '';
        END IF;
      END
      $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_sets_production_set_number`);
    await queryRunner.query(`DROP TABLE IF EXISTS universal_set_codes`);
  }
}
