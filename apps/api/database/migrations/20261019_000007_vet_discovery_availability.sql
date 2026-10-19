CREATE TABLE vet_directory_profiles (
  vet_id uuid PRIMARY KEY REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  experience_years integer NOT NULL DEFAULT 0 CHECK (experience_years BETWEEN 0 AND 80),
  specialties text[] NOT NULL DEFAULT '{}',
  species text[] NOT NULL DEFAULT '{}',
  practice_location text NOT NULL DEFAULT '',
  service_areas text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE vet_availabilities (
  vet_id uuid PRIMARY KEY REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  accepting_new_requests boolean NOT NULL DEFAULT false,
  services text[] NOT NULL DEFAULT '{}',
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  weekday_rules jsonb NOT NULL DEFAULT '[]',
  chat_duration_minutes integer NOT NULL DEFAULT 30 CHECK (chat_duration_minutes BETWEEN 5 AND 240),
  visit_duration_minutes integer NOT NULL DEFAULT 60 CHECK (visit_duration_minutes BETWEEN 5 AND 240),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE vet_service_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  service_type consultation_service_type NOT NULL,
  fee_idr bigint NOT NULL CHECK (fee_idr >= 0),
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vet_id, service_type, effective_at)
);
CREATE INDEX vet_service_rates_current_idx ON vet_service_rates(vet_id, service_type, effective_at DESC);

CREATE TABLE vet_blocked_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (starts_at < ends_at)
);
CREATE INDEX vet_blocked_times_active_range_idx ON vet_blocked_times(vet_id, starts_at, ends_at) WHERE status = 'active';
