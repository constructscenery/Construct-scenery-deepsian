import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVehicleTaxDirectDebit1789475480277 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS tax_direct_debit BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vehicles
        DROP COLUMN IF EXISTS tax_direct_debit
    `);
  }
}
