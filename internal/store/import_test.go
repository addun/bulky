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
		Company: &Company{
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
	if res.CompanyID == 0 {
		t.Fatal("expected company")
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
	if len(riceBuys) != 1 || riceBuys[0].CompanyID != res.CompanyID {
		t.Fatalf("rice: %#v", riceBuys)
	}
	if riceBuys[0].ReceiptID != 0 {
		t.Fatalf("receipt_id: got %d want 0", riceBuys[0].ReceiptID)
	}
	if riceBuys[0].Amount.Cmp(decimal.RequireFromString("40.00")) != 0 {
		t.Fatalf("rice amount %s", riceBuys[0].Amount)
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
