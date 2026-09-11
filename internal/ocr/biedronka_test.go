package ocr

import "testing"

func TestBillFromBiedronkaGroszeAndDiscount(t *testing.T) {
	raw := []byte(`[
		{"sellLine":{"name":"Mleko 1l","quantity":1,"price":329,"total":329,"vatId":"A"}},
		{"discountLine":{"value":30,"isDiscount":true}},
		{"sellLine":{"name":"Chleb","quantity":2,"price":249,"total":498,"vatId":"B"}},
		{"sumInCurrency":{"fiscalTotal":797}}
	]`)
	bill, err := BillFromBiedronka(raw, Tx{
		Date:       "2026-09-08T14:32:00+02:00",
		StoreName:  "Biedronka SKLEP 2615",
		ReceiptNum: "123",
		TotalPrice: 7.97,
	})
	if err != nil {
		t.Fatal(err)
	}
	if bill.BoughtOn != "2026-09-08" || bill.BoughtAt != "14:32" {
		t.Fatalf("date %#v", bill)
	}
	if bill.StoryName != "Biedronka SKLEP 2615" || bill.ExternalID != "2615" {
		t.Fatalf("shop %#v", bill)
	}
	if len(bill.Lines) != 2 {
		t.Fatalf("lines %#v", bill.Lines)
	}
	mleko := bill.Lines[0]
	if mleko.ReceiptName != "Mleko 1l" || mleko.Amount != "3.29" || mleko.UnitPrice != "3.29" || mleko.Discount != "0.30" || mleko.VatType != "A" || mleko.Quantity != "1" {
		t.Fatalf("mleko %#v", mleko)
	}
	chleb := bill.Lines[1]
	if chleb.Amount != "4.98" || chleb.Quantity != "2" || chleb.VatType != "B" {
		t.Fatalf("chleb %#v", chleb)
	}
}

func TestBillFromBiedronkaZlotyDetails(t *testing.T) {
	raw := []byte(`{"items":[{"name":"Ryż","quantity":1,"unit_price":4.5,"total_price":4.5}]}`)
	bill, err := BillFromBiedronka(raw, Tx{Date: "2026-09-01", StoreName: "Biedronka", TotalPrice: 4.5})
	if err != nil {
		t.Fatal(err)
	}
	if len(bill.Lines) != 1 || bill.Lines[0].Amount != "4.50" || bill.Lines[0].ReceiptName != "Ryż" {
		t.Fatalf("got %#v", bill.Lines)
	}
}

func TestBillFromBiedronkaSkipsStorno(t *testing.T) {
	raw := []byte(`[
		{"sellLine":{"name":"Mleko","quantity":1,"price":3.29,"total":3.29}},
		{"sellLine":{"name":"Mleko","quantity":1,"price":3.29,"total":3.29,"isStorno":true}}
	]`)
	bill, err := BillFromBiedronka(raw, Tx{Date: "2026-09-01", TotalPrice: 3.29})
	if err != nil {
		t.Fatal(err)
	}
	if len(bill.Lines) != 1 {
		t.Fatalf("lines %#v", bill.Lines)
	}
}

func TestBillFromBiedronkaNoLines(t *testing.T) {
	if _, err := BillFromBiedronka([]byte(`[]`), Tx{}); err != ErrNoLines {
		t.Fatalf("got %v", err)
	}
}
