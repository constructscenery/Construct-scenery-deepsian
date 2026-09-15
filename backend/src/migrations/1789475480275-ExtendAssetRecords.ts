import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendAssetRecords1789475480275 implements MigrationInterface {
  name = 'ExtendAssetRecords1789475480275';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assets
        ADD COLUMN IF NOT EXISTS make TEXT,
        ADD COLUMN IF NOT EXISTS model TEXT,
        ADD COLUMN IF NOT EXISTS serial_number TEXT,
        ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'location'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assets
        DROP COLUMN IF EXISTS assignment_type,
        DROP COLUMN IF EXISTS serial_number,
        DROP COLUMN IF EXISTS model,
        DROP COLUMN IF EXISTS make
    `);
  }
}
