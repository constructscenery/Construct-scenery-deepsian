import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Addendum 6 — quote sending and history.
 *
 * quotes.revision     — 1 for the first version; +1 each time a Sent quote is revised.
 * quotes.share_token  — random token for the secure preview link (/api/public/quotes/:token);
 *                       set the first time the quote is shared by link.
 * quote_sends         — one row per send (email / download / link) with a snapshot of exactly
 *                       what went out, so every sent version can be re-opened.
 */
export class AddQuoteSendHistory1794420000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

      CREATE TABLE IF NOT EXISTS quote_sends (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('email', 'download', 'link')),
        sent_to TEXT,
        snapshot JSONB NOT NULL,
        sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_quote_sends_quote ON quote_sends(quote_id, sent_at DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS quote_sends;
      ALTER TABLE quotes DROP COLUMN IF EXISTS share_token;
      ALTER TABLE quotes DROP COLUMN IF EXISTS revision;
    `);
  }
}
