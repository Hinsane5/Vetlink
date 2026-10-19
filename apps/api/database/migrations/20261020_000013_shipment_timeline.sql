CREATE TYPE shipment_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'failed');
CREATE TYPE shipment_adapter_outcome AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status shipment_status NOT NULL DEFAULT 'pending',
  tracking_code text CHECK (tracking_code IS NULL OR length(btrim(tracking_code)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  event_id varchar(128) NOT NULL CHECK (length(event_id) BETWEEN 1 AND 128),
  adapter_operation_id uuid NOT NULL,
  outcome shipment_adapter_outcome NOT NULL,
  shipment_status shipment_status,
  from_order_status order_status,
  to_order_status order_status,
  tracking_code text CHECK (tracking_code IS NULL OR length(btrim(tracking_code)) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  error_code varchar(80),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, event_id),
  CHECK (
    (outcome = 'succeeded' AND shipment_status IN ('processing', 'shipped', 'delivered')
      AND from_order_status IS NOT NULL AND to_order_status IS NOT NULL AND error_code IS NULL)
    OR
    (outcome = 'pending' AND shipment_status IS NULL
      AND from_order_status IS NULL AND to_order_status IS NULL AND error_code IS NULL)
    OR
    (outcome = 'failed' AND shipment_status IS NULL
      AND from_order_status IS NULL AND to_order_status IS NULL AND error_code IS NOT NULL)
  )
);
CREATE INDEX shipment_events_timeline_idx ON shipment_events (shipment_id, occurred_at, id);

CREATE FUNCTION prevent_shipment_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shipment timeline events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER shipment_events_append_only
  BEFORE UPDATE OR DELETE ON shipment_events FOR EACH ROW EXECUTE FUNCTION prevent_shipment_event_change();

CREATE FUNCTION enforce_order_shipment_transition() RETURNS trigger AS $$
DECLARE
  event_matches boolean;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'awaiting_payment' AND NEW.status = 'paid' THEN
    IF NEW.payment_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = NEW.payment_id AND p.owner_id = NEW.farmer_id AND p.payable_type = 'order'
        AND p.payable_id = NEW.id AND p.status = 'succeeded' AND p.amount_idr = NEW.total_snapshot_idr
    ) THEN
      RAISE EXCEPTION 'order can become paid only after a matching payment succeeds' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (OLD.status = 'paid' AND NEW.status = 'processing')
     OR (OLD.status = 'processing' AND NEW.status = 'shipped')
     OR (OLD.status = 'shipped' AND NEW.status = 'delivered') THEN
    SELECT EXISTS (
      SELECT 1 FROM shipments s JOIN shipment_events e ON e.shipment_id = s.id
      WHERE s.order_id = NEW.id AND e.outcome = 'succeeded'
        AND e.from_order_status = OLD.status AND e.to_order_status = NEW.status
        AND e.shipment_status::text = NEW.status::text
    ) INTO event_matches;
    IF NOT event_matches THEN
      RAISE EXCEPTION 'order shipment transition requires a saved adapter event' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid order status transition' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER orders_status_transition_guard
  BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION enforce_order_shipment_transition();
