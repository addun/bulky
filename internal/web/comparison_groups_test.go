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

func TestComparisonGroupsCRUD(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	kg, err := st.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	butter, err := st.CreateProduct("Mlekovita 200g", szt.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/comparison-groups", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<h1>Comparison groups</h1>") {
		t.Fatal("missing heading")
	}
	if !strings.Contains(body, `href="/admin/comparison-groups"`) {
		t.Fatal("nav should link to comparison groups")
	}

	form := url.Values{
		"name":       {"Mlekovita"},
		"unit_id":    {itoa(kg.ID)},
		"product_id": {itoa(butter.ID)},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/comparison-groups", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("create status %d body %s", rec.Code, rec.Body.String())
	}

	list, err := st.ListComparisonGroups()
	if err != nil || len(list) != 1 || list[0].Name != "Mlekovita" || list[0].ProductCount != 1 {
		t.Fatalf("stored: %v %#v", err, list)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/comparison-groups/"+itoa(list[0].ID)+"/edit", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("edit %d", rec.Code)
	}
	body = rec.Body.String()
	if !strings.Contains(body, `value="Mlekovita"`) || !strings.Contains(body, "Mlekovita 200g") {
		t.Fatal("edit form should show name and products")
	}

	form = url.Values{
		"name":    {"Mlekovita packs"},
		"unit_id": {itoa(kg.ID)},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/comparison-groups/"+itoa(list[0].ID), strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("update %d", rec.Code)
	}
	got, err := st.GetComparisonGroup(list[0].ID)
	if err != nil || got.Name != "Mlekovita packs" || got.ProductCount != 0 {
		t.Fatalf("updated: %v %#v", err, got)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/comparison-groups/"+itoa(list[0].ID)+"/delete", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Delete comparison group") {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/comparison-groups/"+itoa(list[0].ID)+"/delete", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("delete %d", rec.Code)
	}
	if _, err := st.GetComparisonGroup(list[0].ID); !strings.Contains(err.Error(), "not found") {
		t.Fatalf("gone: %v", err)
	}
}

func TestProductFormSavesComparisonGroups(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	kg, err := st.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	g, err := st.CreateComparisonGroup("Mlekovita", kg.ID, nil)
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
	if !strings.Contains(rec.Body.String(), "Comparison groups") || !strings.Contains(rec.Body.String(), "Mlekovita") {
		t.Fatal("new product form should list groups")
	}

	form := url.Values{
		"name":     {"Mlekovita 200g"},
		"unit_id":  {itoa(szt.ID)},
		"group_id": {itoa(g.ID)},
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
	groups, err := st.ListComparisonGroupsForProduct(items[0].ID)
	if err != nil || len(groups) != 1 || groups[0].ID != g.ID {
		t.Fatalf("groups: %v %#v", err, groups)
	}
}

func TestLookupShowsComparisonLeaders(t *testing.T) {
	st, small, large, _ := lookupButterFixture(t)
	srv, err := New(st, Config{CurrencySymbol: "zł"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/products/"+itoa(small.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "Better value") {
		t.Fatal("lookup should not use the old comparison heading")
	}
	if !strings.Contains(body, "<h2>Check also</h2>") {
		t.Fatal("expected Check also section")
	}
	chartAt := strings.Index(body, "Last 365 days")
	checkAt := strings.Index(body, "<h2>Check also</h2>")
	if chartAt < 0 || checkAt < 0 || checkAt < chartAt {
		t.Fatal("Check also should sit under the graph")
	}
	if !strings.Contains(body, "Mlekovita 500g") || !strings.Contains(body, "Łaciate 500g") {
		t.Fatal("expected other packs from the same groups")
	}
	if !strings.Contains(body, "8,00 zł / szt") || !strings.Contains(body, "6,00 zł / szt") {
		t.Fatal("expected 30-day lows on the right")
	}
	if !strings.Contains(body, `class="thumb thumb-empty"`) {
		t.Fatal("related packs should show a photo slot")
	}
	if !strings.Contains(body, `href="/products/`+itoa(large.ID)+`"`) {
		t.Fatal("lookup should link to the other pack, not admin")
	}
	if strings.Contains(body, `href="/admin/products/`+itoa(large.ID)+`"`) {
		t.Fatal("lookup must not use admin product links")
	}
	related := body[checkAt:]
	if strings.Contains(related, `href="/products/`+itoa(small.ID)+`"`) {
		t.Fatal("Check also should not list the selected pack")
	}
	if strings.Contains(body, "16,00 zł") || strings.Contains(body, "cheaper at") {
		t.Fatal("lookup should not show unit-price conclusions")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/products/"+itoa(large.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	body = rec.Body.String()
	if strings.Contains(body, "Better value") || strings.Contains(body, "Check also") || strings.Contains(body, "cheapest in this group") {
		t.Fatal("admin product page should not compare packs")
	}
	if strings.Contains(body, "By year") {
		t.Fatal("admin product page should not summarise by year")
	}
	if !strings.Contains(body, "<h2>Comparison groups</h2>") || !strings.Contains(body, "Mlekovita") || !strings.Contains(body, "All butters") {
		t.Fatal("admin product page should list the groups this pack belongs to")
	}
}

func lookupButterFixture(t *testing.T) (*store.Store, store.Product, store.Product, store.Product) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	kg, err := st.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	szt, err := st.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	small, err := st.CreateProduct("Mlekovita 200g", szt.ID, nil, []store.ProductConversion{
		{UnitID: kg.ID, Factor: decimal.RequireFromString("0.2")},
	})
	if err != nil {
		t.Fatal(err)
	}
	large, err := st.CreateProduct("Mlekovita 500g", szt.ID, nil, []store.ProductConversion{
		{UnitID: kg.ID, Factor: decimal.RequireFromString("0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	market, err := st.CreateProduct("Łaciate 500g", szt.ID, nil, []store.ProductConversion{
		{UnitID: kg.ID, Factor: decimal.RequireFromString("0.5")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(small.ID, 0, "2026-09-01", decimal.RequireFromString("1"), decimal.RequireFromString("4"), store.KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(large.ID, 0, "2026-09-01", decimal.RequireFromString("1"), decimal.RequireFromString("8"), store.KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePurchase(market.ID, 0, "2026-09-01", decimal.RequireFromString("1"), decimal.RequireFromString("6"), store.KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateComparisonGroup("Mlekovita", kg.ID, []int64{small.ID, large.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateComparisonGroup("All butters", kg.ID, []int64{small.ID, large.ID, market.ID}); err != nil {
		t.Fatal(err)
	}
	return st, small, large, market
}
