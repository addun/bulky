package ocr

import (
	"bytes"
	"context"
	"errors"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSortPageFilesNumeric(t *testing.T) {
	files := []string{"page-10.png", "page-2.png", "page-1.png"}
	sortPageFiles(files)
	if files[0] != "page-1.png" || files[1] != "page-2.png" || files[2] != "page-10.png" {
		t.Fatalf("%v", files)
	}
}

func TestExtractPDFUsesVisionNotText(t *testing.T) {
	stubPDFPages(t, tinyPNG(t))

	billJSON := []byte(`{"bought_on":"2026-08-18","lines":[{"receipt_name":"Maka 5kg","product_name":"Maka","amount":"18.90"}]}`)
	var reqBody []byte
	srv := mockChat(t, func(_ string, body []byte) []byte {
		reqBody = body
		return billJSON
	})
	defer srv.Close()

	a := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Model: "gpt-4o"})
	bill, _, err := a.Extract(textPDF())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(reqBody, []byte(`"type":"image_url"`)) {
		t.Fatal("PDF should send page images, not extracted text")
	}
	if bytes.Contains(reqBody, []byte("extracted invoice")) {
		t.Fatalf("request should not use the old text prompt: %s", reqBody)
	}
	if bill.BoughtOn != "2026-08-18" {
		t.Fatalf("bought_on %q", bill.BoughtOn)
	}
}

func TestPDFPageJPEGsNeedsPoppler(t *testing.T) {
	orig := lookPath
	t.Cleanup(func() { lookPath = orig })
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	_, err := pdfPageJPEGs(textPDF())
	if !errors.Is(err, ErrNoPDFText) {
		t.Fatalf("got %v", err)
	}
	if !strings.Contains(err.Error(), "poppler") && !strings.Contains(err.Error(), "Docker") {
		t.Fatalf("error should mention poppler or Docker: %v", err)
	}
}

func TestPDFPageJPEGsIntegration(t *testing.T) {
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skip("pdftoppm not installed")
	}
	raw := textPDF(
		"Faktura VAT 1/2026 18.08.2026",
		"Maka pszenna 5kg 18.90",
		"Suma PLN 18.90",
	)
	got, err := pdfPageJPEGs(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 {
		t.Fatal("expected at least one page image")
	}
	if sniffFile(got[0]) != fileImage {
		t.Fatal("page should be a jpeg")
	}
}

func TestPreviewJPEGMissingToolsFallsBack(t *testing.T) {
	orig := lookPath
	t.Cleanup(func() { lookPath = orig })
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	jpeg, err := PreviewJPEG(textPDF("Maka pszenna 5kg 18.90 and enough letters here"))
	if err != nil {
		t.Fatal(err)
	}
	if sniffFile(jpeg) != fileImage {
		t.Fatal("preview should still be a jpeg slip")
	}
}

func TestPreviewJPEGStacksPDFPages(t *testing.T) {
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skip("pdftoppm not installed")
	}
	one, err := PreviewJPEG(textPDF("page one with enough letters here Maka 5kg"))
	if err != nil {
		t.Fatal(err)
	}
	two, err := PreviewJPEG(textPDFPages(
		[]string{"page one with enough letters here Maka 5kg"},
		[]string{"page two with more product lines Ryza 1kg"},
	))
	if err != nil {
		t.Fatal(err)
	}
	img1, err := jpeg.Decode(bytes.NewReader(one))
	if err != nil {
		t.Fatal(err)
	}
	img2, err := jpeg.Decode(bytes.NewReader(two))
	if err != nil {
		t.Fatal(err)
	}
	if img2.Bounds().Dy() <= img1.Bounds().Dy() {
		t.Fatalf("two-page preview height %d should exceed one-page %d", img2.Bounds().Dy(), img1.Bounds().Dy())
	}
}

func TestPageIndex(t *testing.T) {
	if pageIndex(filepath.Join("tmp", "page-12.png")) != 12 {
		t.Fatal(pageIndex("page-12.png"))
	}
}

func TestRasterizePDFUsesPdftoppm(t *testing.T) {
	origLook, origRun := lookPath, runCommand
	t.Cleanup(func() { lookPath = origLook; runCommand = origRun })
	lookPath = func(string) (string, error) { return "/usr/bin/pdftoppm", nil }
	runCommand = func(_ context.Context, name string, args ...string) ([]byte, error) {
		if name != "pdftoppm" {
			t.Fatalf("unexpected %s %v", name, args)
		}
		return nil, errors.New("pdftoppm: boom")
	}
	_, err := pdfPageJPEGs(textPDF())
	if err == nil {
		t.Fatal("expected rasterize error")
	}
	if !strings.Contains(err.Error(), "rasterize") {
		t.Fatalf("got %v", err)
	}
}
