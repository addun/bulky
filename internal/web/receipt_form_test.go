package web

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

func TestHydrateBillMatchesCatalog(t *testing.T) {
	products := []store.ProductListItem{
		{Product: store.Product{ID: 4, Name: "Rice", UnitID: 1, UnitName: "kg"}},
	}
	units := []store.Unit{{ID: 1, Name: "kg"}, {ID: 2, Name: "g"}}

	bill := ocr.Bill{
		Lines: []ocr.Line{
			{ReceiptName: "RYZ 10KG", ProductName: "Rice", ProductID: 0, UnitName: "kg", Quantity: "10", Amount: "40"},
			{ReceiptName: "Flour", ProductName: "Flour", ProductID: 0, UnitID: 0, UnitName: "KG", Quantity: "2", Amount: "8"},
			{ReceiptName: "Ghost", ProductName: "Ghost", ProductID: 123, Skip: true},
		},
	}
	got := hydrateBill(bill, products, units)
	if got.Lines[0].ProductID != 4 || got.Lines[0].UnitID != 1 {
		t.Fatalf("rice: %#v", got.Lines[0])
	}
	if got.Lines[1].UnitID != 1 {
		t.Fatalf("flour unit: %#v", got.Lines[1])
	}
	if got.Lines[2].ProductID != 0 {
		t.Fatalf("invalid product id should clear: %#v", got.Lines[2])
	}
}

func TestParseReceiptForm(t *testing.T) {
	get := func(form map[string]string) func(string) string {
		return func(k string) string { return form[k] }
	}

	in, _, msg := parseReceiptForm(get(map[string]string{
		"bought_on":        "2026-08-20",
		"line_count":       "3",
		"include_0":        "1",
		"product_choice_0": "4",
		"quantity_0":       "10",
		"amount_0":         "40,00",
		"include_1":        "1",
		"product_choice_1": "new",
		"product_name_1":   "Flour",
		"unit_id_1":        "1",
		"quantity_1":       "5",
		"amount_1":         "18.50",
		"include_2":        "",
		"product_choice_2": "new",
		"product_name_2":   "Skip me",
		"unit_id_2":        "1",
		"quantity_2":       "1",
		"amount_2":         "1",
	}))
	if msg != "" {
		t.Fatal(msg)
	}
	if in.Company != nil || in.CompanyID != 0 {
		t.Fatalf("company should be empty: %#v", in)
	}
	if len(in.Lines) != 2 {
		t.Fatalf("lines: %#v", in.Lines)
	}
	if in.Lines[0].ProductID != 4 || in.Lines[0].Amount.StringFixed(2) != "40.00" {
		t.Fatalf("line0: %#v", in.Lines[0])
	}
	if in.Lines[1].ProductName != "Flour" || in.Lines[1].UnitID != 1 {
		t.Fatalf("line1: %#v", in.Lines[1])
	}

	in, view, msg := parseReceiptForm(get(map[string]string{
		"bought_on":        "2026-08-20",
		"company_id":       "7",
		"line_count":       "1",
		"include_0":        "1",
		"product_choice_0": "4",
		"quantity_0":       "1",
		"amount_0":         "1",
	}))
	if msg != "" {
		t.Fatal(msg)
	}
	if in.CompanyID != 7 || view.CompanyID != 7 {
		t.Fatalf("company_id: in=%d view=%d", in.CompanyID, view.CompanyID)
	}

	_, _, msg = parseReceiptForm(get(map[string]string{
		"bought_on":        "2026-08-20",
		"line_count":       "1",
		"include_0":        "1",
		"product_choice_0": "new",
		"product_name_0":   "",
		"unit_id_0":        "1",
		"quantity_0":       "1",
		"amount_0":         "1",
	}))
	if msg == "" {
		t.Fatal("expected name error")
	}
}

