import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductionCodeColumn1790177000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE productions
        ADD COLUMN IF NOT EXISTS production_code TEXT;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_productions_production_code ON productions (production_code);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_productions_production_code;
    `);

    await queryRunner.query(`
      ALTER TABLE productions
        DROP COLUMN IF EXISTS production_code;
    `);
  }
}
