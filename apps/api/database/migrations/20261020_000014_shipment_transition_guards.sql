ALTER TABLE shipment_events DROP CONSTRAINT shipment_events_check;
ALTER TABLE shipment_events ADD CONSTRAINT shipment_events_outcome_shape CHECK (
  (outcome = 'succeeded' AND shipment_status IS NOT NULL
    AND shipment_status IN ('processing', 'shipped', 'delivered')
    AND from_order_status IS NOT NULL AND to_order_status IS NOT NULL AND error_code IS NULL)
  OR
  (outcome = 'pending' AND shipment_status IS NULL
    AND from_order_status IS NULL AND to_order_status IS NULL AND error_code IS NULL)
  OR
  (outcome = 'failed' AND shipment_status IS NULL
    AND from_order_status IS NULL AND to_order_status IS NULL AND error_code IS NOT NULL)
);

CREATE FUNCTION enforce_shipment_status_transition() RETURNS trigger AS $$
DECLARE
  current_order_status order_status;
  event_matches boolean;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT status INTO current_order_status FROM orders WHERE id = NEW.order_id;

  IF NEW.status = 'failed' AND current_order_status = 'paid' THEN
    SELECT EXISTS (
      SELECT 1 FROM shipment_events e
      WHERE e.shipment_id = NEW.id AND e.outcome = 'failed'
    ) INTO event_matches;
    IF event_matches THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status IN ('processing', 'shipped', 'delivered')
        AND current_order_status::text = NEW.status::text THEN
    SELECT EXISTS (
      SELECT 1 FROM shipment_events e
      WHERE e.shipment_id = NEW.id AND e.outcome = 'succeeded'
        AND e.shipment_status = NEW.status
        AND e.to_order_status = current_order_status
    ) INTO event_matches;
    IF event_matches THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'shipment status transition requires a saved adapter result' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER shipments_status_transition_guard
  BEFORE UPDATE OF status ON shipments FOR EACH ROW EXECUTE FUNCTION enforce_shipment_status_transition();
