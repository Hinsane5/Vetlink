CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  species text[] NOT NULL CHECK (cardinality(species) > 0),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  unit_price_idr bigint NOT NULL CHECK (unit_price_idr BETWEEN 1 AND 9007199254740991),
  image_attachment_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_active_name_id_idx ON products (lower(name), id) WHERE active;
CREATE INDEX products_active_category_idx ON products (lower(category)) WHERE active;
CREATE INDEX products_active_species_idx ON products USING gin (species) WHERE active;
CREATE INDEX products_active_price_idx ON products (unit_price_idr) WHERE active;

-- Existing BE-08 recommendation drafts may contain unvalidated product IDs.
-- NOT VALID preserves those snapshots while enforcing catalog links on new writes.
ALTER TABLE recommendation_items
  ADD CONSTRAINT recommendation_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT NOT VALID;
