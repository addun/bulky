package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00014_story_external_id.go", up00014, down00014)
}

func up00014(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "stories", "external_id")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE stories ADD COLUMN external_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_external_id
  ON stories(external_id COLLATE NOCASE)
  WHERE external_id != ''`)
	return err
}

func down00014(context.Context, *sql.DB) error {
	return nil
}
