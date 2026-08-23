package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrUnitInUse   = errors.New("unit is in use")
	ErrDuplicate   = errors.New("already exists")
	ErrInvalidUnit = errors.New("invalid unit")
)

type Store struct {
	db      *sql.DB
	dataDir string
}

type Unit struct {
	ID           int64
	Name         string
	ProductCount int
}

type Product struct {
	ID        int64
	Name      string
	UnitID    int64
	UnitName  string
	ImagePath sql.NullString
	CreatedAt string
}

type ProductListItem struct {
	Product
	LastBought      sql.NullString
	LifetimeAmount  decimal.Decimal
	PurchaseCount   int
}

type Purchase struct {
	ID        int64
	ProductID int64
	BoughtOn  string
	Quantity  decimal.Decimal
	Amount    decimal.Decimal
	CreatedAt string
}

type YearSummary struct {
	Year     string
	Quantity decimal.Decimal
	Amount   decimal.Decimal
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "images"), 0o755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dataDir, "bulkly.db")
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db, dataDir: dataDir}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.seedUnits(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) DataDir() string {
	return s.dataDir
}

func (s *Store) ImagesDir() string {
	return filepath.Join(s.dataDir, "images")
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
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
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  bought_on TEXT NOT NULL,
  quantity TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id, bought_on);
`)
	return err
}

func (s *Store) seedUnits() error {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM units`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO units (name) VALUES ('kg'), ('g')`)
	return err
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func (s *Store) ListUnits() ([]Unit, error) {
	rows, err := s.db.Query(`
