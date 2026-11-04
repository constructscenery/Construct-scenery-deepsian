import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseOrderVoid1793741255579 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_orders
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS void_reason TEXT
    `);
    await queryRunner.query('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check');
    await queryRunner.query(`
      ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
        CHECK (status IN ('draft', 'submitted', 'issued', 'invoice_received', 'approved', 'voided'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE purchase_orders SET status = 'draft' WHERE status = 'voided'`);
    await queryRunner.query('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check');
    await queryRunner.query(`
      ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
        CHECK (status IN ('draft', 'submitted', 'issued', 'invoice_received', 'approved'))
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_orders
        DROP COLUMN IF EXISTS void_reason,
        DROP COLUMN IF EXISTS voided_by,
        DROP COLUMN IF EXISTS voided_at
    `);
  }
}
