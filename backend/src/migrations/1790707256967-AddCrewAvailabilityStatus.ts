import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrewAvailabilityStatus1790707256967 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE crew_members
        ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'available';
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_crew_availability_status'
        ) THEN
          ALTER TABLE crew_members
            ADD CONSTRAINT chk_crew_availability_status
            CHECK (availability_status IN ('available', 'booked', 'unavailable'));
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crew_members_availability_status
        ON crew_members (availability_status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_crew_members_availability_status;
    `);

    await queryRunner.query(`
      ALTER TABLE crew_members
        DROP CONSTRAINT IF EXISTS chk_crew_availability_status;
    `);

    await queryRunner.query(`
      ALTER TABLE crew_members
        DROP COLUMN IF EXISTS availability_status;
    `);
  }
}
