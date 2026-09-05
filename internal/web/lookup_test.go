package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store"
)

func TestHomeRendersSearch(t *testing.T) {
	st, _, _ := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `data-product-search`) {
		t.Fatal("expected search")
	}
	if !strings.Contains(body, `class="topbar-admin" href="/admin"`) {
		t.Fatal("expected admin link in the top bar")
	}
	if strings.Contains(body, `lookup-admin`) {
		t.Fatal("admin link should not sit under the search field")
	}
	if strings.Contains(body, `class="rail"`) {
		t.Fatal("home should not use admin chrome")
	}
}

func TestProductSuggestJSON(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	if _, err := st.CreateAlias(flour.ID, 0, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/products/suggestions?q=tortova", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var got []suggestItem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "Cake flour" {
		t.Fatalf("got %#v", got)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/products/suggestions?q=maka", nil)
	srv.Handler().ServeHTTP(rec, req)
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "Cake flour" {
		t.Fatalf("diacritics %#v", got)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/products/suggestions?q=", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Body.String() != "[]" {
		t.Fatalf("empty q: %s", rec.Body.String())
	}
}

func TestProductSuggestCapsAtTen(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	units, err := st.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	for i := 1; i <= 12; i++ {
		if _, err := st.CreateProduct("Oats "+itoa(int64(i)), units[0].ID, nil); err != nil {
			t.Fatal(err)
		}
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/products/suggestions?q=oats", nil)
	srv.Handler().ServeHTTP(rec, req)
	var got []suggestItem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 10 {
		t.Fatalf("got %d want 10", len(got))
	}
}

func TestLookupShowPricesAndChart(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	today := time.Now()
	day := func(delta int) string {
		return today.AddDate(0, 0, delta).Format("2006-01-02")
	}
	if _, err := st.CreatePurchase(flour.ID, 0, day(-40), decimal.RequireFromString("1"), decimal.RequireFromString("1"), store.KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(flour.ID, 0, day(-10), decimal.RequireFromString("2"), decimal.RequireFromString("8"), store.KindPrice); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(flour.ID, 0, day(0), decimal.RequireFromString("1"), decimal.RequireFromString("9"), store.KindPurchase); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{CurrencySymbol: "zł"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/products/"+itoa(flour.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Cake flour") {
		t.Fatal("expected name")
	}
	if !strings.Contains(body, "9,00 zł") {
		t.Fatal("expected last price")
	}
	if !strings.Contains(body, "4,00 zł") {
		t.Fatal("expected 30-day low")
	}
	if !strings.Contains(body, `data-price-chart=`) {
		t.Fatal("expected chart")
	}
	if !strings.Contains(body, day(-10)) {
		t.Fatal("chart should include the 30-day low date")
	}
	if strings.Contains(body, `href="/admin/products/`) {
		t.Fatal("lookup must not include admin product actions")
	}
}

func TestLookupUnknownProduct(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/products/99999", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/products/not-an-id", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-numeric status %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/"+itoa(flour.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("bare id should not be a lookup: %d", rec.Code)
	}
}

func TestAdminIsNotALookupID(t *testing.T) {
	st, _, _ := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "<strong>Cake flour</strong>") {
		t.Fatal(" /admin should be the product ledger")
	}
}
