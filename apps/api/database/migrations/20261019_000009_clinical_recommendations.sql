CREATE TYPE recommendation_status AS ENUM ('draft', 'sent');

CREATE TABLE recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE,
  farmer_id uuid NOT NULL,
  vet_id uuid NOT NULL,
  status recommendation_status NOT NULL DEFAULT 'draft',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
  FOREIGN KEY (farmer_id) REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (vet_id) REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

CREATE TABLE recommendation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES recommendations(id) ON DELETE RESTRICT,
  product_id uuid,
  title_snapshot text NOT NULL CHECK (length(btrim(title_snapshot)) BETWEEN 1 AND 160),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 2000),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id, position)
);

CREATE FUNCTION prevent_sent_recommendation_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'sent' THEN
    RAISE EXCEPTION 'sent recommendations are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recommendations_sent_immutable
  BEFORE UPDATE OR DELETE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION prevent_sent_recommendation_change();

CREATE FUNCTION prevent_sent_recommendation_item_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recommendations WHERE id = OLD.recommendation_id AND status = 'sent') THEN
    RAISE EXCEPTION 'sent recommendation items are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recommendation_items_sent_immutable
  BEFORE UPDATE OR DELETE ON recommendation_items
  FOR EACH ROW EXECUTE FUNCTION prevent_sent_recommendation_item_change();
