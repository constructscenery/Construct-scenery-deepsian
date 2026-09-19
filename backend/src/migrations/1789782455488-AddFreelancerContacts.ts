import { MigrationInterface, QueryRunner } from 'typeorm';
import { FreelancerCallPriority } from '../enums';

export class AddFreelancerContacts1789782455488 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS freelancer_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        skills TEXT,
        notes TEXT,
        is_favourite BOOLEAN NOT NULL DEFAULT false,
        call_priority TEXT NOT NULL DEFAULT '${FreelancerCallPriority.BACKUP}'
          CHECK (call_priority IN ('${FreelancerCallPriority.FIRST_CALL}', '${FreelancerCallPriority.BACKUP}', '${FreelancerCallPriority.NEVER_CALL}')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS freelancer_contacts');
  }
}