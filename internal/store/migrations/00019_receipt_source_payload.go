package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00019_receipt_source_payload.go", up00019, down00019)
}

func up00019(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "receipts", "source_payload")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE receipts ADD COLUMN source_payload TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`UPDATE receipts SET source = 'ocr' WHERE source = ''`)
	return err
}

func down00019(_ context.Context, db *sql.DB) error {
	return nil
}
