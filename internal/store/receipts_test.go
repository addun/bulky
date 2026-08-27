package store

import (
	"encoding/json"
	"testing"
)

func TestReceiptAIThenMigrate(t *testing.T) {
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
	co, err := s.CreateCompany("Local Mill", "Kościuszki", "10", "", "40-001", "Katowice")
	if err != nil {
		t.Fatal(err)
	}

	r, err := s.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != ReceiptPending || r.RawResponse != "" {
		t.Fatalf("create: %#v", r)
	}

	raw, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-20",
		"lines": []map[string]any{
			{"product_name": "Rice", "quantity": "10", "amount": "40.00", "unit_id": units[0].ID},
		},
	})
	if err := s.SaveAIResponse(r.ID, string(raw)); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != ReceiptReady || got.RawResponse != string(raw) {
		t.Fatalf("ready: %#v", got)
	}

	res, err := s.MigrateReceipt(r.ID, BillImport{
		CompanyID: co.ID,
		BoughtOn:  "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Rice", UnitID: units[0].ID, Quantity: mustDec(t, "10"), Amount: mustDec(t, "40.00")},
		},
	}, `{"bought_on":"2026-08-20"}`)
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 1 {
		t.Fatalf("purchases: %d", res.Purchases)
	}
	got, err = s.GetReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != ReceiptMigrated {
		t.Fatalf("status %q", got.Status)
	}

	if _, err := s.MigrateReceipt(r.ID, BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Rice", UnitID: units[0].ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "1")},
		},
	}, "{}"); err != ErrReceiptMigrated {
		t.Fatalf("second migrate: %v", err)
	}

	rice, err := s.FindProductByName("Rice")
	if err != nil {
		t.Fatal(err)
	}
	buys, err := s.ListPurchases(rice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(buys) != 1 {
		t.Fatalf("rice purchases: %d", len(buys))
	}
	if buys[0].ReceiptID != r.ID {
		t.Fatalf("receipt_id: got %d want %d", buys[0].ReceiptID, r.ID)
	}
	if buys[0].Kind != KindPurchase {
		t.Fatalf("kind: got %q want %q", buys[0].Kind, KindPurchase)
	}
	if buys[0].CompanyID != co.ID {
		t.Fatalf("company_id: got %d want %d", buys[0].CompanyID, co.ID)
	}
}

func TestFailReceipt(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err := s.CreateReceipt("photo")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailReceipt(r.ID); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != ReceiptFailed {
		t.Fatalf("status %q", got.Status)
	}
	if _, err := s.MigrateReceipt(r.ID, BillImport{
		BoughtOn: "2026-08-20",
		Lines:    []BillLineInput{{ProductName: "X", UnitID: 1, Quantity: mustDec(t, "1"), Amount: mustDec(t, "1")}},
	}, "{}"); err != ErrReceiptNotReady {
		t.Fatalf("migrate failed receipt: %v", err)
	}
}

func TestListReceiptsNewestFirst(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	first, err := s.CreateReceipt("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateReceipt("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailReceipt(first.ID); err != nil {
		t.Fatal(err)
	}

	list, err := s.ListReceipts()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list: got %d want 2", len(list))
	}
	if list[0].ID != second.ID || list[1].ID != first.ID {
		t.Fatalf("order: %+v", list)
	}
	if list[0].Status != ReceiptPending || list[1].Status != ReceiptFailed {
		t.Fatalf("status: %+v", list)
	}
	if list[0].RawResponse != "" {
		t.Fatal("list should not load raw JSON")
	}
	if list[0].StatusLabel() != "Pending" || list[1].StatusLabel() != "Failed" {
		t.Fatalf("labels: %q %q", list[0].StatusLabel(), list[1].StatusLabel())
	}
}
