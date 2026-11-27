import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FB-06 — verify a self-employed timesheet without an invoice (ADR-08).
 *
 * timesheets.invoice_override_reason / _by / _at record who pushed a timesheet through without an
 * invoice and why. All nullable: NULL = verified normally (or not verified yet). Additive only.
 */
export class AddTimesheetInvoiceOverride1795740571201 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE timesheets
        ADD COLUMN IF NOT EXISTS invoice_override_reason TEXT,
        ADD COLUMN IF NOT EXISTS invoice_override_by     UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS invoice_override_at     TIMESTAMPTZ
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE timesheets
        DROP COLUMN IF EXISTS invoice_override_at,
        DROP COLUMN IF EXISTS invoice_override_by,
        DROP COLUMN IF EXISTS invoice_override_reason
    `);
  }
}
