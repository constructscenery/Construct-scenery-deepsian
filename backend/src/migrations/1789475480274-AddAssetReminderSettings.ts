import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssetReminderSettings1789475480274 implements MigrationInterface {
  name = 'AddAssetReminderSettings1789475480274';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE it_resources
        ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'annual',
        ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS reminder_days INTEGER NOT NULL DEFAULT 30
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE it_resources
        DROP COLUMN IF EXISTS reminder_days,
        DROP COLUMN IF EXISTS reminder_enabled,
        DROP COLUMN IF EXISTS billing_cycle
    `);
  }
}
