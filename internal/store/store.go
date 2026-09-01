package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	_ "modernc.org/sqlite"

	"github.com/adrian/bulkly/internal/match"
)

var (
	ErrNotFound           = errors.New("not found")
	ErrUnitInUse          = errors.New("unit is in use")
	ErrCompanyInUse       = errors.New("company is in use")
	ErrDuplicate          = errors.New("already exists")
	ErrInvalidUnit        = errors.New("invalid unit")
	ErrInvalidCompany     = errors.New("invalid company")
	ErrCompanyName        = errors.New("company name required")
	ErrCompanyStreet      = errors.New("company street name required")
	ErrCompanyBuilding    = errors.New("company building number required")
	ErrCompanyPostal      = errors.New("company postal code required")
	ErrCompanyCity        = errors.New("company city required")
	ErrInvalidKind        = errors.New("invalid purchase kind")
	ErrIncompletePackage  = errors.New("packages and package size are both required")
	ErrInvalidPackage     = errors.New("packages and package size must be greater than zero")
	ErrInvalidAlias       = errors.New("alias is required")
	ErrInvalidSetting     = errors.New("invalid setting")
	ErrSameProduct        = errors.New("cannot merge a product into itself")
	ErrUnitMismatch       = errors.New("products use different units")
	ErrInvalidConversion  = errors.New("invalid unit conversion")
	ErrConversionMismatch = errors.New("products convert to a unit differently")
)

const purchaseSelect = `
SELECT p.id, p.product_id, p.company_id, p.kind, p.receipt_id, p.bought_on, p.quantity, p.amount, p.created_at,
       p.package_count, p.package_size
FROM purchases p`

const receiptPurchaseSelect = `
SELECT p.id, p.product_id, p.company_id, p.kind, p.receipt_id, p.bought_on, p.quantity, p.amount, p.created_at,
       p.package_count, p.package_size, pr.name, u.name, pr.image_path
FROM purchases p
JOIN products pr ON pr.id = p.product_id
JOIN units u ON u.id = pr.unit_id`

type PurchaseKind string

const (
	KindPurchase PurchaseKind = "purchase"
	KindPrice    PurchaseKind = "price"
)

func ParsePurchaseKind(s string) (PurchaseKind, error) {
	switch PurchaseKind(strings.TrimSpace(s)) {
	case KindPurchase:
		return KindPurchase, nil
	case KindPrice:
		return KindPrice, nil
	default:
		return "", ErrInvalidKind
	}
}

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
	ID          int64
	Name        string
	UnitID      int64
	UnitName    string
	ImagePath   sql.NullString
	CreatedAt   string
	Conversions []ProductConversion
}

type ProductListItem struct {
	Product
	LastBought     sql.NullString
	LifetimeAmount decimal.Decimal
	PurchaseCount  int
}

type Company struct {
	ID              int64
	Name            string
	StreetName      string
	BuildingNumber  string
	ApartmentNumber string
	PostalCode      string
	City            string
	PurchaseCount   int
}

func (c Company) StreetLine() string {
	s := strings.TrimSpace(c.StreetName + " " + c.BuildingNumber)
	if c.ApartmentNumber != "" {
		s += "/" + c.ApartmentNumber
	}
	return s
}

func (c Company) AddressLine() string {
	street := c.StreetLine()
	loc := strings.TrimSpace(c.PostalCode + " " + c.City)
	switch {
	case street != "" && loc != "":
		return street + ", " + loc
	case street != "":
		return street
	default:
		return loc
	}
}

func (c Company) Label() string {
	addr := c.AddressLine()
	if addr == "" {
		return c.Name
	}
	return c.Name + " — " + addr
}

type Purchase struct {
	ID           int64
	ProductID    int64
	CompanyID    int64
	Kind         PurchaseKind
	ReceiptID    int64
	BoughtOn     string
	Quantity     decimal.Decimal
	PackageCount decimal.Decimal
	PackageSize  decimal.Decimal
	Amount       decimal.Decimal
	CreatedAt    string
}

type ReceiptPurchase struct {
	Purchase
	ProductName string
	UnitName    string
	ImagePath   sql.NullString
}

func (p Purchase) IsPurchase() bool { return p.Kind == KindPurchase }
func (p Purchase) IsPrice() bool    { return p.Kind == KindPrice }
func (p Purchase) HasPackage() bool { return !p.PackageCount.IsZero() && !p.PackageSize.IsZero() }

