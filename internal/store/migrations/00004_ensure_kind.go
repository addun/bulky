package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00004_ensure_kind.go", up00004, down00004)
}

func up00004(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "kind")
	if err != nil || has {
		return err
	}
	_, err = db.Exec(`ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase'`)
	return err
}

func down00004(context.Context, *sql.DB) error {
	return nil
}
