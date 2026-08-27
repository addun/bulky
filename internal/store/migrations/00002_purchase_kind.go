package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00002_purchase_kind.go", up00002, down00002)
}

func up00002(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "kind")
	if err != nil || has {
		return err
	}
	_, err = db.Exec(`ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase'`)
	return err
}

func down00002(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "kind")
	if err != nil || !has {
		return err
	}
	_, err = db.Exec(`ALTER TABLE purchases DROP COLUMN kind`)
	return err
}
