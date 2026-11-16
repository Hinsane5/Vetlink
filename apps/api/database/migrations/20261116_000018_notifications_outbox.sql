CREATE TYPE notification_category AS ENUM ('consultations', 'reminders', 'commerce');
CREATE TYPE notification_context_type AS ENUM ('follow_up', 'progress_report', 'reminder');
CREATE TYPE notification_outbox_status AS ENUM ('pending', 'sent', 'failed', 'suppressed');

ALTER TYPE notification_delivery_status ADD VALUE 'suppressed';

CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 8 AND 180),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  aggregate_type notification_context_type NOT NULL,
  aggregate_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domain_events_aggregate_idx ON domain_events(aggregate_type, aggregate_id, occurred_at, id);

ALTER TABLE notifications
  ADD COLUMN category notification_category NOT NULL DEFAULT 'reminders',
  ADD COLUMN context_type notification_context_type NOT NULL DEFAULT 'reminder',
  ADD COLUMN domain_event_id uuid;

UPDATE notifications
SET context_type = CASE
      WHEN type LIKE 'follow_up_%' THEN 'follow_up'::notification_context_type
      WHEN type = 'progress_report_submitted' THEN 'progress_report'::notification_context_type
      ELSE 'reminder'::notification_context_type
    END,
    category = CASE
      WHEN type LIKE 'follow_up_%' OR type LIKE 'progress_report_%' OR type LIKE 'reminder_%' OR type LIKE 'care_%'
        THEN 'reminders'::notification_category
      WHEN type LIKE 'order_%' OR type LIKE 'payment_%' THEN 'commerce'::notification_category
      ELSE 'consultations'::notification_category
    END;

INSERT INTO domain_events(event_key, event_type, aggregate_type, aggregate_id, actor_id, occurred_at, aggregate_version, payload)
SELECT DISTINCT ON (n.event_id)
  n.event_id,
  n.type,
  n.context_type,
  n.context_id,
  n.actor_id,
  n.created_at,
  1,
  jsonb_build_object('contextId', n.context_id, 'title', n.title, 'body', n.body, 'category', n.category)
FROM notifications n
ORDER BY n.event_id, n.created_at, n.id
ON CONFLICT (event_key) DO NOTHING;

UPDATE notifications n
SET domain_event_id = e.id
FROM domain_events e
WHERE e.event_key = n.event_id;

ALTER TABLE notifications
  ALTER COLUMN domain_event_id SET NOT NULL,
  ADD CONSTRAINT notifications_domain_event_fk FOREIGN KEY (domain_event_id) REFERENCES domain_events(id) ON DELETE RESTRICT;

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  categories jsonb NOT NULL DEFAULT '{"consultations":true,"reminders":true,"commerce":true}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    jsonb_typeof(categories) = 'object'
    AND categories ?& ARRAY['consultations', 'reminders', 'commerce']
    AND jsonb_typeof(categories->'consultations') = 'boolean'
    AND jsonb_typeof(categories->'reminders') = 'boolean'
    AND jsonb_typeof(categories->'commerce') = 'boolean'
    AND categories - ARRAY['consultations', 'reminders', 'commerce'] = '{}'::jsonb
  )
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 8 AND 128),
  delivery_status notification_outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, event_id)
);
CREATE INDEX notification_outbox_pending_idx
  ON notification_outbox(next_attempt_at, created_at, id)
  WHERE delivery_status = 'pending';

CREATE TABLE notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  operation_id uuid NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'succeeded', 'failed')),
  error jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, attempt),
  CHECK ((outcome = 'failed') = (error IS NOT NULL))
);
CREATE INDEX notification_delivery_attempts_notification_idx
  ON notification_delivery_attempts(notification_id, attempt);

INSERT INTO notification_outbox(notification_id, recipient_id, event_id, delivery_status, attempt_count)
SELECT id, recipient_id, event_id, delivery_status::text::notification_outbox_status,
  CASE WHEN delivery_status = 'pending' THEN 0 ELSE 1 END
FROM notifications
ON CONFLICT (recipient_id, event_id) DO NOTHING;

CREATE FUNCTION prevent_domain_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'domain events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER domain_events_append_only
  BEFORE UPDATE OR DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION prevent_domain_event_change();
