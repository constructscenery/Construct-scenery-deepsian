import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackInventoryPurchases1789475480281 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE materials_inventory
        ADD COLUMN IF NOT EXISTS quantity_purchased DECIMAL(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE materials_inventory
      SET quantity_purchased = quantity
      WHERE quantity_purchased = 0
    `);
    await queryRunner.query(`
      ALTER TABLE materials_inventory
        ADD CONSTRAINT materials_inventory_quantity_purchased_check
        CHECK (quantity_purchased >= 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE materials_inventory DROP CONSTRAINT IF EXISTS materials_inventory_quantity_purchased_check');
    await queryRunner.query('ALTER TABLE materials_inventory DROP COLUMN IF EXISTS quantity_purchased');
  }
}