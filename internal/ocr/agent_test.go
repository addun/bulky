package ocr

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestExtractFromMockAPI(t *testing.T) {
	billJSON, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-01",
		"lines": []map[string]any{
			{"receipt_name": "Rice 10kg", "product_name": "Rice", "quantity": "10", "amount": "40.00", "unit_name": "kg"},
		},
	})
	var reqBody []byte
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
		reqBody = body
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
	bill, raw, err := a.Extract(png)
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
	if bytes.Contains(reqBody, []byte(`"products"`)) {
		t.Fatalf("request should not send a product catalog: %s", reqBody)
	}
}

func TestExtractTallReceiptSendsOneImage(t *testing.T) {
	billJSON, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-18",
		"lines": []map[string]any{
			{"receipt_name": "Mleko", "product_name": "Mleko", "amount": "3.29"},
			{"receipt_name": "Chleb", "product_name": "Chleb", "amount": "4.50"},
			{"receipt_name": "Maslo", "product_name": "Masło", "amount": "8.00"},
		},
	})
	var n atomic.Int32
	var reqBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		reqBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": string(billJSON)}},
			},
		})
	}))
	defer srv.Close()

	img := image.NewRGBA(image.Rect(0, 0, 1417, 4000))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "test-model"})
	bill, raw, err := a.Extract(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if n.Load() != 1 {
		t.Fatalf("requests %d, want 1", n.Load())
	}
	if got := bytes.Count(reqBody, []byte(`"type":"image_url"`)); got != 1 {
		t.Fatalf("images in request %d, want 1", got)
	}
	if bytes.Contains(reqBody, []byte("overlapping")) || bytes.Contains(reqBody, []byte("slices")) {
		t.Fatalf("prompt should not mention slices: %s", reqBody)
	}
	if bill.BoughtOn != "2026-08-18" || len(bill.ProductLines()) != 3 {
		t.Fatalf("bill %#v", bill)
	}
	if !json.Valid(raw) || !bytes.Contains(raw, []byte("Maslo")) {
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
	a := New(Config{APIKey: "x", BaseURL: srv.URL, Model: "test-model"})
	_, _, err := a.Extract(tinyPNG(t))
	if err != ErrNotABill {
		t.Fatalf("got %v", err)
	}
}

func TestNewDoesNotDefaultModel(t *testing.T) {
	a := New(Config{APIKey: "x"})
	if a.cfg.Model != "" {
		t.Fatalf("model %q", a.cfg.Model)
	}
}

func TestExtractRequiresModel(t *testing.T) {
	a := New(Config{APIKey: "x", BaseURL: "http://127.0.0.1:1"})
	_, _, err := a.Extract(tinyPNG(t))
	if err != ErrNoModel {
		t.Fatalf("got %v", err)
	}
}

func TestWithModelDoesNotMutateOriginal(t *testing.T) {
	a := New(Config{APIKey: "x", Model: "first"})
	b := a.WithModel("second")
	if a.cfg.Model != "first" {
		t.Fatalf("original %q", a.cfg.Model)
	}
	if b.cfg.Model != "second" {
		t.Fatalf("copy %q", b.cfg.Model)
	}
}

func mockChat(t *testing.T, handle func(model string, body []byte) []byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &req)
		content := handle(req.Model, body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": string(content)}},
			},
		})
	}))
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
