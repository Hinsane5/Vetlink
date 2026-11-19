ALTER TABLE consultations
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT consultations_cancellation_reason_length_check
    CHECK (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 3 AND 1000);
