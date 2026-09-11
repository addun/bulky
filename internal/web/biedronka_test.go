package web

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/adrian/bulkly/internal/store"
)

func TestBiedronkaPage(t *testing.T) {
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
	req := httptest.NewRequest(http.MethodGet, "/imports/biedronka", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<h1>Biedronka</h1>") {
		t.Fatal("missing heading")
	}
	if strings.Contains(body, `class="rail"`) || strings.Contains(body, `class="is-admin"`) {
		t.Fatal("import page should not use the admin panel")
	}
	if !strings.Contains(body, `id="biedronka-signin"`) {
		t.Fatal("missing Moja Biedronka sign-in")
	}
	if !strings.Contains(body, `id="biedronka-code"`) {
		t.Fatal("missing PKCE redirect field")
	}
	if !strings.Contains(body, `id="biedronka-access"`) || !strings.Contains(body, `id="biedronka-refresh"`) {
		t.Fatal("missing optional token fields")
	}
	if !strings.Contains(body, `id="biedronka-since"`) || !strings.Contains(body, `type="date"`) {
		t.Fatal("missing since date")
	}
	if !strings.Contains(body, `/static/biedronka.js`) {
		t.Fatal("missing browser script")
	}
	if !strings.Contains(body, `id="biedronka-import"`) {
		t.Fatal("missing import button")
	}
	if !strings.Contains(body, `id="biedronka-imported"`) || !strings.Contains(body, `data-payload=`) {
		t.Fatal("missing imported ids")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/receipts", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("receipts status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `href="/imports/biedronka"`) {
		t.Fatal("receipts should link to the Biedronka pull")
	}
	if strings.Contains(rec.Body.String(), `href="/admin/biedronka"`) {
		t.Fatal("admin nav should not link to Biedronka")
	}
}

func TestBiedronkaProxyTransactions(t *testing.T) {
	var gotAuth, gotUA, gotPage string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transactions/" {
			t.Errorf("path %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		gotUA = r.Header.Get("User-Agent")
		gotPage = r.URL.Query().Get("page")
		w.Header().Set("Set-Cookie", "secret=1")
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"page_count":1,"transactions":[{"id":"tx1","date":"2026-09-01T10:00:00+02:00","total_price":3.2}]}`)
	}))
	defer upstream.Close()

	srv := biedronkaTestServer(t, upstream.URL, "")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions?page=2", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if gotAuth != "Bearer tok" {
		t.Fatalf("auth %q", gotAuth)
	}
	if gotUA != biedronkaAPIUA {
		t.Fatalf("ua %q", gotUA)
	}
	if gotPage != "2" {
		t.Fatalf("page %q", gotPage)
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Fatal("must not forward Biedronka cookies")
	}
	var payload struct {
		Transactions []struct {
			ID string `json:"id"`
		} `json:"transactions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Transactions) != 1 || payload.Transactions[0].ID != "tx1" {
		t.Fatalf("payload %#v", payload)
	}
}

func TestBiedronkaProxyEReceiptAndDetails(t *testing.T) {
	var eReceiptFormat, eReceiptAccept, detailsPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/transactions/tx-1/e-receipt/":
			eReceiptFormat = r.Header.Get("output-format")
			eReceiptAccept = r.Header.Get("Accept")
			if eReceiptFormat == "pdf" {
				w.Header().Set("Content-Type", "application/pdf")
				io.WriteString(w, "%PDF-1.4 fake")
				return
			}
			io.WriteString(w, `[{"sellLine":{"name":"Mleko","quantity":1,"total":3.29}}]`)
		case "/transactions/tx-1/":
			detailsPath = r.URL.Path
			io.WriteString(w, `{"id":"tx-1","items":[{"name":"Chleb","total_price":4.5}]}`)
		default:
			t.Errorf("path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	srv := biedronkaTestServer(t, upstream.URL, "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions/tx-1/e-receipt", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("e-receipt %d %s", rec.Code, rec.Body.String())
	}
	if eReceiptFormat != "json" {
		t.Fatalf("output-format %q", eReceiptFormat)
	}
	if !strings.Contains(rec.Body.String(), "Mleko") {
		t.Fatalf("body %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions/tx-1/e-receipt?format=pdf", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pdf %d %s", rec.Code, rec.Body.String())
	}
	if eReceiptFormat != "pdf" {
		t.Fatalf("pdf output-format %q", eReceiptFormat)
	}
	if eReceiptAccept != "application/pdf" {
		t.Fatalf("pdf accept %q", eReceiptAccept)
	}
	if !strings.Contains(rec.Body.String(), "%PDF-") {
		t.Fatalf("pdf body %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions/tx-1/e-receipt?format=xml", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad format %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions/tx-1", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("details %d %s", rec.Code, rec.Body.String())
	}
	if detailsPath != "/transactions/tx-1/" {
		t.Fatalf("details path %q", detailsPath)
	}
}

func TestBiedronkaProxyRejectsBadInput(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("should not call upstream: %s", r.URL)
	}))
	defer upstream.Close()
	srv := biedronkaTestServer(t, upstream.URL, "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions?page=0", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("page 0: %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/transactions/../users", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
		t.Fatalf("traversal %d body %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/users/me", nil)
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("users/me should not be proxied: %d", rec.Code)
	}
}

