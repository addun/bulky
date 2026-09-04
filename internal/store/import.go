package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/shopspring/decimal"
)

type BillLineInput struct {
	ProductID    int64
	ProductName  string
	ReceiptName  string
	UnitID       int64
	Quantity     decimal.Decimal
	PackageCount decimal.Decimal
	PackageSize  decimal.Decimal
	Amount       decimal.Decimal
}

type BillImport struct {
	StoryID   int64
	Story     *Story
	ReceiptID int64
	BoughtOn  string
	Lines     []BillLineInput
}

type BillImportResult struct {
	StoryID    int64
	ProductIDs []int64
	Purchases  int
}

type queryRower interface {
	QueryRow(query string, args ...any) *sql.Row
}

type execRower interface {
	queryRower
	Exec(query string, args ...any) (sql.Result, error)
}

func (s *Store) FindProductByName(name string, storyID int64) (Product, error) {
	return findProductByNameTx(s.db, name, storyID)
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

	storyID := in.StoryID
	if storyID > 0 {
		if _, err := getStoryTx(tx, storyID); err != nil {
			return BillImportResult{}, err
		}
	} else if in.Story != nil {
		c, err := createStoryTx(tx, *in.Story)
		if err != nil {
			return BillImportResult{}, err
		}
		storyID = c.ID
	}

	created := map[string]int64{}
	newIDs := map[int64]struct{}{}
	var result BillImportResult
	result.StoryID = storyID
	for _, line := range in.Lines {
		pid, err := resolveImportProduct(tx, line, created, newIDs, storyID)
		if err != nil {
			return BillImportResult{}, err
		}
		result.ProductIDs = append(result.ProductIDs, pid)
		if _, err := createPurchaseTx(tx, pid, storyID, in.ReceiptID, in.BoughtOn, line.Quantity, line.Amount, line.PackageCount, line.PackageSize); err != nil {
			return BillImportResult{}, err
		}
		result.Purchases++
	}
	return result, nil
}

func fmtNoLines() error {
	return errors.New("no products to import")
}

func resolveImportProduct(tx *sql.Tx, line BillLineInput, created map[string]int64, newIDs map[int64]struct{}, storyID int64) (int64, error) {
	if line.ProductID > 0 {
		p, err := getProductTx(tx, line.ProductID)
		if err != nil {
			return 0, err
		}
		if err := maybeAliasFromReceipt(tx, p.ID, storyID, line.ReceiptName, p.Name); err != nil {
			return 0, err
		}
		return p.ID, nil
	}
	key := strings.ToLower(strings.TrimSpace(line.ProductName))
	if key == "" {
		return 0, errors.New("product name is required")
	}
	if id, ok := created[key]; ok {
		if _, isNew := newIDs[id]; isNew {
			if err := maybeAliasFromReceipt(tx, id, storyID, line.ReceiptName, line.ProductName); err != nil {
				return 0, err
			}
		}
		return id, nil
	}
	existing, err := findProductByNameTx(tx, line.ProductName, storyID)
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
	newIDs[p.ID] = struct{}{}
	if err := maybeAliasFromReceipt(tx, p.ID, storyID, line.ReceiptName, line.ProductName); err != nil {
		return 0, err
	}
	return p.ID, nil
}

func maybeAliasFromReceipt(tx *sql.Tx, productID, storyID int64, receiptName, productName string) error {
	receiptName = strings.TrimSpace(receiptName)
	if receiptName == "" {
		return nil
	}
	if strings.EqualFold(receiptName, strings.TrimSpace(productName)) {
		return nil
	}
	var chainID int64
	if storyID > 0 {
		st, err := getStoryTx(tx, storyID)
		if err != nil {
			return err
		}
		if st.RetailChainID > 0 {
			chainID = st.RetailChainID
			storyID = 0
		}
	}
	_, err := createAliasTx(tx, productID, storyID, chainID, receiptName)
	if err == nil || errors.Is(err, ErrDuplicate) || errors.Is(err, ErrInvalidAlias) || errors.Is(err, ErrAliasScope) {
		return nil
	}
	return err
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

func getStoryTx(tx *sql.Tx, id int64) (Story, error) {
	c, err := scanStoryRow(tx.QueryRow(storySelect+`
WHERE c.id = ?
GROUP BY c.id`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Story{}, ErrNotFound
	}
	return c, err
}

func findProductByNameTx(q queryRower, name string, storyID int64) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, ErrNotFound
	}
	if storyID > 0 {
		p, err := productByAliasTx(q, name, storyID, 0)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return Product{}, err
		}
		chainID, err := storyChainIDTx(q, storyID)
		if err != nil {
			return Product{}, err
		}
		if chainID > 0 {
			p, err := productByAliasTx(q, name, 0, chainID)
			if err == nil {
				return p, nil
			}
			if !errors.Is(err, ErrNotFound) {
				return Product{}, err
			}
		}
	}
	p, err := productByAliasTx(q, name, 0, 0)
	if err == nil {
		return p, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return Product{}, err
	}
	return scanProductRow(q.QueryRow(`
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.name = ? COLLATE NOCASE
ORDER BY p.id
LIMIT 1`, name))
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
	var aliasCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM product_aliases WHERE alias = ? COLLATE NOCASE`, name).Scan(&aliasCount); err != nil {
		return Product{}, err
	}
	if aliasCount > 0 {
		return Product{}, ErrDuplicate
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

func createStoryTx(tx *sql.Tx, in Story) (Story, error) {
	c, err := normalizeStory(in.Name, in.StreetName, in.BuildingNumber, in.ApartmentNumber, in.PostalCode, in.City, in.ExternalID)
	if err != nil {
		return Story{}, err
	}
	id, err := insertStory(tx, c, in.RetailChainID)
	if err != nil {
		return Story{}, err
	}
	return getStoryTx(tx, id)
}

func createPurchaseTx(tx *sql.Tx, productID, storyID, receiptID int64, boughtOn string, quantity, amount, packages, packSize decimal.Decimal) (Purchase, error) {
	var story any
	if storyID > 0 {
		story = storyID
	}
	var receipt any
	if receiptID > 0 {
		receipt = receiptID
	}
	qty, packCount, packSizeVal, err := packedQuantity(quantity, packages, packSize)
	if err != nil {
		return Purchase{}, err
	}
	res, err := tx.Exec(
		`INSERT INTO purchases (product_id, story_id, kind, receipt_id, bought_on, quantity, package_count, package_size, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		productID, story, KindPurchase, receipt, boughtOn, qty.String(), packCount, packSizeVal, amount.String(), nowRFC3339(),
	)
	if err != nil {
		return Purchase{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Purchase{}, err
	}
	row := tx.QueryRow(purchaseSelect+` WHERE p.id = ?`, id)
	return scanPurchase(row)
}
