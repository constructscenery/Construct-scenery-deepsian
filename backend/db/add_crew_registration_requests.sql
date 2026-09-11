-- Migration: Add crew_registration_requests table for external candidate self-onboarding

CREATE TABLE IF NOT EXISTS crew_registration_requests (
  id                              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status                          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  
  -- Personal information
  first_name                      TEXT NOT NULL,
  last_name                       TEXT NOT NULL,
  date_of_birth                   DATE,
  home_address                    TEXT, -- encrypted at rest
  email                           TEXT NOT NULL,
  phone                           TEXT,
  
  -- Employment classification & trade (filled by candidate)
  employment_status               TEXT NOT NULL CHECK (employment_status IN ('paye', 'self_employed')),
  crew_trade                      TEXT NOT NULL,
  
  -- Self-employed details (if applicable)
  company_name                    TEXT,
  company_registration_number     TEXT,
  vat_registration_number         TEXT,
  company_utr                     TEXT,
  
  -- Bank details (encrypted at rest)
  account_name                    TEXT,
  account_number                  TEXT,
  sort_code                       TEXT,
  
  -- Emergency contact
  emergency_contact_name          TEXT,
  emergency_contact_relationship  TEXT,
  emergency_contact_phone         TEXT, -- encrypted at rest
  
  -- Professional & notes
  qualifications                  TEXT[] DEFAULT '{}',
  notes                           TEXT,
  
  -- Review metadata (filled by company user on review/approval)
  reviewed_by                     UUID REFERENCES users(id),
  reviewed_at                     TIMESTAMPTZ,
  rejection_reason                TEXT,
  created_crew_member_id          UUID REFERENCES crew_members(id) ON DELETE SET NULL,
  
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_registration_requests_status ON crew_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_crew_registration_requests_email ON crew_registration_requests(email);
