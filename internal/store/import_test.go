package store

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestImportBillCreatesProductsAndPurchases(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	units, err := s.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	kg := units[0]
	existing, err := s.CreateProduct("Rice", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	res, err := s.ImportBill(BillImport{
		Story: &Story{
			Name:           "Local Mill",
			StreetName:     "Kościuszki",
			BuildingNumber: "10",
			PostalCode:     "40-001",
			City:           "Katowice",
		},
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductID: existing.ID, Quantity: mustDec(t, "10"), Amount: mustDec(t, "40.00")},
			{ProductName: "Flour", UnitID: kg.ID, Quantity: mustDec(t, "5"), Amount: mustDec(t, "18.50")},
			{ProductName: "Flour", UnitID: kg.ID, Quantity: mustDec(t, "2"), Amount: mustDec(t, "7.40")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 3 {
		t.Fatalf("purchases: %d", res.Purchases)
	}
	if res.StoryID == 0 {
		t.Fatal("expected story")
	}
	flour, err := s.FindProductByName("flour", 0)
	if err != nil {
		t.Fatal(err)
	}
	buys, err := s.ListPurchases(flour.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(buys) != 2 {
		t.Fatalf("flour purchases: %d", len(buys))
	}
	riceBuys, err := s.ListPurchases(existing.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(riceBuys) != 1 || riceBuys[0].StoryID != res.StoryID {
		t.Fatalf("rice: %#v", riceBuys)
	}
	if riceBuys[0].ReceiptID != 0 {
		t.Fatalf("receipt_id: got %d want 0", riceBuys[0].ReceiptID)
	}
	if riceBuys[0].Amount.Cmp(decimal.RequireFromString("40.00")) != 0 {
		t.Fatalf("rice amount %s", riceBuys[0].Amount)
	}
}

func TestImportBillCreatesAliasFromReceiptName(t *testing.T) {
	s, kg, _, _, lidl, _ := aliasFixture(t)

	res, err := s.ImportBill(BillImport{
		StoryID:  lidl.ID,
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Pastry flour", ReceiptName: "MAKA TORTOWA 1KG", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.50")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 1 {
		t.Fatalf("purchases: %d", res.Purchases)
	}
	aliases, err := s.ListAliasesByProduct(res.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 1 || aliases[0].Alias != "MAKA TORTOWA 1KG" || aliases[0].StoryID != lidl.ID {
		t.Fatalf("shop alias: %#v", aliases)
	}

	global, err := s.ImportBill(BillImport{
		BoughtOn: "2026-08-21",
		Lines: []BillLineInput{
			{ProductName: "Sugar", ReceiptName: "CUKIER 1KG", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "3.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	galias, err := s.ListAliasesByProduct(global.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(galias) != 1 || galias[0].Alias != "CUKIER 1KG" || galias[0].StoryID != 0 {
		t.Fatalf("global alias: %#v", galias)
	}
}

func TestImportBillCreatesChainAliasWhenStoryHasChain(t *testing.T) {
	s, kg, _, _, shops := chainAliasFixture(t)
	res, err := s.ImportBill(BillImport{
		StoryID:  shops.a.ID,
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Corn flakes", ReceiptName: "PłatkiDada100szt", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.50")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	aliases, err := s.ListAliasesByProduct(res.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 1 {
		t.Fatalf("aliases: %#v", aliases)
	}
	a := aliases[0]
	if a.Alias != "PłatkiDada100szt" || a.StoryID != 0 || a.RetailChainID != shops.biedronka.ID {
		t.Fatalf("expected chain alias: %#v", a)
	}

	hit, err := s.FindProductByName("PłatkiDada100szt", shops.b.ID)
	if err != nil || hit.ID != res.ProductIDs[0] {
		t.Fatalf("other shop in chain should match: %v %#v", err, hit)
	}
}

func TestImportBillSkipsAliasWhenNamesMatch(t *testing.T) {
	s, kg, _, _, _, _ := aliasFixture(t)
	res, err := s.ImportBill(BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Oats", ReceiptName: "oats", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "2.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	aliases, err := s.ListAliasesByProduct(res.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 0 {
		t.Fatalf("expected no alias: %#v", aliases)
	}
}

func TestImportBillSkipsDuplicateAlias(t *testing.T) {
	s, kg, flour, _, _, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, 0, 0, "MAKA TORTOWA"); err != nil {
		t.Fatal(err)
	}
	res, err := s.ImportBill(BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Wheat flour", ReceiptName: "MAKA TORTOWA", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 1 {
		t.Fatalf("purchase should still save: %#v", res)
	}
	aliases, err := s.ListAliasesByProduct(res.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 0 {
		t.Fatalf("duplicate alias should be skipped: %#v", aliases)
	}
}

func TestImportBillTwoReceiptNamesOnNewProduct(t *testing.T) {
	s, kg, _, _, _, _ := aliasFixture(t)
	res, err := s.ImportBill(BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Pastry flour", ReceiptName: "MAKA TORTOWA", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.00")},
			{ProductName: "Pastry flour", ReceiptName: "M.TORTOWA", UnitID: kg.ID, Quantity: mustDec(t, "2"), Amount: mustDec(t, "8.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 2 || res.ProductIDs[0] != res.ProductIDs[1] {
		t.Fatalf("same new product: %#v", res)
	}
	aliases, err := s.ListAliasesByProduct(res.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, a := range aliases {
		got[a.Alias] = true
		if a.StoryID != 0 {
			t.Fatalf("expected global: %#v", a)
		}
	}
	if !got["MAKA TORTOWA"] || !got["M.TORTOWA"] {
		t.Fatalf("aliases: %#v", aliases)
	}
}

func TestImportBillAliasesExistingProductFromReceiptName(t *testing.T) {
	s, kg, flour, _, lidl, _ := aliasFixture(t)
	res, err := s.ImportBill(BillImport{
		StoryID:  lidl.ID,
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductID: flour.ID, ReceiptName: "MAKA TORTOWA", Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ProductIDs[0] != flour.ID {
		t.Fatalf("should reuse flour: %#v", res)
	}
	aliases, err := s.ListAliasesByProduct(flour.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 1 || aliases[0].Alias != "MAKA TORTOWA" || aliases[0].StoryID != lidl.ID {
		t.Fatalf("selected product should keep the corrected alias: %#v", aliases)
	}

	again, err := s.ImportBill(BillImport{
		BoughtOn: "2026-08-21",
		Lines: []BillLineInput{
			{ProductName: "Cake flour", ReceiptName: "SHOULD NOT APPLY", UnitID: kg.ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "4.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if again.ProductIDs[0] != flour.ID {
		t.Fatalf("name match should reuse flour: %#v", again)
	}
	aliases, err = s.ListAliasesByProduct(flour.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 1 || aliases[0].Alias != "MAKA TORTOWA" {
		t.Fatalf("finding an existing name should not add a new alias: %#v", aliases)
	}
}

func TestImportBillEmptyRejected(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.ImportBill(BillImport{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestImportBillStoresPackages(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	units, err := s.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v", err)
	}
	res, err := s.ImportBill(BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Oats", UnitID: units[0].ID, Quantity: mustDec(t, "400"), PackageCount: mustDec(t, "4"), PackageSize: mustDec(t, "100"), Amount: mustDec(t, "8.00")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	buys, err := s.ListPurchases(res.ProductIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(buys) != 1 {
		t.Fatalf("buys: %d", len(buys))
	}
	if buys[0].Quantity.String() != "400" || buys[0].PackageCount.String() != "4" || buys[0].PackageSize.String() != "100" {
		t.Fatalf("pack: %#v", buys[0])
	}
}
