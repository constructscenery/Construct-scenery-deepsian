import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizePurchaseOrderSupplierLinks1789475480282 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE purchase_orders po
      SET supplier_id = s.id
      FROM suppliers s
      WHERE po.supplier_id IS NULL
        AND LOWER(BTRIM(po.supplier_name)) = LOWER(BTRIM(s.name))
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Supplier links are intentionally retained when this normalization is rolled back.
  }
}