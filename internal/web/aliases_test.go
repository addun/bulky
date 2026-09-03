package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/adrian/bulkly/internal/store"
)

func TestAliasesPageFiltersByProduct(t *testing.T) {
	st, flour, rice := aliasPageFixture(t)
	if _, err := st.CreateAlias(flour.ID, 0, "Tortowa"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateAlias(rice.ID, 0, "Ryz"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/aliases?product="+itoa(flour.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Tortowa") {
		t.Fatal("expected this product's alias")
	}
	if strings.Contains(body, "Ryz") {
		t.Fatal("should not list aliases for other products")
	}
	if !strings.Contains(body, "Aliases for Cake flour") {
		t.Fatal("expected filtered heading")
	}
	if !strings.Contains(body, `href="/admin/aliases"`) || !strings.Contains(body, "All aliases") {
		t.Fatal("expected link back to the full list")
	}
	if !strings.Contains(body, `href="/admin/aliases/new?product=`+itoa(flour.ID)+`"`) {
		t.Fatal("filtered page should link to a new alias for this product")
	}
	if strings.Contains(body, `name="alias"`) {
		t.Fatal("list page should not include the add form")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/aliases", nil)
	srv.Handler().ServeHTTP(rec, req)
	body = rec.Body.String()
	if !strings.Contains(body, "Tortowa") || !strings.Contains(body, "Ryz") {
		t.Fatalf("unfiltered list should show every alias: %s", body)
	}
}

func TestAliasesPageUnknownProduct(t *testing.T) {
	st, _, _ := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/aliases?product=999", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestCreateAliasStaysOnProductFilter(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{
		"product_id":   {itoa(flour.ID)},
		"from_product": {itoa(flour.ID)},
		"alias":        {"Mąka tortowa"},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/aliases", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if loc != "/admin/aliases?product="+itoa(flour.ID) {
		t.Fatalf("location %q", loc)
	}
}

func aliasPageFixture(t *testing.T) (*store.Store, store.Product, store.Product) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	units, err := st.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	flour, err := st.CreateProduct("Cake flour", units[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	rice, err := st.CreateProduct("Rice", units[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	return st, flour, rice
}
