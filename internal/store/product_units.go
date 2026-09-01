package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
)

type ProductConversion struct {
	UnitID   int64
	UnitName string
	Factor   decimal.Decimal
}

type ConversionConflictError struct {
	UnitName string
}

func (e *ConversionConflictError) Error() string {
	if e == nil || e.UnitName == "" {
		return ErrConversionMismatch.Error()
	}
	return "products convert to " + e.UnitName + " differently"
}

func (e *ConversionConflictError) Unwrap() error {
	return ErrConversionMismatch
}

func QtyIn(primaryQty decimal.Decimal, conv ProductConversion) decimal.Decimal {
	return primaryQty.Mul(conv.Factor)
}

func PricePer(amount, primaryQty decimal.Decimal, conv ProductConversion) decimal.Decimal {
	q := QtyIn(primaryQty, conv)
	if q.IsZero() {
		return decimal.Zero
	}
	return amount.Div(q)
}

func ConvertPacksToPrimary(packs, size decimal.Decimal, fromUnitID int64, p Product) (decimal.Decimal, decimal.Decimal, bool) {
	if fromUnitID == 0 || fromUnitID == p.UnitID {
		return packs, size, false
	}
	conv, ok := p.ConversionFor(fromUnitID)
	if !ok || packs.IsZero() || conv.Factor.IsZero() {
		return packs, size, false
	}
	primaryQty := packs.Mul(size).Div(conv.Factor)
	return packs, primaryQty.Div(packs), true
}

func (p Product) ConversionFor(unitID int64) (ProductConversion, bool) {
	for _, c := range p.Conversions {
		if c.UnitID == unitID {
			return c, true
		}
	}
	return ProductConversion{}, false
}

func (p Product) UnitIDsAttr() string {
	ids := make([]string, 0, 1+len(p.Conversions))
	ids = append(ids, strconv.FormatInt(p.UnitID, 10))
	for _, c := range p.Conversions {
		ids = append(ids, strconv.FormatInt(c.UnitID, 10))
	}
	return strings.Join(ids, ",")
}

func (p Product) PackConversionsJSON() string {
	type row struct {
		Name   string `json:"name"`
		Factor string `json:"factor"`
	}
	rows := make([]row, 0, len(p.Conversions))
	for _, c := range p.Conversions {
		rows = append(rows, row{Name: c.UnitName, Factor: c.Factor.String()})
	}
	b, err := json.Marshal(rows)
	if err != nil {
		return "[]"
	}
	return string(b)
}

const unitSelect = `
SELECT u.id, u.name,
  (SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
  + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id)
FROM units u`

func (s *Store) ListUnits() ([]Unit, error) {
	rows, err := s.db.Query(unitSelect + ` ORDER BY u.name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Unit
	for rows.Next() {
		var u Unit
		if err := rows.Scan(&u.ID, &u.Name, &u.ProductCount); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) GetUnit(id int64) (Unit, error) {
	var u Unit
	err := s.db.QueryRow(unitSelect+` WHERE u.id = ?`, id).Scan(&u.ID, &u.Name, &u.ProductCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	return u, err
}

func (s *Store) FindUnitByName(name string) (Unit, error) {
	var u Unit
	err := s.db.QueryRow(unitSelect+` WHERE u.name = ? COLLATE NOCASE`, name).Scan(&u.ID, &u.Name, &u.ProductCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	return u, err
}

func (s *Store) ListProductConversions(productID int64) ([]ProductConversion, error) {
	return listProductConversions(s.db, productID)
}

func (s *Store) SetProductConversions(productID int64, conversions []ProductConversion) error {
	p, err := s.GetProduct(productID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := setProductConversionsTx(tx, productID, p.UnitID, conversions); err != nil {
		return err
	}
	return tx.Commit()
}

type conversionQuerier interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

func listProductConversions(q conversionQuerier, productID int64) ([]ProductConversion, error) {
	rows, err := q.Query(`
SELECT c.unit_id, u.name, c.factor
FROM product_unit_conversions c
JOIN units u ON u.id = c.unit_id
WHERE c.product_id = ?
ORDER BY u.name COLLATE NOCASE`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProductConversion
	for rows.Next() {
		var c ProductConversion
		var factor string
		if err := rows.Scan(&c.UnitID, &c.UnitName, &factor); err != nil {
			return nil, err
		}
		c.Factor, err = decimal.NewFromString(factor)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func listAllProductConversions(db *sql.DB) (map[int64][]ProductConversion, error) {
	rows, err := db.Query(`
SELECT c.product_id, c.unit_id, u.name, c.factor
FROM product_unit_conversions c
JOIN units u ON u.id = c.unit_id
ORDER BY u.name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]ProductConversion{}
	for rows.Next() {
		var productID int64
		var c ProductConversion
		var factor string
		if err := rows.Scan(&productID, &c.UnitID, &c.UnitName, &factor); err != nil {
			return nil, err
		}
		c.Factor, err = decimal.NewFromString(factor)
		if err != nil {
			return nil, err
		}
		out[productID] = append(out[productID], c)
	}
	return out, rows.Err()
}

