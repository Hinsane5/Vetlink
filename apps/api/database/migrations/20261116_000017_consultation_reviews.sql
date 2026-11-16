ALTER TABLE consultations
  ADD CONSTRAINT consultations_review_participants_uq UNIQUE (id, farmer_id, vet_id);

CREATE TABLE consultation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE,
  farmer_id uuid NOT NULL,
  vet_id uuid NOT NULL,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review_text text CHECK (
    review_text IS NULL OR (
      review_text = btrim(review_text)
      AND length(review_text) BETWEEN 1 AND 1000
    )
  ),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (consultation_id, farmer_id, vet_id)
    REFERENCES consultations (id, farmer_id, vet_id) ON DELETE RESTRICT
);

CREATE INDEX consultation_reviews_vet_submitted_idx
  ON consultation_reviews (vet_id, submitted_at DESC, id DESC);

CREATE FUNCTION prevent_consultation_review_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consultation reviews are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consultation_reviews_append_only
  BEFORE UPDATE OR DELETE ON consultation_reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_consultation_review_change();
