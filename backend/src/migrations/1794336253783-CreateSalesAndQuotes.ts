import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Addendum 6 — Sales & Quotes (standalone tables).
 *
 * xero_invoices  — local cache of Xero sales invoices (ACCREC). Filled by the Xero
 *                  sync (built separately). production_id = allocation; NULL = unallocated.
 * quotes         — quote header. subtotal / discount_amount / vat_amount / total are an
 *                  aggregate of quote_lines, recalculated server-side on every change
 *                  (allowed by CLAUDE.md rule 4 as a kept-in-sync summary).
 * quote_lines    — one row per quote line.
 * quote_reference_seq — source of CSL-Q-XXXX references; a sequence never hands out
 *                  the same number twice, even under concurrent creates.
 */
export class CreateSalesAndQuotes1794336253783 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS xero_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        xero_invoice_id TEXT NOT NULL UNIQUE,
        invoice_number TEXT,
        contact_name TEXT,
        invoice_date DATE,
        due_date DATE,
        sub_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total NUMERIC(12, 2) NOT NULL DEFAULT 0,
        amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
        amount_credited NUMERIC(12, 2) NOT NULL DEFAULT 0,
        amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
        currency_code TEXT NOT NULL DEFAULT 'GBP',
        xero_status TEXT NOT NULL CHECK (xero_status IN ('draft', 'submitted', 'authorised', 'paid', 'voided', 'deleted')),
        reference TEXT,
        xero_updated_at TIMESTAMPTZ,
        production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
        allocated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        allocated_at TIMESTAMPTZ,
        first_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_xero_invoices_production ON xero_invoices(production_id);
      CREATE INDEX IF NOT EXISTS idx_xero_invoices_status ON xero_invoices(xero_status);
      CREATE INDEX IF NOT EXISTS idx_xero_invoices_invoice_date ON xero_invoices(invoice_date);

      CREATE SEQUENCE IF NOT EXISTS quote_reference_seq START 1;

      CREATE TABLE IF NOT EXISTS quotes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
        valid_until DATE NOT NULL,
        recipient_type TEXT NOT NULL CHECK (recipient_type IN ('internal', 'external')),
        production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
        department TEXT,
        recipient_name TEXT,
        recipient_company TEXT,
        recipient_email TEXT,
        introduction TEXT,
        footer_notes TEXT,
        discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')),
        discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
        vat_treatment TEXT NOT NULL DEFAULT 'standard' CHECK (vat_treatment IN ('standard', 'zero', 'exempt')),
        subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total NUMERIC(12, 2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'declined', 'awaiting_po_ref', 'invoice_raised')),
        status_note TEXT,
        po_reference TEXT,
        sent_at TIMESTAMPTZ,
        approved_at TIMESTAMPTZ,
        declined_at TIMESTAMPTZ,
        invoice_raised_at TIMESTAMPTZ,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT quotes_valid_until_check CHECK (valid_until >= quote_date)
      );

      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE INDEX IF NOT EXISTS idx_quotes_production ON quotes(production_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_quote_date ON quotes(quote_date);

      CREATE TABLE IF NOT EXISTS quote_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        line_type TEXT NOT NULL CHECK (line_type IN ('labour_grade', 'labour_department', 'materials', 'plant_hire', 'misc')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL,
        bectu_rate_id UUID REFERENCES bectu_rates(id) ON DELETE SET NULL,
        quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit TEXT,
        unit_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
        line_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id, sort_order);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS quote_lines;
      DROP TABLE IF EXISTS quotes;
      DROP SEQUENCE IF EXISTS quote_reference_seq;
      DROP TABLE IF EXISTS xero_invoices;
    `);
  }
}
