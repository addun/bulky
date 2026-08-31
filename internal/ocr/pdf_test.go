package ocr

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"strings"
	"testing"
)

func TestSniffFile(t *testing.T) {
	if sniffFile(textPDF("Maka 5kg 18.90")) != filePDF {
		t.Fatal("pdf")
	}
	if sniffFile(tinyPNG(t)) != fileImage {
		t.Fatal("png")
	}
	if sniffFile([]byte("hello")) != fileUnknown {
		t.Fatal("unknown")
	}
}

func TestExtractPDFText(t *testing.T) {
	raw := textPDF(
		"Faktura VAT 1/2026 18.08.2026",
		"Maka pszenna 5kg 2 x 18.90 37.80",
		"Ryza 1kg 4.50",
		"Suma PLN 42.30",
	)
	got, err := extractPDFText(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !isPDFWithText(got) {
		t.Fatalf("expected text bill, got %q", got)
	}
	for _, want := range []string{"Maka", "Ryza", "18.90", "42.30"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
}

func TestIsPDFWithText(t *testing.T) {
	if isPDFWithText("Page 1") {
		t.Fatal("page furniture is not a text bill")
	}
	if !isPDFWithText("Faktura VAT 12/2026 Maka 5kg 18.90 Ryza 4.50 Suma 23.40") {
		t.Fatal("invoice text should count")
	}
}

func TestExtractPDFTextEmptyPage(t *testing.T) {
	got, err := extractPDFText(textPDF())
	if err != nil {
		t.Fatal(err)
	}
	if isPDFWithText(got) {
		t.Fatalf("empty pdf looked like text: %q", got)
	}
}

func TestPreviewJPEGAcceptsPDF(t *testing.T) {
	out, err := PreviewJPEG(textPDF("Maka pszenna 5kg 18.90 and enough letters here"))
	if err != nil {
		t.Fatal(err)
	}
	if len(out) == 0 {
		t.Fatal("empty jpeg")
	}
	if sniffFile(out) != fileImage {
		t.Fatal("preview should be a jpeg")
	}
}

func TestStackPagesJoinsVertically(t *testing.T) {
	a := image.NewRGBA(image.Rect(0, 0, 10, 20))
	b := image.NewRGBA(image.Rect(0, 0, 8, 15))
	got := stackPages([]image.Image{a, b})
	if got.Bounds().Dx() != 10 {
		t.Fatalf("width %d", got.Bounds().Dx())
	}
	if got.Bounds().Dy() != 20+previewPageGap+15 {
		t.Fatalf("height %d", got.Bounds().Dy())
	}
}

func TestStackPreviewJPEGJoinsPages(t *testing.T) {
	a := image.NewRGBA(image.Rect(0, 0, 40, 30))
	b := image.NewRGBA(image.Rect(0, 0, 40, 50))
	jpegBytes, err := stackPreviewJPEG([][]byte{pngBytes(t, a), pngBytes(t, b)})
	if err != nil {
		t.Fatal(err)
	}
	got, err := jpeg.Decode(bytes.NewReader(jpegBytes))
	if err != nil {
		t.Fatal(err)
	}
	if got.Bounds().Dy() != 30+previewPageGap+50 {
		t.Fatalf("height %d", got.Bounds().Dy())
	}
}

func TestExtractPDFTextFromMultiplePages(t *testing.T) {
	raw := textPDFPages(
		[]string{"Faktura VAT 1/2026 Maka pszenna 5kg 18.90"},
		[]string{"Ryza 1kg 4.50 Suma PLN 23.40 extra letters"},
	)
	got, err := extractPDFText(raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Maka", "Ryza", "23.40"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
}

func pngBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestExtractFromPDFSendsImagesNotText(t *testing.T) {
	stubPDFPages(t, tinyPNG(t))

	billJSON := []byte(`{"bought_on":"2026-08-18","lines":[{"receipt_name":"Maka 5kg","product_name":"Maka","amount":"18.90","unit_name":"kg"}]}`)
	var reqBody []byte
	srv := mockChat(t, func(_ string, body []byte) []byte {
		reqBody = body
		return billJSON
	})
	defer srv.Close()

	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "gpt-4o"})
	pdf := textPDF(
		"Faktura VAT 1/2026 18.08.2026",
		"Maka pszenna 5kg 2 x 18.90 37.80",
		"Suma PLN 37.80",
	)
	bill, raw, err := a.Extract(pdf)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(reqBody, []byte(`"type":"image_url"`)) {
		t.Fatal("PDF should be sent as page images")
	}
	if bytes.Contains(reqBody, []byte("Maka pszenna")) {
		t.Fatalf("request should not include extracted PDF text: %s", reqBody)
	}
	if bill.BoughtOn != "2026-08-18" || len(bill.ProductLines()) != 1 {
		t.Fatalf("bill %#v", bill)
	}
	if !bytes.Contains(raw, []byte("Maka")) {
		t.Fatalf("raw %s", raw)
	}
}

func TestExtractPDFSendsEachPageOnce(t *testing.T) {
	stubPDFPages(t, tinyPNG(t), tinyPNG(t))
	billJSON := []byte(`{"bought_on":"2026-08-18","lines":[{"receipt_name":"Maka","product_name":"Maka","amount":"18.90"}]}`)
	var reqBody []byte
	srv := mockChat(t, func(_ string, body []byte) []byte {
		reqBody = body
		return billJSON
	})
	defer srv.Close()

	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "gpt-4o"})
	_, _, err := a.Extract(textPDF("page one"))
	if err != nil {
		t.Fatal(err)
	}
	if got := bytes.Count(reqBody, []byte(`"type":"image_url"`)); got != 2 {
		t.Fatalf("images in request %d, want 2", got)
	}
	if !bytes.Contains(reqBody, []byte("Page 1 of 2")) || !bytes.Contains(reqBody, []byte("Page 2 of 2")) {
		t.Fatalf("prompt should label PDF pages: %s", reqBody)
	}
	if bytes.Contains(reqBody, []byte("overlapping")) {
		t.Fatalf("prompt should not mention slices: %s", reqBody)
	}
}

