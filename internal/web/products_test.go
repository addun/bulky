package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestMergeFormOmitsCurrentProduct(t *testing.T) {
	st, flour, rice := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/products/"+itoa(rice.ID)+"/merge-with", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `Merge Rice?`) {
		t.Fatal("expected merge heading")
	}
	if !strings.Contains(body, `/products/`+itoa(rice.ID)+`/merge-with`) {
		t.Fatal("picker should continue to the summary")
	}
	if !strings.Contains(body, `value="`+itoa(flour.ID)+`"`) {
		t.Fatal("expected the other product as a target")
	}
	if strings.Contains(body, `value="`+itoa(rice.ID)+`"`) {
		t.Fatal("current product should not be a target")
	}
	if strings.Contains(body, `Merge and delete this product`) {
		t.Fatal("picker should not run the merge yet")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/products/"+itoa(rice.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `/products/`+itoa(rice.ID)+`/merge-with`) {
		t.Fatal("product page should link to merge")
	}
}

func TestMergeConfirmShowsSummary(t *testing.T) {
	st, flour, rice := aliasPageFixture(t)
	if _, err := st.CreateAlias(rice.ID, 0, "Ryż"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	form := url.Values{"into_id": {itoa(flour.ID)}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/products/"+itoa(rice.ID)+"/merge-with", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("redirect status %d", rec.Code)
	}
	want := "/products/" + itoa(rice.ID) + "/merge-with/" + itoa(flour.ID) + "/"
	if loc := rec.Header().Get("Location"); loc != want {
		t.Fatalf("location %q", loc)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, want, nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "You are going to merge:") {
		t.Fatal("expected summary heading")
	}
	if !strings.Contains(body, "Rice") || !strings.Contains(body, "Cake flour") {
		t.Fatal("expected both product names")
	}
	if !strings.Contains(body, "Rice will be removed") {
		t.Fatal("expected removal line")
	}
	if !strings.Contains(body, "Nothing in the history to move") {
		t.Fatal("expected empty history")
	}
	if !strings.Contains(body, "1 alias will move to Cake flour") {
		t.Fatal("expected alias count")
	}
	if !strings.Contains(body, "“Rice” stays as an alias on Cake flour") {
		t.Fatal("expected dropped name as alias")
	}
	if !strings.Contains(body, `method="post"`) || !strings.Contains(body, want) {
		t.Fatal("confirm should post the merge")
	}
}

func TestMergeProductRedirectsToKeeper(t *testing.T) {
	st, flour, rice := aliasPageFixture(t)
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/products/"+itoa(rice.ID)+"/merge-with/"+itoa(flour.ID)+"/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/products/"+itoa(flour.ID) {
		t.Fatalf("location %q", loc)
	}
	if _, err := st.GetProduct(rice.ID); err == nil {
		t.Fatal("rice should be gone")
	}
}

func TestMergeProductRejectsUnitMismatch(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	kg, err := st.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	sugar, err := st.CreateProduct("Sugar", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/products/"+itoa(sugar.ID)+"/merge-with/"+itoa(flour.ID)+"/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Those products use different units.") {
		t.Fatalf("body: %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/products/"+itoa(sugar.ID)+"/merge-with/"+itoa(flour.ID)+"/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Those products use different units.") {
		t.Fatalf("body: %s", rec.Body.String())
	}
	if _, err := st.GetProduct(sugar.ID); err != nil {
		t.Fatalf("sugar should remain: %v", err)
	}
}
