import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSafetyHealthDocumentStatus1789475480284 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE safety_health_documents
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    `);
    await queryRunner.query(`
      ALTER TABLE safety_health_documents
        DROP CONSTRAINT IF EXISTS safety_health_documents_status_check
    `);
    await queryRunner.query(`
      ALTER TABLE safety_health_documents
        ADD CONSTRAINT safety_health_documents_status_check
        CHECK (status IN ('active', 'pending_alteration'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE safety_health_documents DROP CONSTRAINT IF EXISTS safety_health_documents_status_check');
    await queryRunner.query('ALTER TABLE safety_health_documents DROP COLUMN IF EXISTS status');
  }
}
