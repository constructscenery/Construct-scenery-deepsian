import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkSafetyHealthDocumentsToProductions1789475480285 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS safety_health_document_productions (
        document_id UUID NOT NULL REFERENCES safety_health_documents(id) ON DELETE CASCADE,
        production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, production_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_safety_health_document_productions_production ON safety_health_document_productions(production_id)`);
    await queryRunner.query(`
      INSERT INTO safety_health_document_productions (document_id, production_id)
      SELECT id, production_id FROM safety_health_documents
      WHERE production_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS safety_health_document_productions');
  }
}
