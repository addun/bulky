package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/shopspring/decimal"
	_ "modernc.org/sqlite"
)

func TestOpenFreshSeedsAndVersions(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	assertCurrentSchema(t, s.db)
	assertGooseVersion(t, s.db, 1)

	units, err := s.ListUnits()
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 {
		t.Fatalf("units: got %d want 2", len(units))
	}
	names := map[string]bool{}
	for _, u := range units {
		names[u.Name] = true
	}
	if !names["kg"] || !names["g"] {
		t.Fatalf("units: %#v", units)
	}
}

func TestOpenSecondBootNoops(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	assertCurrentSchema(t, s.db)
	assertGooseVersion(t, s.db, 1)

	units, err := s.ListUnits()
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 {
		t.Fatalf("units after second boot: got %d want 2", len(units))
	}
}

func TestOpenAddsPurchaseCompanyID(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "bulkly.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  image_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  street_name TEXT NOT NULL,
  building_number TEXT NOT NULL,
  apartment_number TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL
);
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  bought_on TEXT NOT NULL,
  quantity TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO units (name) VALUES ('kg'), ('g');
INSERT INTO companies (name, street_name, building_number, apartment_number, postal_code, city)
VALUES ('Acme', 'Al. Jerozolimskie', '1', '', '00-001', 'Warsaw');
INSERT INTO products (name, unit_id, created_at) VALUES ('Rice', 1, '2024-01-01T00:00:00Z');
INSERT INTO purchases (product_id, bought_on, quantity, amount, created_at)
VALUES (1, '2024-01-02', '10', '20.50', '2024-01-02T00:00:00Z');
`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	assertCurrentSchema(t, s.db)
	assertGooseVersion(t, s.db, 1)

	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM purchases`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("purchases: got %d want 1", n)
	}

	var companyID sql.NullInt64
	if err := s.db.QueryRow(`SELECT company_id FROM purchases`).Scan(&companyID); err != nil {
		t.Fatal(err)
	}
	if companyID.Valid {
		t.Fatalf("legacy purchase company_id: got %d want NULL", companyID.Int64)
	}
}

func TestPurchaseCompanyOptional(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	units, err := s.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	p, err := s.CreateProduct("Rice", units[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	buy, err := s.CreatePurchase(p.ID, 0, "2024-01-02", mustDec(t, "10"), mustDec(t, "20.50"))
	if err != nil {
		t.Fatal(err)
	}
	if buy.CompanyID != 0 {
		t.Fatalf("CompanyID: got %d want 0", buy.CompanyID)
	}
	if err := s.UpdatePurchase(buy.ID, 0, "2024-01-03", buy.Quantity, buy.Amount); err != nil {
		t.Fatal(err)
	}
}

func mustDec(t *testing.T, s string) decimal.Decimal {
	t.Helper()
	d, err := decimal.NewFromString(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func assertGooseVersion(t *testing.T, db *sql.DB, want int64) {
	t.Helper()
	var v int64
	err := db.QueryRow(`SELECT version_id FROM goose_db_version WHERE is_applied = 1 ORDER BY id DESC LIMIT 1`).Scan(&v)
	if err != nil {
		t.Fatalf("goose version: %v", err)
	}
	if v != want {
		t.Fatalf("goose version: got %d want %d", v, want)
	}
}

func assertCurrentSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, table := range []string{"units", "products", "companies", "purchases", "goose_db_version"} {
		if !tableExists(t, db, table) {
			t.Fatalf("missing table %s", table)
		}
	}
	for _, col := range []string{"street_name", "building_number", "apartment_number", "postal_code", "city"} {
		if !hasColumn(t, db, "companies", col) {
			t.Fatalf("companies missing %s", col)
		}
	}
	if !hasColumn(t, db, "purchases", "company_id") {
		t.Fatal("purchases missing company_id")
	}
	for _, idx := range []string{"idx_products_name", "idx_purchases_product", "idx_companies_name", "idx_purchases_company"} {
		if !indexExists(t, db, idx) {
			t.Fatalf("missing index %s", idx)
		}
	}
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func indexExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, name).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func hasColumn(t *testing.T, db *sql.DB, table, col string) bool {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			t.Fatal(err)
		}
		if name == col {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return false
}