SELECT u.id, u.name, COUNT(p.id)
FROM units u
LEFT JOIN products p ON p.unit_id = u.id
GROUP BY u.id
ORDER BY u.name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Unit
	for rows.Next() {
		var u Unit
		if err := rows.Scan(&u.ID, &u.Name, &u.ProductCount); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) GetUnit(id int64) (Unit, error) {
	var u Unit
	err := s.db.QueryRow(`
SELECT u.id, u.name, COUNT(p.id)
FROM units u
LEFT JOIN products p ON p.unit_id = u.id
WHERE u.id = ?
GROUP BY u.id`, id).Scan(&u.ID, &u.Name, &u.ProductCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	return u, err
}

func (s *Store) FindUnitByName(name string) (Unit, error) {
	var u Unit
	err := s.db.QueryRow(`
SELECT u.id, u.name, COUNT(p.id)
FROM units u
LEFT JOIN products p ON p.unit_id = u.id
WHERE u.name = ? COLLATE NOCASE
GROUP BY u.id`, name).Scan(&u.ID, &u.Name, &u.ProductCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	return u, err
}

func (s *Store) CreateUnit(name string) (Unit, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Unit{}, ErrInvalidUnit
	}
	res, err := s.db.Exec(`INSERT INTO units (name) VALUES (?)`, name)
	if err != nil {
		if isUniqueErr(err) {
			return Unit{}, ErrDuplicate
		}
		return Unit{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Unit{}, err
	}
	return s.GetUnit(id)
}

func (s *Store) UpdateUnit(id int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidUnit
	}
	res, err := s.db.Exec(`UPDATE units SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		if isUniqueErr(err) {
			return ErrDuplicate
		}
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteUnit(id int64) error {
	u, err := s.GetUnit(id)
	if err != nil {
		return err
	}
	if u.ProductCount > 0 {
		return ErrUnitInUse
	}
	res, err := s.db.Exec(`DELETE FROM units WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListProducts(q string) ([]ProductListItem, error) {
	q = strings.TrimSpace(q)
	var rows *sql.Rows
	var err error
	if q == "" {
		rows, err = s.db.Query(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
ORDER BY p.name COLLATE NOCASE`)
	} else {
		rows, err = s.db.Query(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.name LIKE ? ESCAPE '\'
ORDER BY p.name COLLATE NOCASE`, likeContains(q))
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ProductListItem
	index := map[int64]int{}
	for rows.Next() {
		var it ProductListItem
		if err := rows.Scan(&it.ID, &it.Name, &it.UnitID, &it.UnitName, &it.ImagePath, &it.CreatedAt); err != nil {
			return nil, err
		}
		it.LifetimeAmount = decimal.Zero
		index[it.ID] = len(items)
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return items, nil
	}

	prows, err := s.db.Query(`SELECT product_id, bought_on, amount FROM purchases`)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var pid int64
		var boughtOn, amount string
		if err := prows.Scan(&pid, &boughtOn, &amount); err != nil {
			return nil, err
		}
		i, ok := index[pid]
		if !ok {
			continue
		}
		d, err := decimal.NewFromString(amount)
		if err != nil {
			return nil, err
		}
		items[i].LifetimeAmount = items[i].LifetimeAmount.Add(d)
		items[i].PurchaseCount++
		if !items[i].LastBought.Valid || boughtOn > items[i].LastBought.String {
			items[i].LastBought = sql.NullString{String: boughtOn, Valid: true}
		}
	}
	return items, prows.Err()
}

func (s *Store) GetProduct(id int64) (Product, error) {
	var p Product
	err := s.db.QueryRow(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.id = ?`, id).Scan(&p.ID, &p.Name, &p.UnitID, &p.UnitName, &p.ImagePath, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}

func (s *Store) ResolveUnit(unitID int64, newName string) (int64, error) {
	newName = strings.TrimSpace(newName)
	if newName != "" {
		u, err := s.FindUnitByName(newName)
		if err == nil {
			return u.ID, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return 0, err
		}
		u, err = s.CreateUnit(newName)
		if err != nil {
			return 0, err
		}
		return u.ID, nil
	}
	if unitID <= 0 {
		return 0, ErrInvalidUnit
	}
	if _, err := s.GetUnit(unitID); err != nil {
		return 0, err
	}
	return unitID, nil
}

func (s *Store) CreateProduct(name string, unitID int64, imagePath *string) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, fmt.Errorf("name is required")
	}
	if _, err := s.GetUnit(unitID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return Product{}, ErrInvalidUnit
		}
		return Product{}, err
	}
	res, err := s.db.Exec(
		`INSERT INTO products (name, unit_id, image_path, created_at) VALUES (?, ?, ?, ?)`,
		name, unitID, imagePath, nowRFC3339(),
	)
	if err != nil {
		return Product{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Product{}, err
	}
	return s.GetProduct(id)
}

func (s *Store) UpdateProduct(id int64, name string, unitID int64, imagePath *string, clearImage bool) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name is required")
	}
	if _, err := s.GetUnit(unitID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrInvalidUnit
		}
		return err
	}
	cur, err := s.GetProduct(id)
	if err != nil {
		return err
	}
	var path any
	switch {
	case clearImage:
		path = nil
	case imagePath != nil:
		path = *imagePath
	default:
		if cur.ImagePath.Valid {
			path = cur.ImagePath.String
		} else {
			path = nil
		}
	}
	res, err := s.db.Exec(`UPDATE products SET name = ?, unit_id = ?, image_path = ? WHERE id = ?`, name, unitID, path, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteProduct(id int64) (imageName string, err error) {
	p, err := s.GetProduct(id)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(`DELETE FROM products WHERE id = ?`, id)
	if err != nil {
		return "", err
	}
	if p.ImagePath.Valid {
		return p.ImagePath.String, nil
	}
	return "", nil
}

func (s *Store) ListPurchases(productID int64) ([]Purchase, error) {
	rows, err := s.db.Query(`
SELECT id, product_id, bought_on, quantity, amount, created_at
FROM purchases
WHERE product_id = ?
ORDER BY bought_on DESC, id DESC`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Purchase
	for rows.Next() {
		p, err := scanPurchase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetPurchase(id int64) (Purchase, error) {
	row := s.db.QueryRow(`
SELECT id, product_id, bought_on, quantity, amount, created_at
FROM purchases WHERE id = ?`, id)
	p, err := scanPurchase(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Purchase{}, ErrNotFound
	}
	return p, err
}

func (s *Store) CreatePurchase(productID int64, boughtOn string, quantity, amount decimal.Decimal) (Purchase, error) {
	if _, err := s.GetProduct(productID); err != nil {
		return Purchase{}, err
	}
	res, err := s.db.Exec(
		`INSERT INTO purchases (product_id, bought_on, quantity, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
		productID, boughtOn, quantity.String(), amount.String(), nowRFC3339(),
	)
	if err != nil {
		return Purchase{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Purchase{}, err
	}
	return s.GetPurchase(id)
}

func (s *Store) UpdatePurchase(id int64, boughtOn string, quantity, amount decimal.Decimal) error {
	res, err := s.db.Exec(
		`UPDATE purchases SET bought_on = ?, quantity = ?, amount = ? WHERE id = ?`,
		boughtOn, quantity.String(), amount.String(), id,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeletePurchase(id int64) error {
	res, err := s.db.Exec(`DELETE FROM purchases WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func YearlySummaries(purchases []Purchase) []YearSummary {
	order := []string{}
	byYear := map[string]*YearSummary{}
	for _, p := range purchases {
		year := p.BoughtOn
		if len(year) >= 4 {
			year = year[:4]
		}
		s, ok := byYear[year]
		if !ok {
			s = &YearSummary{Year: year, Quantity: decimal.Zero, Amount: decimal.Zero}
			byYear[year] = s
			order = append(order, year)
		}
		s.Quantity = s.Quantity.Add(p.Quantity)
		s.Amount = s.Amount.Add(p.Amount)
	}
	out := make([]YearSummary, 0, len(order))
	// purchases are newest-first, so first-seen year is newest
	seen := map[string]bool{}
	for _, y := range order {
		if seen[y] {
			continue
		}
		seen[y] = true
		out = append(out, *byYear[y])
	}
	return out
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanPurchase(row rowScanner) (Purchase, error) {
	var p Purchase
	var qty, amt string
	if err := row.Scan(&p.ID, &p.ProductID, &p.BoughtOn, &qty, &amt, &p.CreatedAt); err != nil {
		return Purchase{}, err
	}
	q, err := decimal.NewFromString(qty)
	if err != nil {
		return Purchase{}, err
	}
	a, err := decimal.NewFromString(amt)
	if err != nil {
		return Purchase{}, err
	}
	p.Quantity = q
	p.Amount = a
	return p, nil
}

func likeContains(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, `%`, `\%`)
	q = strings.ReplaceAll(q, `_`, `\_`)
	return "%" + q + "%"
}

func isUniqueErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
