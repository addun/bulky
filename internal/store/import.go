package store

import (
	"errors"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

type BillLineInput struct {
	ProductID   int64
	ProductName string
	ReceiptName string
	UnitID      int64
	Quantity    decimal.Decimal
	Amount      decimal.Decimal
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

func (s *Store) FindProductByName(name string, storyID int64) (Product, error) {
	return findProductByName(s.q, name, storyID)
}

func (s *Store) ImportBill(in BillImport) (BillImportResult, error) {
	if len(in.Lines) == 0 {
		return BillImportResult{}, fmtNoLines()
	}
	var res BillImportResult
	err := s.withTx(func(q *sqlc.Queries) error {
		var err error
		res, err = importBill(q, in)
		return err
	})
	return res, err
}

func importBill(q *sqlc.Queries, in BillImport) (BillImportResult, error) {
	if len(in.Lines) == 0 {
		return BillImportResult{}, fmtNoLines()
	}

	storyID := in.StoryID
	if storyID > 0 {
		if _, err := getStory(q, storyID); err != nil {
			return BillImportResult{}, err
		}
	} else if in.Story != nil {
		c, err := createStoryTx(q, *in.Story)
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
		pid, err := resolveImportProduct(q, line, created, newIDs, storyID)
		if err != nil {
			return BillImportResult{}, err
		}
		result.ProductIDs = append(result.ProductIDs, pid)
		if _, err := createPurchase(q, pid, storyID, in.ReceiptID, in.BoughtOn, line.Quantity, line.Amount); err != nil {
			return BillImportResult{}, err
		}
		result.Purchases++
	}
	return result, nil
}

func fmtNoLines() error {
	return errors.New("no products to import")
}

func resolveImportProduct(q *sqlc.Queries, line BillLineInput, created map[string]int64, newIDs map[int64]struct{}, storyID int64) (int64, error) {
	if line.ProductID > 0 {
		p, err := getProduct(q, line.ProductID)
		if err != nil {
			return 0, err
		}
		if err := maybeAliasFromReceipt(q, p.ID, storyID, line.ReceiptName); err != nil {
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
			if err := maybeAliasFromReceipt(q, id, storyID, line.ReceiptName); err != nil {
				return 0, err
			}
		}
		return id, nil
	}
	existing, err := findProductByName(q, line.ProductName, storyID)
	if err == nil {
		created[key] = existing.ID
		return existing.ID, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return 0, err
	}
	p, err := createProduct(q, line.ProductName, line.UnitID)
	if err != nil {
		return 0, err
	}
	created[key] = p.ID
	newIDs[p.ID] = struct{}{}
	if err := maybeAliasFromReceipt(q, p.ID, storyID, line.ReceiptName); err != nil {
		return 0, err
	}
	return p.ID, nil
}

func maybeAliasFromReceipt(q *sqlc.Queries, productID, storyID int64, receiptName string) error {
	receiptName = strings.TrimSpace(receiptName)
	if receiptName == "" {
		return nil
	}
	var chainID int64
	if storyID > 0 {
		st, err := getStory(q, storyID)
		if err != nil {
			return err
		}
		if st.RetailChainID > 0 {
			chainID = st.RetailChainID
			storyID = 0
		}
	}
	_, err := createAlias(q, productID, storyID, chainID, receiptName)
	if err == nil || errors.Is(err, ErrDuplicate) || errors.Is(err, ErrInvalidAlias) || errors.Is(err, ErrAliasScope) {
		return nil
	}
	return err
}

func findProductByName(q *sqlc.Queries, name string, storyID int64) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, ErrNotFound
	}
	if storyID > 0 {
		p, err := productByAlias(q, name, storyID, 0)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return Product{}, err
		}
		chainID, err := storyChainID(q, storyID)
		if err != nil {
			return Product{}, err
		}
		if chainID > 0 {
			p, err := productByAlias(q, name, 0, chainID)
			if err == nil {
				return p, nil
			}
			if !errors.Is(err, ErrNotFound) {
				return Product{}, err
			}
		}
	}
	p, err := productByAlias(q, name, 0, 0)
	if err == nil {
		return p, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return Product{}, err
	}
	row, err := q.FindProductByName(ctx(), name)
	if err != nil {
		return Product{}, notFound(err)
	}
	return mapFindProduct(row), nil
}

func createProduct(q *sqlc.Queries, name string, unitID int64) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, errors.New("name is required")
	}
	n, err := q.CountUnitsByID(ctx(), unitID)
	if err != nil {
		return Product{}, err
	}
	if n == 0 {
		return Product{}, ErrInvalidUnit
	}
	aliasCount, err := q.CountAliasesByAlias(ctx(), name)
	if err != nil {
		return Product{}, err
	}
	if aliasCount > 0 {
		return Product{}, ErrDuplicate
	}
	id, err := q.InsertProduct(ctx(), sqlc.InsertProductParams{
		Name:      name,
		UnitID:    unitID,
		ImagePath: nullStringPtr(nil),
		CreatedAt: nowRFC3339(),
	})
	if err != nil {
		return Product{}, err
	}
	return getProduct(q, id)
}

func createStoryTx(q *sqlc.Queries, in Story) (Story, error) {
	c, err := normalizeStory(in.Name, in.StreetName, in.BuildingNumber, in.ApartmentNumber, in.PostalCode, in.City, in.ExternalID)
	if err != nil {
		return Story{}, err
	}
	id, err := insertStory(q, c, in.RetailChainID)
	if err != nil {
		return Story{}, err
	}
	return getStory(q, id)
}

func createPurchase(q *sqlc.Queries, productID, storyID, receiptID int64, boughtOn string, quantity, amount decimal.Decimal) (Purchase, error) {
	if err := validQuantity(quantity); err != nil {
		return Purchase{}, err
	}
	boughtOn, err := NormalizeBoughtOn(boughtOn)
	if err != nil {
		return Purchase{}, err
	}
	id, err := q.InsertPurchase(ctx(), sqlc.InsertPurchaseParams{
		ProductID: productID,
		StoryID:   nullID(storyID),
		Kind:      string(KindPurchase),
		ReceiptID: nullID(receiptID),
		BoughtOn:  boughtOn,
		Quantity:  quantity.String(),
		Amount:    amount.String(),
		CreatedAt: nowRFC3339(),
	})
	if err != nil {
		return Purchase{}, err
	}
	return getPurchase(q, id)
}