func TestReceiptReviewTemplateExecutes(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{Currency: "PLN", CurrencySymbol: "zł"})
	if err != nil {
		t.Fatal(err)
	}
	var buf strings.Builder
	err = srv.tmpl.ExecuteTemplate(&buf, "receipt_review.html", gin.H{
		"Page": page{Title: "Confirm bill", Currency: "PLN"},
		"View": receiptView{
			ReceiptID: 3,
			ImagePath: "aabbccddeeff00112233445566778899",
			Status:    store.ReceiptReady,
			BoughtOn:  "2026-08-20",
			Lines: []receiptLineView{{
				Include: true, ProductName: "Rice", UnitID: 1, Quantity: "10", Amount: "40.00", ReceiptName: "RYZ",
			}},
		},
		"Products":  []store.ProductListItem{},
		"Units":     []store.Unit{{ID: 1, Name: "kg"}},
		"Companies": []store.Company{{ID: 2, Name: "Local Mill"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	if !strings.Contains(body, "Save purchases") || !strings.Contains(body, "Rice") {
		t.Fatalf("unexpected body: %s", body)
	}
	if !strings.Contains(body, `name="receipt_id"`) {
		t.Fatal("missing receipt id")
	}
	if !strings.Contains(body, `name="company_id"`) || !strings.Contains(body, "Local Mill") {
		t.Fatal("review form should let you pick a company")
	}
	if strings.Contains(body, "Street name") {
		t.Fatal("review form should not ask for company address")
	}
	if !strings.Contains(body, `src="/receipts/3/preview"`) {
		t.Fatal("preview should be nested under the receipt")
	}
}

func TestReceiptsPageRendersWhenUnconfigured(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/receipts", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<h1>Receipts</h1>") {
		t.Fatal("missing heading")
	}
	if !strings.Contains(body, "OCR_API_KEY") {
		t.Fatal("missing setup hint")
	}
	if !strings.Contains(body, `href="/receipts"`) {
		t.Fatal("missing receipts nav")
	}
	if !strings.Contains(body, "No receipts yet.") {
		t.Fatal("empty list")
	}

	srv, err = New(st, Config{OCR: ocr.Config{APIKey: "sk-test"}})
	if err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/receipts", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("configured status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `name="bill"`) {
		t.Fatal("configured page should show the upload field")
	}
	body = rec.Body.String()
	if !strings.Contains(body, `capture="environment"`) {
		t.Fatal("configured page should offer the phone camera")
	}
	if !strings.Contains(body, "Take photo") || !strings.Contains(body, "Choose photo") {
		t.Fatal("configured page should offer camera and file pickers")
	}
	if !strings.Contains(body, `name="bill_camera"`) {
		t.Fatal("configured page should post the camera field")
	}
	if !strings.Contains(body, `accept="image/*"`) {
		t.Fatal("file inputs should accept any image so Chrome and phones can open the picker")
	}
}

func TestReceiptsPageListsReceipts(t *testing.T) {
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
	if err := st.SaveAIResponse(r.ID, `{"bought_on":"2026-08-20","lines":[]}`); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/receipts", nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "No receipts yet.") {
		t.Fatal("should list receipts")
	}
	if !strings.Contains(body, `href="/receipts/`+itoa(r.ID)+`"`) {
		t.Fatal("missing receipt link")
	}
	if !strings.Contains(body, "To confirm") {
		t.Fatal("missing status")
	}
	if !strings.Contains(body, `src="/receipts/`+itoa(r.ID)+`/preview"`) {
		t.Fatal("preview should be nested under the receipt")
	}
}

func TestReceiptReviewLoadsReceiptJSON(t *testing.T) {
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
	if err := st.SaveAIResponse(r.ID, `{"bought_on":"2026-08-20","lines":[{"product_name":"Rice","quantity":"10","amount":"40.00","unit_name":"kg"}]}`); err != nil {
		t.Fatal(err)
	}
	srv, err := New(st, Config{Currency: "PLN", CurrencySymbol: "zł"})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/receipts/"+itoa(r.ID), nil)
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Rice") {
		t.Fatal("review should show the saved product")
	}
	if !strings.Contains(rec.Body.String(), `name="company_id"`) {
		t.Fatal("review should include a company picker")
	}
}

func TestPickFormFileUsesCameraField(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("bill_camera", "shot.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodPost, "/receipts", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	c.Request = req

	fh, err := pickFormFile(c, "bill", "bill_camera")
	if err != nil {
		t.Fatal(err)
	}
	if fh.Filename != "shot.jpg" {
		t.Fatalf("filename %q", fh.Filename)
	}
}
