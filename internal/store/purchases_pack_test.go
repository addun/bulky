package store

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

func TestCreatePurchaseFromPackagesComputesQuantity(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	g, err := s.FindUnitByName("g")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProduct("Almonds", g.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	buy, err := s.CreatePurchase(p.ID, 0, "2026-08-20", decimal.Zero, mustDec(t, "12.40"), KindPurchase, mustDec(t, "4"), mustDec(t, "100"))
	if err != nil {
		t.Fatal(err)
	}
	if !buy.HasPackage() {
		t.Fatal("expected packed purchase")
	}
	if !buy.Quantity.Equal(mustDec(t, "400")) {
		t.Fatalf("quantity: got %s want 400", buy.Quantity)
	}
	if !buy.PackageCount.Equal(mustDec(t, "4")) || !buy.PackageSize.Equal(mustDec(t, "100")) {
		t.Fatalf("pack: count=%s size=%s", buy.PackageCount, buy.PackageSize)
	}
	if !buy.FormPackages().Equal(mustDec(t, "4")) || !buy.FormPackSize().Equal(mustDec(t, "100")) {
		t.Fatalf("form pack: %s × %s", buy.FormPackages(), buy.FormPackSize())
	}

	last, ok, err := s.LastPackageSize(p.ID)
	if err != nil || !ok || !last.Equal(mustDec(t, "100")) {
		t.Fatalf("last pack size: %v ok=%v size=%s", err, ok, last)
	}

	if err := s.UpdatePurchase(buy.ID, 0, "2026-08-21", decimal.Zero, mustDec(t, "18"), KindPurchase, mustDec(t, "3"), mustDec(t, "250")); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetPurchase(buy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Quantity.Equal(mustDec(t, "750")) {
		t.Fatalf("updated quantity: got %s want 750", got.Quantity)
	}

	rows, err := s.ListPurchases(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	years := YearlySummaries(rows)
	if len(years) != 1 || !years[0].Quantity.Equal(mustDec(t, "750")) {
		t.Fatalf("years: %#v", years)
	}
}

func TestCreatePurchaseLooseQuantityStillWorks(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	g, err := s.FindUnitByName("g")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProduct("Rice", g.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	buy, err := s.CreatePurchase(p.ID, 0, "2026-08-20", mustDec(t, "250"), mustDec(t, "8"), KindPurchase, decimal.Zero, decimal.Zero)
	if err != nil {
		t.Fatal(err)
	}
	if buy.HasPackage() {
		t.Fatalf("expected loose buy: %#v", buy)
	}
	if !buy.Quantity.Equal(mustDec(t, "250")) {
		t.Fatalf("quantity: %s", buy.Quantity)
	}
	if !buy.FormPackages().Equal(mustDec(t, "1")) || !buy.FormPackSize().Equal(mustDec(t, "250")) {
		t.Fatalf("legacy form: %s × %s", buy.FormPackages(), buy.FormPackSize())
	}
	if _, ok, err := s.LastPackageSize(p.ID); err != nil || ok {
		t.Fatalf("last pack size: err=%v ok=%v", err, ok)
	}
}

func TestCreatePurchaseRejectsPartialPackage(t *testing.T) {
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
	if _, err := s.CreatePurchase(p.ID, 0, "2026-08-20", decimal.Zero, mustDec(t, "1"), KindPurchase, mustDec(t, "4"), decimal.Zero); !errors.Is(err, ErrIncompletePackage) {
		t.Fatalf("count only: %v", err)
	}
	buy, err := s.CreatePurchase(p.ID, 0, "2026-08-20", mustDec(t, "250"), mustDec(t, "8"), KindPurchase, decimal.Zero, mustDec(t, "100"))
	if err != nil {
		t.Fatal(err)
	}
	if buy.HasPackage() || !buy.Quantity.Equal(mustDec(t, "250")) {
		t.Fatalf("size without packages should be a loose buy: %#v", buy)
	}
}
