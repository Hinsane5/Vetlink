CREATE TYPE schedule_proposal_status AS ENUM ('pending', 'accepted', 'declined', 'superseded');

ALTER TABLE addresses ADD CONSTRAINT addresses_id_owner_uq UNIQUE (id, owner_id);
ALTER TABLE farms ADD COLUMN visit_address_id uuid;
ALTER TABLE farms ADD CONSTRAINT farms_visit_address_owned_fk
  FOREIGN KEY (visit_address_id, owner_id) REFERENCES addresses(id, owner_id) ON DELETE RESTRICT;

CREATE TABLE consultation_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id uuid NOT NULL REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  animal_id uuid NOT NULL,
  service_type consultation_service_type NOT NULL,
  complaint text NOT NULL CHECK (length(btrim(complaint)) BETWEEN 1 AND 4000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  fee_snapshot_idr bigint NOT NULL CHECK (fee_snapshot_idr > 0),
  commission_snapshot_idr bigint NOT NULL DEFAULT 0 CHECK (
    commission_snapshot_idr >= 0 AND commission_snapshot_idr <= fee_snapshot_idr
  ),
  visit_address_snapshot jsonb,
  idempotency_key varchar(128) NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  CHECK (service_type <> 'visit' OR visit_address_snapshot IS NOT NULL),
  FOREIGN KEY (animal_id, farmer_id) REFERENCES livestock(id, farmer_id) ON DELETE RESTRICT,
  UNIQUE (farmer_id, idempotency_key),
  UNIQUE (id, farmer_id, vet_id, animal_id)
);

ALTER TABLE consultations
  ADD COLUMN quote_id uuid UNIQUE REFERENCES consultation_quotes(id) ON DELETE RESTRICT,
  ADD COLUMN rejection_reason text,
  ADD COLUMN refund_status text NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'refund_needed')),
  ADD COLUMN reschedule_previous_status consultation_status
    CHECK (reschedule_previous_status IS NULL OR reschedule_previous_status IN ('requested', 'scheduled'));

CREATE TABLE consultation_schedule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  previous_status consultation_status NOT NULL CHECK (previous_status IN ('requested', 'scheduled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status schedule_proposal_status NOT NULL DEFAULT 'pending',
  responded_by uuid REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (starts_at < ends_at),
  CHECK ((status = 'pending') = (responded_at IS NULL)),
  CHECK ((responded_at IS NULL) = (responded_by IS NULL))
);

CREATE UNIQUE INDEX consultation_schedule_proposals_one_pending_idx
  ON consultation_schedule_proposals (consultation_id)
  WHERE status = 'pending';
CREATE INDEX consultation_schedule_proposals_pending_slot_idx
  ON consultation_schedule_proposals (starts_at, ends_at)
  WHERE status = 'pending';

CREATE TABLE consultation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role user_role NOT NULL,
  action_type text NOT NULL CHECK (length(action_type) BETWEEN 1 AND 80),
  action_scope text NOT NULL CHECK (length(action_scope) BETWEEN 1 AND 180),
  idempotency_key varchar(128) NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  from_status consultation_status,
  to_status consultation_status,
  from_visit_stage visit_stage,
  to_visit_stage visit_stage,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, action_scope, idempotency_key)
);
CREATE INDEX consultation_actions_history_idx
  ON consultation_actions (consultation_id, created_at, id);

CREATE FUNCTION prevent_consultation_action_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consultation actions are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consultation_actions_append_only
  BEFORE UPDATE OR DELETE ON consultation_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_consultation_action_change();
