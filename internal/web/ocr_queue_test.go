package web

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

func TestReceiptStatusShowsReading(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
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
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "This scan has no product list yet. Upload the bill again.") && !strings.Contains(body, "Reading the bill") {
		t.Fatal("pending receipt should not bounce to the list")
	}
	if !strings.Contains(body, "Reading the bill") {
		t.Fatal("pending receipt should explain that OCR is running")
	}
	if !strings.Contains(body, `http-equiv="refresh"`) {
		t.Fatal("pending receipt should auto-refresh")
	}
	if !strings.Contains(body, ">Reading<") && !strings.Contains(body, "Reading</p>") {
		t.Fatal("pending receipt should show the Reading status")
	}
	if !strings.Contains(body, `src="/admin/receipts/`+itoa(r.ID)+`/preview"`) {
		t.Fatal("pending receipt should show the preview")
	}
}

func TestReceiptStatusShowsFailed(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.FailReceipt(r.ID, "No products could be read from this bill. Try another photo or PDF."); err != nil {
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
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "Reading the bill") {
		t.Fatal("failed receipt should not look like it is still reading")
	}
	if strings.Contains(body, `http-equiv="refresh"`) {
		t.Fatal("failed receipt should not auto-refresh")
	}
	if !strings.Contains(body, "No products could be read from this bill") {
		t.Fatal("failed receipt should show the OCR error")
	}
	if !strings.Contains(body, "This scan has no product list yet") {
		t.Fatal("failed receipt should explain there is no product list")
	}
	if !strings.Contains(body, `action="/admin/receipts/`+itoa(r.ID)+`/retry"`) {
		t.Fatal("failed receipt should offer Read again")
	}
	if !strings.Contains(body, "Read again") {
		t.Fatal("failed receipt should label the retry")
	}
}

func TestRetryReceiptReadsAgain(t *testing.T) {
	billJSON, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-01",
		"lines": []map[string]any{
			{"receipt_name": "Rice", "product_name": "Rice", "quantity": "1", "amount": "4.00", "unit_name": "kg"},
		},
	})
	api := mockOCRServer(t, func() []byte { return billJSON })
	defer api.Close()

	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSetting(store.SettingOCRModel, "test-model"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{OCR: ocr.Config{APIKey: "sk-test", BaseURL: api.URL}})
	if err != nil {
		t.Fatal(err)
	}

	receipt, msg, status := srv.acceptBillUpload(fileHeaderPNG(t, tinyPNG(t)))
	if msg != "" {
		t.Fatalf("accept: %s (%d)", msg, status)
	}
	if err := st.FailReceipt(receipt.ID, "blurry"); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/receipts/"+itoa(receipt.ID)+"/retry", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/admin/receipts/"+itoa(receipt.ID) {
		t.Fatalf("location %q", loc)
	}
	waitReceiptStatus(t, st, receipt.ID, store.ReceiptReady)
}

