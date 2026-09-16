import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendSupplierDirectory1789475480280 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS category TEXT,
        ADD COLUMN IF NOT EXISTS primary_contact_name TEXT,
        ADD COLUMN IF NOT EXISTS account_number TEXT,
        ADD COLUMN IF NOT EXISTS credit_terms TEXT,
        ADD COLUMN IF NOT EXISTS payment_terms TEXT,
        ADD COLUMN IF NOT EXISTS lead_times TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE suppliers
        DROP COLUMN IF EXISTS lead_times,
        DROP COLUMN IF EXISTS payment_terms,
        DROP COLUMN IF EXISTS credit_terms,
        DROP COLUMN IF EXISTS account_number,
        DROP COLUMN IF EXISTS primary_contact_name,
        DROP COLUMN IF EXISTS category
    `);
  }
}