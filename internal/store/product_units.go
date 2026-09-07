package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store/sqlc"
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

func (s *Store) ListUnits() ([]Unit, error) {
	rows, err := s.q.ListUnits(ctx())
	if err != nil {
		return nil, err
	}
	return mapUnits(rows), nil
}

func (s *Store) GetUnit(id int64) (Unit, error) {
	row, err := s.q.GetUnit(ctx(), id)
	if errors.Is(err, sql.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	if err != nil {
		return Unit{}, err
	}
	return mapUnit(row), nil
}

func (s *Store) FindUnitByName(name string) (Unit, error) {
	row, err := s.q.FindUnitByName(ctx(), name)
	if errors.Is(err, sql.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	if err != nil {
		return Unit{}, err
	}
	return mapFindUnit(row), nil
}

func (s *Store) CreateUnit(name string) (Unit, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Unit{}, ErrInvalidUnit
	}
	id, err := s.q.InsertUnit(ctx(), name)
	if err != nil {
		if isUniqueErr(err) {
			return Unit{}, ErrDuplicate
		}
		return Unit{}, err
	}
	return s.GetUnit(id)
}

func (s *Store) UpdateUnit(id int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidUnit
	}
	n, err := s.q.UpdateUnit(ctx(), sqlc.UpdateUnitParams{Name: name, ID: id})
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

func (s *Store) DeleteUnit(id int64) error {
	u, err := s.GetUnit(id)
	if err != nil {
		return err
	}
	if u.ProductCount > 0 {
		return ErrUnitInUse
	}
	n, err := s.q.DeleteUnit(ctx(), id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListProductConversions(productID int64) ([]ProductConversion, error) {
	return listProductConversions(s.q, productID)
}

func (s *Store) SetProductConversions(productID int64, conversions []ProductConversion) error {
	p, err := s.GetProduct(productID)
	if err != nil {
		return err
	}
	return s.withTx(func(q *sqlc.Queries) error {
		return setProductConversions(q, productID, p.UnitID, conversions)
	})
}

// ChangePurchaseUnit promotes an extra unit to the purchase unit.
// The extra's factor is used to rewrite purchases and rebase remaining extras.
// The previous purchase unit is kept as an extra so bills in that unit still match.
func (s *Store) ChangePurchaseUnit(productID, newUnitID int64) error {
	p, err := s.GetProduct(productID)
	if err != nil {
		return err
	}
	if newUnitID == p.UnitID {
		return ErrInvalidUnit
	}
	conv, ok := p.ConversionFor(newUnitID)
	if !ok {
		return ErrInvalidConversion
	}
	factor := conv.Factor
	return s.withTx(func(q *sqlc.Queries) error {
		if err := q.UpdateProductUnit(ctx(), sqlc.UpdateProductUnitParams{UnitID: newUnitID, ID: productID}); err != nil {
			return err
		}
		if err := rewritePurchaseQuantities(q, productID, factor); err != nil {
			return err
		}
		return setProductConversions(q, productID, newUnitID, rebaseConversions(p.Conversions, p.UnitID, newUnitID, factor))
	})
}

func rewritePurchaseQuantities(q *sqlc.Queries, productID int64, factor decimal.Decimal) error {
	rows, err := q.ListPurchasesByProductAsc(ctx(), productID)
	if err != nil {
		return err
	}
	buys, err := mapPurchasesAsc(rows)
	if err != nil {
		return err
	}
	for _, buy := range buys {
		qty := buy.Quantity.Mul(factor)
		if err := q.UpdatePurchaseQuantity(ctx(), sqlc.UpdatePurchaseQuantityParams{Quantity: qty.String(), ID: buy.ID}); err != nil {
			return err
		}
	}
	return nil
}

func rebaseConversions(convs []ProductConversion, oldUnitID, newUnitID int64, factor decimal.Decimal) []ProductConversion {
	out := make([]ProductConversion, 0, len(convs)+1)
	for _, c := range convs {
		if c.UnitID == newUnitID {
			continue
		}
		out = append(out, ProductConversion{UnitID: c.UnitID, Factor: c.Factor.Div(factor)})
	}
	out = append(out, ProductConversion{UnitID: oldUnitID, Factor: decimal.NewFromInt(1).Div(factor)})
	return out
}

func listProductConversions(q *sqlc.Queries, productID int64) ([]ProductConversion, error) {
	rows, err := q.ListProductConversions(ctx(), productID)
	if err != nil {
		return nil, err
	}
	return mapConversions(rows)
}

func listAllProductConversions(q *sqlc.Queries) (map[int64][]ProductConversion, error) {
	rows, err := q.ListAllProductConversions(ctx())
	if err != nil {
		return nil, err
	}
	out := map[int64][]ProductConversion{}
	for _, r := range rows {
		c, err := mapAllConversion(r)
		if err != nil {
			return nil, err
		}
		out[r.ProductID] = append(out[r.ProductID], c)
	}
	return out, nil
}

func attachProductConversions(q *sqlc.Queries, p *Product) error {
	convs, err := listProductConversions(q, p.ID)
	if err != nil {
		return err
	}
	p.Conversions = convs
	return nil
}

func attachItemConversions(q *sqlc.Queries, items []ProductListItem) error {
	if len(items) == 0 {
		return nil
	}
	byID, err := listAllProductConversions(q)
	if err != nil {
		return err
	}
	for i := range items {
		items[i].Conversions = byID[items[i].ID]
	}
	return nil
}

func setProductConversions(q *sqlc.Queries, productID, purchaseUnitID int64, conversions []ProductConversion) error {
	normalized, err := normalizeConversions(q, purchaseUnitID, conversions)
	if err != nil {
		return err
	}
	if err := q.DeleteProductConversions(ctx(), productID); err != nil {
		return err
	}
	for _, c := range normalized {
		if err := q.InsertProductConversion(ctx(), sqlc.InsertProductConversionParams{
			ProductID: productID,
			UnitID:    c.UnitID,
			Factor:    c.Factor.String(),
		}); err != nil {
			return err
		}
	}
	return nil
}

func normalizeConversions(q *sqlc.Queries, purchaseUnitID int64, conversions []ProductConversion) ([]ProductConversion, error) {
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
		n, err := q.CountUnitsByID(ctx(), c.UnitID)
		if err != nil {
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

func mergeConversions(q *sqlc.Queries, intoID, fromID int64) error {
	into, err := listProductConversions(q, intoID)
	if err != nil {
		return err
	}
	from, err := listProductConversions(q, fromID)
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
		if err := q.InsertProductConversion(ctx(), sqlc.InsertProductConversionParams{
			ProductID: intoID,
			UnitID:    c.UnitID,
			Factor:    c.Factor.String(),
		}); err != nil {
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
