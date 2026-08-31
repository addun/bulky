package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProductsPageFuzzySearch(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	if _, err := st.CreateAlias(flour.ID, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/?q=tortova", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `<strong>Cake flour</strong>`) {
		t.Fatal("typo should still find the product")
	}
	if strings.Contains(body, `<strong>Rice</strong>`) {
		t.Fatal("unrelated product should not appear")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/?q=maka", nil)
	srv.Handler().ServeHTTP(rec, req)
	body = rec.Body.String()
	if !strings.Contains(body, `<strong>Cake flour</strong>`) {
		t.Fatal("diacritics should still find the product")
	}
	if strings.Contains(body, `<strong>Rice</strong>`) {
		t.Fatal("rice should not match maka")
	}
}
