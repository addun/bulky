package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/adrian/bulkly/internal/store"
)

func TestReceiptReviewOffersCreateStoryWhenUnmatched(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"bought_on":"2026-08-18","company_name":"Biedronka","external_id":"2615","street_name":"Kościuszki","building_number":"10","postal_code":"40-001","city":"Katowice","lines":[{"receipt_name":"Chleb","package_count":"1","amount":"4.50"}]}`
	if err := st.SaveAIResponse(r.ID, raw); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/receipts/"+itoa(r.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Create store") {
		t.Fatal("unmatched OCR address should offer create")
	}
	if !strings.Contains(body, `/admin/stories/new?`) || !strings.Contains(body, "prefill%5Bname%5D=Biedronka") {
		t.Fatal("create link should pass OCR fields as prefill query params")
	}
	if !strings.Contains(body, "prefill%5Bexternal_id%5D=2615") {
		t.Fatal("create link should pass the store code")
	}
	if !strings.Contains(body, "next=%2Fadmin%2Freceipts%2F"+itoa(r.ID)) && !strings.Contains(body, "next=/admin/receipts/"+itoa(r.ID)) {
		t.Fatal("create link should return to this receipt")
	}
}

func TestCreateStoryPrefillsFromQueryAndReturnsToReceipt(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"bought_on":"2026-08-18","company_name":"Biedronka","external_id":"2615","street_name":"Kościuszki","building_number":"10","postal_code":"40-001","city":"Katowice","lines":[{"receipt_name":"Chleb","package_count":"1","amount":"4.50"}]}`
	if err := st.SaveAIResponse(r.ID, raw); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	next := "/admin/receipts/" + itoa(r.ID)
	q := url.Values{
		prefillQuery("name"):            {"Biedronka"},
		prefillQuery("external_id"):     {"2615"},
		prefillQuery("street_name"):     {"Kościuszki"},
		prefillQuery("building_number"): {"10"},
		prefillQuery("postal_code"):     {"40-001"},
		prefillQuery("city"):            {"Katowice"},
		"next":                          {next},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/stories/new?"+q.Encode(), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `value="Biedronka"`) || !strings.Contains(body, `value="Kościuszki"`) || !strings.Contains(body, `value="2615"`) {
		t.Fatal("form should be prefilled from query params")
	}
	if !strings.Contains(body, `name="next"`) || !strings.Contains(body, `value="`+next+`"`) {
		t.Fatal("form should keep the receipt return path")
	}

	form := url.Values{
		"name":             {"Biedronka"},
		"external_id":      {"2615"},
		"street_name":      {"Kościuszki"},
		"building_number":  {"10"},
		"apartment_number": {""},
		"postal_code":      {"40-001"},
		"city":             {"Katowice"},
		"next":             {next},
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/stories", strings.NewReader(form.Encode()))
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
	list, err := st.ListStories()
	if err != nil || len(list) != 1 {
		t.Fatalf("stories: %v %#v", err, list)
	}
	if list[0].ExternalID != "2615" {
		t.Fatalf("store code: %#v", list[0])
	}
	body = rec.Body.String()
	if !strings.Contains(body, `option value="`+itoa(list[0].ID)+`" selected`) {
		t.Fatal("receipt should preselect the story that matches OCR")
	}
	if strings.Contains(body, "Create store") {
		t.Fatal("matched story should not offer create")
	}
}

func TestCreateStoryDoesNotSelectUnrelatedShop(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"bought_on":"2026-08-18","company_name":"Biedronka","external_id":"2615","street_name":"Kościuszki","building_number":"10","postal_code":"40-001","city":"Katowice","lines":[{"receipt_name":"Chleb","package_count":"1","amount":"4.50"}]}`
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
		"next":            {"/admin/receipts/" + itoa(r.ID)},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/stories", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/receipts/"+itoa(r.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	list, err := st.ListStories()
	if err != nil || len(list) != 1 {
		t.Fatalf("stories: %v %#v", err, list)
	}
	if strings.Contains(rec.Body.String(), `option value="`+itoa(list[0].ID)+`" selected`) {
		t.Fatal("unrelated story should not be preselected")
	}
	if !strings.Contains(rec.Body.String(), "Create store") {
		t.Fatal("OCR address still unmatched, create should remain")
	}
}

func TestCreateStoryRejectsOffsiteNext(t *testing.T) {
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
		"next":            {"https://evil.example/admin/receipts/1"},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/stories", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Header().Get("Location") != "/admin/stories" {
		t.Fatalf("location %s", rec.Header().Get("Location"))
	}
}

func TestReceiptReturnPath(t *testing.T) {
	if got := receiptReturnPath("/admin/receipts/12"); got != "/admin/receipts/12" {
		t.Fatalf("ok: %q", got)
	}
	for _, bad := range []string{"", "/admin/stories", "/admin/receipts/12/edit", "/admin/receipts/12?x=1", "//evil", "https://x/admin/receipts/1", "/admin/receipts/12/../admin/stories"} {
		if got := receiptReturnPath(bad); got != "" {
			t.Fatalf("bad %q -> %q", bad, got)
		}
	}
}
