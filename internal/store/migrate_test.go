package store

import (
	"database/sql"
	"errors"
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
	assertGooseVersion(t, s.db, 7)

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
	assertGooseVersion(t, s.db, 7)

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
	assertGooseVersion(t, s.db, 7)

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

	var kind string
	if err := s.db.QueryRow(`SELECT kind FROM purchases`).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if kind != string(KindPurchase) {
		t.Fatalf("legacy purchase kind: got %q want %q", kind, KindPurchase)
	}
}

func TestOpenAddsKindWhenGooseAlreadyAtReceipts(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", filepath.Join(dir, "bulkly.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE purchases DROP COLUMN kind`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM goose_db_version WHERE version_id >= 4`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if !hasColumn(t, s.db, "purchases", "kind") {
		t.Fatal("purchases missing kind after reopen")
	}
	assertGooseVersion(t, s.db, 7)
	if _, err := s.ListProducts(""); err != nil {
		t.Fatalf("ListProducts: %v", err)
	}
}

func TestOpenRenamesRecipesToReceipts(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", filepath.Join(dir, "bulkly.db"))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`DROP INDEX IF EXISTS idx_receipts_status`,
		`DROP INDEX IF EXISTS idx_purchases_receipt`,
		`ALTER TABLE receipts RENAME TO recipes`,
		`ALTER TABLE purchases RENAME COLUMN receipt_id TO recipe_id`,
		`CREATE INDEX IF NOT EXISTS idx_recipes_status ON recipes(status)`,
		`CREATE INDEX IF NOT EXISTS idx_purchases_recipe ON purchases(recipe_id)`,
		`DELETE FROM goose_db_version WHERE version_id >= 5`,
	} {
		if _, err := db.Exec(q); err != nil {
			db.Close()
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	assertCurrentSchema(t, s.db)
	assertGooseVersion(t, s.db, 7)
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
	buy, err := s.CreatePurchase(p.ID, 0, "2024-01-02", mustDec(t, "10"), mustDec(t, "20.50"), KindPurchase, decimal.Zero, decimal.Zero)
	if err != nil {
		t.Fatal(err)
	}
	if buy.CompanyID != 0 {
		t.Fatalf("CompanyID: got %d want 0", buy.CompanyID)
	}
	if buy.ReceiptID != 0 {
		t.Fatalf("ReceiptID: got %d want 0", buy.ReceiptID)
	}
	if buy.Kind != KindPurchase {
		t.Fatalf("Kind: got %q want %q", buy.Kind, KindPurchase)
	}
	if err := s.UpdatePurchase(buy.ID, 0, "2024-01-03", buy.Quantity, buy.Amount, KindPurchase, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}
}

func TestPriceKindExcludedFromSpend(t *testing.T) {
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
	if _, err := s.CreatePurchase(p.ID, 0, "2024-06-01", mustDec(t, "10"), mustDec(t, "40"), KindPurchase, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(p.ID, 0, "2024-07-01", mustDec(t, "5"), mustDec(t, "30"), KindPrice, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}

	items, err := s.ListProducts("")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("products: got %d want 1", len(items))
	}
	if items[0].PurchaseCount != 1 {
		t.Fatalf("PurchaseCount: got %d want 1", items[0].PurchaseCount)
	}
	if !items[0].LifetimeAmount.Equal(mustDec(t, "40")) {
		t.Fatalf("LifetimeAmount: got %s want 40", items[0].LifetimeAmount)
	}
	if !items[0].LastBought.Valid || items[0].LastBought.String != "2024-06-01" {
		t.Fatalf("LastBought: got %#v want 2024-06-01", items[0].LastBought)
	}

	rows, err := s.ListPurchases(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("history: got %d want 2", len(rows))
	}
	years := YearlySummaries(rows)
	if len(years) != 1 || years[0].Year != "2024" {
		t.Fatalf("years: %#v", years)
	}
	if !years[0].Amount.Equal(mustDec(t, "40")) {
		t.Fatalf("year amount: got %s want 40", years[0].Amount)
	}
	if !years[0].Quantity.Equal(mustDec(t, "10")) {
		t.Fatalf("year qty: got %s want 10", years[0].Quantity)
	}

	if _, err := s.CreatePurchase(p.ID, 0, "2024-08-01", mustDec(t, "1"), mustDec(t, "1"), PurchaseKind("bogus"), decimal.Zero, decimal.Zero); !errors.Is(err, ErrInvalidKind) {
		t.Fatalf("invalid kind: %v", err)
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
	for _, table := range []string{"units", "products", "companies", "purchases", "receipts", "product_aliases", "goose_db_version"} {
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
	if !hasColumn(t, db, "purchases", "kind") {
		t.Fatal("purchases missing kind")
	}
	if !hasColumn(t, db, "purchases", "receipt_id") {
		t.Fatal("purchases missing receipt_id")
	}
	if !hasColumn(t, db, "purchases", "package_count") {
		t.Fatal("purchases missing package_count")
	}
	if !hasColumn(t, db, "purchases", "package_size") {
		t.Fatal("purchases missing package_size")
	}
	if tableExists(t, db, "ocr_scans") || tableExists(t, db, "ocr_scan_lines") || tableExists(t, db, "recipes") {
		t.Fatal("ocr_scans and recipes tables should be gone")
	}
	for _, col := range []string{"image_path", "raw_response", "status", "created_at"} {
		if !hasColumn(t, db, "receipts", col) {
			t.Fatalf("receipts missing %s", col)
		}
	}
	if !hasColumn(t, db, "product_aliases", "alias") {
		t.Fatal("product_aliases missing alias")
	}
	for _, idx := range []string{"idx_products_name", "idx_purchases_product", "idx_companies_name", "idx_purchases_company", "idx_receipts_status", "idx_purchases_receipt", "idx_product_aliases_shop", "idx_product_aliases_global", "idx_product_aliases_product"} {
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
