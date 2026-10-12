CREATE TYPE account_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE user_role AS ENUM ('farmer', 'vet');
CREATE TYPE vet_verification_status AS ENUM ('not_submitted', 'pending', 'verified', 'revision_required');
CREATE TYPE consultation_service_type AS ENUM ('chat', 'visit');
CREATE TYPE consultation_status AS ENUM (
  'draft',
  'awaiting_payment',
  'requested',
  'scheduled',
  'reschedule_pending',
  'in_progress',
  'completed',
  'rejected',
  'cancelled'
);
CREATE TYPE visit_stage AS ENUM ('scheduled', 'en_route', 'arrived', 'examining', 'completed');
CREATE TYPE clinical_note_status AS ENUM ('draft', 'final');
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'expired');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  status account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE UNIQUE INDEX users_normalized_email_uq ON users (lower(btrim(email)));

CREATE TABLE role_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE farmer_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE vet_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  professional_name text,
  registration_reference text,
  verification_status vet_verification_status NOT NULL DEFAULT 'not_submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  species text[] NOT NULL DEFAULT '{}',
  timezone text NOT NULL,
  location jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, owner_id)
);

CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  label text NOT NULL,
  recipient_name text NOT NULL,
  phone text NOT NULL,
  address_line text NOT NULL,
  city text NOT NULL,
  province text NOT NULL,
  postal_code text NOT NULL,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE livestock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id uuid NOT NULL REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  farm_id uuid NOT NULL,
  display_code text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  species text NOT NULL CHECK (length(btrim(species)) > 0),
  breed text,
  sex text NOT NULL CHECK (sex IN ('female', 'male', 'unknown')),
  birth_date date,
  estimated_age_months integer CHECK (estimated_age_months IS NULL OR estimated_age_months >= 0),
  weight_kg numeric(8, 2) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (farm_id, farmer_id) REFERENCES farms(id, owner_id) ON DELETE RESTRICT,
  UNIQUE (farm_id, display_code),
  UNIQUE (id, farmer_id)
);

CREATE TABLE consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_code text NOT NULL UNIQUE,
  farmer_id uuid NOT NULL REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  animal_id uuid NOT NULL,
  service_type consultation_service_type NOT NULL,
  complaint text NOT NULL CHECK (length(btrim(complaint)) > 0),
  status consultation_status NOT NULL DEFAULT 'awaiting_payment',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  fee_snapshot_idr bigint NOT NULL CHECK (fee_snapshot_idr >= 0),
  commission_snapshot_idr bigint NOT NULL CHECK (
    commission_snapshot_idr >= 0 AND commission_snapshot_idr <= fee_snapshot_idr
  ),
  visit_address_snapshot jsonb,
  completion_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (animal_id, farmer_id) REFERENCES livestock(id, farmer_id) ON DELETE RESTRICT,
  CHECK (starts_at < ends_at),
  CHECK (service_type <> 'visit' OR visit_address_snapshot IS NOT NULL),
  UNIQUE (id, farmer_id, vet_id, animal_id)
);

CREATE INDEX consultations_farmer_created_idx ON consultations (farmer_id, created_at DESC);
CREATE INDEX consultations_vet_created_idx ON consultations (vet_id, created_at DESC);

CREATE TABLE consultation_visits (
  consultation_id uuid PRIMARY KEY REFERENCES consultations(id) ON DELETE RESTRICT,
  stage visit_stage NOT NULL DEFAULT 'scheduled',
  departure_at timestamptz,
  arrival_at timestamptz,
  examination_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((stage = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE,
  farmer_id uuid NOT NULL,
  vet_id uuid NOT NULL,
  animal_id uuid NOT NULL,
  complaint text NOT NULL DEFAULT '',
  findings text NOT NULL DEFAULT '',
  assessment text NOT NULL DEFAULT '',
  actions text NOT NULL DEFAULT '',
  care_instructions text NOT NULL DEFAULT '',
  status clinical_note_status NOT NULL DEFAULT 'draft',
  finalized_at timestamptz,
  finalized_by uuid REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES consultations(id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'draft' AND finalized_at IS NULL AND finalized_by IS NULL)
    OR (status = 'final' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
  )
);

CREATE FUNCTION prevent_final_clinical_note_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'final clinical notes are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinical_notes_final_immutable
  BEFORE UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION prevent_final_clinical_note_change();

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payable_type text NOT NULL CHECK (payable_type IN ('consultation', 'order')),
  payable_id uuid NOT NULL,
  method text NOT NULL,
  amount_idr bigint NOT NULL CHECK (amount_idr >= 0),
  status payment_status NOT NULL DEFAULT 'pending',
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  adapter_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, payable_type, payable_id, operation_key),
  UNIQUE (adapter_reference)
);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status payment_status NOT NULL DEFAULT 'pending',
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  adapter_reference text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, attempt_number),
  UNIQUE (payment_id, operation_key),
  UNIQUE (adapter_reference)
);

CREATE TABLE idempotency_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_scope text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('in_progress', 'completed', 'failed')),
  resource_type text,
  resource_id uuid,
  http_status smallint CHECK (http_status BETWEEN 100 AND 599),
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (actor_id, operation_scope, idempotency_key),
  CHECK ((state = 'in_progress' AND completed_at IS NULL) OR (state <> 'in_progress' AND completed_at IS NOT NULL))
);
