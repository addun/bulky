package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00003_receipts.go", up00003, down00003)
}

func up00003(_ context.Context, db *sql.DB) error {
	if _, err := db.Exec(`
DROP INDEX IF EXISTS idx_ocr_scan_lines_scan;
DROP TABLE IF EXISTS ocr_scan_lines;
DROP TABLE IF EXISTS ocr_scans;
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY,
  image_path TEXT NOT NULL,
  raw_response TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
`); err != nil {
		return err
	}
	has, err := hasColumn(db, "purchases", "receipt_id")
	if err != nil {
		return err
	}
	if !has {
		if _, err := db.Exec(`ALTER TABLE purchases ADD COLUMN receipt_id INTEGER REFERENCES receipts(id) ON DELETE SET NULL`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_purchases_receipt ON purchases(receipt_id)`)
	return err
}

func down00003(context.Context, *sql.DB) error {
	return nil
}
