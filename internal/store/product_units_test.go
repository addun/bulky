package store

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

func TestProductConversionsSaveAndList(t *testing.T) {
	s, szt, liter, ml := conversionFixture(t)
	p, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
		{UnitID: ml.ID, Factor: mustDec(t, "1500")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Conversions) != 2 {
		t.Fatalf("conversions: %#v", p.Conversions)
	}
	got := map[string]string{}
	for _, c := range p.Conversions {
		got[c.UnitName] = c.Factor.String()
	}
	if got["l"] != "1.5" || got["ml"] != "1500" {
		t.Fatalf("got %#v", got)
	}

	listed, err := s.ListProductConversions(p.ID)
	if err != nil || len(listed) != 2 {
		t.Fatalf("list: %v %#v", err, listed)
	}

	items, err := s.ListProducts("")
	if err != nil {
		t.Fatal(err)
	}
	var item ProductListItem
	for _, it := range items {
		if it.ID == p.ID {
			item = it
			break
		}
	}
	if len(item.Conversions) != 2 {
		t.Fatalf("list products: %#v", item.Conversions)
	}
}

func TestProductConversionsRejectBadRows(t *testing.T) {
	s, szt, liter, _ := conversionFixture(t)
	_, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: szt.ID, Factor: mustDec(t, "1")},
	})
	if !errors.Is(err, ErrInvalidConversion) {
		t.Fatalf("purchase unit as extra: %v", err)
	}
	_, err = s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: decimal.Zero},
	})
	if !errors.Is(err, ErrInvalidConversion) {
		t.Fatalf("zero factor: %v", err)
	}
	_, err = s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
		{UnitID: liter.ID, Factor: mustDec(t, "2")},
	})
	if !errors.Is(err, ErrInvalidConversion) {
		t.Fatalf("duplicate extra: %v", err)
	}
	_, err = s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: 999, Factor: mustDec(t, "1")},
	})
	if !errors.Is(err, ErrInvalidUnit) {
		t.Fatalf("missing unit: %v", err)
	}
}

func TestProductConversionsReplaceOnUpdate(t *testing.T) {
	s, szt, liter, ml := conversionFixture(t)
	p, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateProduct(p.ID, "Water", szt.ID, nil, false, []ProductConversion{
		{UnitID: ml.ID, Factor: mustDec(t, "1500")},
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetProduct(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Conversions) != 1 || got.Conversions[0].UnitID != ml.ID {
		t.Fatalf("replaced: %#v", got.Conversions)
	}
	if err := s.UpdateProduct(p.ID, "Water", szt.ID, nil, false, []ProductConversion{}); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetProduct(p.ID)
	if err != nil || len(got.Conversions) != 0 {
		t.Fatalf("cleared: %v %#v", err, got.Conversions)
	}
}

func TestUnitInUseViaConversion(t *testing.T) {
	s, szt, liter, _ := conversionFixture(t)
	if _, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
	}); err != nil {
		t.Fatal(err)
	}
	u, err := s.GetUnit(liter.ID)
	if err != nil || u.ProductCount != 1 {
		t.Fatalf("count: %v %#v", err, u)
	}
	if err := s.DeleteUnit(liter.ID); !errors.Is(err, ErrUnitInUse) {
		t.Fatalf("delete: %v", err)
	}
}

func TestQtyInAndPricePer(t *testing.T) {
	p := Product{
		UnitID:   1,
		UnitName: "szt",
		Conversions: []ProductConversion{
			{UnitID: 2, UnitName: "l", Factor: mustDec(t, "1.5")},
		},
	}
	qty := QtyIn(mustDec(t, "6"), p.Conversions[0])
	if !qty.Equal(mustDec(t, "9")) {
		t.Fatalf("qty in l: %s", qty)
	}
	price := PricePer(mustDec(t, "15"), mustDec(t, "6"), p.Conversions[0])
	if !price.Equal(mustDec(t, "1.6666666666666667")) && price.StringFixed(2) != "1.67" {
		if !price.Round(2).Equal(mustDec(t, "1.67")) {
			t.Fatalf("price: %s", price)
		}
	}
}

func TestMergeProductsUnionsConversions(t *testing.T) {
	s, szt, liter, ml := conversionFixture(t)
	into, err := s.CreateProduct("Sparkling water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	from, err := s.CreateProduct("Woda gazowana", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
		{UnitID: ml.ID, Factor: mustDec(t, "1500")},
	})
	if err != nil {
		t.Fatal(err)
	}
	keeper, _, err := s.MergeProducts(into.ID, from.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetProduct(keeper.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Conversions) != 2 {
		t.Fatalf("union: %#v", got.Conversions)
	}
	names := map[string]bool{}
	for _, c := range got.Conversions {
		names[c.UnitName] = true
	}
	if !names["l"] || !names["ml"] {
		t.Fatalf("names: %#v", got.Conversions)
	}
}

