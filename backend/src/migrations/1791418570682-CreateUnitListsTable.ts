import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUnitListsTable1791418570682 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS unit_lists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        file_key TEXT,
        file_size BIGINT,
        file_mime_type TEXT DEFAULT 'application/pdf',
        date DATE DEFAULT CURRENT_DATE,
        name TEXT,
        email TEXT,
        phone_number TEXT,
        company_name TEXT,
        notes TEXT,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_unit_lists_date ON unit_lists(date);
      CREATE INDEX IF NOT EXISTS idx_unit_lists_production_id ON unit_lists(production_id);
      CREATE INDEX IF NOT EXISTS idx_unit_lists_file_name ON unit_lists(file_name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS unit_lists');
  }
}
