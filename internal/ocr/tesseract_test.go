package ocr

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

func TestExtractScannedPDFUsesOCRTextNotVision(t *testing.T) {
	orig := scanPDFText
	t.Cleanup(func() { scanPDFText = orig })
	scanPDFText = func([]byte) (string, error) {
		return "Faktura VAT 1/2026 18.08.2026 Maka pszenna 5kg 18.90 Suma PLN 18.90 extra letters", nil
	}

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
	if bytes.Contains(reqBody, []byte(`"type":"image_url"`)) {
		t.Fatal("scanned PDF should send OCR text, not images")
	}
	if !bytes.Contains(reqBody, []byte("Maka pszenna")) {
		t.Fatalf("request should include OCR text: %s", reqBody)
	}
	if bill.BoughtOn != "2026-08-18" {
		t.Fatalf("bought_on %q", bill.BoughtOn)
	}
}

func TestHasPDFOCRFalseWhenMissing(t *testing.T) {
	orig := lookPath
	t.Cleanup(func() { lookPath = orig })
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	if hasPDFOCR() {
		t.Fatal("expected missing tools")
	}
}

func TestOCRPDFNeedsDockerWhenMissingTools(t *testing.T) {
	orig := lookPath
	t.Cleanup(func() { lookPath = orig })
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	_, err := ocrPDF(context.Background(), textPDF())
	if !errors.Is(err, ErrNoPDFText) {
		t.Fatalf("got %v", err)
	}
	if !strings.Contains(err.Error(), "Docker") {
		t.Fatalf("error should mention Docker: %v", err)
	}
}

func TestOCRPDFMissingPolishData(t *testing.T) {
	origLook, origRun := lookPath, runCommand
	t.Cleanup(func() { lookPath = origLook; runCommand = origRun })
	lookPath = func(string) (string, error) { return "/usr/bin/x", nil }
	runCommand = func(_ context.Context, name string, args ...string) ([]byte, error) {
		if name == "tesseract" && len(args) == 1 && args[0] == "--list-langs" {
			return []byte("List of available languages (2):\neng\nosd\n"), nil
		}
		t.Fatalf("unexpected %s %v", name, args)
		return nil, nil
	}
	_, err := ocrPDF(context.Background(), textPDF())
	if err == nil || errors.Is(err, ErrNoPDFText) {
		t.Fatalf("got %v", err)
	}
	if !strings.Contains(err.Error(), "tesseract-lang") {
		t.Fatalf("error should mention tesseract-lang: %v", err)
	}
}

func TestTesseractPageWrapsMissingPol(t *testing.T) {
	orig := runCommand
	t.Cleanup(func() { runCommand = orig })
	runCommand = func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return nil, fmt.Errorf("tesseract: Error opening data file /opt/homebrew/share/tessdata/pol.traineddata Failed loading language 'pol'")
	}
	_, err := tesseractPage(context.Background(), "/tmp/page-1.png")
	if err == nil || !strings.Contains(err.Error(), "tesseract-lang") {
		t.Fatalf("got %v", err)
	}
}

func TestOCRPDFIntegration(t *testing.T) {
	if _, err := exec.LookPath("tesseract"); err != nil {
		t.Skip("tesseract not installed")
	}
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skip("pdftoppm not installed")
	}
	if !tesseractHasPol(context.Background()) {
		t.Skip("pol traineddata not installed")
	}
	raw := textPDF(
		"Faktura VAT 1/2026 18.08.2026",
		"Maka pszenna 5kg 18.90",
		"Suma PLN 18.90",
	)
	got, err := ocrPDF(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if !isPDFWithText(got) {
		t.Fatalf("OCR text too short: %q", got)
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
