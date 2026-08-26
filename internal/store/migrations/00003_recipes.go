package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00003_recipes.go", up00003, down00003)
}

func up00003(_ context.Context, db *sql.DB) error {
	if _, err := db.Exec(`
DROP INDEX IF EXISTS idx_ocr_scan_lines_scan;
DROP TABLE IF EXISTS ocr_scan_lines;
DROP TABLE IF EXISTS ocr_scans;
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  image_path TEXT NOT NULL,
  raw_response TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipes_status ON recipes(status);
`); err != nil {
		return err
	}
	has, err := hasColumn(db, "purchases", "recipe_id")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE purchases ADD COLUMN recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_purchases_recipe ON purchases(recipe_id)`)
	if err != nil {
		return err
	}
	return ensurePurchaseKindColumn(db)
}

func down00003(context.Context, *sql.DB) error {
	return nil
}
