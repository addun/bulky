package store

import (
	"database/sql"
	"errors"
	"strings"
	"unicode"
)

var (
	ErrRetailChainInUse     = errors.New("retail chain is in use")
	ErrInvalidRetailChain   = errors.New("invalid retail chain")
	ErrRetailChainName      = errors.New("retail chain name required")
	ErrRetailChainLegalName = errors.New("retail chain legal name required")
	ErrRetailChainTaxID     = errors.New("retail chain tax id required")
)

type RetailChain struct {
	ID         int64
	Name       string
	LegalName  string
	TaxID      string
	StoryCount int
}

func (c RetailChain) Label() string {
	if c.LegalName == "" || strings.EqualFold(c.LegalName, c.Name) {
		return c.Name
	}
	return c.Name + " — " + c.LegalName
}

const retailChainSelect = `
SELECT rc.id, rc.name, rc.legal_name, rc.tax_id,
  (SELECT COUNT(*) FROM stories s WHERE s.retail_chain_id = rc.id)
FROM retail_chains rc`

func (s *Store) ListRetailChains() ([]RetailChain, error) {
	rows, err := s.db.Query(retailChainSelect + ` ORDER BY rc.name COLLATE NOCASE, rc.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RetailChain
	for rows.Next() {
		c, err := scanRetailChain(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetRetailChain(id int64) (RetailChain, error) {
	c, err := scanRetailChain(s.db.QueryRow(retailChainSelect+` WHERE rc.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return RetailChain{}, ErrNotFound
	}
	return c, err
}

func (s *Store) CreateRetailChain(name, legalName, taxID string) (RetailChain, error) {
	c, err := normalizeRetailChain(name, legalName, taxID)
	if err != nil {
		return RetailChain{}, err
	}
	res, err := s.db.Exec(
		`INSERT INTO retail_chains (name, legal_name, tax_id) VALUES (?, ?, ?)`,
		c.Name, c.LegalName, c.TaxID,
	)
	if err != nil {
		if isUniqueErr(err) {
			return RetailChain{}, ErrDuplicate
		}
		return RetailChain{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return RetailChain{}, err
	}
	return s.GetRetailChain(id)
}

func (s *Store) UpdateRetailChain(id int64, name, legalName, taxID string) error {
	c, err := normalizeRetailChain(name, legalName, taxID)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(
		`UPDATE retail_chains SET name = ?, legal_name = ?, tax_id = ? WHERE id = ?`,
		c.Name, c.LegalName, c.TaxID, id,
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

func (s *Store) DeleteRetailChain(id int64) error {
	c, err := s.GetRetailChain(id)
	if err != nil {
		return err
	}
	if c.StoryCount > 0 {
		return ErrRetailChainInUse
	}
	res, err := s.db.Exec(`DELETE FROM retail_chains WHERE id = ?`, id)
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

func scanRetailChain(row rowScanner) (RetailChain, error) {
	var c RetailChain
	err := row.Scan(&c.ID, &c.Name, &c.LegalName, &c.TaxID, &c.StoryCount)
	return c, err
}

func normalizeRetailChain(name, legalName, taxID string) (RetailChain, error) {
	c := RetailChain{
		Name:      strings.TrimSpace(name),
		LegalName: strings.TrimSpace(legalName),
		TaxID:     normalizeTaxID(taxID),
	}
	if c.Name == "" {
		return RetailChain{}, ErrRetailChainName
	}
	if c.LegalName == "" {
		return RetailChain{}, ErrRetailChainLegalName
	}
	if c.TaxID == "" {
		return RetailChain{}, ErrRetailChainTaxID
	}
	return c, nil
}

func normalizeTaxID(s string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToUpper(r))
		}
	}
	return b.String()
}

func optionalRetailChainArgTx(q queryRower, id int64) (any, error) {
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
