-- Create crew_role_contacts table
CREATE TABLE IF NOT EXISTS crew_role_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_type TEXT NOT NULL CHECK (role_type IN ('designer', 'supv_art', 'art_dir', 'fin_control', 'producer', 'upm', 'line_prod')),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company_or_production TEXT,
  notes TEXT,
  is_favourite BOOLEAN NOT NULL DEFAULT false,
  call_priority TEXT NOT NULL DEFAULT 'backup' CHECK (call_priority IN ('first_call', 'backup', 'never_call')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_role_contacts_role ON crew_role_contacts(role_type);
CREATE INDEX IF NOT EXISTS idx_crew_role_contacts_favourite ON crew_role_contacts(is_favourite);

-- Create role_contact_documents table
CREATE TABLE IF NOT EXISTS role_contact_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_contact_id UUID NOT NULL REFERENCES crew_role_contacts(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_contact_docs ON role_contact_documents(role_contact_id);

-- Create containers table
CREATE TABLE IF NOT EXISTS containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_number TEXT NOT NULL,
  container_type TEXT NOT NULL DEFAULT '20ft Storage Container',
  size TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_hire', 'in_use', 'maintenance', 'decommissioned')),
  ownership_status TEXT NOT NULL DEFAULT 'owned' CHECK (ownership_status IN ('owned', 'hired')),
  location TEXT,
  assigned_production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
  supplier TEXT,
  hire_start_date DATE,
  hire_end_date DATE,
  weekly_cost NUMERIC(10, 2),
  condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'damaged', 'needs_repair')),
  contents_description TEXT,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
CREATE INDEX IF NOT EXISTS idx_containers_ownership ON containers(ownership_status);
CREATE INDEX IF NOT EXISTS idx_containers_prod ON containers(assigned_production_id);

-- Create container_documents table
CREATE TABLE IF NOT EXISTS container_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_container_docs ON container_documents(container_id);
