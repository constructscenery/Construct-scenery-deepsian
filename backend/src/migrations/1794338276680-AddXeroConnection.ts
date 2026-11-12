import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Addendum 6 — Xero connection (Sales module).
 *
 * xero_connection — one row (singleton). Holds the connected Xero organisation, the
 *                   AES-256-GCM encrypted OAuth tokens and the last sync result. The row is
 *                   kept on disconnect (tokens cleared, status 'disconnected') so cached
 *                   invoices stay visible and stay tied to the organisation they came from.
 * xero_invoices.tenant_id — which Xero organisation an invoice came from, so connecting a
 *                   different organisation never mixes two sets of books in the Sales view.
 */
export class AddXeroConnection1794338276680 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS xero_connection (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        singleton BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton),
        tenant_id TEXT NOT NULL,
        tenant_name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        access_token_expires_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect', 'disconnected')),
        connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_synced_at TIMESTAMPTZ,
        last_sync_attempt_at TIMESTAMPTZ,
        last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed')),
        last_sync_error TEXT,
        last_sync_count INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE xero_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_xero_invoices_tenant ON xero_invoices(tenant_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_xero_invoices_tenant;
      ALTER TABLE xero_invoices DROP COLUMN IF EXISTS tenant_id;
      DROP TABLE IF EXISTS xero_connection;
    `);
  }
}
