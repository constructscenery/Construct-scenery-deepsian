import { MigrationInterface, QueryRunner } from 'typeorm';

// SQL lives in a shared JS module so the startup schema guard runs exactly the same statements.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const schema: { UP_STATEMENTS: string[]; DOWN_STATEMENTS: string[] } = require('../../services/emailing/emailingSchema');

/**
 * Crew emailing + self-service portal.
 *
 *  - Extends email_log so every outbound message records its subject, content,
 *    recipient, related crew/production record, provider message id and
 *    delivery status, and doubles as the durable send queue (attempts,
 *    next_attempt_at, idempotency_key for duplicate prevention).
 *  - email_templates / email_batches   — editable templates and group sends
 *  - email_events / email_suppressions — SES delivery, bounce and complaint events
 *  - email_settings / email_test_recipients — live-sending gate + internal test group
 *  - crew_portal_links                 — reusable secure link per crew member
 *  - crew_timesheet_submissions (+entries), crew_invoice_submissions,
 *    crew_submission_reviews           — crew submissions held for office review
 *  - availability_polls (+recipients)  — availability requests and responses
 *
 * Existing rows in email_log are untouched; new columns are nullable or defaulted.
 * Every statement is re-runnable (IF NOT EXISTS / IF EXISTS).
 */
export class CrewEmailingAndPortal1791420874762 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of schema.UP_STATEMENTS) {
      await queryRunner.query(sql);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of schema.DOWN_STATEMENTS) {
      await queryRunner.query(sql);
    }
  }
}
