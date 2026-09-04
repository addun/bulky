package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/adrian/bulkly/internal/store"
)

func TestRetailChainsCRUD(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/retail-chains", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<h1>Retail chains</h1>") {
		t.Fatal("missing heading")
	}
	if strings.Contains(body, "Biedronka, Lidl, and the rest") {
		t.Fatal("retail chains page should not have a subtitle")
	}
	if !strings.Contains(body, `<details class="nav-group" open>`) || !strings.Contains(body, "<summary>") || !strings.Contains(body, "Shops") || !strings.Contains(body, `class="nav-group-arrow"`) {
		t.Fatal("nav should nest retail chains and stories in an open details group with an arrow")
	}
	if !strings.Contains(body, `href="/admin/retail-chains"`) {
		t.Fatal("nav should link to retail chains")
	}

	form := url.Values{
		"name":       {"Biedronka"},
		"legal_name": {"Jeronimo Martins Polska S.A."},
		"tax_id":     {"779-101-13-27"},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/retail-chains", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("create status %d", rec.Code)
	}
	if rec.Header().Get("Location") != "/admin/retail-chains" {
		t.Fatalf("location %s", rec.Header().Get("Location"))
	}

	list, err := st.ListRetailChains()
	if err != nil || len(list) != 1 || list[0].TaxID != "7791011327" {
		t.Fatalf("stored: %v %#v", err, list)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/stories/new", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("story form %d", rec.Code)
	}
	body = rec.Body.String()
	if !strings.Contains(body, `name="retail_chain_id"`) || !strings.Contains(body, "Biedronka") {
		t.Fatal("story form should list the chain")
	}

	shopForm := url.Values{
		"name":             {"Biedronka Dworcowa"},
		"street_name":      {"Kościuszki"},
		"building_number":  {"10"},
		"apartment_number": {""},
		"postal_code":      {"40-001"},
		"city":             {"Katowice"},
		"retail_chain_id":  {itoa(list[0].ID)},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/stories", strings.NewReader(shopForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("story create %d", rec.Code)
	}
	stories, err := st.ListStories()
	if err != nil || len(stories) != 1 || stories[0].RetailChainID != list[0].ID {
		t.Fatalf("story: %v %#v", err, stories)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/retail-chains/"+itoa(list[0].ID)+"/delete", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("delete confirm %d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Location"), "error=") {
		t.Fatal("should refuse delete while a story uses the chain")
	}
}

func TestCreateRetailChainRejectsBlankName(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"name": {""}, "legal_name": {"Legal"}, "tax_id": {"1234567890"}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/retail-chains", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Name is required.") {
		t.Fatal("expected name error")
	}
}