func (p Purchase) FormPackages() decimal.Decimal {
	if p.HasPackage() {
		return p.PackageCount
	}
	if p.Quantity.IsZero() {
		return decimal.Zero
	}
	return decimal.NewFromInt(1)
}

func (p Purchase) FormPackSize() decimal.Decimal {
	if p.HasPackage() {
		return p.PackageSize
	}
	return p.Quantity
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
	if err := runMigrations(db); err != nil {
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

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
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

func (s *Store) ListCompanies() ([]Company, error) {
	rows, err := s.db.Query(`
SELECT c.id, c.name, c.street_name, c.building_number, c.apartment_number, c.postal_code, c.city, COUNT(p.id)
FROM companies c
LEFT JOIN purchases p ON p.company_id = c.id
GROUP BY c.id
ORDER BY c.name COLLATE NOCASE, c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Company
	for rows.Next() {
		var c Company
		if err := rows.Scan(&c.ID, &c.Name, &c.StreetName, &c.BuildingNumber, &c.ApartmentNumber, &c.PostalCode, &c.City, &c.PurchaseCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetCompany(id int64) (Company, error) {
	var c Company
	err := s.db.QueryRow(`
SELECT c.id, c.name, c.street_name, c.building_number, c.apartment_number, c.postal_code, c.city, COUNT(p.id)
FROM companies c
LEFT JOIN purchases p ON p.company_id = c.id
WHERE c.id = ?
GROUP BY c.id`, id).Scan(&c.ID, &c.Name, &c.StreetName, &c.BuildingNumber, &c.ApartmentNumber, &c.PostalCode, &c.City, &c.PurchaseCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Company{}, ErrNotFound
	}
	return c, err
}

func (s *Store) CreateCompany(name, streetName, building, apartment, postalCode, city string) (Company, error) {
	c, err := normalizeCompany(name, streetName, building, apartment, postalCode, city)
	if err != nil {
		return Company{}, err
	}
	res, err := s.db.Exec(
		`INSERT INTO companies (name, street_name, building_number, apartment_number, postal_code, city) VALUES (?, ?, ?, ?, ?, ?)`,
		c.Name, c.StreetName, c.BuildingNumber, c.ApartmentNumber, c.PostalCode, c.City,
	)
	if err != nil {
		return Company{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Company{}, err
	}
	return s.GetCompany(id)
}

func (s *Store) UpdateCompany(id int64, name, streetName, building, apartment, postalCode, city string) error {
	c, err := normalizeCompany(name, streetName, building, apartment, postalCode, city)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(
		`UPDATE companies SET name = ?, street_name = ?, building_number = ?, apartment_number = ?, postal_code = ?, city = ? WHERE id = ?`,
		c.Name, c.StreetName, c.BuildingNumber, c.ApartmentNumber, c.PostalCode, c.City, id,
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

func (s *Store) DeleteCompany(id int64) error {
	c, err := s.GetCompany(id)
	if err != nil {
		return err
	}
	if c.PurchaseCount > 0 {
		return ErrCompanyInUse
	}
	res, err := s.db.Exec(`DELETE FROM companies WHERE id = ?`, id)
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
	rows, err := s.db.Query(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
ORDER BY p.name COLLATE NOCASE`)
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

	prows, err := s.db.Query(`SELECT product_id, bought_on, amount FROM purchases WHERE kind = ?`, KindPurchase)
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
	if err := prows.Err(); err != nil {
		return nil, err
	}
	if err := attachItemConversions(s.db, items); err != nil {
		return nil, err
	}
	if q == "" {
		return items, nil
	}
	aliases, err := s.ListAliases()
	if err != nil {
		return nil, err
	}
	return filterProductSearch(items, q, aliases), nil
}

func filterProductSearch(items []ProductListItem, q string, aliases []ProductAlias) []ProductListItem {
	labels := map[int64][]string{}
	for _, a := range aliases {
		labels[a.ProductID] = append(labels[a.ProductID], a.Alias)
	}
	type hit struct {
		item  ProductListItem
		score float64
	}
	var hits []hit
	for _, it := range items {
		labs := append([]string{it.Name}, labels[it.ID]...)
		score := match.Search(q, labs...)
		if score <= 0 {
			continue
		}
		hits = append(hits, hit{it, score})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return strings.ToLower(hits[i].item.Name) < strings.ToLower(hits[j].item.Name)
	})
	out := make([]ProductListItem, len(hits))
	for i, h := range hits {
		out[i] = h.item
	}
	return out
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
	if err != nil {
		return Product{}, err
	}
	if err := attachProductConversions(s.db, &p); err != nil {
		return Product{}, err
	}
	return p, nil
}

func (s *Store) CreateProduct(name string, unitID int64, imagePath *string, conversions ...[]ProductConversion) (Product, error) {
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
	taken, err := s.aliasExists(name)
	if err != nil {
		return Product{}, err
	}
	if taken {
		return Product{}, ErrDuplicate
	}
	var convs []ProductConversion
	if len(conversions) > 0 {
		convs = conversions[0]
	}
	tx, err := s.db.Begin()
	if err != nil {
		return Product{}, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(
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
	if err := setProductConversionsTx(tx, id, unitID, convs); err != nil {
		return Product{}, err
	}
	if err := tx.Commit(); err != nil {
		return Product{}, err
	}
	return s.GetProduct(id)
}

func (s *Store) UpdateProduct(id int64, name string, unitID int64, imagePath *string, clearImage bool, conversions ...[]ProductConversion) error {
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
	taken, err := s.aliasExists(name)
	if err != nil {
		return err
	}
	if taken {
		return ErrDuplicate
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
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE products SET name = ?, unit_id = ?, image_path = ? WHERE id = ?`, name, unitID, path, id)
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
	if len(conversions) > 0 {
		if err := setProductConversionsTx(tx, id, unitID, conversions[0]); err != nil {
			return err
		}
	} else if unitID != cur.UnitID {
		if err := setProductConversionsTx(tx, id, unitID, cur.Conversions); err != nil {
			return err
		}
	}
	return tx.Commit()
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
	rows, err := s.db.Query(purchaseSelect+`
WHERE p.product_id = ?
ORDER BY p.bought_on DESC, p.id DESC`, productID)
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

func (s *Store) ListPurchasesByReceipt(receiptID int64) ([]ReceiptPurchase, error) {
	rows, err := s.db.Query(receiptPurchaseSelect+`
WHERE p.receipt_id = ?
ORDER BY p.id`, receiptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReceiptPurchase
	for rows.Next() {
		p, err := scanReceiptPurchase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetPurchase(id int64) (Purchase, error) {
	row := s.db.QueryRow(purchaseSelect+` WHERE p.id = ?`, id)
	p, err := scanPurchase(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Purchase{}, ErrNotFound
	}
	return p, err
}

func (s *Store) CreatePurchase(productID, companyID int64, boughtOn string, quantity, amount decimal.Decimal, kind PurchaseKind, packages, packSize decimal.Decimal) (Purchase, error) {
	if _, err := s.GetProduct(productID); err != nil {
		return Purchase{}, err
	}
	if _, err := ParsePurchaseKind(string(kind)); err != nil {
		return Purchase{}, err
	}
	company, err := s.optionalCompanyArg(companyID)
	if err != nil {
		return Purchase{}, err
	}
	qty, packCount, packSizeVal, err := packedQuantity(quantity, packages, packSize)
	if err != nil {
		return Purchase{}, err
	}
	res, err := s.db.Exec(
		`INSERT INTO purchases (product_id, company_id, kind, receipt_id, bought_on, quantity, package_count, package_size, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		productID, company, kind, nil, boughtOn, qty.String(), packCount, packSizeVal, amount.String(), nowRFC3339(),
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

func (s *Store) UpdatePurchase(id, companyID int64, boughtOn string, quantity, amount decimal.Decimal, kind PurchaseKind, packages, packSize decimal.Decimal) error {
	if _, err := ParsePurchaseKind(string(kind)); err != nil {
		return err
	}
	company, err := s.optionalCompanyArg(companyID)
	if err != nil {
		return err
	}
	qty, packCount, packSizeVal, err := packedQuantity(quantity, packages, packSize)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(
		`UPDATE purchases SET company_id = ?, kind = ?, bought_on = ?, quantity = ?, package_count = ?, package_size = ?, amount = ? WHERE id = ?`,
		company, kind, boughtOn, qty.String(), packCount, packSizeVal, amount.String(), id,
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
		if !p.IsPurchase() {
			continue
		}
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

func packedQuantity(quantity, packages, packSize decimal.Decimal) (qty decimal.Decimal, packCount, packSizeVal any, err error) {
	if packages.IsZero() {
		return quantity, nil, nil, nil
	}
	if packSize.IsZero() {
		return decimal.Zero, nil, nil, ErrIncompletePackage
	}
	if packages.IsNegative() || packSize.IsNegative() {
		return decimal.Zero, nil, nil, ErrInvalidPackage
	}
	return packages.Mul(packSize), packages.String(), packSize.String(), nil
}

func (s *Store) LastPackageSize(productID int64) (decimal.Decimal, bool, error) {
	var size sql.NullString
	err := s.db.QueryRow(`
SELECT package_size FROM purchases
WHERE product_id = ? AND package_size IS NOT NULL AND TRIM(package_size) != ''
ORDER BY bought_on DESC, id DESC
LIMIT 1`, productID).Scan(&size)
	if errors.Is(err, sql.ErrNoRows) {
		return decimal.Zero, false, nil
	}
	if err != nil {
		return decimal.Zero, false, err
	}
	if !size.Valid || size.String == "" {
		return decimal.Zero, false, nil
	}
	d, err := decimal.NewFromString(size.String)
	if err != nil {
		return decimal.Zero, false, err
	}
	return d, true, nil
}

func scanPurchase(row rowScanner) (Purchase, error) {
	p, _, err := scanPurchaseRow(row, false)
	return p, err
}

func scanReceiptPurchase(row rowScanner) (ReceiptPurchase, error) {
	p, extra, err := scanPurchaseRow(row, true)
	if err != nil {
		return ReceiptPurchase{}, err
	}
	return ReceiptPurchase{Purchase: p, ProductName: extra.name, UnitName: extra.unit, ImagePath: extra.image}, nil
}

type purchaseProductCols struct {
	name  string
	unit  string
	image sql.NullString
}

func scanPurchaseRow(row rowScanner, withProduct bool) (Purchase, purchaseProductCols, error) {
	var p Purchase
	var companyID, receiptID sql.NullInt64
	var qty, amt, kind string
	var packCount, packSize sql.NullString
	var extra purchaseProductCols
	dest := []any{&p.ID, &p.ProductID, &companyID, &kind, &receiptID, &p.BoughtOn, &qty, &amt, &p.CreatedAt, &packCount, &packSize}
	if withProduct {
		dest = append(dest, &extra.name, &extra.unit, &extra.image)
	}
	if err := row.Scan(dest...); err != nil {
		return Purchase{}, extra, err
	}
	p.CompanyID = companyID.Int64
	p.Kind = PurchaseKind(kind)
	p.ReceiptID = receiptID.Int64
	q, err := decimal.NewFromString(qty)
	if err != nil {
		return Purchase{}, extra, err
	}
	a, err := decimal.NewFromString(amt)
	if err != nil {
		return Purchase{}, extra, err
	}
	p.Quantity = q
	p.Amount = a
	if packCount.Valid && packCount.String != "" {
		n, err := decimal.NewFromString(packCount.String)
		if err != nil {
			return Purchase{}, extra, err
		}
		p.PackageCount = n
	}
	if packSize.Valid && packSize.String != "" {
		n, err := decimal.NewFromString(packSize.String)
		if err != nil {
			return Purchase{}, extra, err
		}
		p.PackageSize = n
	}
	return p, extra, nil
}

func (s *Store) optionalCompanyArg(id int64) (any, error) {
	if id == 0 {
		return nil, nil
	}
	if _, err := s.GetCompany(id); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrInvalidCompany
		}
		return nil, err
	}
	return id, nil
}

func normalizeCompany(name, streetName, building, apartment, postalCode, city string) (Company, error) {
	c := Company{
		Name:            strings.TrimSpace(name),
		StreetName:      strings.TrimSpace(streetName),
		BuildingNumber:  strings.TrimSpace(building),
		ApartmentNumber: strings.TrimSpace(apartment),
		PostalCode:      strings.TrimSpace(postalCode),
		City:            strings.TrimSpace(city),
	}
	if c.Name == "" {
		return Company{}, ErrCompanyName
	}
	if c.StreetName == "" {
		return Company{}, ErrCompanyStreet
	}
	if c.BuildingNumber == "" {
		return Company{}, ErrCompanyBuilding
	}
	if c.PostalCode == "" {
		return Company{}, ErrCompanyPostal
	}
	if c.City == "" {
		return Company{}, ErrCompanyCity
	}
	return c, nil
}

func isUniqueErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
