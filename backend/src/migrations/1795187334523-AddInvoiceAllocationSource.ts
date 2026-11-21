import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS-06 — Xero invoice auto-link.
 *
 * xero_invoices.allocation_source (InvoiceAllocationSource):
 *   NULL     — never allocated by anyone; auto-link may allocate it
 *   'auto'   — allocated by auto-link from the Xero reference
 *   'manual' — a person allocated or unallocated it; auto-link never touches it again
 *
 * Existing allocations were all made by people, so they are backfilled as 'manual'.
 */
export class AddInvoiceAllocationSource1795187334523 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE xero_invoices ADD COLUMN IF NOT EXISTS allocation_source TEXT;
    `);
    await queryRunner.query(`
      ALTER TABLE xero_invoices DROP CONSTRAINT IF EXISTS xero_invoices_allocation_source_check;
    `);
    await queryRunner.query(`
      ALTER TABLE xero_invoices ADD CONSTRAINT xero_invoices_allocation_source_check
        CHECK (allocation_source IS NULL OR allocation_source IN ('auto', 'manual'));
    `);
    await queryRunner.query(`
      UPDATE xero_invoices SET allocation_source = 'manual'
      WHERE production_id IS NOT NULL AND allocation_source IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE xero_invoices DROP CONSTRAINT IF EXISTS xero_invoices_allocation_source_check`);
    await queryRunner.query(`ALTER TABLE xero_invoices DROP COLUMN IF EXISTS allocation_source`);
  }
}
