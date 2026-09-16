import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMaterialsCatalogueAndInventory1789475480278 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE materials_catalogue
        ADD COLUMN IF NOT EXISTS material_name TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS category TEXT,
        ADD COLUMN IF NOT EXISTS price_updated_date DATE
    `);
    await queryRunner.query(`
      UPDATE materials_catalogue
      SET material_name = COALESCE(material_name, product_description),
          description = COALESCE(description, product_description)
      WHERE material_name IS NULL OR description IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS materials_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_id UUID NOT NULL REFERENCES materials_catalogue(id),
        material_name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        quantity DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        unit_of_measure TEXT NOT NULL,
        production_id UUID REFERENCES productions(id),
        location TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS materials_inventory');
    await queryRunner.query(`ALTER TABLE materials_catalogue DROP COLUMN IF EXISTS price_updated_date, DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS material_name`);
  }
}