CREATE TYPE verification_submission_status AS ENUM ('pending', 'revision_required', 'verified');

-- Reviewer grants are provisioned out-of-band by database operators; no API grants this capability.
CREATE TABLE trusted_reviewers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE professional_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  filename text NOT NULL CHECK (length(btrim(filename)) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  byte_size bigint NOT NULL CHECK (byte_size > 0), content_sha256 char(64) NOT NULL,
  storage_key uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  document_ids uuid[] NOT NULL CHECK (cardinality(document_ids) BETWEEN 1 AND 5),
  status verification_submission_status NOT NULL DEFAULT 'pending', reviewer_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
  reviewed_by uuid REFERENCES trusted_reviewers(user_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((status = 'pending') = (reviewed_at IS NULL AND reviewed_by IS NULL)),
  CHECK (status <> 'revision_required' OR length(btrim(reviewer_reason)) BETWEEN 1 AND 1000),
  CHECK (status <> 'verified' OR reviewer_reason IS NULL)
);
CREATE INDEX verification_submissions_queue_idx ON verification_submissions (submitted_at) WHERE status = 'pending';
