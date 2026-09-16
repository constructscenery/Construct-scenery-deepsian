import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkSuppliersToPurchaseOrders1789475480279 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_orders
        ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)`);
    await queryRunner.query(`
      UPDATE purchase_orders po
      SET supplier_id = s.id
      FROM suppliers s
      WHERE po.supplier_id IS NULL AND LOWER(po.supplier_name) = LOWER(s.name)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_purchase_orders_supplier');
    await queryRunner.query('ALTER TABLE purchase_orders DROP COLUMN IF EXISTS supplier_id');
  }
}