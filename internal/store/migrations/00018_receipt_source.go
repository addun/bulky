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
	cols := []struct {
		name string
		ddl  string
	}{
		{"source", `ALTER TABLE receipts ADD COLUMN source TEXT NOT NULL DEFAULT ''`},
		{"external_id", `ALTER TABLE receipts ADD COLUMN external_id TEXT NOT NULL DEFAULT ''`},
		{"source_payload", `ALTER TABLE receipts ADD COLUMN source_payload TEXT NOT NULL DEFAULT ''`},
	}
	for _, col := range cols {
		has, err := hasColumn(db, "receipts", col.name)
		if err != nil {
			return err
		}
		if !has {
			if _, err := db.Exec(col.ddl); err != nil {
				return err
			}
		}
	}
	if _, err := db.Exec(`UPDATE receipts SET source = 'ocr' WHERE source = ''`); err != nil {
		return err
	}
	_, err := db.Exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_source_external
  ON receipts(source, external_id)
  WHERE external_id != ''`)
	return err
}

func down00018(_ context.Context, db *sql.DB) error {
	return nil
}