func TestExtractBrokenPDFGoesToVision(t *testing.T) {
	stubPDFPages(t, tinyPNG(t))
	billJSON := []byte(`{"bought_on":"2026-08-18","lines":[{"receipt_name":"Maka","product_name":"Maka","amount":"18.90"}]}`)
	var reqBody []byte
	srv := mockChat(t, func(_ string, body []byte) []byte {
		reqBody = body
		return billJSON
	})
	defer srv.Close()

	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "gpt-4o"})
	broken := []byte("%PDF-1.4\n1 0 obj<<>>endobj\n")
	if sniffFile(broken) != filePDF {
		t.Fatal("fixture should sniff as pdf")
	}
	bill, _, err := a.Extract(broken)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(reqBody, []byte(`"type":"image_url"`)) {
		t.Fatal("broken PDF should still go to vision")
	}
	if bill.BoughtOn != "2026-08-18" {
		t.Fatalf("bought_on %q", bill.BoughtOn)
	}
}

func TestExtractPDFWithoutText(t *testing.T) {
	orig := lookPath
	t.Cleanup(func() { lookPath = orig })
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	a := New(Config{APIKey: "x", BaseURL: "http://127.0.0.1:1", Model: "test-model"})
	_, _, err := a.Extract(textPDF())
	if !errors.Is(err, ErrNoPDFText) {
		t.Fatalf("got %v", err)
	}
}

func TestExtractLocalAPIUsesConfiguredModelForPDF(t *testing.T) {
	stubPDFPages(t, tinyPNG(t))
	var model string
	srv := mockChat(t, func(m string, _ []byte) []byte {
		model = m
		return []byte(`{"bought_on":"2026-08-01","lines":[{"receipt_name":"Rice","product_name":"Rice","amount":"40.00"}]}`)
	})
	defer srv.Close()
	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "local-reader"})
	_, _, err := a.Extract(textPDF(
		"Faktura VAT 1/2026 18.08.2026",
		"Maka pszenna 5kg 18.90",
		"Suma PLN 18.90",
	))
	if err != nil {
		t.Fatal(err)
	}
	if model != "local-reader" {
		t.Fatalf("model %q", model)
	}
}

func stubPDFPages(t *testing.T, pages ...[]byte) {
	t.Helper()
	orig := pdfPageJPEGs
	t.Cleanup(func() { pdfPageJPEGs = orig })
	pdfPageJPEGs = func([]byte) ([][]byte, error) {
		return pages, nil
	}
}

func textPDF(lines ...string) []byte {
	return textPDFPages(lines)
}

func textPDFPages(pages ...[]string) []byte {
	if len(pages) == 0 {
		pages = [][]string{nil}
	}
	n := len(pages)
	fontObj := 3 + 2*n
	kids := make([]string, n)
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"", // Pages dict filled below
	}
	for i, lines := range pages {
		pageObj := 3 + 2*i
		contentObj := pageObj + 1
		kids[i] = fmt.Sprintf("%d 0 R", pageObj)
		stream := pageStream(lines)
		objects = append(objects,
			fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>", contentObj, fontObj),
			fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
		)
	}
	objects[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n)
	objects = append(objects, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	return pdfObjects(objects)
}

func pageStream(lines []string) string {
	var ops strings.Builder
	ops.WriteString("BT /F1 12 Tf 50 800 Td\n")
	for i, line := range lines {
		if i > 0 {
			ops.WriteString("0 -16 Td\n")
		}
		ops.WriteString(pdfLiteral(line))
		ops.WriteString(" Tj\n")
	}
	ops.WriteString("ET")
	return ops.String()
}

func pdfLiteral(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `(`, `\(`)
	s = strings.ReplaceAll(s, `)`, `\)`)
	return "(" + s + ")"
}

func pdfObjects(objects []string) []byte {
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")
	offs := make([]int, len(objects)+1)
	for i, obj := range objects {
		offs[i+1] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", len(objects)+1)
	buf.WriteString("0000000000 65535 f \n")
	for i := 1; i <= len(objects); i++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offs[i])
	}
	fmt.Fprintf(&buf, "trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return buf.Bytes()
}
