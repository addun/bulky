-- Canonical SQLite schema for sqlc.
-- Goose remains the migrator. Update this snapshot when a migration changes tables.

CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  image_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE retail_chains (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  legal_name TEXT NOT NULL,
  tax_id TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE stories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  street_name TEXT NOT NULL,
  building_number TEXT NOT NULL,
  apartment_number TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  retail_chain_id INTEGER REFERENCES retail_chains(id),
  external_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  image_path TEXT NOT NULL,
  raw_response TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  story_id INTEGER REFERENCES stories(id),
  bought_on TEXT NOT NULL,
  quantity TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'purchase',
  receipt_id INTEGER REFERENCES receipts(id) ON DELETE SET NULL
);

CREATE TABLE product_aliases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  retail_chain_id INTEGER REFERENCES retail_chains(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  CHECK (NOT (story_id IS NOT NULL AND retail_chain_id IS NOT NULL))
);

CREATE TABLE product_unit_conversions (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  factor TEXT NOT NULL,
  PRIMARY KEY (product_id, unit_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_products_name ON products(name COLLATE NOCASE);
CREATE INDEX idx_purchases_product ON purchases(product_id, bought_on);
CREATE INDEX idx_purchases_story ON purchases(story_id);
CREATE INDEX idx_purchases_receipt ON purchases(receipt_id);
CREATE INDEX idx_stories_name ON stories(name COLLATE NOCASE);
CREATE INDEX idx_stories_retail_chain ON stories(retail_chain_id);
CREATE UNIQUE INDEX idx_stories_external_id
  ON stories(external_id COLLATE NOCASE)
  WHERE external_id != '';
CREATE INDEX idx_receipts_status ON receipts(status);
CREATE UNIQUE INDEX idx_product_aliases_shop
  ON product_aliases(story_id, alias COLLATE NOCASE)
  WHERE story_id IS NOT NULL;
CREATE UNIQUE INDEX idx_product_aliases_chain
  ON product_aliases(retail_chain_id, alias COLLATE NOCASE)
  WHERE retail_chain_id IS NOT NULL;
CREATE UNIQUE INDEX idx_product_aliases_global
  ON product_aliases(alias COLLATE NOCASE)
  WHERE story_id IS NULL AND retail_chain_id IS NULL;
CREATE INDEX idx_product_aliases_product ON product_aliases(product_id);
