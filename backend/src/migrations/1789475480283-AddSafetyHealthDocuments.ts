import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSafetyHealthDocuments1789475480283 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS safety_health_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_type TEXT NOT NULL CHECK (document_type IN ('risk_template', 'risk_assessment', 'coshh', 'insurance')),
        file_url TEXT NOT NULL,
        file_key TEXT,
        file_name TEXT NOT NULL,
        file_size BIGINT,
        file_mime_type TEXT,
        assessment_date DATE,
        location TEXT,
        production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
        tags TEXT[] NOT NULL DEFAULT '{}',
        public_token TEXT UNIQUE,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_safety_health_type ON safety_health_documents(document_type)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_safety_health_date ON safety_health_documents(assessment_date)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_safety_health_production ON safety_health_documents(production_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS safety_health_documents');
  }
}
