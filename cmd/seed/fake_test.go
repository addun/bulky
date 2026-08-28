package main

import (
	"testing"

	"github.com/adrian/bulkly/internal/store"
	"github.com/brianvoe/gofakeit/v7"
)

func TestFakeSeedInsertsRows(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	cfg := fakeConfig{Companies: 3, Products: 5, Purchases: 12}
	stats, err := fakeSeed(st, gofakeit.New(8675309), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if stats != (fakeStats{Companies: 3, Products: 5, Purchases: 12}) {
		t.Fatalf("stats: %+v", stats)
	}

	companies, err := st.ListCompanies()
	if err != nil {
		t.Fatal(err)
	}
	if len(companies) != 3 {
		t.Fatalf("companies: got %d", len(companies))
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
	if buys != 12 {
		t.Fatalf("purchases: got %d", buys)
	}
}

func TestFakeSeedIsReproducible(t *testing.T) {
	cfg := fakeConfig{Companies: 2, Products: 4, Purchases: 6}

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
