package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00012_retail_chains.go", up00012, down00012)
}

func up00012(_ context.Context, db *sql.DB) error {
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS retail_chains (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  legal_name TEXT NOT NULL,
  tax_id TEXT NOT NULL COLLATE NOCASE UNIQUE
);
`); err != nil {
		return err
	}
	has, err := hasColumn(db, "stories", "retail_chain_id")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE stories ADD COLUMN retail_chain_id INTEGER REFERENCES retail_chains(id)`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_stories_retail_chain ON stories(retail_chain_id)`)
	return err
}

func down00012(context.Context, *sql.DB) error {
	return nil
}
