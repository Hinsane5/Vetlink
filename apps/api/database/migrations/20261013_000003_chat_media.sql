CREATE TYPE attachment_kind AS ENUM ('image', 'video');
CREATE TYPE attachment_upload_status AS ENUM ('pending', 'uploaded', 'failed', 'committed');
CREATE TYPE message_delivery_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
  access_context text NOT NULL DEFAULT 'consultation' CHECK (access_context = 'consultation'),
  kind attachment_kind NOT NULL,
  mime_type text NOT NULL,
  filename text NOT NULL CHECK (length(btrim(filename)) BETWEEN 1 AND 255),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text UNIQUE,
  upload_key varchar(128) NOT NULL CHECK (length(upload_key) BETWEEN 8 AND 128),
  upload_fingerprint char(64) NOT NULL CHECK (upload_fingerprint ~ '^[0-9a-f]{64}$'),
  upload_status attachment_upload_status NOT NULL DEFAULT 'pending',
  upload_attempt integer NOT NULL DEFAULT 1 CHECK (upload_attempt > 0),
  upload_attempted_at timestamptz NOT NULL DEFAULT now(),
  failure_code text,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
    OR (kind = 'video' AND mime_type = 'video/mp4')
  ),
  CHECK (
    (upload_status IN ('pending', 'failed') AND storage_key IS NULL)
    OR (upload_status IN ('uploaded', 'committed') AND storage_key IS NOT NULL)
  ),
  CHECK ((upload_status = 'failed') = (failure_code IS NOT NULL)),
  CHECK ((upload_status = 'committed') = (committed_at IS NOT NULL)),
  UNIQUE (id, consultation_id, owner_id)
);

CREATE UNIQUE INDEX attachments_owner_upload_key_uq
  ON attachments (owner_id, consultation_id, upload_key);

CREATE INDEX attachments_consultation_owner_created_idx
  ON attachments (consultation_id, owner_id, created_at DESC);

CREATE TABLE consultation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_message_id uuid NOT NULL,
  text text,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  delivery_status message_delivery_status NOT NULL DEFAULT 'pending',
  delivery_attempt integer NOT NULL DEFAULT 1 CHECK (delivery_attempt > 0),
  delivery_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (text IS NULL OR (length(btrim(text)) BETWEEN 1 AND 4000)),
  CHECK ((delivery_status = 'sent') = (sent_at IS NOT NULL)),
  UNIQUE (consultation_id, sender_id, client_message_id),
  UNIQUE (id, consultation_id, sender_id)
);

CREATE INDEX consultation_messages_conversation_page_idx
  ON consultation_messages (consultation_id, created_at DESC, id DESC);

CREATE TABLE message_attachments (
  message_id uuid NOT NULL,
  attachment_id uuid NOT NULL UNIQUE,
  consultation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  PRIMARY KEY (message_id, attachment_id),
  UNIQUE (message_id, position),
  CHECK (sender_id = owner_id),
  FOREIGN KEY (message_id, consultation_id, sender_id)
    REFERENCES consultation_messages(id, consultation_id, sender_id) ON DELETE RESTRICT,
  FOREIGN KEY (attachment_id, consultation_id, owner_id)
    REFERENCES attachments(id, consultation_id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX message_attachments_consultation_idx
  ON message_attachments (consultation_id, message_id, position);
