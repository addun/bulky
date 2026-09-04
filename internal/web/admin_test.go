package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

func TestAdminPageAndSave(t *testing.T) {
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
	req := httptest.NewRequest(http.MethodGet, "/admin/settings", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<h1>Settings</h1>") {
		t.Fatal("missing heading")
	}
	if !strings.Contains(body, `name="ocr_model"`) {
		t.Fatal("missing model field")
	}
	if !strings.Contains(body, `href="https://developers.openai.com/api/docs/models/all"`) {
		t.Fatal("missing models link")
	}
	if strings.Contains(body, "API key") {
		t.Fatal("admin should not mention the API key")
	}
	if strings.Contains(body, `value="gpt-4o"`) {
		t.Fatal("model field should start empty")
	}

	form := url.Values{"ocr_model": {"gpt-4o-mini"}}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/settings", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("save status %d", rec.Code)
	}
	if rec.Header().Get("Location") != "/admin/settings" {
		t.Fatalf("location %s", rec.Header().Get("Location"))
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/admin/settings", nil)
	srv.Handler().ServeHTTP(rec, req)
	body = rec.Body.String()
	if !strings.Contains(body, `value="gpt-4o-mini"`) {
		t.Fatal("saved model should fill the field")
	}
}

func TestAdminRejectsEmptyModel(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"ocr_model": {"  "}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/settings", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AI model is required") {
		t.Fatal("expected validation error")
	}
	got, err := st.GetSetting(store.SettingOCRModel)
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("empty save wrote %q", got)
	}
}

func TestScanReceiptRequiresModel(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{OCR: ocr.Config{APIKey: "sk-test"}})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/receipts", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	loc, err := url.QueryUnescape(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(loc, "Admin") {
		t.Fatalf("location %s", loc)
	}
}

func TestUnitsPageHasNoSubtitle(t *testing.T) {
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
	req := httptest.NewRequest(http.MethodGet, "/admin/units", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<h1>Units</h1>") {
		t.Fatal("missing heading")
	}
	if strings.Contains(body, "Products pick a purchase unit from this list") {
		t.Fatal("units page should not have a subtitle")
	}
	if !strings.Contains(body, "Catalog") || !strings.Contains(body, `href="/admin"`) || !strings.Contains(body, `href="/admin/units"`) || !strings.Contains(body, `href="/admin/aliases"`) {
		t.Fatal("nav should nest products, units, and aliases in a catalog group")
	}
}
