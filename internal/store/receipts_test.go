package store

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/shopspring/decimal"
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

	rice, err := s.FindProductByName("Rice", 0)
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

	assigned, err := s.ListPurchasesByReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(assigned) != 1 {
		t.Fatalf("by receipt: %d", len(assigned))
	}
	if assigned[0].ProductID != rice.ID || assigned[0].ProductName != "Rice" {
		t.Fatalf("assigned product: %#v", assigned[0])
	}
	if assigned[0].UnitName == "" {
		t.Fatal("assigned row should include the unit")
	}
	if assigned[0].ReceiptID != r.ID {
		t.Fatalf("assigned receipt_id: got %d want %d", assigned[0].ReceiptID, r.ID)
	}
	if !assigned[0].Amount.Equal(mustDec(t, "40.00")) {
		t.Fatalf("assigned amount: %s", assigned[0].Amount)
	}

	if _, err := s.CreatePurchase(rice.ID, co.ID, "2026-08-21", mustDec(t, "1"), mustDec(t, "1"), KindPurchase, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}
	assigned, err = s.ListPurchasesByReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(assigned) != 1 {
		t.Fatalf("manual purchase should not appear on the receipt: %d", len(assigned))
	}
	other, err := s.ListPurchasesByReceipt(r.ID + 99)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("unknown receipt: %d", len(other))
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

func TestUpdateReceiptVisitOnSavedBill(t *testing.T) {
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
	if err := s.SaveAIResponse(r.ID, `{"bought_on":"2026-08-20","lines":[{"product_name":"Rice"},{"product_name":"Flour"}]}`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MigrateReceipt(r.ID, BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Rice", UnitID: units[0].ID, Quantity: mustDec(t, "10"), Amount: mustDec(t, "40.00")},
			{ProductName: "Flour", UnitID: units[0].ID, Quantity: mustDec(t, "5"), Amount: mustDec(t, "18.50")},
		},
	}, `{"bought_on":"2026-08-20","notes":"blurry"}`); err != nil {
		t.Fatal(err)
	}

	assigned, err := s.ListPurchasesByReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(assigned) != 2 || assigned[0].CompanyID != 0 || assigned[1].CompanyID != 0 {
		t.Fatalf("saved without company: %#v", assigned)
	}

	if err := s.UpdateReceiptVisit(r.ID, co.ID, "2026-08-21"); err != nil {
		t.Fatal(err)
	}
	assigned, err = s.ListPurchasesByReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if assigned[0].CompanyID != co.ID || assigned[1].CompanyID != co.ID {
		t.Fatalf("after set: %#v", assigned)
	}
	if assigned[0].BoughtOn != "2026-08-21" || assigned[1].BoughtOn != "2026-08-21" {
		t.Fatalf("date: %#v", assigned)
	}
	got, err := s.GetReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	var bill map[string]any
	if err := json.Unmarshal([]byte(got.RawResponse), &bill); err != nil {
		t.Fatal(err)
	}
	if int64(bill["company_id"].(float64)) != co.ID {
		t.Fatalf("json company: %#v", bill["company_id"])
	}
	if bill["bought_on"] != "2026-08-21" {
		t.Fatalf("json date: %#v", bill["bought_on"])
	}
	if bill["notes"] != "blurry" {
		t.Fatalf("notes should stay: %#v", bill["notes"])
	}

	if err := s.UpdateReceiptVisit(r.ID, 0, "2026-08-21"); err != nil {
		t.Fatal(err)
	}
	assigned, err = s.ListPurchasesByReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if assigned[0].CompanyID != 0 || assigned[1].CompanyID != 0 {
		t.Fatalf("cleared: %#v", assigned)
	}

	ready, err := s.CreateReceipt("cccccccccccccccccccccccccccccccc")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveAIResponse(ready.ID, `{"bought_on":"2026-08-20","lines":[]}`); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateReceiptVisit(ready.ID, co.ID, "2026-08-21"); err != ErrReceiptNotReady {
		t.Fatalf("ready receipt: %v", err)
	}
	if err := s.UpdateReceiptVisit(r.ID, co.ID+99, "2026-08-21"); !errors.Is(err, ErrInvalidCompany) {
		t.Fatalf("missing company: %v", err)
	}
}
