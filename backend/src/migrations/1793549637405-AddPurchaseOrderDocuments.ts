import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseOrderDocuments1793549637405 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // CASCADE so permanently deleting a PO isn't blocked by its extra documents
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS purchase_order_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      file_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      file_mime_type TEXT NOT NULL,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_purchase_order_documents_parent ON purchase_order_documents(purchase_order_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS purchase_order_documents');
  }
}
