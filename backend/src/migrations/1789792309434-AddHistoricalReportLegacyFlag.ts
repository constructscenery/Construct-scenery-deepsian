import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHistoricalReportLegacyFlag1789792309434 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE historical_cost_reports ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE historical_cost_reports DROP COLUMN IF EXISTS is_legacy');
  }
}