package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00007_product_aliases.go", up00007, down00007)
}

func up00007(_ context.Context, db *sql.DB) error {
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS product_aliases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  alias TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_shop
  ON product_aliases(company_id, alias COLLATE NOCASE)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_global
  ON product_aliases(alias COLLATE NOCASE)
  WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_aliases_product ON product_aliases(product_id);
`); err != nil {
		return err
	}
	return nil
}

func down00007(context.Context, *sql.DB) error {
	return nil
}
