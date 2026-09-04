package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
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

const aliasSelect = `
SELECT a.id, a.product_id, p.name, a.story_id, COALESCE(c.name, ''),
       a.retail_chain_id, COALESCE(rc.name, ''), a.alias
FROM product_aliases a
JOIN products p ON p.id = a.product_id
LEFT JOIN stories c ON c.id = a.story_id
LEFT JOIN retail_chains rc ON rc.id = a.retail_chain_id`

func (s *Store) ListAliases() ([]ProductAlias, error) {
	rows, err := s.db.Query(aliasSelect + `
ORDER BY p.name COLLATE NOCASE, c.name COLLATE NOCASE, rc.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAliases(rows)
}

func (s *Store) ListAliasesByProduct(productID int64) ([]ProductAlias, error) {
	rows, err := s.db.Query(aliasSelect+`
WHERE a.product_id = ?
ORDER BY a.story_id IS NOT NULL, a.retail_chain_id IS NOT NULL, c.name COLLATE NOCASE, rc.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAliases(rows)
}

func (s *Store) GetAlias(id int64) (ProductAlias, error) {
	return scanAlias(s.db.QueryRow(aliasSelect+` WHERE a.id = ?`, id))
}

func (s *Store) CreateAlias(productID, storyID, chainID int64, alias string) (ProductAlias, error) {
	return createAliasTx(s.db, productID, storyID, chainID, alias)
}

func (s *Store) UpdateAlias(id, productID, storyID, chainID int64, alias string) error {
	if _, err := s.GetAlias(id); err != nil {
		return err
	}
	alias, story, chain, err := prepareAliasTx(s.db, productID, storyID, chainID, alias)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(
		`UPDATE product_aliases SET product_id = ?, story_id = ?, retail_chain_id = ?, alias = ? WHERE id = ?`,
		productID, story, chain, alias, id,
	)
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

func (s *Store) DeleteAlias(id int64) error {
	res, err := s.db.Exec(`DELETE FROM product_aliases WHERE id = ?`, id)
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

func prepareAliasTx(q queryRower, productID, storyID, chainID int64, alias string) (string, any, any, error) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return "", nil, nil, ErrInvalidAlias
	}
	if storyID != 0 && chainID != 0 {
		return "", nil, nil, ErrAliasScope
	}
	var n int
	if err := q.QueryRow(`SELECT COUNT(*) FROM products WHERE id = ?`, productID).Scan(&n); err != nil {
		return "", nil, nil, err
	}
	if n == 0 {
		return "", nil, nil, ErrNotFound
	}
	story, err := optionalStoryArgTx(q, storyID)
	if err != nil {
		return "", nil, nil, err
	}
	chain, err := optionalChainArgTx(q, chainID)
	if err != nil {
		return "", nil, nil, err
	}
	if err := q.QueryRow(`SELECT COUNT(*) FROM products WHERE name = ? COLLATE NOCASE`, alias).Scan(&n); err != nil {
		return "", nil, nil, err
	}
	if n > 0 {
		return "", nil, nil, ErrDuplicate
	}
	return alias, story, chain, nil
}

func optionalStoryArgTx(q queryRower, id int64) (any, error) {
	if id == 0 {
		return nil, nil
	}
	var n int
	if err := q.QueryRow(`SELECT COUNT(*) FROM stories WHERE id = ?`, id).Scan(&n); err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrInvalidStory
	}
	return id, nil
}

func optionalChainArgTx(q queryRower, id int64) (any, error) {
	if id == 0 {
		return nil, nil
	}
	var n int
	if err := q.QueryRow(`SELECT COUNT(*) FROM retail_chains WHERE id = ?`, id).Scan(&n); err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrInvalidRetailChain
	}
	return id, nil
}

func createAliasTx(db execRower, productID, storyID, chainID int64, alias string) (ProductAlias, error) {
	alias, story, chain, err := prepareAliasTx(db, productID, storyID, chainID, alias)
	if err != nil {
		return ProductAlias{}, err
	}
	res, err := db.Exec(
		`INSERT INTO product_aliases (product_id, story_id, retail_chain_id, alias) VALUES (?, ?, ?, ?)`,
		productID, story, chain, alias,
	)
	if err != nil {
		if isUniqueErr(err) {
			return ProductAlias{}, ErrDuplicate
		}
		return ProductAlias{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return ProductAlias{}, err
	}
	return scanAlias(db.QueryRow(aliasSelect+` WHERE a.id = ?`, id))
}

func (s *Store) catalogNameExists(name string) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM products WHERE name = ? COLLATE NOCASE`, strings.TrimSpace(name)).Scan(&n)
	return n > 0, err
}

func (s *Store) aliasExists(alias string) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM product_aliases WHERE alias = ? COLLATE NOCASE`, strings.TrimSpace(alias)).Scan(&n)
	return n > 0, err
}

func scanAliases(rows *sql.Rows) ([]ProductAlias, error) {
	var out []ProductAlias
	for rows.Next() {
		a, err := scanAlias(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func scanAlias(row rowScanner) (ProductAlias, error) {
	var a ProductAlias
	var storyID, chainID sql.NullInt64
	err := row.Scan(&a.ID, &a.ProductID, &a.ProductName, &storyID, &a.StoryName, &chainID, &a.RetailChainName, &a.Alias)
	if errors.Is(err, sql.ErrNoRows) {
		return ProductAlias{}, ErrNotFound
	}
	if err != nil {
		return ProductAlias{}, err
	}
	a.StoryID = storyID.Int64
	a.RetailChainID = chainID.Int64
	return a, nil
}

func productByAliasTx(q queryRower, alias string, storyID, chainID int64) (Product, error) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return Product{}, ErrNotFound
	}
	qstr := `
SELECT p.id, p.name, p.unit_id, u.name, p.image_path, p.created_at
FROM product_aliases a
JOIN products p ON p.id = a.product_id
JOIN units u ON u.id = p.unit_id
WHERE a.alias = ? COLLATE NOCASE AND `
	var row *sql.Row
	switch {
	case storyID > 0:
		row = q.QueryRow(qstr+`a.story_id = ?
ORDER BY a.id
LIMIT 1`, alias, storyID)
	case chainID > 0:
		row = q.QueryRow(qstr+`a.retail_chain_id = ?
ORDER BY a.id
LIMIT 1`, alias, chainID)
	default:
		row = q.QueryRow(qstr+`a.story_id IS NULL AND a.retail_chain_id IS NULL
ORDER BY a.id
LIMIT 1`, alias)
	}
	return scanProductRow(row)
}

func storyChainIDTx(q queryRower, storyID int64) (int64, error) {
	if storyID <= 0 {
		return 0, nil
	}
	var chain sql.NullInt64
	err := q.QueryRow(`SELECT retail_chain_id FROM stories WHERE id = ?`, storyID).Scan(&chain)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return chain.Int64, err
}

func scanProductRow(row *sql.Row) (Product, error) {
	var p Product
	err := row.Scan(&p.ID, &p.Name, &p.UnitID, &p.UnitName, &p.ImagePath, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}