func TestBiedronkaTokenRefresh(t *testing.T) {
	var gotUA, gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" {
			t.Errorf("path %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		gotUA = r.Header.Get("User-Agent")
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"access_token":"new-a","refresh_token":"new-r"}`)
	}))
	defer upstream.Close()

	srv := biedronkaTestServer(t, "http://unused.example", upstream.URL+"/token")
	form := url.Values{"refresh_token": {"old-r"}, "client_id": {"evil"}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/biedronka/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Bearer should-not-forward")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if gotUA != biedronkaAuthUA {
		t.Fatalf("ua %q", gotUA)
	}
	if strings.Contains(gotBody, "should-not-forward") {
		t.Fatal("must not forward API bearer to Keycloak")
	}
	if !strings.Contains(gotBody, "refresh_token=old-r") || !strings.Contains(gotBody, "client_id="+biedronkaClientID) {
		t.Fatalf("form %s", gotBody)
	}
	if strings.Contains(gotBody, "evil") {
		t.Fatalf("must ignore caller client_id: %s", gotBody)
	}
	if !strings.Contains(rec.Body.String(), "new-a") {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestBiedronkaAuthCodeFromRedirect(t *testing.T) {
	got, ok := biedronkaAuthCode("app://cma20.biedronka.pl?code=abc.def&session_state=1")
	if !ok || got != "abc.def" {
		t.Fatalf("app url: %q %v", got, ok)
	}
	got, ok = biedronkaAuthCode("Failed to launch 'app://cma20.biedronka.pl?code=xyz123&iss=https%3A%2F%2Fkonto.biedronka.pl'")
	if !ok || got != "xyz123" {
		t.Fatalf("noisy copy: %q %v", got, ok)
	}
	got, ok = biedronkaAuthCode(" onlyTheCode ")
	if !ok || got != "onlyTheCode" {
		t.Fatalf("raw: %q %v", got, ok)
	}
	if _, ok = biedronkaAuthCode(" "); ok {
		t.Fatal("empty should fail")
	}
}

func TestBiedronkaTokenAuthorizationCode(t *testing.T) {
	var gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"access_token":"a","refresh_token":"r"}`)
	}))
	defer upstream.Close()

	srv := biedronkaTestServer(t, "http://unused.example", upstream.URL+"/token")
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {"Failed to launch 'app://cma20.biedronka.pl?code=xyz123'"},
		"code_verifier": {"verifier-from-pkce"},
		"client_id":     {"evil"},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/biedronka/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(gotBody, "grant_type=authorization_code") || !strings.Contains(gotBody, "code=xyz123") {
		t.Fatalf("form %s", gotBody)
	}
	if !strings.Contains(gotBody, "code_verifier=verifier-from-pkce") || !strings.Contains(gotBody, "client_id="+biedronkaClientID) {
		t.Fatalf("pkce %s", gotBody)
	}
	if strings.Contains(gotBody, "evil") {
		t.Fatalf("must ignore caller client_id: %s", gotBody)
	}
}

func TestBiedronkaTxID(t *testing.T) {
	if _, ok := biedronkaTxID("tx-1_ab"); !ok {
		t.Fatal("expected ok")
	}
	for _, bad := range []string{"", "..", "tx/1", "tx 1", "tx.1", strings.Repeat("a", 129)} {
		if _, ok := biedronkaTxID(bad); ok {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestBiedronkaImportCreatesReadyReceipt(t *testing.T) {
	var pdfFormat string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transactions/tx-1/e-receipt/" {
			t.Errorf("path %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		pdfFormat = r.Header.Get("output-format")
		w.Header().Set("Content-Type", "application/pdf")
		io.WriteString(w, "not-a-pdf")
	}))
	defer upstream.Close()

	srv := biedronkaTestServer(t, upstream.URL, "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/biedronka/imported", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("imported %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"ids":[]`) {
		t.Fatalf("empty imported %s", rec.Body.String())
	}

	body := `{"id":"tx-1","date":"2026-09-08T14:32:00+02:00","store_name":"Biedronka SKLEP 2615","receipt_num":"99","total_price":3.29,"receipt":[{"sellLine":{"name":"Mleko 1l","quantity":1,"price":3.29,"total":3.29,"vatId":"A"}}]}`
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/biedronka/import", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import %d %s", rec.Code, rec.Body.String())
	}
	if pdfFormat != "pdf" {
		t.Fatalf("import should fetch pdf, got %q", pdfFormat)
	}
	var out struct {
		Status    string `json:"status"`
		ID        string `json:"id"`
		ReceiptID int64  `json:"receipt_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Status != "imported" || out.ID != "tx-1" || out.ReceiptID == 0 {
		t.Fatalf("out %#v", out)
	}
	receipt, err := srv.store.GetReceipt(out.ReceiptID)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Status != store.ReceiptReady || receipt.Source != store.ReceiptSourceBiedronka || receipt.ExternalID != "tx-1" {
		t.Fatalf("receipt %#v", receipt)
	}
	if !strings.Contains(receipt.RawResponse, `"Mleko 1l"`) {
		t.Fatalf("bill %s", receipt.RawResponse)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/biedronka/import", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer tok")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"skipped"`) {
		t.Fatalf("dup %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/biedronka/imported", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("imported after %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"tx-1"`) || !strings.Contains(rec.Body.String(), `"2026-09-08"`) {
		t.Fatalf("imported state %s", rec.Body.String())
	}
}

func biedronkaTestServer(t *testing.T, api, auth string) *Server {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	srv.biedronkaAPI = api
	if auth != "" {
		srv.biedronkaAuth = auth
	}
	return srv
}
