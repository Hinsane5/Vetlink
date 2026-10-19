CREATE TYPE earning_status AS ENUM ('pending', 'available');
CREATE TYPE ledger_entry_kind AS ENUM (
  'earn_pending',
  'release_pending',
  'credit_available',
  'reserve_withdrawal',
  'release_withdrawal',
  'payout_paid'
);
CREATE TYPE withdrawal_status AS ENUM ('submitting', 'submitted', 'processing', 'paid', 'rejected', 'failed');

CREATE TABLE payout_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  bank_label text NOT NULL CHECK (length(btrim(bank_label)) BETWEEN 1 AND 80),
  account_masked text NOT NULL CHECK (account_masked ~ '^[*•Xx -]+[0-9]{4}$'),
  account_holder text NOT NULL CHECK (length(btrim(account_holder)) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, vet_id)
);
CREATE INDEX payout_destinations_vet_active_idx ON payout_destinations(vet_id, active, created_at DESC);

CREATE TABLE earning_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  gross_idr bigint NOT NULL CHECK (gross_idr >= 0),
  commission_idr bigint NOT NULL CHECK (commission_idr >= 0 AND commission_idr <= gross_idr),
  net_idr bigint NOT NULL CHECK (net_idr >= 0 AND net_idr = gross_idr - commission_idr),
  status earning_status NOT NULL DEFAULT 'pending',
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, vet_id)
);
CREATE INDEX earning_transactions_vet_period_idx ON earning_transactions(vet_id, earned_at DESC, id DESC);

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL,
  destination_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(destination_snapshot) = 'object'
    AND destination_snapshot ?& ARRAY['id', 'label', 'bankLabel', 'accountMasked', 'accountHolder']
  ),
  amount_idr bigint NOT NULL CHECK (amount_idr > 0),
  fee_snapshot_idr bigint NOT NULL DEFAULT 0 CHECK (fee_snapshot_idr >= 0 AND fee_snapshot_idr <= amount_idr),
  net_amount_idr bigint NOT NULL CHECK (net_amount_idr = amount_idr - fee_snapshot_idr),
  status withdrawal_status NOT NULL DEFAULT 'submitting',
  operation_key varchar(128) NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 128),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  adapter_outcome text CHECK (adapter_outcome IS NULL OR adapter_outcome IN ('pending', 'succeeded', 'failed')),
  adapter_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (destination_id, vet_id) REFERENCES payout_destinations(id, vet_id) ON DELETE RESTRICT,
  UNIQUE (vet_id, operation_key),
  UNIQUE (id, vet_id),
  CHECK (status <> 'submitting' OR submitted_at IS NULL),
  CHECK (status IN ('submitting', 'failed') OR submitted_at IS NOT NULL)
);
CREATE INDEX withdrawals_vet_created_idx ON withdrawals(vet_id, created_at DESC, id DESC);

CREATE TABLE earning_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id uuid NOT NULL REFERENCES earning_transactions(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'succeeded', 'failed')),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  service_reference text,
  error_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'failed') = (error_code IS NOT NULL))
);

CREATE TABLE withdrawal_adapter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid NOT NULL REFERENCES withdrawals(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('submission', 'payout')),
  outcome text NOT NULL CHECK (outcome IN ('pending', 'succeeded', 'failed')),
  target_status text CHECK (target_status IS NULL OR target_status IN ('processing', 'paid', 'rejected', 'failed')),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  service_reference text,
  error_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'failed') = (error_code IS NOT NULL)),
  CHECK (event_type <> 'submission' OR target_status IS NULL),
  CHECK (event_type <> 'payout' OR (outcome = 'succeeded' AND target_status IS NOT NULL) OR outcome IN ('pending', 'failed'))
);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id uuid NOT NULL REFERENCES vet_profiles(user_id) ON DELETE RESTRICT,
  earning_id uuid,
  withdrawal_id uuid,
  kind ledger_entry_kind NOT NULL,
  amount_idr bigint NOT NULL CHECK (amount_idr > 0),
  operation_key varchar(200) NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 200),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (earning_id, vet_id) REFERENCES earning_transactions(id, vet_id) ON DELETE RESTRICT,
  FOREIGN KEY (withdrawal_id, vet_id) REFERENCES withdrawals(id, vet_id) ON DELETE RESTRICT,
  UNIQUE (operation_key),
  CHECK (
    (kind IN ('earn_pending', 'release_pending', 'credit_available') AND earning_id IS NOT NULL AND withdrawal_id IS NULL)
    OR (kind IN ('reserve_withdrawal', 'release_withdrawal', 'payout_paid') AND earning_id IS NULL AND withdrawal_id IS NOT NULL)
  )
);
CREATE INDEX ledger_entries_vet_occurred_idx ON ledger_entries(vet_id, occurred_at, id);
CREATE INDEX ledger_entries_earning_idx ON ledger_entries(earning_id) WHERE earning_id IS NOT NULL;
CREATE INDEX ledger_entries_withdrawal_idx ON ledger_entries(withdrawal_id) WHERE withdrawal_id IS NOT NULL;

