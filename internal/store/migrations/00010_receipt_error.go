package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00010_receipt_error.go", up00010, down00010)
}

func up00010(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "receipts", "error_message")
	if err != nil || has {
		return err
	}
	_, err = db.Exec(`ALTER TABLE receipts ADD COLUMN error_message TEXT NOT NULL DEFAULT ''`)
	return err
}

func down00010(context.Context, *sql.DB) error {
	return nil
}
