package store

import (
	"errors"
	"testing"
)

func TestAliasCRUDAndUniqueness(t *testing.T) {
	s, _, flour, rice, lidl, biedronka := aliasFixture(t)

	shop, err := s.CreateAlias(flour.ID, lidl.ID, 0, "Mąka tortowa")
	if err != nil {
		t.Fatal(err)
	}
	if shop.ProductName != "Cake flour" || shop.StoryName != "Lidl" || shop.Alias != "Mąka tortowa" {
		t.Fatalf("shop: %#v", shop)
	}

	global, err := s.CreateAlias(flour.ID, 0, 0, "Tortowa")
	if err != nil {
		t.Fatal(err)
	}
	if global.StoryID != 0 || global.StoryName != "" || global.RetailChainID != 0 {
		t.Fatalf("global: %#v", global)
	}

	if _, err := s.CreateAlias(flour.ID, lidl.ID, 0, "mąka tortowa"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup shop: %v", err)
	}
	if _, err := s.CreateAlias(rice.ID, 0, 0, "tortowa"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup global: %v", err)
	}
	if _, err := s.CreateAlias(flour.ID, 0, 0, "Cake flour"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("catalog name: %v", err)
	}
	if _, err := s.CreateAlias(flour.ID, 0, 0, "  "); !errors.Is(err, ErrInvalidAlias) {
		t.Fatalf("empty: %v", err)
	}
	if _, err := s.CreateAlias(flour.ID, lidl.ID, 1, "Both"); !errors.Is(err, ErrAliasScope) {
		t.Fatalf("both scopes: %v", err)
	}

	other, err := s.CreateAlias(rice.ID, biedronka.ID, 0, "Mąka tortowa")
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

	if err := s.UpdateAlias(shop.ID, flour.ID, lidl.ID, 0, "Mąka T 1kg"); err != nil {
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
	if _, err := s.CreateAlias(flour.ID, 0, 0, "Mąka"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(rice.ID, lidl.ID, 0, "Mąka"); err != nil {
		t.Fatal(err)
	}

	shopHit, err := s.FindProductByName("mąka", lidl.ID)
	if err != nil || shopHit.ID != rice.ID {
		t.Fatalf("shop should win: %v %#v", err, shopHit)
	}
	globalHit, err := s.FindProductByName("mąka", 0)
	if err != nil || globalHit.ID != flour.ID {
		t.Fatalf("no story uses global: %v %#v", err, globalHit)
	}
	catalog, err := s.FindProductByName("cake flour", lidl.ID)
	if err != nil || catalog.ID != flour.ID {
		t.Fatalf("catalog: %v %#v", err, catalog)
	}
}

func TestFindProductByNameStoryThenChainThenGlobal(t *testing.T) {
	s, kg, flour, rice, sugar := chainAliasFixture(t)
	biedraA, biedraB, lidlShop := sugar.a, sugar.b, sugar.lidl

	if _, err := s.CreateAlias(flour.ID, 0, 0, "Płatki"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(rice.ID, 0, sugar.biedronka.ID, "Płatki"); err != nil {
		t.Fatal(err)
	}
	oats, err := s.CreateProduct("Oats", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(oats.ID, biedraA.ID, 0, "Płatki"); err != nil {
		t.Fatal(err)
	}

	storyHit, err := s.FindProductByName("płatki", biedraA.ID)
	if err != nil || storyHit.ID != oats.ID {
		t.Fatalf("story should win: %v %#v", err, storyHit)
	}
	chainHit, err := s.FindProductByName("płatki", biedraB.ID)
	if err != nil || chainHit.ID != rice.ID {
		t.Fatalf("other Biedronka uses chain: %v %#v", err, chainHit)
	}
	lidlHit, err := s.FindProductByName("płatki", lidlShop.ID)
	if err != nil || lidlHit.ID != flour.ID {
		t.Fatalf("Lidl chain should not leak Biedronka: %v %#v", err, lidlHit)
	}
	globalHit, err := s.FindProductByName("płatki", 0)
	if err != nil || globalHit.ID != flour.ID {
		t.Fatalf("no story uses global: %v %#v", err, globalHit)
	}
}

func TestChainAliasUniquePerChain(t *testing.T) {
	s, _, flour, rice, shops := chainAliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, 0, shops.biedronka.ID, "PłatkiDada100szt"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(rice.ID, 0, shops.biedronka.ID, "płatkidada100szt"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup chain: %v", err)
	}
	got, err := s.CreateAlias(rice.ID, 0, shops.lidlChain.ID, "PłatkiDada100szt")
	if err != nil {
		t.Fatal(err)
	}
	if got.RetailChainID != shops.lidlChain.ID || got.StoryID != 0 {
		t.Fatalf("other chain: %#v", got)
	}
}

func TestImportBillResolvesAlias(t *testing.T) {
	s, kg, flour, _, lidl, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, lidl.ID, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}

	res, err := s.ImportBill(BillImport{
		StoryID:  lidl.ID,
		BoughtOn: "2026-08-20",
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

func TestListProductsFuzzySearch(t *testing.T) {
	s, _, flour, rice, lidl, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, lidl.ID, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}

	found, err := s.ListProducts("maka")
	if err != nil || len(found) != 1 || found[0].ID != flour.ID {
		t.Fatalf("diacritics: %v %#v", err, found)
	}
	found, err = s.ListProducts("tortova")
	if err != nil || len(found) != 1 || found[0].ID != flour.ID {
		t.Fatalf("typo: %v %#v", err, found)
	}
	found, err = s.ListProducts("caka flour")
	if err != nil || len(found) != 1 || found[0].ID != flour.ID {
		t.Fatalf("name typo: %v %#v", err, found)
	}
	found, err = s.ListProducts("Rice")
	if err != nil || len(found) != 1 || found[0].ID != rice.ID {
		t.Fatalf("exact name: %v %#v", err, found)
	}
	found, err = s.ListProducts("ghost")
	if err != nil || len(found) != 0 {
		t.Fatalf("miss: %v %#v", err, found)
	}
}

func TestProductNameCannotReuseAlias(t *testing.T) {
	s, kg, flour, _, _, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, 0, 0, "Tortowa"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateProduct("tortowa", kg.ID, nil); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("create: %v", err)
	}
	if err := s.UpdateProduct(flour.ID, "Tortowa", kg.ID, nil, false); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("update: %v", err)
	}
}

func aliasFixture(t *testing.T) (*Store, Unit, Product, Product, Story, Story) {
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
	lidl, err := s.CreateStory("Lidl", "Kościuszki", "1", "", "40-001", "Katowice", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	biedronka, err := s.CreateStory("Biedronka", "Marszałkowska", "2", "", "00-001", "Warszawa", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	return s, kg, flour, rice, lidl, biedronka
}

type chainAliasShops struct {
	biedronka RetailChain
	lidlChain RetailChain
	a, b      Story
	lidl      Story
}

func chainAliasFixture(t *testing.T) (*Store, Unit, Product, Product, chainAliasShops) {
	t.Helper()
	s, kg, flour, rice, _, _ := aliasFixture(t)
	biedronka, err := s.CreateRetailChain("Biedronka", "Jeronimo Martins Polska S.A.", "7791011327")
	if err != nil {
		t.Fatal(err)
	}
	lidlChain, err := s.CreateRetailChain("Lidl", "Lidl sp. z o.o.", "1234567890")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateStory("Biedra Śląska", "Kościuszki", "10", "", "40-001", "Katowice", "", biedronka.ID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateStory("Biedra Centrum", "Marszałkowska", "20", "", "00-001", "Warszawa", "", biedronka.ID)
	if err != nil {
		t.Fatal(err)
	}
	lidlShop, err := s.CreateStory("Lidl Gliwice", "Zwycięstwa", "5", "", "44-100", "Gliwice", "", lidlChain.ID)
	if err != nil {
		t.Fatal(err)
	}
	return s, kg, flour, rice, chainAliasShops{
		biedronka: biedronka,
		lidlChain: lidlChain,
		a:         a,
		b:         b,
		lidl:      lidlShop,
	}
}
