package store

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestComparisonGroupCRUD(t *testing.T) {
	s, kg, szt := comparisonFixture(t)
	g, err := s.CreateComparisonGroup("  Mlekovita  ", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if g.Name != "Mlekovita" || g.UnitID != kg.ID || g.UnitName != "kg" || g.ProductCount != 0 {
		t.Fatalf("created: %#v", g)
	}
	if _, err := s.CreateComparisonGroup("mlekovita", kg.ID, nil); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate: %v", err)
	}
	if _, err := s.CreateComparisonGroup("", kg.ID, nil); !errors.Is(err, ErrComparisonGroupName) {
		t.Fatalf("empty: %v", err)
	}
	if _, err := s.CreateComparisonGroup("Oils", 999, nil); !errors.Is(err, ErrInvalidUnit) {
		t.Fatalf("unit: %v", err)
	}

	p, err := s.CreateProduct("Mlekovita 200g", szt.ID, nil, []ProductConversion{
		{UnitID: kg.ID, Factor: mustDec(t, "0.2")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateComparisonGroup(g.ID, "Mlekovita packs", kg.ID, []int64{p.ID, p.ID}); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetComparisonGroup(g.ID)
	if err != nil || got.Name != "Mlekovita packs" || got.ProductCount != 1 {
		t.Fatalf("updated: %v %#v", err, got)
	}
	ids, err := s.ListComparisonGroupProductIDs(g.ID)
	if err != nil || len(ids) != 1 || ids[0] != p.ID {
		t.Fatalf("members: %v %#v", err, ids)
	}
	groups, err := s.ListComparisonGroupsForProduct(p.ID)
	if err != nil || len(groups) != 1 || groups[0].ID != g.ID {
		t.Fatalf("for product: %v %#v", err, groups)
	}

	if err := s.DeleteComparisonGroup(g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetComparisonGroup(g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
}

func TestComparisonLeadersPickCheapestPerGroup(t *testing.T) {
	s, _, _, small, large, market := butterFixture(t)

	got, err := s.ComparisonLeaders(small.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("groups: %#v", got)
	}
	if got[0].Group.Name != "All butters" || got[1].Group.Name != "Mlekovita" {
		t.Fatalf("order: %q %q", got[0].Group.Name, got[1].Group.Name)
	}

	brand := got[1]
	if brand.Leader == nil || brand.Leader.ProductID != large.ID || !brand.Leader.Price.Equal(mustDec(t, "16")) {
		t.Fatalf("brand leader: %#v", brand.Leader)
	}
	if brand.Selected == nil || brand.Selected.ProductID != small.ID || !brand.Selected.Price.Equal(mustDec(t, "20")) {
		t.Fatalf("brand selected: %#v", brand.Selected)
	}
	if brand.SelectedIsLeader || !brand.SelectedComparable {
		t.Fatalf("brand flags: %#v", brand)
	}

	all := got[0]
	if all.Leader == nil || all.Leader.ProductID != market.ID || !all.Leader.Price.Equal(mustDec(t, "12")) {
		t.Fatalf("market leader: %#v", all.Leader)
	}
	if all.SelectedIsLeader {
		t.Fatal("200g should not win the market")
	}

	got, err = s.ComparisonLeaders(large.ID)
	if err != nil {
		t.Fatal(err)
	}
	brand = byGroupName(t, got, "Mlekovita")
	if !brand.SelectedIsLeader || brand.Leader == nil || brand.Leader.ProductID != large.ID {
		t.Fatalf("500g should lead the brand: %#v", brand)
	}
	all = byGroupName(t, got, "All butters")
	if all.SelectedIsLeader || all.Leader == nil || all.Leader.ProductID != market.ID {
		t.Fatalf("Łaciate should still lead the market: %#v", all)
	}
}

func TestComparisonLeadersSkipIncomparableAndUnpriced(t *testing.T) {
	s, kg, szt := comparisonFixture(t)
	butter, err := s.CreateProduct("Mlekovita 200g", szt.ID, nil, []ProductConversion{
		{UnitID: kg.ID, Factor: mustDec(t, "0.2")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(butter.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "4"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	orphan, err := s.CreateProduct("Mystery pack", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(orphan.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "1"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	unpriced, err := s.CreateProduct("Mlekovita 500g", szt.ID, nil, []ProductConversion{
		{UnitID: kg.ID, Factor: mustDec(t, "0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	g, err := s.CreateComparisonGroup("Mlekovita", kg.ID, []int64{butter.ID, orphan.ID, unpriced.ID})
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.ComparisonLeaders(butter.ID)
	if err != nil || len(got) != 1 || got[0].Group.ID != g.ID {
		t.Fatalf("leaders: %v %#v", err, got)
	}
	if got[0].Leader == nil || got[0].Leader.ProductID != butter.ID || !got[0].SelectedIsLeader {
		t.Fatalf("only comparable priced pack should win: %#v", got[0])
	}
}

func TestComparisonLeadersPreferSelectedOnTie(t *testing.T) {
	s, kg, szt := comparisonFixture(t)
	a, err := s.CreateProduct("A pack", szt.ID, nil, []ProductConversion{{UnitID: kg.ID, Factor: mustDec(t, "0.2")}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateProduct("B pack", szt.ID, nil, []ProductConversion{{UnitID: kg.ID, Factor: mustDec(t, "0.2")}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(a.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "4"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(b.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "4"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateComparisonGroup("Same price", kg.ID, []int64{a.ID, b.ID}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ComparisonLeaders(b.ID)
	if err != nil || len(got) != 1 || !got[0].SelectedIsLeader || got[0].Leader.ProductID != b.ID {
		t.Fatalf("tie should keep the selected pack: %v %#v", err, got)
	}
}

func TestComparisonLeadersNoneWhenProductHasNoGroups(t *testing.T) {
	s, kg, _ := comparisonFixture(t)
	p, err := s.CreateProduct("Loose flour", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.ComparisonLeaders(p.ID)
	if err != nil || got != nil {
		t.Fatalf("empty: %v %#v", err, got)
	}
}

func TestRelatedGroupProductsListsPeersWith30DayLow(t *testing.T) {
	s, _, _, small, _, market := butterFixture(t)
	since := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	got, err := s.RelatedGroupProducts(small.ID, since)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("peers: %#v", got)
	}
	if got[0].Name != "Mlekovita 500g" || got[1].Name != "Łaciate 500g" {
		t.Fatalf("order: %q %q", got[0].Name, got[1].Name)
	}
	if got[0].ID == small.ID || got[1].ID == small.ID {
		t.Fatal("selected pack should not list itself")
	}
	if got[0].Low30 == nil || !got[0].Low30.Price.Equal(mustDec(t, "8")) {
		t.Fatalf("500g low: %#v", got[0].Low30)
	}
	if got[1].Low30 == nil || !got[1].Low30.Price.Equal(mustDec(t, "6")) || got[1].ID != market.ID {
		t.Fatalf("Łaciate low: %#v", got[1].Low30)
	}
	none, err := s.RelatedGroupProducts(small.ID, time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC))
	if err != nil || none != nil {
		t.Fatalf("outside window: %v %#v", err, none)
	}
}

func TestSetProductComparisonGroups(t *testing.T) {
	s, kg, szt := comparisonFixture(t)
	p, err := s.CreateProduct("Mlekovita 200g", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	brand, err := s.CreateComparisonGroup("Mlekovita", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	market, err := s.CreateComparisonGroup("All butters", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetProductComparisonGroups(p.ID, []int64{brand.ID, market.ID, brand.ID}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListComparisonGroupsForProduct(p.ID)
	if err != nil || len(got) != 2 {
		t.Fatalf("assigned: %v %#v", err, got)
	}
	if err := s.SetProductComparisonGroups(p.ID, nil); err != nil {
		t.Fatal(err)
	}
	got, err = s.ListComparisonGroupsForProduct(p.ID)
	if err != nil || len(got) != 0 {
		t.Fatalf("cleared: %v %#v", err, got)
	}
	if err := s.SetProductComparisonGroups(p.ID, []int64{999}); !errors.Is(err, ErrInvalidComparisonGroup) {
		t.Fatalf("bad group: %v", err)
	}
}

func TestDeleteUnitBlockedByComparisonGroup(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	u, err := s.CreateUnit("bundle")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateComparisonGroup("Week deals", u.ID, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUnit(u.ID); !errors.Is(err, ErrUnitInUse) {
		t.Fatalf("in use: %v", err)
	}
}

func TestMergeProductsMovesComparisonGroups(t *testing.T) {
	s, kg, szt := comparisonFixture(t)
	keep, err := s.CreateProduct("Mlekovita 200g", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	drop, err := s.CreateProduct("Mlekovita Extra 200g", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := s.CreateComparisonGroup("Mlekovita", kg.ID, []int64{keep.ID, drop.ID})
	if err != nil {
		t.Fatal(err)
	}
	onlyDrop, err := s.CreateComparisonGroup("All butters", kg.ID, []int64{drop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.MergeProducts(keep.ID, drop.ID); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListComparisonGroupsForProduct(keep.ID)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, g := range got {
		names[g.Name] = true
	}
	if !names["Mlekovita"] || !names["All butters"] || len(got) != 2 {
		t.Fatalf("groups: %#v", got)
	}
	ids, err := s.ListComparisonGroupProductIDs(shared.ID)
	if err != nil || len(ids) != 1 || ids[0] != keep.ID {
		t.Fatalf("shared members: %v %#v", err, ids)
	}
	ids, err = s.ListComparisonGroupProductIDs(onlyDrop.ID)
	if err != nil || len(ids) != 1 || ids[0] != keep.ID {
		t.Fatalf("moved members: %v %#v", err, ids)
	}
}

func comparisonFixture(t *testing.T) (*Store, Unit, Unit) {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	kg, err := s.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	szt, err := s.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	return s, kg, szt
}

func butterFixture(t *testing.T) (*Store, Unit, Unit, Product, Product, Product) {
	t.Helper()
	s, kg, szt := comparisonFixture(t)
	small, err := s.CreateProduct("Mlekovita 200g", szt.ID, nil, []ProductConversion{
		{UnitID: kg.ID, Factor: mustDec(t, "0.2")},
	})
	if err != nil {
		t.Fatal(err)
	}
	large, err := s.CreateProduct("Mlekovita 500g", szt.ID, nil, []ProductConversion{
		{UnitID: kg.ID, Factor: mustDec(t, "0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	market, err := s.CreateProduct("Łaciate 500g", szt.ID, nil, []ProductConversion{
		{UnitID: kg.ID, Factor: mustDec(t, "0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(small.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "4"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(large.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "8"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(market.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "6"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateComparisonGroup("Mlekovita", kg.ID, []int64{small.ID, large.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateComparisonGroup("All butters", kg.ID, []int64{small.ID, large.ID, market.ID}); err != nil {
		t.Fatal(err)
	}
	return s, kg, szt, small, large, market
}

func byGroupName(t *testing.T, got []GroupComparison, name string) GroupComparison {
	t.Helper()
	for _, g := range got {
		if g.Group.Name == name {
			return g
		}
	}
	t.Fatalf("missing group %q in %#v", name, got)
	return GroupComparison{}
}

func TestFactorToGroupUnit(t *testing.T) {
	if got, ok := factorToGroupUnit(3, 3, sql.NullString{}); !ok || !got.Equal(decimal.NewFromInt(1)) {
		t.Fatalf("same unit: %v %v", got, ok)
	}
	if _, ok := factorToGroupUnit(1, 2, sql.NullString{}); ok {
		t.Fatal("missing conversion should not compare")
	}
	if got, ok := factorToGroupUnit(1, 2, sql.NullString{String: "0.2", Valid: true}); !ok || !got.Equal(mustDec(t, "0.2")) {
		t.Fatalf("conversion: %v %v", got, ok)
	}
}
