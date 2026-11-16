CREATE TYPE follow_up_status AS ENUM ('scheduled', 'completed', 'cancelled');
CREATE TYPE reminder_kind AS ENUM ('care', 'follow_up');
CREATE TYPE reminder_care_status AS ENUM ('scheduled', 'done');
CREATE TYPE reminder_delivery_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE notification_delivery_status AS ENUM ('pending', 'sent', 'failed');

ALTER TABLE consultations
  ADD COLUMN parent_consultation_id uuid REFERENCES consultations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT consultations_id_parent_owner_vet_animal_uq
    UNIQUE (id,parent_consultation_id,farmer_id,vet_id,animal_id);

CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL,
  farmer_id uuid NOT NULL,
  vet_id uuid NOT NULL,
  animal_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  kind text NOT NULL DEFAULT 'recheck' CHECK (kind = 'recheck'),
  status follow_up_status NOT NULL DEFAULT 'scheduled',
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  follow_up_consultation_id uuid,
  operation_key varchar(128) NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (starts_at < ends_at),
  CHECK (ends_at - starts_at BETWEEN interval '5 minutes' AND interval '4 hours'),
  FOREIGN KEY (consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES consultations(id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  UNIQUE (id, consultation_id, farmer_id, vet_id, animal_id),
  UNIQUE (vet_id, consultation_id, operation_key),
  FOREIGN KEY (follow_up_consultation_id, consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES consultations(id, parent_consultation_id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  UNIQUE (follow_up_consultation_id)
);
CREATE INDEX follow_ups_vet_active_range_idx
  ON follow_ups (vet_id, starts_at, ends_at)
  WHERE status = 'scheduled';
CREATE INDEX follow_ups_consultation_start_idx
  ON follow_ups (consultation_id, starts_at, id);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id uuid NOT NULL,
  farmer_id uuid NOT NULL,
  consultation_id uuid,
  vet_id uuid,
  follow_up_id uuid,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind reminder_kind NOT NULL,
  due_at timestamptz NOT NULL,
  instructions text NOT NULL CHECK (length(btrim(instructions)) BETWEEN 3 AND 500),
  care_status reminder_care_status NOT NULL DEFAULT 'scheduled',
  delivery_status reminder_delivery_status NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  delivery_attempt integer NOT NULL DEFAULT 0 CHECK (delivery_attempt >= 0),
  delivery_operation_id uuid,
  delivery_error jsonb,
  operation_key varchar(128) NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (animal_id, farmer_id) REFERENCES livestock(id, farmer_id) ON DELETE RESTRICT,
  CHECK ((consultation_id IS NULL) = (vet_id IS NULL)),
  FOREIGN KEY (consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES consultations(id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  FOREIGN KEY (follow_up_id, consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES follow_ups(id, consultation_id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  CHECK (follow_up_id IS NULL OR consultation_id IS NOT NULL),
  CHECK ((care_status = 'done') = (completed_at IS NOT NULL)),
  CHECK (delivery_status <> 'sent' OR delivery_operation_id IS NOT NULL),
  UNIQUE (created_by, operation_key),
  UNIQUE (id, farmer_id, animal_id)
);
CREATE INDEX reminders_owner_due_idx ON reminders (farmer_id, due_at, id);
CREATE INDEX reminders_vet_due_idx ON reminders (vet_id, due_at, id) WHERE consultation_id IS NOT NULL;

CREATE TABLE reminder_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES reminders(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt > 0),
  idempotency_key varchar(128) NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  operation_id uuid NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'succeeded', 'failed')),
  error jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reminder_id, actor_id, idempotency_key),
  UNIQUE (reminder_id, attempt)
);

CREATE TABLE progress_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL,
  follow_up_id uuid NOT NULL,
  farmer_id uuid NOT NULL,
  vet_id uuid NOT NULL,
  animal_id uuid NOT NULL,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 3 AND 2000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  operation_key varchar(128) NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES consultations(id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  FOREIGN KEY (follow_up_id, consultation_id, farmer_id, vet_id, animal_id)
    REFERENCES follow_ups(id, consultation_id, farmer_id, vet_id, animal_id) ON DELETE RESTRICT,
  UNIQUE (id, consultation_id, farmer_id),
  UNIQUE (farmer_id, follow_up_id, operation_key)
);
CREATE INDEX progress_reports_follow_up_submitted_idx
  ON progress_reports (follow_up_id, submitted_at, id);

CREATE TABLE progress_report_attachments (
  report_id uuid NOT NULL,
  attachment_id uuid NOT NULL UNIQUE,
  consultation_id uuid NOT NULL,
  farmer_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  PRIMARY KEY (report_id, attachment_id),
  UNIQUE (report_id, position),
  FOREIGN KEY (report_id, consultation_id, farmer_id)
    REFERENCES progress_reports(id, consultation_id, farmer_id) ON DELETE RESTRICT,
  FOREIGN KEY (attachment_id, consultation_id, farmer_id)
    REFERENCES attachments(id, consultation_id, owner_id) ON DELETE RESTRICT
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 80),
  context_id uuid NOT NULL,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 8 AND 128),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  read_at timestamptz,
  delivery_status notification_delivery_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, event_id)
);
CREATE INDEX notifications_recipient_created_idx ON notifications (recipient_id, created_at DESC, id DESC);

CREATE TABLE care_coordination_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_scope text NOT NULL CHECK (length(operation_scope) BETWEEN 1 AND 180),
  idempotency_key varchar(128) NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  resource_type text NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 40),
  resource_id uuid NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, operation_scope, idempotency_key)
);
CREATE INDEX care_coordination_operations_resource_idx
  ON care_coordination_operations (resource_type, resource_id);
