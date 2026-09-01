package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00009_product_unit_conversions.go", up00009, down00009)
}

func up00009(_ context.Context, db *sql.DB) error {
	has, err := hasTable(db, "product_unit_conversions")
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	_, err = db.Exec(`
CREATE TABLE product_unit_conversions (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  factor TEXT NOT NULL,
  PRIMARY KEY (product_id, unit_id)
);
`)
	return err
}

func down00009(_ context.Context, db *sql.DB) error {
	_, err := db.Exec(`DROP TABLE IF EXISTS product_unit_conversions`)
	return err
}
