import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInsuranceExpiryReminders1789780440346 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE safety_health_documents
        ADD COLUMN IF NOT EXISTS expiry_date DATE,
        ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS reminder_days INTEGER NOT NULL DEFAULT 30
          CHECK (reminder_days BETWEEN 0 AND 365)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE safety_health_documents
        DROP COLUMN IF EXISTS reminder_days,
        DROP COLUMN IF EXISTS reminder_enabled,
        DROP COLUMN IF EXISTS expiry_date
    `);
  }
}