CREATE FUNCTION prevent_ledger_entry_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_change();

CREATE FUNCTION enforce_earning_status_transition() RETURNS trigger AS $$
DECLARE
  has_settlement boolean;
  has_ledger_move boolean;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' OR NEW.status <> 'available' THEN
    RAISE EXCEPTION 'earning status transition is not allowed' USING ERRCODE = '23514';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM earning_settlement_events e
    WHERE e.earning_id = NEW.id AND e.outcome = 'succeeded'
  ) INTO has_settlement;
  SELECT NEW.net_idr = 0 OR (
    EXISTS (SELECT 1 FROM ledger_entries l WHERE l.earning_id = NEW.id AND l.kind = 'release_pending' AND l.amount_idr = NEW.net_idr)
    AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.earning_id = NEW.id AND l.kind = 'credit_available' AND l.amount_idr = NEW.net_idr)
  ) INTO has_ledger_move;
  IF NOT has_settlement OR NOT has_ledger_move THEN
    RAISE EXCEPTION 'earning availability requires a saved settlement and ledger transfer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER earning_status_transition_guard
  BEFORE UPDATE OF status ON earning_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_earning_status_transition();

CREATE FUNCTION prevent_earning_settlement_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'earning settlement events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER earning_settlement_events_append_only
  BEFORE UPDATE OR DELETE ON earning_settlement_events
  FOR EACH ROW EXECUTE FUNCTION prevent_earning_settlement_event_change();

CREATE FUNCTION prevent_withdrawal_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'withdrawal adapter events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER withdrawal_adapter_events_append_only
  BEFORE UPDATE OR DELETE ON withdrawal_adapter_events
  FOR EACH ROW EXECUTE FUNCTION prevent_withdrawal_event_change();

CREATE FUNCTION enforce_withdrawal_status_transition() RETURNS trigger AS $$
DECLARE
  has_adapter_result boolean;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitting' AND NEW.status = 'submitted' THEN
    SELECT EXISTS (
      SELECT 1 FROM withdrawal_adapter_events e
      WHERE e.withdrawal_id = NEW.id AND e.event_type = 'submission' AND e.outcome = 'succeeded'
    ) INTO has_adapter_result;
  ELSIF OLD.status = 'submitting' AND NEW.status = 'failed' THEN
    SELECT EXISTS (
      SELECT 1 FROM withdrawal_adapter_events e
      WHERE e.withdrawal_id = NEW.id AND e.event_type = 'submission' AND e.outcome = 'failed'
    ) INTO has_adapter_result;
  ELSIF OLD.status IN ('submitted', 'processing') AND NEW.status IN ('processing', 'paid', 'rejected', 'failed') THEN
    SELECT EXISTS (
      SELECT 1 FROM withdrawal_adapter_events e
      WHERE e.withdrawal_id = NEW.id AND e.event_type = 'payout'
        AND ((NEW.status = 'failed' AND e.outcome = 'failed') OR (e.outcome = 'succeeded' AND e.target_status = NEW.status::text))
    ) INTO has_adapter_result;
  ELSE
    has_adapter_result := false;
  END IF;

  IF NOT has_adapter_result THEN
    RAISE EXCEPTION 'withdrawal status transition requires a saved adapter result' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER withdrawal_status_transition_guard
  BEFORE UPDATE OF status ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION enforce_withdrawal_status_transition();