func TestMergeProductsRejectsConversionConflict(t *testing.T) {
	s, szt, liter, _ := conversionFixture(t)
	into, err := s.CreateProduct("Water A", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	from, err := s.CreateProduct("Water B", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = s.MergeProducts(into.ID, from.ID)
	var conflict *ConversionConflictError
	if !errors.As(err, &conflict) || conflict.UnitName != "l" {
		t.Fatalf("conflict: %v", err)
	}
	if _, err := s.GetProduct(from.ID); err != nil {
		t.Fatalf("from should remain: %v", err)
	}
	if _, err := s.MergePlan(into.ID, from.ID); !errors.As(err, &conflict) {
		t.Fatalf("plan: %v", err)
	}
}

func TestChangePurchaseUnitPromotesExtra(t *testing.T) {
	s, szt, liter, ml := conversionFixture(t)
	p, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
		{UnitID: ml.ID, Factor: mustDec(t, "1500")},
	})
	if err != nil {
		t.Fatal(err)
	}
	packed, err := s.CreatePurchase(p.ID, 0, "2026-08-20", mustDec(t, "2"), mustDec(t, "15"), KindPurchase)
	if err != nil {
		t.Fatal(err)
	}
	loose, err := s.CreatePurchase(p.ID, 0, "2026-08-21", mustDec(t, "3"), mustDec(t, "7.50"), KindPurchase)
	if err != nil {
		t.Fatal(err)
	}

	if err := s.ChangePurchaseUnit(p.ID, liter.ID); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetProduct(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.UnitID != liter.ID {
		t.Fatalf("unit: %d want %d", got.UnitID, liter.ID)
	}
	factors := map[int64]decimal.Decimal{}
	for _, c := range got.Conversions {
		factors[c.UnitID] = c.Factor
	}
	if _, ok := factors[liter.ID]; ok {
		t.Fatalf("promoted unit should not stay as extra: %#v", got.Conversions)
	}
	wantSzt := decimal.NewFromInt(1).Div(mustDec(t, "1.5"))
	if !factors[szt.ID].Equal(wantSzt) {
		t.Fatalf("szt factor: %s want %s", factors[szt.ID], wantSzt)
	}
	if !factors[ml.ID].Equal(mustDec(t, "1000")) {
		t.Fatalf("ml factor: %s", factors[ml.ID])
	}

	packed, err = s.GetPurchase(packed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !packed.Quantity.Equal(mustDec(t, "3")) {
		t.Fatalf("packed qty: %s", packed.Quantity)
	}
	if !packed.Amount.Equal(mustDec(t, "15")) {
		t.Fatalf("amount should stay: %s", packed.Amount)
	}

	loose, err = s.GetPurchase(loose.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !loose.Quantity.Equal(mustDec(t, "4.5")) {
		t.Fatalf("loose qty: %s", loose.Quantity)
	}
}

func TestChangePurchaseUnitRejectsUnknownExtra(t *testing.T) {
	s, szt, liter, ml := conversionFixture(t)
	p, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	buy, err := s.CreatePurchase(p.ID, 0, "2026-08-20", mustDec(t, "500"), mustDec(t, "8"), KindPurchase)
	if err != nil {
		t.Fatal(err)
	}

	if err := s.ChangePurchaseUnit(p.ID, ml.ID); !errors.Is(err, ErrInvalidConversion) {
		t.Fatalf("unit that is not an extra: %v", err)
	}

	got, err := s.GetProduct(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.UnitID != szt.ID {
		t.Fatalf("unit: %d", got.UnitID)
	}
	buy, err = s.GetPurchase(buy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !buy.Quantity.Equal(mustDec(t, "500")) {
		t.Fatalf("qty should stay: %s", buy.Quantity)
	}
}

func TestChangePurchaseUnitRejects(t *testing.T) {
	s, szt, liter, ml := conversionFixture(t)
	p, err := s.CreateProduct("Water", szt.ID, nil, []ProductConversion{
		{UnitID: liter.ID, Factor: mustDec(t, "1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(p.ID, 0, "2026-08-20", mustDec(t, "2"), mustDec(t, "5"), KindPurchase); err != nil {
		t.Fatal(err)
	}

	if err := s.ChangePurchaseUnit(p.ID, szt.ID); !errors.Is(err, ErrInvalidUnit) {
		t.Fatalf("same unit: %v", err)
	}
	if err := s.ChangePurchaseUnit(p.ID, ml.ID); !errors.Is(err, ErrInvalidConversion) {
		t.Fatalf("not an extra: %v", err)
	}
	if err := s.ChangePurchaseUnit(p.ID, 999); !errors.Is(err, ErrInvalidConversion) {
		t.Fatalf("missing unit: %v", err)
	}
	if err := s.ChangePurchaseUnit(999, liter.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing product: %v", err)
	}

	got, err := s.GetProduct(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.UnitID != szt.ID || len(got.Conversions) != 1 || got.Conversions[0].UnitID != liter.ID {
		t.Fatalf("product should be unchanged: %#v", got)
	}
	buys, err := s.ListPurchases(p.ID)
	if err != nil || len(buys) != 1 || !buys[0].Quantity.Equal(mustDec(t, "2")) {
		t.Fatalf("purchases should be unchanged: %v %#v", err, buys)
	}
}

func TestUpdateProductRejectsUnitChange(t *testing.T) {
	s, szt, liter, _ := conversionFixture(t)
	p, err := s.CreateProduct("Water", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateProduct(p.ID, "Water", liter.ID, nil, false); !errors.Is(err, ErrInvalidUnit) {
		t.Fatalf("unit change: %v", err)
	}
	got, err := s.GetProduct(p.ID)
	if err != nil || got.UnitID != szt.ID {
		t.Fatalf("unit should stay: %v %#v", err, got)
	}
}

func conversionFixture(t *testing.T) (*Store, Unit, Unit, Unit) {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	szt, err := s.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	liter, err := s.CreateUnit("l")
	if err != nil {
		t.Fatal(err)
	}
	ml, err := s.CreateUnit("ml")
	if err != nil {
		t.Fatal(err)
	}
	return s, szt, liter, ml
}
