import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMileageToVehicles1789475480276 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS mileage INTEGER
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vehicles
        DROP COLUMN IF EXISTS mileage
    `);
  }
}