func TestRetryReceiptNeedsStoredBill(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSetting(store.SettingOCRModel, "test-model"); err != nil {
		t.Fatal(err)
	}
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.FailReceipt(r.ID, "blurry"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{OCR: ocr.Config{APIKey: "sk-test", BaseURL: "http://127.0.0.1:1"}})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/receipts/"+itoa(r.ID)+"/retry", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "/admin/receipts/"+itoa(r.ID)+"?error=") || !strings.Contains(loc, "disk") {
		t.Fatalf("location %q", loc)
	}
	got, err := st.GetReceipt(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != store.ReceiptFailed {
		t.Fatalf("status %q", got.Status)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, loc, nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("show status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "no longer on disk") {
		t.Fatal("retry without a stored file should explain that")
	}
}

func TestReceiptsPageLinksPending(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, err := st.CreateReceipt("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/receipts", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `href="/admin/receipts/`+itoa(r.ID)+`"`) {
		t.Fatal("pending receipts should link to the status page")
	}
	if !strings.Contains(body, "Reading") {
		t.Fatal("pending receipts should show Reading")
	}
}

func TestScanReceiptRedirectsBeforeOCRFinishes(t *testing.T) {
	billJSON, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-01",
		"lines": []map[string]any{
			{"receipt_name": "Rice 10kg", "product_name": "Rice", "quantity": "10", "amount": "40.00", "unit_name": "kg"},
		},
	})
	release := make(chan struct{})
	api := mockOCRServer(t, func() []byte {
		<-release
		return billJSON
	})
	defer api.Close()

	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSetting(store.SettingOCRModel, "test-model"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{OCR: ocr.Config{APIKey: "sk-test", BaseURL: api.URL}})
	if err != nil {
		t.Fatal(err)
	}

	rec := postBill(t, srv, tinyPNG(t))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if !strings.HasPrefix(loc, "/admin/receipts/") {
		t.Fatalf("location %q", loc)
	}
	id := strings.TrimPrefix(loc, "/admin/receipts/")

	got, err := st.GetReceipt(mustID(t, id))
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != store.ReceiptPending {
		t.Fatalf("upload should return before OCR finishes: %q", got.Status)
	}

	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, loc, nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("show status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Reading the bill") {
		t.Fatal("receipt page should show OCR in progress")
	}

	close(release)
	waitReceiptStatus(t, st, got.ID, store.ReceiptReady)

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, loc, nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ready status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Rice") {
		t.Fatal("ready receipt should show the confirm form")
	}
}

func TestScanReceiptFailedShowsErrorOnReceipt(t *testing.T) {
	api := mockOCRServer(t, func() []byte {
		return []byte(`{"not_a_bill": true, "lines": []}`)
	})
	defer api.Close()

	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSetting(store.SettingOCRModel, "test-model"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{OCR: ocr.Config{APIKey: "sk-test", BaseURL: api.URL}})
	if err != nil {
		t.Fatal(err)
	}

	rec := postBill(t, srv, tinyPNG(t))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	id := mustID(t, strings.TrimPrefix(loc, "/admin/receipts/"))
	waitReceiptStatus(t, st, id, store.ReceiptFailed)

	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, loc, nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("show status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "does not look like a bill") {
		t.Fatal("failed OCR should show on the receipt page")
	}
	if strings.Contains(body, "Reading the bill") {
		t.Fatal("failed OCR should not still say reading")
	}
}

func TestRecoverOCRProcessesPendingReceipt(t *testing.T) {
	billJSON, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-01",
		"lines": []map[string]any{
			{"receipt_name": "Rice", "product_name": "Rice", "quantity": "1", "amount": "4.00", "unit_name": "kg"},
		},
	})
	api := mockOCRServer(t, func() []byte { return billJSON })
	defer api.Close()

	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSetting(store.SettingOCRModel, "test-model"); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{OCR: ocr.Config{APIKey: "sk-test", BaseURL: api.URL}})
	if err != nil {
		t.Fatal(err)
	}

	receipt, msg, status := srv.acceptBillUpload(fileHeaderPNG(t, tinyPNG(t)))
	if msg != "" {
		t.Fatalf("accept: %s (%d)", msg, status)
	}
	if receipt.Status != store.ReceiptPending {
		t.Fatalf("status %q", receipt.Status)
	}

	srv.RecoverOCR()
	waitReceiptStatus(t, st, receipt.ID, store.ReceiptReady)
}

func mockOCRServer(t *testing.T, body func() []byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content := body()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": string(content)}},
			},
		})
	}))
}

func postBill(t *testing.T, srv *Server, raw []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("bill", "bill.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/receipts", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

func fileHeaderPNG(t *testing.T, raw []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("bill", "bill.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodPost, "/admin/receipts", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	c.Request = req
	fh, err := pickFormFile(c, "bill")
	if err != nil {
		t.Fatal(err)
	}
	return fh
}

func waitReceiptStatus(t *testing.T, st *store.Store, id int64, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var last string
	for time.Now().Before(deadline) {
		r, err := st.GetReceipt(id)
		if err != nil {
			t.Fatal(err)
		}
		last = r.Status
		if r.Status == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("receipt %d status %q want %q", id, last, want)
}

func mustID(t *testing.T, s string) int64 {
	t.Helper()
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		t.Fatalf("id %q", s)
	}
	return id
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
