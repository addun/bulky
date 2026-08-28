package store

import (
	"database/sql"
	"errors"
	"strings"
)

type ProductAlias struct {
	ID          int64
	ProductID   int64
	ProductName string
	CompanyID   int64
	CompanyName string
	Alias       string
}

const aliasSelect = `
SELECT a.id, a.product_id, p.name, a.company_id, COALESCE(c.name, ''), a.alias
FROM product_aliases a
JOIN products p ON p.id = a.product_id
LEFT JOIN companies c ON c.id = a.company_id`

func (s *Store) ListAliases() ([]ProductAlias, error) {
	rows, err := s.db.Query(aliasSelect + `
ORDER BY p.name COLLATE NOCASE, c.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAliases(rows)
}

func (s *Store) ListAliasesByProduct(productID int64) ([]ProductAlias, error) {
	rows, err := s.db.Query(aliasSelect+`
WHERE a.product_id = ?
ORDER BY a.company_id IS NOT NULL, c.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAliases(rows)
}

func (s *Store) GetAlias(id int64) (ProductAlias, error) {
	return scanAlias(s.db.QueryRow(aliasSelect+` WHERE a.id = ?`, id))
}

func (s *Store) CreateAlias(productID, companyID int64, alias string) (ProductAlias, error) {
	alias, company, err := s.prepareAlias(productID, companyID, alias)
	if err != nil {
		return ProductAlias{}, err
	}
	res, err := s.db.Exec(
		`INSERT INTO product_aliases (product_id, company_id, alias) VALUES (?, ?, ?)`,
		productID, company, alias,
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
	return s.GetAlias(id)
}

func (s *Store) UpdateAlias(id, productID, companyID int64, alias string) error {
	if _, err := s.GetAlias(id); err != nil {
		return err
	}
	alias, company, err := s.prepareAlias(productID, companyID, alias)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(
		`UPDATE product_aliases SET product_id = ?, company_id = ?, alias = ? WHERE id = ?`,
		productID, company, alias, id,
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

func (s *Store) prepareAlias(productID, companyID int64, alias string) (string, any, error) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return "", nil, ErrInvalidAlias
	}
	if _, err := s.GetProduct(productID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", nil, ErrNotFound
		}
		return "", nil, err
	}
	company, err := s.optionalCompanyArg(companyID)
	if err != nil {
		return "", nil, err
	}
	taken, err := s.catalogNameExists(alias)
	if err != nil {
		return "", nil, err
	}
	if taken {
		return "", nil, ErrDuplicate
	}
	return alias, company, nil
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
	var companyID sql.NullInt64
	err := row.Scan(&a.ID, &a.ProductID, &a.ProductName, &companyID, &a.CompanyName, &a.Alias)
	if errors.Is(err, sql.ErrNoRows) {
		return ProductAlias{}, ErrNotFound
	}
	if err != nil {
		return ProductAlias{}, err
	}
	a.CompanyID = companyID.Int64
	return a, nil
}

func productByAliasTx(q queryRower, alias string, companyID int64) (Product, error) {
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
	if companyID > 0 {
		row = q.QueryRow(qstr+`a.company_id = ?
ORDER BY a.id
LIMIT 1`, alias, companyID)
	} else {
		row = q.QueryRow(qstr+`a.company_id IS NULL
ORDER BY a.id
LIMIT 1`, alias)
	}
	return scanProductRow(row)
}

func scanProductRow(row *sql.Row) (Product, error) {
	var p Product
	err := row.Scan(&p.ID, &p.Name, &p.UnitID, &p.UnitName, &p.ImagePath, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}
