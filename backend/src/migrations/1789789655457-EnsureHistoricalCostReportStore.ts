import { MigrationInterface, QueryRunner } from 'typeorm';
import { HistoricalCostReportSource, HistoricalCostReportType } from '../enums';

export class EnsureHistoricalCostReportStore1789789655457 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS historical_cost_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
      production_name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('${HistoricalCostReportSource.AUTOMATIC}', '${HistoricalCostReportSource.MANUAL_UPLOAD}')),
      report_date DATE NOT NULL DEFAULT CURRENT_DATE,
      file_url TEXT,
      file_key TEXT,
      file_name TEXT,
      file_size BIGINT,
      file_mime_type TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await queryRunner.query('ALTER TABLE historical_cost_reports DROP CONSTRAINT IF EXISTS historical_cost_reports_report_type_check');
    await queryRunner.query(`ALTER TABLE historical_cost_reports ADD CONSTRAINT historical_cost_reports_report_type_check CHECK (report_type IN ('${HistoricalCostReportType.TYPE_1}', '${HistoricalCostReportType.TYPE_2}'))`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_reports_automatic ON historical_cost_reports(production_id, report_type) WHERE source = '${HistoricalCostReportSource.AUTOMATIC}'`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_historical_reports_date_type ON historical_cost_reports(report_date DESC, report_type)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_historical_reports_date_type');
    await queryRunner.query('DROP INDEX IF EXISTS idx_historical_reports_automatic');
    await queryRunner.query('ALTER TABLE historical_cost_reports DROP CONSTRAINT IF EXISTS historical_cost_reports_report_type_check');
    // Preserve the pre-existing archive table and its documents on rollback.
    await queryRunner.query("ALTER TABLE historical_cost_reports ADD CONSTRAINT historical_cost_reports_report_type_check CHECK (report_type IN ('type1', 'type2', 'manual'))");
  }
}