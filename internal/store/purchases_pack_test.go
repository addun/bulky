package store

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

func TestCreatePurchaseStoresQuantity(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	szt, err := s.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProduct("Almonds", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	buy, err := s.CreatePurchase(p.ID, 0, "2026-08-20", mustDec(t, "4"), mustDec(t, "12.40"), KindPurchase)
	if err != nil {
		t.Fatal(err)
	}
	if !buy.Quantity.Equal(mustDec(t, "4")) {
		t.Fatalf("quantity: got %s want 4", buy.Quantity)
	}

	if err := s.UpdatePurchase(buy.ID, 0, "2026-08-21", mustDec(t, "3"), mustDec(t, "18"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetPurchase(buy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Quantity.Equal(mustDec(t, "3")) {
		t.Fatalf("updated quantity: got %s want 3", got.Quantity)
	}

	rows, err := s.ListPurchases(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	years := YearlySummaries(rows)
	if len(years) != 1 || !years[0].Quantity.Equal(mustDec(t, "3")) {
		t.Fatalf("years: %#v", years)
	}
}

func TestCreatePurchaseRejectsZeroQuantity(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	g, err := s.FindUnitByName("g")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProduct("Coffee", g.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(p.ID, 0, "2026-08-20", decimal.Zero, mustDec(t, "1"), KindPurchase); !errors.Is(err, ErrInvalidQuantity) {
		t.Fatalf("zero qty: %v", err)
	}
}
