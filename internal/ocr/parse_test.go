package ocr

import (
	"bytes"
	"crypto/rand"
	"image"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/disintegration/imaging"
)

func TestParseBillFromFencedJSON(t *testing.T) {
	raw := []byte("Here you go:\n```json\n{\n  \"bought_on\": \"26.08.2026\",\n  \"lines\": [\n    {\"receipt_name\": \"Maka 5kg\", \"product_name\": \"Mąka pszenna\", \"package_count\": 2, \"package_size\": \"1,5\", \"unit_name\": \"kg\", \"amount\": \"18,90\", \"skip\": false},\n    {\"receipt_name\": \"PTU A\", \"skip\": true, \"skip_reason\": \"VAT\"}\n  ]\n}\n```\n")
	bill, err := parseBill(raw)
	if err != nil {
		t.Fatal(err)
	}
	if bill.BoughtOn != "2026-08-26" {
		t.Fatalf("bought_on: %q", bill.BoughtOn)
	}
	if len(bill.Lines) != 2 {
		t.Fatalf("lines: %d", len(bill.Lines))
	}
	if bill.Lines[0].PackageCount != "2" || bill.Lines[0].PackageSize != "1.5" || bill.Lines[0].Amount != "18.90" {
		t.Fatalf("pack/amount: %#v", bill.Lines[0])
	}
	if bill.Lines[0].ProductName != "Mąka pszenna" {
		t.Fatalf("product_name: %q", bill.Lines[0].ProductName)
	}
	got := bill.ProductLines()
	if len(got) != 1 || got[0].ProductID != 0 || got[0].ReceiptName != "Maka 5kg" {
		t.Fatalf("product lines: %#v", got)
	}
}

func TestParseBillRejectsNonJSON(t *testing.T) {
	_, err := parseBill([]byte("sorry, I cannot see that"))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNormalizeDateAndNumber(t *testing.T) {
	if got := normalizeDate("2.1.2026"); got != "2026-01-02" {
		t.Fatalf("date: %q", got)
	}
	if got := normalizeNumber("1 234,50 zł"); got != "1234.50" {
		t.Fatalf("number: %q", got)
	}
	if got := normalizeNumber("1.234,50"); got != "1234.50" {
		t.Fatalf("grouped: %q", got)
	}
}

func TestPrepareJPEGAcceptsPNG(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 12, 8))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	out, err := PrepareJPEG(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) == 0 {
		t.Fatal("empty jpeg")
	}
}

func TestPrepareJPEGKeepsDimensionsWhenUnderCap(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 400, 1200))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	out, err := PrepareJPEG(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) > maxPreparedBytes {
		t.Fatalf("size %d over cap %d", len(out), maxPreparedBytes)
	}
	got, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	w, h := got.Bounds().Dx(), got.Bounds().Dy()
	if w != 400 || h != 1200 {
		t.Fatalf("got %dx%d, want 400x1200", w, h)
	}
}

func TestPrepareJPEGShrinksWhenOverCap(t *testing.T) {
	img := incompressibleImage(1800, 2400)
	var qbuf bytes.Buffer
	if err := imaging.Encode(&qbuf, flattenWhite(img), imaging.JPEG, imaging.JPEGQuality(jpegQuality)); err != nil {
		t.Fatal(err)
	}
	if qbuf.Len() <= maxPreparedBytes {
		t.Fatalf("fixture too compressible after quality: %d", qbuf.Len())
	}

	var src bytes.Buffer
	if err := jpeg.Encode(&src, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	if src.Len() > MaxImageBytes {
		t.Fatalf("fixture over upload limit: %d", src.Len())
	}

	out, err := PrepareJPEG(src.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) > maxPreparedBytes {
		t.Fatalf("size %d over cap %d", len(out), maxPreparedBytes)
	}
	got, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	w, h := got.Bounds().Dx(), got.Bounds().Dy()
	if w >= 1800 && h >= 2400 {
		t.Fatalf("expected shrink, still %dx%d", w, h)
	}
	if w*h == 0 {
		t.Fatal("empty image")
	}
}

func TestPrepareJPEGRejectsEmpty(t *testing.T) {
	_, err := PrepareJPEG(nil)
	if err != ErrNoImage {
		t.Fatalf("got %v", err)
	}
}

func TestConfigured(t *testing.T) {
	if (Config{}).Configured() {
		t.Fatal("empty config should not be configured")
	}
	if !(Config{APIKey: "sk"}).Configured() {
		t.Fatal("key should configure")
	}
	if !(Config{BaseURL: "http://localhost:11434/v1"}).Configured() {
		t.Fatal("custom base url should configure")
	}
	if (Config{BaseURL: DefaultBaseURL}).Configured() {
		t.Fatal("default openai url without key is not configured")
	}
}

func TestExtractJSONStripsFence(t *testing.T) {
	got, err := extractJSON([]byte("```json\n{\"a\":1}\n```"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != `{"a":1}` {
		t.Fatalf("got %s", got)
	}
}

func incompressibleImage(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	if _, err := rand.Read(img.Pix); err != nil {
		panic(err)
	}
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = 255
	}
	return img
}
