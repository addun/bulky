package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00017_comparison_groups.go", up00017, down00017)
}

func up00017(_ context.Context, db *sql.DB) error {
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS comparison_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comparison_group_products (
  group_id INTEGER NOT NULL REFERENCES comparison_groups(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_comparison_groups_unit ON comparison_groups(unit_id);
CREATE INDEX IF NOT EXISTS idx_comparison_group_products_product ON comparison_group_products(product_id);
`); err != nil {
		return err
	}
	return nil
}

func down00017(_ context.Context, db *sql.DB) error {
	_, err := db.Exec(`
DROP TABLE IF EXISTS comparison_group_products;
DROP TABLE IF EXISTS comparison_groups;
`)
	return err
}
