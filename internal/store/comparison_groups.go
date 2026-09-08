package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

type ComparisonGroup struct {
	ID           int64
	Name         string
	UnitID       int64
	UnitName     string
	CreatedAt    string
	ProductCount int
}

type ComparisonOffer struct {
	ProductID   int64
	ProductName string
	Price       decimal.Decimal
	BoughtOn    string
}

type GroupComparison struct {
	Group              ComparisonGroup
	Selected           *ComparisonOffer
	Leader             *ComparisonOffer
	SelectedIsLeader   bool
	SelectedComparable bool
}

type RelatedProduct struct {
	Product
	Quote *QuotedPrice
}

func (s *Store) ListComparisonGroups() ([]ComparisonGroup, error) {
	rows, err := s.q.ListComparisonGroups(ctx())
	if err != nil {
		return nil, err
	}
	return mapComparisonGroups(rows), nil
}

func (s *Store) GetComparisonGroup(id int64) (ComparisonGroup, error) {
	row, err := s.q.GetComparisonGroup(ctx(), id)
	if errors.Is(err, sql.ErrNoRows) {
		return ComparisonGroup{}, ErrNotFound
	}
	if err != nil {
		return ComparisonGroup{}, err
	}
	return mapGetComparisonGroup(row), nil
}

func (s *Store) CreateComparisonGroup(name string, unitID int64, productIDs []int64) (ComparisonGroup, error) {
	name, err := normalizeComparisonGroupName(name)
	if err != nil {
		return ComparisonGroup{}, err
	}
	if _, err := s.GetUnit(unitID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ComparisonGroup{}, ErrInvalidUnit
		}
		return ComparisonGroup{}, err
	}
	var id int64
	err = s.withTx(func(q *sqlc.Queries) error {
		var err error
		id, err = q.InsertComparisonGroup(ctx(), sqlc.InsertComparisonGroupParams{
			Name:      name,
			UnitID:    unitID,
			CreatedAt: nowRFC3339(),
		})
		if err != nil {
			if isUniqueErr(err) {
				return ErrDuplicate
			}
			return err
		}
		return setComparisonGroupProducts(q, id, productIDs)
	})
	if err != nil {
		return ComparisonGroup{}, err
	}
	return s.GetComparisonGroup(id)
}

