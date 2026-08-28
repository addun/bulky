package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00006_purchase_packages.go", up00006, down00006)
}

func up00006(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "package_count")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE purchases ADD COLUMN package_count TEXT`); err != nil {
			return err
		}
	}
	has, err = hasColumn(db, "purchases", "package_size")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE purchases ADD COLUMN package_size TEXT`); err != nil {
			return err
		}
	}
	return nil
}

func down00006(context.Context, *sql.DB) error {
	return nil
}
