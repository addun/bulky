package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00015_drop_purchase_packages.go", up00015, down00015)
}

func up00015(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "package_count")
	if err != nil {
		return err
	}
	if has {
		if _, err := db.Exec(`ALTER TABLE purchases DROP COLUMN package_count`); err != nil {
			return err
		}
	}
	has, err = hasColumn(db, "purchases", "package_size")
	if err != nil {
		return err
	}
	if has {
		if _, err := db.Exec(`ALTER TABLE purchases DROP COLUMN package_size`); err != nil {
			return err
		}
	}
	return nil
}

func down00015(context.Context, *sql.DB) error {
	return nil
}
