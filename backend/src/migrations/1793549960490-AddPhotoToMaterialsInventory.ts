import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhotoToMaterialsInventory1793549960490 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE materials_inventory
        ADD COLUMN IF NOT EXISTS photo_key TEXT,
        ADD COLUMN IF NOT EXISTS photo_name TEXT,
        ADD COLUMN IF NOT EXISTS photo_mime_type TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE materials_inventory
        DROP COLUMN IF EXISTS photo_mime_type,
        DROP COLUMN IF EXISTS photo_name,
        DROP COLUMN IF EXISTS photo_key
    `);
  }
}
