import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductionContactsAndNotes1790176020293 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE productions
        ADD COLUMN IF NOT EXISTS supervising_art_director TEXT,
        ADD COLUMN IF NOT EXISTS supervising_art_director_mobile TEXT,
        ADD COLUMN IF NOT EXISTS supervising_art_director_email TEXT,
        ADD COLUMN IF NOT EXISTS financial_controller TEXT,
        ADD COLUMN IF NOT EXISTS financial_controller_mobile TEXT,
        ADD COLUMN IF NOT EXISTS financial_controller_email TEXT,
        ADD COLUMN IF NOT EXISTS art_dept_coordinator TEXT,
        ADD COLUMN IF NOT EXISTS art_dept_coordinator_mobile TEXT,
        ADD COLUMN IF NOT EXISTS art_dept_coordinator_email TEXT,
        ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await queryRunner.query(`
      ALTER TABLE purchase_orders
        ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_orders
        DROP COLUMN IF EXISTS notes;
    `);

    await queryRunner.query(`
      ALTER TABLE productions
        DROP COLUMN IF EXISTS notes,
        DROP COLUMN IF EXISTS art_dept_coordinator_email,
        DROP COLUMN IF EXISTS art_dept_coordinator_mobile,
        DROP COLUMN IF EXISTS art_dept_coordinator,
        DROP COLUMN IF EXISTS financial_controller_email,
        DROP COLUMN IF EXISTS financial_controller_mobile,
        DROP COLUMN IF EXISTS financial_controller,
        DROP COLUMN IF EXISTS supervising_art_director_email,
        DROP COLUMN IF EXISTS supervising_art_director_mobile,
        DROP COLUMN IF EXISTS supervising_art_director;
    `);
  }
}
