CREATE TYPE health_event_kind AS ENUM ('examination','disease','vaccine','medication','care');
CREATE TYPE health_event_provenance AS ENUM ('farmer_report','clinical_note','reminder');

CREATE TABLE health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id uuid NOT NULL REFERENCES livestock(id) ON DELETE RESTRICT,
  kind health_event_kind NOT NULL,
  occurred_at timestamptz NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provenance health_event_provenance NOT NULL,
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 8 AND 128),
  clinical_note_id uuid UNIQUE REFERENCES clinical_notes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((provenance = 'clinical_note') = (clinical_note_id IS NOT NULL)),
  UNIQUE (provenance, source_key)
);
CREATE INDEX health_events_animal_timeline_idx ON health_events (animal_id, occurred_at DESC, id DESC);
