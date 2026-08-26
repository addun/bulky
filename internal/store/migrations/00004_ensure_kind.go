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
	return ensurePurchaseKindColumn(db)
}

func down00004(context.Context, *sql.DB) error {
	return nil
}
