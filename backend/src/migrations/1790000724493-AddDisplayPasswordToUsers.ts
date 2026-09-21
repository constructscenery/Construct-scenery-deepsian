import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayPasswordToUsers1790000724493 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS display_password TEXT;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS display_password;
    `);
  }
}
