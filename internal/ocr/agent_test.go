package ocr

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExtractFromMockAPI(t *testing.T) {
	billJSON, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-01",
		"lines": []map[string]any{
			{"receipt_name": "Rice 10kg", "product_name": "Rice", "quantity": "10", "amount": "40.00", "unit_name": "kg"},
		},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("auth %s", r.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(r.Body)
		if !json.Valid(body) {
			t.Error("request body is not JSON")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": string(billJSON)}},
			},
		})
	}))
	defer srv.Close()

	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "test-model"})

	png := tinyPNG(t)
	bill, raw, err := a.Extract(png, Catalog{
		Units: []CatalogUnit{{ID: 1, Name: "kg"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if bill.BoughtOn != "2026-08-01" {
		t.Fatalf("bought_on %q", bill.BoughtOn)
	}
	if len(bill.ProductLines()) != 1 {
		t.Fatalf("lines %#v", bill.Lines)
	}
	if !json.Valid(raw) || !bytes.Contains(raw, []byte("Rice")) {
		t.Fatalf("raw %s", raw)
	}
}

func TestExtractNotABill(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": `{"not_a_bill": true, "lines": []}`}},
			},
		})
	}))
	defer srv.Close()
	a := New(Config{APIKey: "x", BaseURL: srv.URL})
	_, _, err := a.Extract(tinyPNG(t), Catalog{})
	if err != ErrNotABill {
		t.Fatalf("got %v", err)
	}
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