func attachProductConversions(db *sql.DB, p *Product) error {
	convs, err := listProductConversions(db, p.ID)
	if err != nil {
		return err
	}
	p.Conversions = convs
	return nil
}

func attachItemConversions(db *sql.DB, items []ProductListItem) error {
	if len(items) == 0 {
		return nil
	}
	byID, err := listAllProductConversions(db)
	if err != nil {
		return err
	}
	for i := range items {
		items[i].Conversions = byID[items[i].ID]
	}
	return nil
}

func setProductConversionsTx(tx *sql.Tx, productID, purchaseUnitID int64, conversions []ProductConversion) error {
	normalized, err := normalizeConversions(tx, purchaseUnitID, conversions)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM product_unit_conversions WHERE product_id = ?`, productID); err != nil {
		return err
	}
	for _, c := range normalized {
		if _, err := tx.Exec(
			`INSERT INTO product_unit_conversions (product_id, unit_id, factor) VALUES (?, ?, ?)`,
			productID, c.UnitID, c.Factor.String(),
		); err != nil {
			return err
		}
	}
	return nil
}

func normalizeConversions(tx *sql.Tx, purchaseUnitID int64, conversions []ProductConversion) ([]ProductConversion, error) {
	seen := map[int64]bool{}
	out := make([]ProductConversion, 0, len(conversions))
	for _, c := range conversions {
		if c.UnitID == 0 {
			continue
		}
		if c.UnitID == purchaseUnitID {
			return nil, ErrInvalidConversion
		}
		if seen[c.UnitID] {
			return nil, ErrInvalidConversion
		}
		if c.Factor.IsNegative() || c.Factor.IsZero() {
			return nil, ErrInvalidConversion
		}
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM units WHERE id = ?`, c.UnitID).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, ErrInvalidUnit
		}
		seen[c.UnitID] = true
		out = append(out, c)
	}
	return out, nil
}

func mergeConversionsTx(tx *sql.Tx, intoID, fromID int64) error {
	into, err := listProductConversions(tx, intoID)
	if err != nil {
		return err
	}
	from, err := listProductConversions(tx, fromID)
	if err != nil {
		return err
	}
	if err := conversionMergeConflict(into, from); err != nil {
		return err
	}
	intoByUnit := map[int64]bool{}
	for _, c := range into {
		intoByUnit[c.UnitID] = true
	}
	for _, c := range from {
		if intoByUnit[c.UnitID] {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO product_unit_conversions (product_id, unit_id, factor) VALUES (?, ?, ?)`,
			intoID, c.UnitID, c.Factor.String(),
		); err != nil {
			return err
		}
	}
	return nil
}

func conversionMergeConflict(into, from []ProductConversion) error {
	intoByUnit := map[int64]ProductConversion{}
	for _, c := range into {
		intoByUnit[c.UnitID] = c
	}
	for _, c := range from {
		if existing, ok := intoByUnit[c.UnitID]; ok && !existing.Factor.Equal(c.Factor) {
			return &ConversionConflictError{UnitName: c.UnitName}
		}
	}
	return nil
}
