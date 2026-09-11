package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00018_receipt_source.go", up00018, down00018)
}

func up00018(_ context.Context, db *sql.DB) error {
	for _, col := range []string{"source", "external_id"} {
		has, err := hasColumn(db, "receipts", col)
		if err != nil {
			return err
		}
		if !has {
			if _, err := db.Exec(`ALTER TABLE receipts ADD COLUMN ` + col + ` TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
	}
	_, err := db.Exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_source_external
  ON receipts(source, external_id)
  WHERE source != '' AND external_id != ''`)
	return err
}

func down00018(context.Context, *sql.DB) error {
	return nil
}
