import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinanceProductionSoftDeletion1789791823065 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE productions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    await queryRunner.query('ALTER TABLE historical_cost_reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE historical_cost_reports DROP COLUMN IF EXISTS deleted_at');
    await queryRunner.query('ALTER TABLE productions DROP COLUMN IF EXISTS deleted_at');
  }
}