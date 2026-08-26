package migrations

import (
	"context"
	"database/sql"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00001_baseline.go", up00001, down00001)
}

func up00001(_ context.Context, db *sql.DB) error {
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  image_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  street_name TEXT NOT NULL,
  building_number TEXT NOT NULL,
  apartment_number TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id),
  bought_on TEXT NOT NULL,
  quantity TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id, bought_on);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name COLLATE NOCASE);
`); err != nil {
		return err
	}
	if err := ensurePurchaseCompanyColumn(db); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_purchases_company ON purchases(company_id)`); err != nil {
		return err
	}
	_, err := db.Exec(`INSERT OR IGNORE INTO units (name) VALUES ('kg'), ('g')`)
	return err
}

func down00001(context.Context, *sql.DB) error {
	return nil
}

func ensurePurchaseCompanyColumn(db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "company_id")
	if err != nil || has {
		return err
	}
	_, err = db.Exec(`ALTER TABLE purchases ADD COLUMN company_id INTEGER REFERENCES companies(id)`)
	return err
}

func ensurePurchaseKindColumn(db *sql.DB) error {
	has, err := hasColumn(db, "purchases", "kind")
	if err != nil || has {
		return err
	}
	_, err = db.Exec(`ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase'`)
	return err
}

func hasColumn(db *sql.DB, table, col string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(name, col) {
			return true, nil
		}
	}
	return false, rows.Err()
}
