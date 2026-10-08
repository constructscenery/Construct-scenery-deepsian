/**
 * Crew emailing schema — single source of truth for the SQL used by both the
 * TypeORM migration (src/migrations/1791420874762-CrewEmailingAndPortal.ts) and
 * the startup schema guard (services/emailing/schemaGuard.js).
 *
 * Every statement is re-runnable (IF NOT EXISTS / IF EXISTS).
 */

const UP_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS email_templates (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_key  TEXT UNIQUE,
      name          TEXT NOT NULL,
      message_type  TEXT NOT NULL,
      subject       TEXT NOT NULL,
      body          TEXT NOT NULL,
      is_system     BOOLEAN NOT NULL DEFAULT false,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_email_templates_message_type CHECK (message_type IN (
        'timesheet_reminder','invoice_request','availability_poll','manual',
        'submission_approved','submission_returned','submission_declined'))
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS availability_polls (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title             TEXT NOT NULL,
      message           TEXT,
      start_date        DATE NOT NULL,
      end_date          DATE NOT NULL,
      production_id     UUID REFERENCES productions(id) ON DELETE SET NULL,
      response_deadline DATE,
      created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at         TIMESTAMPTZ,
      closed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT chk_availability_polls_dates CHECK (end_date >= start_date)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS availability_poll_recipients (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id         UUID NOT NULL REFERENCES availability_polls(id) ON DELETE CASCADE,
      crew_member_id  UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
      invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      response        TEXT,
      response_notes  TEXT,
      responded_at    TIMESTAMPTZ,
      applied_status  TEXT,
      applied_at      TIMESTAMPTZ,
      applied_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT uq_availability_poll_recipient UNIQUE (poll_id, crew_member_id),
      CONSTRAINT chk_availability_response CHECK (response IS NULL OR response IN ('available','partial','unavailable')),
      CONSTRAINT chk_availability_applied_status CHECK (applied_status IS NULL OR applied_status IN ('available','booked','unavailable'))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_availability_poll_recipients_crew ON availability_poll_recipients (crew_member_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS email_batches (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_type         TEXT NOT NULL,
      template_id          UUID REFERENCES email_templates(id) ON DELETE SET NULL,
      subject              TEXT NOT NULL,
      body                 TEXT NOT NULL,
      production_id        UUID REFERENCES productions(id) ON DELETE SET NULL,
      week_ending_date     DATE,
      availability_poll_id UUID REFERENCES availability_polls(id) ON DELETE SET NULL,
      is_automated         BOOLEAN NOT NULL DEFAULT false,
      created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    ALTER TABLE email_log
      ADD COLUMN IF NOT EXISTS message_type        TEXT,
      ADD COLUMN IF NOT EXISTS subject             TEXT,
      ADD COLUMN IF NOT EXISTS body_html           TEXT,
      ADD COLUMN IF NOT EXISTS body_text           TEXT,
      ADD COLUMN IF NOT EXISTS related_record_type TEXT,
      ADD COLUMN IF NOT EXISTS crew_member_id      UUID REFERENCES crew_members(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS production_id       UUID REFERENCES productions(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS week_ending_date    DATE,
      ADD COLUMN IF NOT EXISTS template_id         UUID REFERENCES email_templates(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS batch_id            UUID REFERENCES email_batches(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS provider            TEXT,
      ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
      ADD COLUMN IF NOT EXISTS status              TEXT,
      ADD COLUMN IF NOT EXISTS status_updated_at   TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS attempts            INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_attempts        INTEGER NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS next_attempt_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_attempt_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS delivered_at        TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS idempotency_key     TEXT,
      ADD COLUMN IF NOT EXISTS reply_to            TEXT,
      ADD COLUMN IF NOT EXISTS is_automated        BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_test             BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS sent_by             UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `,
  `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_email_log_status') THEN
        ALTER TABLE email_log ADD CONSTRAINT chk_email_log_status CHECK (status IS NULL OR status IN (
          'queued','sending','sent','delivered','delayed','soft_bounced','bounced',
          'complained','rejected','failed','suppressed','cancelled'));
      END IF;
    END $$;
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_email_log_idempotency_key ON email_log (idempotency_key) WHERE idempotency_key IS NOT NULL
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_log_queue ON email_log (status, next_attempt_at) WHERE status IN ('queued','sending')
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_log_provider_message ON email_log (provider_message_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_log_crew ON email_log (crew_member_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_log_production ON email_log (production_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_log_batch ON email_log (batch_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS email_events (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_log_id        UUID REFERENCES email_log(id) ON DELETE SET NULL,
      provider_message_id TEXT,
      event_type          TEXT NOT NULL,
      recipient_email     TEXT,
      bounce_type         TEXT,
      bounce_subtype      TEXT,
      diagnostic          TEXT,
      occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sns_message_id      TEXT,
      raw_payload         TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_email_events_sns_recipient ON email_events (sns_message_id, (COALESCE(recipient_email, ''))) WHERE sns_message_id IS NOT NULL
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_events_log ON email_events (email_log_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS email_suppressions (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email          TEXT NOT NULL,
      reason         TEXT NOT NULL,
      detail         TEXT,
      email_event_id UUID REFERENCES email_events(id) ON DELETE SET NULL,
      created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cleared_at     TIMESTAMPTZ,
      cleared_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      cleared_note   TEXT,
      CONSTRAINT chk_email_suppressions_reason CHECK (reason IN ('hard_bounce','complaint','invalid_address','manual'))
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions_active ON email_suppressions (LOWER(email)) WHERE cleared_at IS NULL
  `,
  `
    CREATE TABLE IF NOT EXISTS email_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS email_test_recipients (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email      TEXT NOT NULL,
      name       TEXT,
      added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_email_test_recipients_email ON email_test_recipients (LOWER(email))
  `,
  `
    CREATE TABLE IF NOT EXISTS crew_portal_links (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_member_id  UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
      token_hash      TEXT NOT NULL UNIQUE,
      token_encrypted TEXT NOT NULL,
      created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL,
      last_used_at    TIMESTAMPTZ,
      revoked_at      TIMESTAMPTZ,
      revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_portal_links_active ON crew_portal_links (crew_member_id) WHERE revoked_at IS NULL
  `,
  `
    CREATE TABLE IF NOT EXISTS crew_timesheet_submissions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_member_id   UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
      production_id    UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
      week_ending_date DATE NOT NULL,
      status           TEXT NOT NULL DEFAULT 'submitted',
      crew_notes       TEXT,
      reviewer_notes   TEXT,
      revision         INTEGER NOT NULL DEFAULT 1,
      timesheet_id     UUID REFERENCES timesheets(id) ON DELETE SET NULL,
      submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_crew_timesheet_submissions_status CHECK (status IN ('submitted','returned','approved','declined'))
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_timesheet_submissions_open
      ON crew_timesheet_submissions (crew_member_id, production_id, week_ending_date)
      WHERE status IN ('submitted','returned','approved')
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_crew_timesheet_submissions_status ON crew_timesheet_submissions (status, submitted_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS crew_timesheet_submission_entries (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id        UUID NOT NULL REFERENCES crew_timesheet_submissions(id) ON DELETE CASCADE,
      date                 DATE NOT NULL,
      day_of_week          TEXT NOT NULL,
      full_day_worked      BOOLEAN NOT NULL DEFAULT false,
      overtime_hours       DECIMAL(6,2) NOT NULL DEFAULT 0,
      set_number           TEXT,
      site                 TEXT,
      travel               DECIMAL(10,2) NOT NULL DEFAULT 0,
      mileage              DECIMAL(10,2) NOT NULL DEFAULT 0,
      per_diem             DECIMAL(10,2) NOT NULL DEFAULT 0,
      ad_hoc_reimbursement DECIMAL(10,2) NOT NULL DEFAULT 0,
      meal_breakfast       BOOLEAN NOT NULL DEFAULT false,
      meal_lunch           BOOLEAN NOT NULL DEFAULT false,
      meal_supper          BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT uq_crew_timesheet_submission_entry_date UNIQUE (submission_id, date)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS crew_invoice_submissions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_member_id   UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
      production_id    UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
      week_ending_date DATE NOT NULL,
      invoice_number   TEXT,
      amount           DECIMAL(12,2),
      file_url         TEXT NOT NULL,
      file_key         TEXT,
      file_name        TEXT NOT NULL,
      file_size        BIGINT,
      file_mime_type   TEXT,
      status           TEXT NOT NULL DEFAULT 'submitted',
      crew_notes       TEXT,
      reviewer_notes   TEXT,
      revision         INTEGER NOT NULL DEFAULT 1,
      timesheet_id     UUID REFERENCES timesheets(id) ON DELETE SET NULL,
      submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_crew_invoice_submissions_status CHECK (status IN ('submitted','returned','approved','declined'))
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_invoice_submissions_open
      ON crew_invoice_submissions (crew_member_id, production_id, week_ending_date)
      WHERE status IN ('submitted','returned','approved')
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_crew_invoice_submissions_status ON crew_invoice_submissions (status, submitted_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS crew_submission_reviews (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      timesheet_submission_id UUID REFERENCES crew_timesheet_submissions(id) ON DELETE CASCADE,
      invoice_submission_id   UUID REFERENCES crew_invoice_submissions(id) ON DELETE CASCADE,
      action                  TEXT NOT NULL,
      notes                   TEXT,
      revision                INTEGER NOT NULL DEFAULT 1,
      actor_type              TEXT NOT NULL,
      actor_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_crew_submission_reviews_target CHECK (num_nonnulls(timesheet_submission_id, invoice_submission_id) = 1),
      CONSTRAINT chk_crew_submission_reviews_action CHECK (action IN ('submitted','resubmitted','approved','returned','declined')),
      CONSTRAINT chk_crew_submission_reviews_actor CHECK (actor_type IN ('crew','staff'))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_crew_submission_reviews_ts ON crew_submission_reviews (timesheet_submission_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_crew_submission_reviews_inv ON crew_submission_reviews (invoice_submission_id)
  `,
];

const DOWN_STATEMENTS = [
  `
    DROP TABLE IF EXISTS crew_submission_reviews
  `,
  `
    DROP TABLE IF EXISTS crew_invoice_submissions
  `,
  `
    DROP TABLE IF EXISTS crew_timesheet_submission_entries
  `,
  `
    DROP TABLE IF EXISTS crew_timesheet_submissions
  `,
  `
    DROP TABLE IF EXISTS crew_portal_links
  `,
  `
    DROP TABLE IF EXISTS email_test_recipients
  `,
  `
    DROP TABLE IF EXISTS email_settings
  `,
  `
    DROP TABLE IF EXISTS email_suppressions
  `,
  `
    DROP TABLE IF EXISTS email_events
  `,
  `
    DROP INDEX IF EXISTS idx_email_log_batch
  `,
  `
    DROP INDEX IF EXISTS idx_email_log_production
  `,
  `
    DROP INDEX IF EXISTS idx_email_log_crew
  `,
  `
    DROP INDEX IF EXISTS idx_email_log_provider_message
  `,
  `
    DROP INDEX IF EXISTS idx_email_log_queue
  `,
  `
    DROP INDEX IF EXISTS uq_email_log_idempotency_key
  `,
  `
    ALTER TABLE email_log DROP CONSTRAINT IF EXISTS chk_email_log_status
  `,
  `
    ALTER TABLE email_log
      DROP COLUMN IF EXISTS created_at,
      DROP COLUMN IF EXISTS sent_by,
      DROP COLUMN IF EXISTS is_test,
      DROP COLUMN IF EXISTS is_automated,
      DROP COLUMN IF EXISTS reply_to,
      DROP COLUMN IF EXISTS idempotency_key,
      DROP COLUMN IF EXISTS delivered_at,
      DROP COLUMN IF EXISTS last_attempt_at,
      DROP COLUMN IF EXISTS next_attempt_at,
      DROP COLUMN IF EXISTS max_attempts,
      DROP COLUMN IF EXISTS attempts,
      DROP COLUMN IF EXISTS status_updated_at,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS provider_message_id,
      DROP COLUMN IF EXISTS provider,
      DROP COLUMN IF EXISTS batch_id,
      DROP COLUMN IF EXISTS template_id,
      DROP COLUMN IF EXISTS week_ending_date,
      DROP COLUMN IF EXISTS production_id,
      DROP COLUMN IF EXISTS crew_member_id,
      DROP COLUMN IF EXISTS related_record_type,
      DROP COLUMN IF EXISTS body_text,
      DROP COLUMN IF EXISTS body_html,
      DROP COLUMN IF EXISTS subject,
      DROP COLUMN IF EXISTS message_type
  `,
  `
    DROP TABLE IF EXISTS email_batches
  `,
  `
    DROP TABLE IF EXISTS availability_poll_recipients
  `,
  `
    DROP TABLE IF EXISTS availability_polls
  `,
  `
    DROP TABLE IF EXISTS email_templates
  `,
];

module.exports = { UP_STATEMENTS, DOWN_STATEMENTS };
