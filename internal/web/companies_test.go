package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/adrian/bulkly/internal/store"
)

func TestReceiptReviewOffersCreateCompanyWhenUnmatched(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"bought_on":"2026-08-18","company_name":"Biedronka","street_name":"Kościuszki","building_number":"10","postal_code":"40-001","city":"Katowice","lines":[{"receipt_name":"Chleb","package_count":"1","amount":"4.50"}]}`
	if err := st.SaveAIResponse(r.ID, raw); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/receipts/"+itoa(r.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Create company") {
		t.Fatal("unmatched OCR address should offer create")
	}
	if !strings.Contains(body, `/companies/new?`) || !strings.Contains(body, "prefill%5Bname%5D=Biedronka") {
		t.Fatal("create link should pass OCR fields as prefill query params")
	}
	if !strings.Contains(body, "next=%2Freceipts%2F"+itoa(r.ID)) && !strings.Contains(body, "next=/receipts/"+itoa(r.ID)) {
		t.Fatal("create link should return to this receipt")
	}
}

func TestCreateCompanyPrefillsFromQueryAndReturnsToReceipt(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"bought_on":"2026-08-18","company_name":"Biedronka","street_name":"Kościuszki","building_number":"10","postal_code":"40-001","city":"Katowice","lines":[{"receipt_name":"Chleb","package_count":"1","amount":"4.50"}]}`
	if err := st.SaveAIResponse(r.ID, raw); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	next := "/receipts/" + itoa(r.ID)
	q := url.Values{
		prefillQuery("name"):            {"Biedronka"},
		prefillQuery("street_name"):     {"Kościuszki"},
		prefillQuery("building_number"): {"10"},
		prefillQuery("postal_code"):     {"40-001"},
		prefillQuery("city"):            {"Katowice"},
		"next":                          {next},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/companies/new?"+q.Encode(), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `value="Biedronka"`) || !strings.Contains(body, `value="Kościuszki"`) {
		t.Fatal("form should be prefilled from query params")
	}
	if !strings.Contains(body, `name="next"`) || !strings.Contains(body, `value="`+next+`"`) {
		t.Fatal("form should keep the receipt return path")
	}

	form := url.Values{
		"name":             {"Biedronka"},
		"street_name":      {"Kościuszki"},
		"building_number":  {"10"},
		"apartment_number": {""},
		"postal_code":      {"40-001"},
		"city":             {"Katowice"},
		"next":             {next},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/companies", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Header().Get("Location") != next {
		t.Fatalf("location %s", rec.Header().Get("Location"))
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, next, nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("review status %d", rec.Code)
	}
	list, err := st.ListCompanies()
	if err != nil || len(list) != 1 {
		t.Fatalf("companies: %v %#v", err, list)
	}
	body = rec.Body.String()
	if !strings.Contains(body, `option value="`+itoa(list[0].ID)+`" selected`) {
		t.Fatal("receipt should preselect the company that matches OCR")
	}
	if strings.Contains(body, "Create company") {
		t.Fatal("matched company should not offer create")
	}
}

func TestCreateCompanyDoesNotSelectUnrelatedShop(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"bought_on":"2026-08-18","company_name":"Biedronka","street_name":"Kościuszki","building_number":"10","postal_code":"40-001","city":"Katowice","lines":[{"receipt_name":"Chleb","package_count":"1","amount":"4.50"}]}`
	if err := st.SaveAIResponse(r.ID, raw); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{
		"name":            {"Local Mill"},
		"street_name":     {"Marszałkowska"},
		"building_number": {"1"},
		"postal_code":     {"00-001"},
		"city":            {"Warszawa"},
		"next":            {"/receipts/" + itoa(r.ID)},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/companies", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/receipts/"+itoa(r.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	list, err := st.ListCompanies()
	if err != nil || len(list) != 1 {
		t.Fatalf("companies: %v %#v", err, list)
	}
	if strings.Contains(rec.Body.String(), `option value="`+itoa(list[0].ID)+`" selected`) {
		t.Fatal("unrelated company should not be preselected")
	}
	if !strings.Contains(rec.Body.String(), "Create company") {
		t.Fatal("OCR address still unmatched, create should remain")
	}
}

func TestCreateCompanyRejectsOffsiteNext(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{
		"name":            {"Local Mill"},
		"street_name":     {"Kościuszki"},
		"building_number": {"10"},
		"postal_code":     {"40-001"},
		"city":            {"Katowice"},
		"next":            {"https://evil.example/receipts/1"},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/companies", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Header().Get("Location") != "/companies" {
		t.Fatalf("location %s", rec.Header().Get("Location"))
	}
}

func TestReceiptReturnPath(t *testing.T) {
	if got := receiptReturnPath("/receipts/12"); got != "/receipts/12" {
		t.Fatalf("ok: %q", got)
	}
	for _, bad := range []string{"", "/companies", "/receipts/12/edit", "/receipts/12?x=1", "//evil", "https://x/receipts/1", "/receipts/12/../companies"} {
		if got := receiptReturnPath(bad); got != "" {
			t.Fatalf("bad %q -> %q", bad, got)
		}
	}
}
