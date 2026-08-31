package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00008_settings.go", up00008, down00008)
}

func up00008(_ context.Context, db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)
	return err
}

func down00008(context.Context, *sql.DB) error {
	return nil
}
