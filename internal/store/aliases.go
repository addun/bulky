package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

type ProductAlias struct {
	ID              int64
	ProductID       int64
	ProductName     string
	StoryID         int64
	StoryName       string
	RetailChainID   int64
	RetailChainName string
	Alias           string
}

func (a ProductAlias) ScopeValue() string {
	switch {
	case a.StoryID > 0:
		return fmt.Sprintf("story:%d", a.StoryID)
	case a.RetailChainID > 0:
		return fmt.Sprintf("chain:%d", a.RetailChainID)
	default:
		return ""
	}
}

func (a ProductAlias) ScopeLabel() string {
	switch {
	case a.StoryID > 0:
		return a.StoryName
	case a.RetailChainID > 0:
		return a.RetailChainName
	default:
		return "any shop"
	}
}

func (s *Store) ListAliases() ([]ProductAlias, error) {
	rows, err := s.q.ListAliases(ctx())
	if err != nil {
		return nil, err
	}
	return mapAliases(rows), nil
}

func (s *Store) ListAliasesByProduct(productID int64) ([]ProductAlias, error) {
	rows, err := s.q.ListAliasesByProduct(ctx(), productID)
	if err != nil {
		return nil, err
	}
	return mapAliasesByProduct(rows), nil
}

func (s *Store) GetAlias(id int64) (ProductAlias, error) {
	return getAlias(s.q, id)
}

func (s *Store) CreateAlias(productID, storyID, chainID int64, alias string) (ProductAlias, error) {
	return createAlias(s.q, productID, storyID, chainID, alias)
}

func (s *Store) UpdateAlias(id, productID, storyID, chainID int64, alias string) error {
	if _, err := s.GetAlias(id); err != nil {
		return err
	}
	params, err := prepareAlias(s.q, productID, storyID, chainID, alias)
	if err != nil {
		return err
	}
	n, err := s.q.UpdateAlias(ctx(), sqlc.UpdateAliasParams{
		ProductID:     params.ProductID,
		StoryID:       params.StoryID,
		RetailChainID: params.RetailChainID,
		Alias:         params.Alias,
		ID:            id,
	})
	if err != nil {
		if isUniqueErr(err) {
			return ErrDuplicate
		}
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteAlias(id int64) error {
	n, err := s.q.DeleteAlias(ctx(), id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func prepareAlias(q *sqlc.Queries, productID, storyID, chainID int64, alias string) (sqlc.InsertAliasParams, error) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return sqlc.InsertAliasParams{}, ErrInvalidAlias
	}
	if storyID != 0 && chainID != 0 {
		return sqlc.InsertAliasParams{}, ErrAliasScope
	}
	n, err := q.CountProductsByID(ctx(), productID)
	if err != nil {
		return sqlc.InsertAliasParams{}, err
	}
	if n == 0 {
		return sqlc.InsertAliasParams{}, ErrNotFound
	}
	story, err := optionalStory(q, storyID)
	if err != nil {
		return sqlc.InsertAliasParams{}, err
	}
	chain, err := optionalChain(q, chainID)
	if err != nil {
		return sqlc.InsertAliasParams{}, err
	}
	n, err = q.CountProductsByNameExcept(ctx(), sqlc.CountProductsByNameExceptParams{
		Name: alias,
		ID:   productID,
	})
	if err != nil {
		return sqlc.InsertAliasParams{}, err
	}
	if n > 0 {
		return sqlc.InsertAliasParams{}, ErrDuplicate
	}
	return sqlc.InsertAliasParams{
		ProductID:     productID,
		StoryID:       story,
		RetailChainID: chain,
		Alias:         alias,
	}, nil
}

func createAlias(q *sqlc.Queries, productID, storyID, chainID int64, alias string) (ProductAlias, error) {
	params, err := prepareAlias(q, productID, storyID, chainID, alias)
	if err != nil {
		return ProductAlias{}, err
	}
	id, err := q.InsertAlias(ctx(), params)
	if err != nil {
		if isUniqueErr(err) {
			return ProductAlias{}, ErrDuplicate
		}
		return ProductAlias{}, err
	}
	return getAlias(q, id)
}

func (s *Store) catalogNameExists(name string) (bool, error) {
	n, err := s.q.CountProductsByName(ctx(), strings.TrimSpace(name))
	return n > 0, err
}

func (s *Store) aliasExists(alias string) (bool, error) {
	return aliasExistsExcept(s.q, alias, 0)
}

func aliasExistsExcept(q *sqlc.Queries, alias string, exceptProductID int64) (bool, error) {
	n, err := q.CountAliasesByAliasExcept(ctx(), sqlc.CountAliasesByAliasExceptParams{
		Alias:     strings.TrimSpace(alias),
		ProductID: exceptProductID,
	})
	return n > 0, err
}

func productByAlias(q *sqlc.Queries, alias string, storyID, chainID int64) (Product, error) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return Product{}, ErrNotFound
	}
	switch {
	case storyID > 0:
		row, err := q.ProductByStoryAlias(ctx(), sqlc.ProductByStoryAliasParams{Alias: alias, StoryID: nullID(storyID)})
		if err != nil {
			return Product{}, notFound(err)
		}
		return mapProductByStoryAlias(row), nil
	case chainID > 0:
		row, err := q.ProductByChainAlias(ctx(), sqlc.ProductByChainAliasParams{Alias: alias, RetailChainID: nullID(chainID)})
		if err != nil {
			return Product{}, notFound(err)
		}
		return mapProductByChainAlias(row), nil
	default:
		row, err := q.ProductByGlobalAlias(ctx(), alias)
		if err != nil {
			return Product{}, notFound(err)
		}
		return mapProductByGlobalAlias(row), nil
	}
}

func storyChainID(q *sqlc.Queries, storyID int64) (int64, error) {
	if storyID <= 0 {
		return 0, nil
	}
	chain, err := q.GetStoryRetailChainID(ctx(), storyID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, notFound(err)
	}
	return chain.Int64, nil
}
