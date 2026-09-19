import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBuildingFreelancerDocuments1789789230238 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, parent, column] of [
      ['building_documents', 'buildings', 'building_id'],
      ['freelancer_documents', 'freelancer_contacts', 'freelancer_id'],
    ]) {
      await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${table} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ${column} UUID NOT NULL REFERENCES ${parent}(id) ON DELETE RESTRICT,
        file_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        file_mime_type TEXT NOT NULL,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_${table}_parent ON ${table}(${column})`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS freelancer_documents');
    await queryRunner.query('DROP TABLE IF EXISTS building_documents');
  }
}