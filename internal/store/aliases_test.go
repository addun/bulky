package store

import (
	"errors"
	"testing"
)

func TestAliasCRUDAndUniqueness(t *testing.T) {
	s, _, flour, rice, lidl, biedronka := aliasFixture(t)

	shop, err := s.CreateAlias(flour.ID, lidl.ID, "Mąka tortowa")
	if err != nil {
		t.Fatal(err)
	}
	if shop.ProductName != "Cake flour" || shop.CompanyName != "Lidl" || shop.Alias != "Mąka tortowa" {
		t.Fatalf("shop: %#v", shop)
	}

	global, err := s.CreateAlias(flour.ID, 0, "Tortowa")
	if err != nil {
		t.Fatal(err)
	}
	if global.CompanyID != 0 || global.CompanyName != "" {
		t.Fatalf("global: %#v", global)
	}

	if _, err := s.CreateAlias(flour.ID, lidl.ID, "mąka tortowa"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup shop: %v", err)
	}
	if _, err := s.CreateAlias(rice.ID, 0, "tortowa"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup global: %v", err)
	}
	if _, err := s.CreateAlias(flour.ID, 0, "Cake flour"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("catalog name: %v", err)
	}
	if _, err := s.CreateAlias(flour.ID, 0, "  "); !errors.Is(err, ErrInvalidAlias) {
		t.Fatalf("empty: %v", err)
	}

	other, err := s.CreateAlias(rice.ID, biedronka.ID, "Mąka tortowa")
	if err != nil {
		t.Fatal(err)
	}
	if other.ProductID != rice.ID {
		t.Fatalf("other shop: %#v", other)
	}

	list, err := s.ListAliases()
	if err != nil || len(list) != 3 {
		t.Fatalf("list: %v %#v", err, list)
	}
	forFlour, err := s.ListAliasesByProduct(flour.ID)
	if err != nil || len(forFlour) != 2 {
		t.Fatalf("by product: %v %#v", err, forFlour)
	}

	if err := s.UpdateAlias(shop.ID, flour.ID, lidl.ID, "Mąka T 1kg"); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetAlias(shop.ID)
	if err != nil || got.Alias != "Mąka T 1kg" {
		t.Fatalf("updated: %v %#v", err, got)
	}
	if err := s.DeleteAlias(shop.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetAlias(shop.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
}

func TestFindProductByNameShopThenGlobal(t *testing.T) {
	s, _, flour, rice, lidl, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, 0, "Mąka"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(rice.ID, lidl.ID, "Mąka"); err != nil {
		t.Fatal(err)
	}

	shopHit, err := s.FindProductByName("mąka", lidl.ID)
	if err != nil || shopHit.ID != rice.ID {
		t.Fatalf("shop should win: %v %#v", err, shopHit)
	}
	globalHit, err := s.FindProductByName("mąka", 0)
	if err != nil || globalHit.ID != flour.ID {
		t.Fatalf("no company uses global: %v %#v", err, globalHit)
	}
	catalog, err := s.FindProductByName("cake flour", lidl.ID)
	if err != nil || catalog.ID != flour.ID {
		t.Fatalf("catalog: %v %#v", err, catalog)
	}
}

func TestImportBillResolvesAlias(t *testing.T) {
	s, kg, flour, _, lidl, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, lidl.ID, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}

	res, err := s.ImportBill(BillImport{
		CompanyID: lidl.ID,
		BoughtOn:  "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Mąka tortowa 1kg", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.50")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 1 || len(res.ProductIDs) != 1 || res.ProductIDs[0] != flour.ID {
		t.Fatalf("import: %#v", res)
	}
	products, err := s.ListProducts("")
	if err != nil || len(products) != 2 {
		t.Fatalf("should not create a product: %v %#v", err, products)
	}

	found, err := s.ListProducts("tortowa")
	if err != nil || len(found) != 1 || found[0].ID != flour.ID {
		t.Fatalf("search: %v %#v", err, found)
	}
}

func TestProductNameCannotReuseAlias(t *testing.T) {
	s, kg, flour, _, _, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, 0, "Tortowa"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateProduct("tortowa", kg.ID, nil); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("create: %v", err)
	}
	if err := s.UpdateProduct(flour.ID, "Tortowa", kg.ID, nil, false); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("update: %v", err)
	}
}

func aliasFixture(t *testing.T) (*Store, Unit, Product, Product, Company, Company) {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	units, err := s.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	kg := units[0]
	flour, err := s.CreateProduct("Cake flour", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	rice, err := s.CreateProduct("Rice", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	lidl, err := s.CreateCompany("Lidl", "Kościuszki", "1", "", "40-001", "Katowice")
	if err != nil {
		t.Fatal(err)
	}
	biedronka, err := s.CreateCompany("Biedronka", "Marszałkowska", "2", "", "00-001", "Warszawa")
	if err != nil {
		t.Fatal(err)
	}
	return s, kg, flour, rice, lidl, biedronka
}