func (s *Store) UpdateComparisonGroup(id int64, name string, unitID int64, productIDs []int64) error {
	name, err := normalizeComparisonGroupName(name)
	if err != nil {
		return err
	}
	if _, err := s.GetUnit(unitID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrInvalidUnit
		}
		return err
	}
	return s.withTx(func(q *sqlc.Queries) error {
		n, err := q.UpdateComparisonGroup(ctx(), sqlc.UpdateComparisonGroupParams{
			Name:   name,
			UnitID: unitID,
			ID:     id,
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
		return setComparisonGroupProducts(q, id, productIDs)
	})
}

func (s *Store) DeleteComparisonGroup(id int64) error {
	n, err := s.q.DeleteComparisonGroup(ctx(), id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListComparisonGroupProductIDs(groupID int64) ([]int64, error) {
	ids, err := s.q.ListComparisonGroupProductIDs(ctx(), groupID)
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (s *Store) ListComparisonGroupsForProduct(productID int64) ([]ComparisonGroup, error) {
	rows, err := s.q.ListComparisonGroupsForProduct(ctx(), productID)
	if err != nil {
		return nil, err
	}
	out := make([]ComparisonGroup, len(rows))
	for i, r := range rows {
		out[i] = ComparisonGroup{
			ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName,
			CreatedAt: r.CreatedAt, ProductCount: int(r.ProductCount),
		}
	}
	return out, nil
}

func (s *Store) SetProductComparisonGroups(productID int64, groupIDs []int64) error {
	if _, err := s.GetProduct(productID); err != nil {
		return err
	}
	return s.withTx(func(q *sqlc.Queries) error {
		return setProductComparisonGroups(q, productID, groupIDs)
	})
}

func (s *Store) ComparisonLeaders(productID int64) ([]GroupComparison, error) {
	if _, err := s.GetProduct(productID); err != nil {
		return nil, err
	}
	members, err := s.q.ListComparisonMembersForProduct(ctx(), productID)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, nil
	}
	ids := uniqueProductIDs(members)
	buys, err := listPurchasesForProductIDs(s.q, ids)
	if err != nil {
		return nil, err
	}
	last := lastPricesByProduct(buys)
	return pickGroupLeaders(productID, members, last), nil
}

func (s *Store) RelatedGroupProducts(productID int64, now time.Time) ([]RelatedProduct, error) {
	if _, err := s.GetProduct(productID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListRelatedGroupProducts(ctx(), sqlc.ListRelatedGroupProductsParams{
		ProductID: productID,
		ExcludeID: productID,
	})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	ids := make([]int64, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	buys, err := listPurchasesForProductIDs(s.q, ids)
	if err != nil {
		return nil, err
	}
	quotes := quotesByProduct(buys, now)
	out := make([]RelatedProduct, 0, len(rows))
	for _, r := range rows {
		pt, ok := quotes[r.ID]
		if !ok {
			continue
		}
		cp := pt
		out = append(out, RelatedProduct{
			Product: Product{
				ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName,
				ImagePath: r.ImagePath, CreatedAt: r.CreatedAt,
			},
			Quote: &cp,
		})
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func pickGroupLeaders(selectedID int64, members []sqlc.ListComparisonMembersForProductRow, last map[int64]PricePoint) []GroupComparison {
	var out []GroupComparison
	idx := -1
	for _, m := range members {
		if idx < 0 || out[idx].Group.ID != m.GroupID {
			out = append(out, GroupComparison{Group: ComparisonGroup{
				ID: m.GroupID, Name: m.GroupName, UnitID: m.GroupUnitID, UnitName: m.GroupUnitName,
			}})
			idx = len(out) - 1
		}
		offer, ok := comparableOffer(m, last)
		if !ok {
			continue
		}
		if m.ProductID == selectedID {
			cp := offer
			out[idx].Selected = &cp
			out[idx].SelectedComparable = true
		}
		if betterOffer(offer, out[idx].Leader, selectedID) {
			cp := offer
			out[idx].Leader = &cp
		}
	}
	for i := range out {
		if out[i].Leader != nil && out[i].Selected != nil && out[i].Leader.ProductID == selectedID {
			out[i].SelectedIsLeader = true
		}
	}
	return out
}

func comparableOffer(m sqlc.ListComparisonMembersForProductRow, last map[int64]PricePoint) (ComparisonOffer, bool) {
	pt, ok := last[m.ProductID]
	if !ok {
		return ComparisonOffer{}, false
	}
	factor, ok := factorToGroupUnit(m.ProductUnitID, m.GroupUnitID, m.ConversionFactor)
	if !ok {
		return ComparisonOffer{}, false
	}
	price := pt.Price.Div(factor)
	return ComparisonOffer{
		ProductID:   m.ProductID,
		ProductName: m.ProductName,
		Price:       price,
		BoughtOn:    pt.BoughtOn,
	}, true
}

func factorToGroupUnit(productUnitID, groupUnitID int64, conv sql.NullString) (decimal.Decimal, bool) {
	if productUnitID == groupUnitID {
		return decimal.NewFromInt(1), true
	}
	if !conv.Valid {
		return decimal.Zero, false
	}
	factor, err := decimal.NewFromString(conv.String)
	if err != nil || factor.IsZero() || factor.IsNegative() {
		return decimal.Zero, false
	}
	return factor, true
}

func betterOffer(candidate ComparisonOffer, current *ComparisonOffer, selectedID int64) bool {
	if current == nil {
		return true
	}
	if candidate.Price.LessThan(current.Price) {
		return true
	}
	if current.Price.LessThan(candidate.Price) {
		return false
	}
	if candidate.ProductID == selectedID {
		return true
	}
	if current.ProductID == selectedID {
		return false
	}
	return candidate.ProductID < current.ProductID
}

func uniqueProductIDs(members []sqlc.ListComparisonMembersForProductRow) []int64 {
	seen := map[int64]bool{}
	var ids []int64
	for _, m := range members {
		if seen[m.ProductID] {
			continue
		}
		seen[m.ProductID] = true
		ids = append(ids, m.ProductID)
	}
	return ids
}

func lastPricesByProduct(buys []Purchase) map[int64]PricePoint {
	byProduct := map[int64][]Purchase{}
	for _, p := range buys {
		byProduct[p.ProductID] = append(byProduct[p.ProductID], p)
	}
	out := map[int64]PricePoint{}
	for id, list := range byProduct {
		if pt := LastUnitPrice(list); pt != nil {
			out[id] = *pt
		}
	}
	return out
}

func listPurchasesForProductIDs(q *sqlc.Queries, ids []int64) ([]Purchase, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := q.ListPurchasesForProductIDs(ctx(), ids)
	if err != nil {
		return nil, err
	}
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

func setComparisonGroupProducts(q *sqlc.Queries, groupID int64, productIDs []int64) error {
	ids, err := uniquePositiveIDs(productIDs)
	if err != nil {
		return err
	}
	for _, id := range ids {
		n, err := q.CountProductsByID(ctx(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
	}
	if err := q.DeleteComparisonGroupProducts(ctx(), groupID); err != nil {
		return err
	}
	for _, id := range ids {
		if err := q.InsertComparisonGroupProduct(ctx(), sqlc.InsertComparisonGroupProductParams{
			GroupID:   groupID,
			ProductID: id,
		}); err != nil {
			return err
		}
	}
	return nil
}

func setProductComparisonGroups(q *sqlc.Queries, productID int64, groupIDs []int64) error {
	ids, err := uniquePositiveIDs(groupIDs)
	if err != nil {
		return err
	}
	for _, id := range ids {
		n, err := q.CountComparisonGroupsByID(ctx(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrInvalidComparisonGroup
		}
	}
	if err := q.DeleteProductComparisonGroups(ctx(), productID); err != nil {
		return err
	}
	for _, id := range ids {
		if err := q.InsertComparisonGroupProduct(ctx(), sqlc.InsertComparisonGroupProductParams{
			GroupID:   id,
			ProductID: productID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func uniquePositiveIDs(ids []int64) ([]int64, error) {
	seen := map[int64]bool{}
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if id < 0 {
			return nil, ErrNotFound
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

func normalizeComparisonGroupName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", ErrComparisonGroupName
	}
	return name, nil
}

func mapGetComparisonGroup(r sqlc.GetComparisonGroupRow) ComparisonGroup {
	return ComparisonGroup{
		ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName,
		CreatedAt: r.CreatedAt, ProductCount: int(r.ProductCount),
	}
}

func mapComparisonGroups(rows []sqlc.ListComparisonGroupsRow) []ComparisonGroup {
	out := make([]ComparisonGroup, len(rows))
	for i, r := range rows {
		out[i] = ComparisonGroup{
			ID: r.ID, Name: r.Name, UnitID: r.UnitID, UnitName: r.UnitName,
			CreatedAt: r.CreatedAt, ProductCount: int(r.ProductCount),
		}
	}
	return out
}
