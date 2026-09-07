package store

import (
	"errors"
	"strings"
	"unicode"

	"github.com/adrian/bulkly/internal/store/sqlc"
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

func (s *Store) ListRetailChains() ([]RetailChain, error) {
	rows, err := s.q.ListRetailChains(ctx())
	if err != nil {
		return nil, err
	}
	return mapRetailChains(rows), nil
}

func (s *Store) GetRetailChain(id int64) (RetailChain, error) {
	row, err := s.q.GetRetailChain(ctx(), id)
	if err != nil {
		return RetailChain{}, notFound(err)
	}
	return mapRetailChain(row), nil
}

func (s *Store) CreateRetailChain(name, legalName, taxID string) (RetailChain, error) {
	c, err := normalizeRetailChain(name, legalName, taxID)
	if err != nil {
		return RetailChain{}, err
	}
	id, err := s.q.InsertRetailChain(ctx(), sqlc.InsertRetailChainParams{
		Name:      c.Name,
		LegalName: c.LegalName,
		TaxID:     c.TaxID,
	})
	if err != nil {
		if isUniqueErr(err) {
			return RetailChain{}, ErrDuplicate
		}
		return RetailChain{}, err
	}
	return s.GetRetailChain(id)
}

func (s *Store) UpdateRetailChain(id int64, name, legalName, taxID string) error {
	c, err := normalizeRetailChain(name, legalName, taxID)
	if err != nil {
		return err
	}
	n, err := s.q.UpdateRetailChain(ctx(), sqlc.UpdateRetailChainParams{
		Name:      c.Name,
		LegalName: c.LegalName,
		TaxID:     c.TaxID,
		ID:        id,
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

func (s *Store) DeleteRetailChain(id int64) error {
	c, err := s.GetRetailChain(id)
	if err != nil {
		return err
	}
	if c.StoryCount > 0 {
		return ErrRetailChainInUse
	}
	n, err := s.q.DeleteRetailChain(ctx(), id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
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
