package store

import (
	"context"
	"database/sql"
	"errors"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

func ctx() context.Context {
	return context.Background()
}

func (s *Store) withTx(fn func(*sqlc.Queries) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func nullID(id int64) sql.NullInt64 {
	if id == 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: id, Valid: true}
}

func nullStringPtr(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

func optionalStory(q *sqlc.Queries, id int64) (sql.NullInt64, error) {
	if id == 0 {
		return sql.NullInt64{}, nil
	}
	n, err := q.CountStoriesByID(ctx(), id)
	if err != nil {
		return sql.NullInt64{}, err
	}
	if n == 0 {
		return sql.NullInt64{}, ErrInvalidStory
	}
	return nullID(id), nil
}

func optionalChain(q *sqlc.Queries, id int64) (sql.NullInt64, error) {
	if id == 0 {
		return sql.NullInt64{}, nil
	}
	n, err := q.CountRetailChainsByID(ctx(), id)
	if err != nil {
		return sql.NullInt64{}, err
	}
	if n == 0 {
		return sql.NullInt64{}, ErrInvalidRetailChain
	}
	return nullID(id), nil
}

func mapUnit(r sqlc.GetUnitRow) Unit {
	return Unit{ID: r.ID, Name: r.Name, ProductCount: int(r.ProductCount)}
}

func mapListUnit(r sqlc.ListUnitsRow) Unit {
	return Unit{ID: r.ID, Name: r.Name, ProductCount: int(r.ProductCount)}
}

func mapFindUnit(r sqlc.FindUnitByNameRow) Unit {
	return Unit{ID: r.ID, Name: r.Name, ProductCount: int(r.ProductCount)}
}

func mapUnits(rows []sqlc.ListUnitsRow) []Unit {
	out := make([]Unit, len(rows))
	for i, r := range rows {
		out[i] = mapListUnit(r)
	}
	return out
}

func mapStory(r sqlc.GetStoryRow) Story {
	return Story{
		ID: r.ID, Name: r.Name, StreetName: r.StreetName, BuildingNumber: r.BuildingNumber,
		ApartmentNumber: r.ApartmentNumber, PostalCode: r.PostalCode, City: r.City,
		ExternalID: r.ExternalID, RetailChainID: r.RetailChainID, RetailChainName: r.RetailChainName,
		PurchaseCount: int(r.PurchaseCount),
	}
}

func mapListStory(r sqlc.ListStoriesRow) Story {
	return Story{
		ID: r.ID, Name: r.Name, StreetName: r.StreetName, BuildingNumber: r.BuildingNumber,
		ApartmentNumber: r.ApartmentNumber, PostalCode: r.PostalCode, City: r.City,
		ExternalID: r.ExternalID, RetailChainID: r.RetailChainID, RetailChainName: r.RetailChainName,
		PurchaseCount: int(r.PurchaseCount),
	}
}

func mapStories(rows []sqlc.ListStoriesRow) []Story {
	out := make([]Story, len(rows))
	for i, r := range rows {
		out[i] = mapListStory(r)
	}
	return out
}

func mapRetailChain(r sqlc.GetRetailChainRow) RetailChain {
	return RetailChain{ID: r.ID, Name: r.Name, LegalName: r.LegalName, TaxID: r.TaxID, StoryCount: int(r.StoryCount)}
}

func mapRetailChains(rows []sqlc.ListRetailChainsRow) []RetailChain {
	out := make([]RetailChain, len(rows))
	for i, r := range rows {
		out[i] = RetailChain{ID: r.ID, Name: r.Name, LegalName: r.LegalName, TaxID: r.TaxID, StoryCount: int(r.StoryCount)}
	}
	return out
}

func mapProduct(r sqlc.GetProductRow) Product {
	return Product{ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName, ImagePath: r.ImagePath, CreatedAt: r.CreatedAt}
}

func mapListProduct(r sqlc.ListProductsRow) Product {
	return Product{ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName, ImagePath: r.ImagePath, CreatedAt: r.CreatedAt}
}

func mapFindProduct(r sqlc.FindProductByNameRow) Product {
	return Product{ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName, ImagePath: r.ImagePath, CreatedAt: r.CreatedAt}
}

func mapProductByStoryAlias(r sqlc.ProductByStoryAliasRow) Product {
	return Product{ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName, ImagePath: r.ImagePath, CreatedAt: r.CreatedAt}
}

func mapProductByChainAlias(r sqlc.ProductByChainAliasRow) Product {
	return Product{ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName, ImagePath: r.ImagePath, CreatedAt: r.CreatedAt}
}

func mapProductByGlobalAlias(r sqlc.ProductByGlobalAliasRow) Product {
	return Product{ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName, ImagePath: r.ImagePath, CreatedAt: r.CreatedAt}
}

func mapPurchase(r sqlc.GetPurchaseRow) (Purchase, error) {
	q, err := decimal.NewFromString(r.Quantity)
	if err != nil {
		return Purchase{}, err
	}
	a, err := decimal.NewFromString(r.Amount)
	if err != nil {
		return Purchase{}, err
	}
	return Purchase{
		ID: r.ID, ProductID: r.ProductID, StoryID: r.StoryID, Kind: PurchaseKind(r.Kind),
		ReceiptID: r.ReceiptID, BoughtOn: r.BoughtOn, Quantity: q, Amount: a, CreatedAt: r.CreatedAt,
	}, nil
}

func mapPurchases(rows []sqlc.ListPurchasesByProductRow) ([]Purchase, error) {
	out := make([]Purchase, len(rows))
	for i, r := range rows {
		p, err := mapPurchase(sqlc.GetPurchaseRow{
			ID: r.ID, ProductID: r.ProductID, StoryID: r.StoryID, Kind: r.Kind,
			ReceiptID: r.ReceiptID, BoughtOn: r.BoughtOn, Quantity: r.Quantity, Amount: r.Amount, CreatedAt: r.CreatedAt,
		})
		if err != nil {
			return nil, err
		}
		out[i] = p
	}
	return out, nil
}

func mapPurchasesAsc(rows []sqlc.ListPurchasesByProductAscRow) ([]Purchase, error) {
	out := make([]Purchase, len(rows))
	for i, r := range rows {
		p, err := mapPurchase(sqlc.GetPurchaseRow{
			ID: r.ID, ProductID: r.ProductID, StoryID: r.StoryID, Kind: r.Kind,
			ReceiptID: r.ReceiptID, BoughtOn: r.BoughtOn, Quantity: r.Quantity, Amount: r.Amount, CreatedAt: r.CreatedAt,
		})
		if err != nil {
			return nil, err
		}
		out[i] = p
	}
	return out, nil
}

func mapReceiptPurchases(rows []sqlc.ListPurchasesByReceiptRow) ([]ReceiptPurchase, error) {
	out := make([]ReceiptPurchase, len(rows))
	for i, r := range rows {
		p, err := mapPurchase(sqlc.GetPurchaseRow{
			ID: r.ID, ProductID: r.ProductID, StoryID: r.StoryID, Kind: r.Kind,
			ReceiptID: r.ReceiptID, BoughtOn: r.BoughtOn, Quantity: r.Quantity, Amount: r.Amount, CreatedAt: r.CreatedAt,
		})
		if err != nil {
			return nil, err
		}
		out[i] = ReceiptPurchase{Purchase: p, ProductName: r.ProductName, UnitName: r.UnitName, ImagePath: r.ImagePath}
	}
	return out, nil
}

func mapAlias(r sqlc.GetAliasRow) ProductAlias {
	return ProductAlias{
		ID: r.ID, ProductID: r.ProductID, ProductName: r.ProductName, StoryID: r.StoryID,
		StoryName: r.StoryName, RetailChainID: r.RetailChainID, RetailChainName: r.RetailChainName, Alias: r.Alias,
	}
}

func mapAliases(rows []sqlc.ListAliasesRow) []ProductAlias {
	out := make([]ProductAlias, len(rows))
	for i, r := range rows {
		out[i] = ProductAlias{
			ID: r.ID, ProductID: r.ProductID, ProductName: r.ProductName, StoryID: r.StoryID,
			StoryName: r.StoryName, RetailChainID: r.RetailChainID, RetailChainName: r.RetailChainName, Alias: r.Alias,
		}
	}
	return out
}

func mapAliasesByProduct(rows []sqlc.ListAliasesByProductRow) []ProductAlias {
	out := make([]ProductAlias, len(rows))
	for i, r := range rows {
		out[i] = ProductAlias{
			ID: r.ID, ProductID: r.ProductID, ProductName: r.ProductName, StoryID: r.StoryID,
			StoryName: r.StoryName, RetailChainID: r.RetailChainID, RetailChainName: r.RetailChainName, Alias: r.Alias,
		}
	}
	return out
}

func mapReceipt(r sqlc.Receipt) Receipt {
	return Receipt{
		ID: r.ID, ImagePath: r.ImagePath, RawResponse: r.RawResponse, Status: r.Status,
		ErrorMessage: r.ErrorMessage, CreatedAt: r.CreatedAt,
		Source: r.Source, ExternalID: r.ExternalID, SourcePayload: r.SourcePayload,
	}
}

func mapReceipts(rows []sqlc.ListReceiptsRow) []Receipt {
	out := make([]Receipt, len(rows))
	for i, r := range rows {
		out[i] = Receipt{ID: r.ID, ImagePath: r.ImagePath, Status: r.Status, ErrorMessage: r.ErrorMessage, CreatedAt: r.CreatedAt}
	}
	return out
}

func mapConversion(r sqlc.ListProductConversionsRow) (ProductConversion, error) {
	factor, err := decimal.NewFromString(r.Factor)
	if err != nil {
		return ProductConversion{}, err
	}
	return ProductConversion{UnitID: r.UnitID, UnitName: r.UnitName, Factor: factor}, nil
}

func mapConversions(rows []sqlc.ListProductConversionsRow) ([]ProductConversion, error) {
	out := make([]ProductConversion, len(rows))
	for i, r := range rows {
		c, err := mapConversion(r)
		if err != nil {
			return nil, err
		}
		out[i] = c
	}
	return out, nil
}

func mapAllConversion(r sqlc.ListAllProductConversionsRow) (ProductConversion, error) {
	factor, err := decimal.NewFromString(r.Factor)
	if err != nil {
		return ProductConversion{}, err
	}
	return ProductConversion{UnitID: r.UnitID, UnitName: r.UnitName, Factor: factor}, nil
}

func getProduct(q *sqlc.Queries, id int64) (Product, error) {
	row, err := q.GetProduct(ctx(), id)
	if err != nil {
		return Product{}, notFound(err)
	}
	return mapProduct(row), nil
}

func getStory(q *sqlc.Queries, id int64) (Story, error) {
	row, err := q.GetStory(ctx(), id)
	if err != nil {
		return Story{}, notFound(err)
	}
	return mapStory(row), nil
}

func getPurchase(q *sqlc.Queries, id int64) (Purchase, error) {
	row, err := q.GetPurchase(ctx(), id)
	if err != nil {
		return Purchase{}, notFound(err)
	}
	return mapPurchase(row)
}

func getReceipt(q *sqlc.Queries, id int64) (Receipt, error) {
	row, err := q.GetReceipt(ctx(), id)
	if err != nil {
		return Receipt{}, notFound(err)
	}
	return mapReceipt(row), nil
}

func getAlias(q *sqlc.Queries, id int64) (ProductAlias, error) {
	row, err := q.GetAlias(ctx(), id)
	if err != nil {
		return ProductAlias{}, notFound(err)
	}
	return mapAlias(row), nil
}
