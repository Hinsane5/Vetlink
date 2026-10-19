CREATE TYPE order_status AS ENUM ('awaiting_payment', 'paid', 'processing', 'shipped', 'delivered');

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id uuid NOT NULL UNIQUE REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, farmer_id)
);

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);
CREATE INDEX cart_items_cart_created_idx ON cart_items (cart_id, created_at, product_id);

CREATE TABLE checkout_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  cart_version integer NOT NULL CHECK (cart_version > 0),
  address_id uuid NOT NULL,
  address_version integer NOT NULL CHECK (address_version > 0),
  address_snapshot jsonb NOT NULL CHECK (jsonb_typeof(address_snapshot) = 'object'),
  line_snapshots jsonb NOT NULL CHECK (jsonb_typeof(line_snapshots) = 'array' AND jsonb_array_length(line_snapshots) > 0),
  subtotal_snapshot_idr bigint NOT NULL CHECK (subtotal_snapshot_idr BETWEEN 0 AND 9007199254740991),
  shipping_snapshot_idr bigint NOT NULL CHECK (shipping_snapshot_idr BETWEEN 0 AND 9007199254740991),
  shipping_label text NOT NULL CHECK (length(btrim(shipping_label)) BETWEEN 1 AND 120),
  shipping_adapter_operation_id uuid NOT NULL,
  total_snapshot_idr bigint NOT NULL CHECK (total_snapshot_idr BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at timestamptz,
  FOREIGN KEY (cart_id, farmer_id) REFERENCES carts(id, farmer_id) ON DELETE RESTRICT,
  CHECK (total_snapshot_idr = subtotal_snapshot_idr + shipping_snapshot_idr),
  UNIQUE (id, farmer_id)
);
CREATE INDEX checkout_quotes_farmer_created_idx ON checkout_quotes (farmer_id, created_at DESC);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_code text NOT NULL UNIQUE CHECK (length(display_code) BETWEEN 1 AND 24),
  farmer_id uuid NOT NULL REFERENCES farmer_profiles(user_id) ON DELETE RESTRICT,
  status order_status NOT NULL DEFAULT 'awaiting_payment',
  checkout_quote_id uuid NOT NULL UNIQUE REFERENCES checkout_quotes(id) ON DELETE RESTRICT,
  address_id uuid NOT NULL,
  address_snapshot jsonb NOT NULL CHECK (jsonb_typeof(address_snapshot) = 'object'),
  subtotal_snapshot_idr bigint NOT NULL CHECK (subtotal_snapshot_idr BETWEEN 0 AND 9007199254740991),
  shipping_snapshot_idr bigint NOT NULL CHECK (shipping_snapshot_idr BETWEEN 0 AND 9007199254740991),
  shipping_label_snapshot text NOT NULL CHECK (length(btrim(shipping_label_snapshot)) BETWEEN 1 AND 120),
  total_snapshot_idr bigint NOT NULL CHECK (total_snapshot_idr BETWEEN 0 AND 9007199254740991),
  payment_id uuid UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (checkout_quote_id, farmer_id) REFERENCES checkout_quotes(id, farmer_id) ON DELETE RESTRICT,
  CHECK (total_snapshot_idr = subtotal_snapshot_idr + shipping_snapshot_idr),
  CHECK ((status = 'paid' AND paid_at IS NOT NULL AND payment_id IS NOT NULL) OR status <> 'paid'),
  UNIQUE (id, farmer_id)
);
CREATE INDEX orders_farmer_created_idx ON orders (farmer_id, created_at DESC, id DESC);
CREATE INDEX orders_payment_idx ON orders (payment_id) WHERE payment_id IS NOT NULL;

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL CHECK (length(btrim(product_name_snapshot)) BETWEEN 1 AND 160),
  category_snapshot text NOT NULL CHECK (length(btrim(category_snapshot)) BETWEEN 1 AND 80),
  unit_price_snapshot_idr bigint NOT NULL CHECK (unit_price_snapshot_idr BETWEEN 0 AND 9007199254740991),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_snapshot_idr bigint NOT NULL CHECK (line_total_snapshot_idr BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (line_total_snapshot_idr = unit_price_snapshot_idr * quantity),
  UNIQUE (order_id, product_id)
);
CREATE INDEX order_items_order_idx ON order_items (order_id, created_at, id);

CREATE FUNCTION prevent_checkout_quote_snapshot_change() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.farmer_id, NEW.cart_id, NEW.cart_version, NEW.address_id, NEW.address_version,
         NEW.address_snapshot, NEW.line_snapshots, NEW.subtotal_snapshot_idr, NEW.shipping_snapshot_idr,
         NEW.shipping_label, NEW.shipping_adapter_operation_id, NEW.total_snapshot_idr, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.farmer_id, OLD.cart_id, OLD.cart_version, OLD.address_id, OLD.address_version,
         OLD.address_snapshot, OLD.line_snapshots, OLD.subtotal_snapshot_idr, OLD.shipping_snapshot_idr,
         OLD.shipping_label, OLD.shipping_adapter_operation_id, OLD.total_snapshot_idr, OLD.created_at, OLD.expires_at)
  THEN
    RAISE EXCEPTION 'checkout quote snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER checkout_quotes_snapshot_immutable
  BEFORE UPDATE ON checkout_quotes FOR EACH ROW EXECUTE FUNCTION prevent_checkout_quote_snapshot_change();

CREATE FUNCTION prevent_order_snapshot_change() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.display_code, NEW.farmer_id, NEW.checkout_quote_id, NEW.address_id, NEW.address_snapshot,
         NEW.subtotal_snapshot_idr, NEW.shipping_snapshot_idr, NEW.shipping_label_snapshot,
         NEW.total_snapshot_idr, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.display_code, OLD.farmer_id, OLD.checkout_quote_id, OLD.address_id, OLD.address_snapshot,
         OLD.subtotal_snapshot_idr, OLD.shipping_snapshot_idr, OLD.shipping_label_snapshot,
         OLD.total_snapshot_idr, OLD.created_at)
  THEN
    RAISE EXCEPTION 'order snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER orders_snapshot_immutable
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION prevent_order_snapshot_change();

CREATE FUNCTION prevent_order_item_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order item snapshots are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER order_items_snapshot_immutable
  BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION prevent_order_item_change();
