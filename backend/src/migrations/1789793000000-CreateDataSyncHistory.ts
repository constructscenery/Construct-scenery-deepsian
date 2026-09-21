import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDataSyncHistory1789793000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_sync_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename VARCHAR(255) NOT NULL,
        s3_key TEXT NOT NULL,
        s3_url TEXT NOT NULL,
        file_size BIGINT NOT NULL DEFAULT 0,
        tables_synced INTEGER NOT NULL DEFAULT 0,
        total_records INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
        triggered_by_type VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
        triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        triggered_by_user_name VARCHAR(255),
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_data_sync_history_created_at
        ON data_sync_history (created_at DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS data_sync_history CASCADE;
    `);
  }
}
