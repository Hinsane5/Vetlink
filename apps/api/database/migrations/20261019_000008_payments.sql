ALTER TABLE payments ADD COLUMN request_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE payment_attempts ADD COLUMN request_fingerprint text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX payments_one_per_payable_idx ON payments(owner_id,payable_type,payable_id);
CREATE TABLE payment_callback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  event_id text NOT NULL UNIQUE CHECK (length(event_id) BETWEEN 8 AND 128),
  outcome payment_status NOT NULL CHECK (outcome IN ('pending','succeeded','failed')),
  received_at timestamptz NOT NULL DEFAULT now()
);
