package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store"
)

func TestProductsPageFuzzySearch(t *testing.T) {
	st, flour, _ := aliasPageFixture(t)
	if _, err := st.CreateAlias(flour.ID, 0, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin?q=tortova", nil)
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
	req = httptest.NewRequest(http.MethodGet, "/admin?q=maka", nil)
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
	req := httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(rice.ID)+"/merge-with", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `Merge Rice?`) {
		t.Fatal("expected merge heading")
	}
	if !strings.Contains(body, `/admin/products/`+itoa(rice.ID)+`/merge-with`) {
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
	req = httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(rice.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `/admin/products/`+itoa(rice.ID)+`/merge-with`) {
		t.Fatal("product page should link to merge")
	}
	if strings.Contains(rec.Body.String(), `/admin/products/`+itoa(rice.ID)+`/change-unit`) {
		t.Fatal("product page should not link to change unit")
	}
}

func TestMergeConfirmShowsSummary(t *testing.T) {
	st, flour, rice := aliasPageFixture(t)
	if _, err := st.CreateAlias(rice.ID, 0, 0, "Ryż"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	form := url.Values{"into_id": {itoa(flour.ID)}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/products/"+itoa(rice.ID)+"/merge-with", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("redirect status %d", rec.Code)
	}
	want := "/admin/products/" + itoa(rice.ID) + "/merge-with/" + itoa(flour.ID) + "/"
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
	req := httptest.NewRequest(http.MethodPost, "/admin/products/"+itoa(rice.ID)+"/merge-with/"+itoa(flour.ID)+"/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/admin/products/"+itoa(flour.ID) {
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
	req := httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(sugar.ID)+"/merge-with/"+itoa(flour.ID)+"/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Those products use different units.") {
		t.Fatalf("body: %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/products/"+itoa(sugar.ID)+"/merge-with/"+itoa(flour.ID)+"/", nil)
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

func TestProductFormSavesExtraUnits(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	liter, err := st.CreateUnit("l")
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/products/new", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Conversions") || !strings.Contains(body, "equals") || !strings.Contains(body, `id="extra-unit-template"`) {
		t.Fatal("new product form should offer extra units")
	}

	form := url.Values{
		"name":          {"Water"},
		"unit_id":       {itoa(szt.ID)},
		"extra_unit_id": {itoa(liter.ID)},
		"extra_factor":  {"1.5"},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/products", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}

	items, err := st.ListProducts("")
	if err != nil || len(items) != 1 {
		t.Fatalf("list: %v %#v", err, items)
	}
	p := items[0]
	if p.Name != "Water" || p.UnitID != szt.ID || len(p.Conversions) != 1 {
		t.Fatalf("product: %#v", p)
	}
	if p.Conversions[0].UnitID != liter.ID || p.Conversions[0].Factor.String() != "1.5" {
		t.Fatalf("conversion: %#v", p.Conversions)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(p.ID)+"/edit", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("edit status %d", rec.Code)
	}
	body = rec.Body.String()
	if !strings.Contains(body, `value="1,5"`) {
		t.Fatal("edit form should show the factor")
	}
	if !strings.Contains(body, `selected>`+liter.Name) && !strings.Contains(body, `value="`+itoa(liter.ID)+`" selected`) {
		t.Fatalf("edit form should select litres: %s", body)
	}
	if !strings.Contains(body, `/admin/products/`+itoa(p.ID)+`/change-unit`) {
		t.Fatal("edit form should link to change unit")
	}
	if strings.Contains(body, `id="purchase-unit"`) {
		t.Fatal("edit form should not offer a live purchase unit select")
	}
}

func TestProductShowUsesPurchaseUnit(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	liter, err := st.CreateUnit("l")
	if err != nil {
		t.Fatal(err)
	}
	p, err := st.CreateProduct("Water", szt.ID, nil, []store.ProductConversion{
		{UnitID: liter.ID, Factor: decimal.RequireFromString("1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(p.ID, 0, "2026-08-20", decimal.Zero, decimal.RequireFromString("15"), store.KindPurchase, decimal.RequireFromString("6"), decimal.RequireFromString("1")); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{Currency: "PLN", CurrencySymbol: "zł"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	srv.Handler().ServeHTTP(rec, req)
	list := rec.Body.String()
	if !strings.Contains(list, `class="meta">szt`) {
		t.Fatalf("list should name the purchase unit: %s", list)
	}
	if strings.Contains(list, `class="meta">szt · l</span>`) || strings.Contains(list, `class="meta">szt · l ·`) {
		t.Fatal("list should not name extra units")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(p.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "6 szt") {
		t.Fatal("year should show purchase quantity")
	}
	if strings.Contains(body, "9 l") || strings.Contains(body, "1,67 zł / l") {
		t.Fatal("product page should not show extra unit quantities or prices")
	}
	if !strings.Contains(body, "2,50 zł / szt") {
		t.Fatalf("history should show purchase unit price: %s", body)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(p.ID)+"/purchases/new", nil)
	srv.Handler().ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "Package size (szt)") {
		t.Fatal("purchase form should use the purchase unit")
	}
}

func TestMergeProductRejectsConversionConflict(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	liter, err := st.CreateUnit("l")
	if err != nil {
		t.Fatal(err)
	}
	a, err := st.CreateProduct("Water A", szt.ID, nil, []store.ProductConversion{
		{UnitID: liter.ID, Factor: decimal.RequireFromString("1.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := st.CreateProduct("Water B", szt.ID, nil, []store.ProductConversion{
		{UnitID: liter.ID, Factor: decimal.RequireFromString("0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(b.ID)+"/merge-with/"+itoa(a.ID)+"/", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Those products convert to l differently.") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

func TestChangeProductUnitFormAndSave(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	liter, err := st.CreateUnit("l")
	if err != nil {
		t.Fatal(err)
	}
	ml, err := st.CreateUnit("ml")
	if err != nil {
		t.Fatal(err)
	}
	p, err := st.CreateProduct("Water", szt.ID, nil, []store.ProductConversion{
		{UnitID: liter.ID, Factor: decimal.RequireFromString("1.5")},
		{UnitID: ml.ID, Factor: decimal.RequireFromString("1500")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(p.ID, 0, "2026-08-20", decimal.Zero, decimal.RequireFromString("15"), store.KindPurchase, decimal.RequireFromString("2"), decimal.RequireFromString("1")); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(p.ID)+"/change-unit", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `Change unit for Water`) || !strings.Contains(body, `1 szt equals`) {
		t.Fatal("form should explain the conversion")
	}
	if strings.Contains(body, `keep_old`) {
		t.Fatal("old unit is always kept, not a checkbox")
	}
	if strings.Contains(body, `name="factor"`) {
		t.Fatal("factor comes from the extra, not a form field")
	}
	if strings.Contains(body, `<option value="`+itoa(szt.ID)+`"`) {
		t.Fatal("current unit should not be a choice")
	}
	kg, err := st.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, `<option value="`+itoa(kg.ID)+`"`) {
		t.Fatal("units that are not extras should not be a choice")
	}
	if !strings.Contains(body, `<option value="`+itoa(liter.ID)+`"`) || !strings.Contains(body, `<option value="`+itoa(ml.ID)+`"`) {
		t.Fatal("extras should be the only choices")
	}

	form := url.Values{
		"unit_id": {itoa(liter.ID)},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/products/"+itoa(p.ID)+"/change-unit", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/admin/products/"+itoa(p.ID) {
		t.Fatalf("location: %s", loc)
	}

	got, err := st.GetProduct(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.UnitID != liter.ID {
		t.Fatalf("unit: %d", got.UnitID)
	}
	buys, err := st.ListPurchases(p.ID)
	if err != nil || len(buys) != 1 || !buys[0].Quantity.Equal(decimal.RequireFromString("3")) {
		t.Fatalf("buys: %v %#v", err, buys)
	}
}

func TestChangeProductUnitRequiresExtra(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	liter, err := st.CreateUnit("l")
	if err != nil {
		t.Fatal(err)
	}
	p, err := st.CreateProduct("Water", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(p.ID)+"/change-unit", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Add a conversion first") {
		t.Fatalf("body: %s", rec.Body.String())
	}

	form := url.Values{"unit_id": {itoa(liter.ID)}}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/products/"+itoa(p.ID)+"/change-unit", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Choose one of the extra units on this product") {
		t.Fatalf("body: %s", rec.Body.String())
	}

	got, err := st.GetProduct(p.ID)
	if err != nil || got.UnitID != szt.ID {
		t.Fatalf("unit should stay: %v %#v", err, got)
	}
}
