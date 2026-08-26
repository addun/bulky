package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/shopspring/decimal"
)

type BillLineInput struct {
	ProductID   int64
	ProductName string
	UnitID      int64
	Quantity    decimal.Decimal
	Amount      decimal.Decimal
}

type BillImport struct {
	CompanyID int64
	Company   *Company
	RecipeID  int64
	BoughtOn  string
	Lines     []BillLineInput
}

type BillImportResult struct {
	CompanyID  int64
	ProductIDs []int64
	Purchases  int
}

func (s *Store) FindProductByName(name string) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, ErrNotFound
	}
	var p Product
	err := s.db.QueryRow(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.name = ? COLLATE NOCASE
ORDER BY p.id
LIMIT 1`, name).Scan(&p.ID, &p.Name, &p.UnitID, &p.UnitName, &p.ImagePath, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}

func (s *Store) ImportBill(in BillImport) (BillImportResult, error) {
	if len(in.Lines) == 0 {
		return BillImportResult{}, fmtNoLines()
	}
	tx, err := s.db.Begin()
	if err != nil {
		return BillImportResult{}, err
	}
	defer tx.Rollback()
	res, err := importBillTx(tx, in)
	if err != nil {
		return BillImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return BillImportResult{}, err
	}
	return res, nil
}

func importBillTx(tx *sql.Tx, in BillImport) (BillImportResult, error) {
	if len(in.Lines) == 0 {
		return BillImportResult{}, fmtNoLines()
	}

	companyID := in.CompanyID
	if companyID > 0 {
		if _, err := getCompanyTx(tx, companyID); err != nil {
			return BillImportResult{}, err
		}
	} else if in.Company != nil {
		c, err := createCompanyTx(tx, *in.Company)
		if err != nil {
			return BillImportResult{}, err
		}
		companyID = c.ID
	}

	created := map[string]int64{}
	var result BillImportResult
	result.CompanyID = companyID
	for _, line := range in.Lines {
		pid, err := resolveImportProduct(tx, line, created)
		if err != nil {
			return BillImportResult{}, err
		}
		result.ProductIDs = append(result.ProductIDs, pid)
		if _, err := createPurchaseTx(tx, pid, companyID, in.RecipeID, in.BoughtOn, line.Quantity, line.Amount); err != nil {
			return BillImportResult{}, err
		}
		result.Purchases++
	}
	return result, nil
}

func fmtNoLines() error {
	return errors.New("no products to import")
}

func resolveImportProduct(tx *sql.Tx, line BillLineInput, created map[string]int64) (int64, error) {
	if line.ProductID > 0 {
		if _, err := getProductTx(tx, line.ProductID); err != nil {
			return 0, err
		}
		return line.ProductID, nil
	}
	key := strings.ToLower(strings.TrimSpace(line.ProductName))
	if key == "" {
		return 0, errors.New("product name is required")
	}
	if id, ok := created[key]; ok {
		return id, nil
	}
	existing, err := findProductByNameTx(tx, line.ProductName)
	if err == nil {
		created[key] = existing.ID
		return existing.ID, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return 0, err
	}
	p, err := createProductTx(tx, line.ProductName, line.UnitID)
	if err != nil {
		return 0, err
	}
	created[key] = p.ID
	return p.ID, nil
}

func getProductTx(tx *sql.Tx, id int64) (Product, error) {
	var p Product
	err := tx.QueryRow(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.id = ?`, id).Scan(&p.ID, &p.Name, &p.UnitID, &p.UnitName, &p.ImagePath, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}

func getCompanyTx(tx *sql.Tx, id int64) (Company, error) {
	var c Company
	err := tx.QueryRow(`
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

func findProductByNameTx(tx *sql.Tx, name string) (Product, error) {
	var p Product
	err := tx.QueryRow(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.name = ? COLLATE NOCASE
ORDER BY p.id
LIMIT 1`, strings.TrimSpace(name)).Scan(&p.ID, &p.Name, &p.UnitID, &p.UnitName, &p.ImagePath, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}

func createProductTx(tx *sql.Tx, name string, unitID int64) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, errors.New("name is required")
	}
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM units WHERE id = ?`, unitID).Scan(&n); err != nil {
		return Product{}, err
	}
	if n == 0 {
		return Product{}, ErrInvalidUnit
	}
	res, err := tx.Exec(
		`INSERT INTO products (name, unit_id, image_path, created_at) VALUES (?, ?, ?, ?)`,
		name, unitID, nil, nowRFC3339(),
	)
	if err != nil {
		return Product{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Product{}, err
	}
	return getProductTx(tx, id)
}

func createCompanyTx(tx *sql.Tx, in Company) (Company, error) {
	c, err := normalizeCompany(in.Name, in.StreetName, in.BuildingNumber, in.ApartmentNumber, in.PostalCode, in.City)
	if err != nil {
		return Company{}, err
	}
	res, err := tx.Exec(
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
	return getCompanyTx(tx, id)
}

func createPurchaseTx(tx *sql.Tx, productID, companyID, recipeID int64, boughtOn string, quantity, amount decimal.Decimal) (Purchase, error) {
	var company any
	if companyID > 0 {
		company = companyID
	}
	var recipe any
	if recipeID > 0 {
		recipe = recipeID
	}
	res, err := tx.Exec(
		`INSERT INTO purchases (product_id, company_id, kind, recipe_id, bought_on, quantity, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		productID, company, KindPurchase, recipe, boughtOn, quantity.String(), amount.String(), nowRFC3339(),
	)
	if err != nil {
		return Purchase{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Purchase{}, err
	}
	row := tx.QueryRow(`
SELECT id, product_id, company_id, kind, recipe_id, bought_on, quantity, amount, created_at
FROM purchases WHERE id = ?`, id)
	return scanPurchase(row)
}
