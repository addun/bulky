package main

import (
	"testing"

	"github.com/adrian/bulkly/internal/store"
	"github.com/brianvoe/gofakeit/v7"
	"github.com/shopspring/decimal"
)

func TestFakeSeedInsertsRows(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	cfg := fakeConfig{Stories: 3, Products: 5, HistoryPerProduct: 2}
	stats, err := fakeSeed(st, gofakeit.New(8675309), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if stats != (fakeStats{Stories: 3, Products: 5, Purchases: 10}) {
		t.Fatalf("stats: %+v", stats)
	}

	stories, err := st.ListStories()
	if err != nil {
		t.Fatal(err)
	}
	if len(stories) != 3 {
		t.Fatalf("stories: got %d", len(stories))
	}

	products, err := st.ListProducts("")
	if err != nil {
		t.Fatal(err)
	}
	if len(products) != 5 {
		t.Fatalf("products: got %d", len(products))
	}

	var buys int
	for _, p := range products {
		rows, err := st.ListPurchases(p.ID)
		if err != nil {
			t.Fatal(err)
		}
		buys += len(rows)
	}
	if buys != 10 {
		t.Fatalf("purchases: got %d", buys)
	}
}

func TestFakeSeedIsReproducible(t *testing.T) {
	cfg := fakeConfig{Stories: 2, Products: 4, HistoryPerProduct: 3}

	open := func(t *testing.T) *store.Store {
		t.Helper()
		st, err := store.Open(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { st.Close() })
		return st
	}

	a := open(t)
	b := open(t)
	if _, err := fakeSeed(a, gofakeit.New(42), cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := fakeSeed(b, gofakeit.New(42), cfg); err != nil {
		t.Fatal(err)
	}

	pa, err := a.ListProducts("")
	if err != nil {
		t.Fatal(err)
	}
	pb, err := b.ListProducts("")
	if err != nil {
		t.Fatal(err)
	}
	if len(pa) != len(pb) {
		t.Fatalf("product count %d vs %d", len(pa), len(pb))
	}
	for i := range pa {
		if pa[i].Name != pb[i].Name || pa[i].UnitName != pb[i].UnitName {
			t.Fatalf("product %d: %+v vs %+v", i, pa[i], pb[i])
		}
	}
}

func TestFakeSeedUnitPricesStayInRange(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	if _, err := fakeSeed(st, gofakeit.New(1), fakeConfig{Stories: 1, Products: 4, HistoryPerProduct: 80}); err != nil {
		t.Fatal(err)
	}

	minP := decimal.NewFromFloat(minUnitPrice)
	maxP := decimal.NewFromFloat(maxUnitPrice)
	products, err := st.ListProducts("")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range products {
		rows, err := st.ListPurchases(p.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row.Quantity.IsZero() {
				t.Fatalf("%s: zero quantity", p.Name)
			}
			up := row.Amount.Div(row.Quantity)
			if up.LessThan(minP) || up.GreaterThan(maxP) {
				t.Fatalf("%s: unit price %s outside 1–100", p.Name, up)
			}
		}
	}
}

func TestClampExistingUnitPricesRescales(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	units, err := st.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v", err)
	}
	boom, err := st.CreateProduct("Boom", units[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(boom.ID, 0, "2024-01-01", decimal.NewFromInt(1), decimal.NewFromInt(1_000_000), store.KindPurchase, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(boom.ID, 0, "2024-06-01", decimal.NewFromInt(2), decimal.NewFromInt(50_000_000), store.KindPrice, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}
	ok, err := st.CreateProduct("Fine", units[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(ok.ID, 0, "2024-01-01", decimal.NewFromInt(1), decimal.NewFromInt(12), store.KindPurchase, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}

	n, err := clampExistingUnitPrices(st)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("updated %d, want 2", n)
	}

	minP := decimal.NewFromFloat(minUnitPrice)
	maxP := decimal.NewFromFloat(maxUnitPrice)
	rows, err := st.ListPurchases(boom.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		up := row.Amount.Div(row.Quantity)
		if up.LessThan(minP) || up.GreaterThan(maxP) {
			t.Fatalf("boom unit price %s outside 1–100", up)
		}
	}
	fine, err := st.ListPurchases(ok.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(fine) != 1 || !fine[0].Amount.Equal(decimal.NewFromInt(12)) {
		t.Fatalf("in-range amount changed: %+v", fine)
	}
}
