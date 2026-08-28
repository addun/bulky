package ocr

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func TestParseBillFromFencedJSON(t *testing.T) {
	raw := []byte("Here you go:\n```json\n{\n  \"bought_on\": \"26.08.2026\",\n  \"lines\": [\n    {\"receipt_name\": \"Maka 5kg\", \"product_name\": \"Mąka pszenna\", \"quantity\": 2, \"amount\": \"18,90\", \"skip\": false},\n    {\"receipt_name\": \"PTU A\", \"skip\": true, \"skip_reason\": \"VAT\"}\n  ]\n}\n```\n")
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
	if bill.Lines[0].Quantity != "2" || bill.Lines[0].Amount != "18.90" {
		t.Fatalf("qty/amount: %#v", bill.Lines[0])
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

func TestPrepareJPEGNormalizesLongEdge(t *testing.T) {
	cases := []struct {
		w, h int
	}{
		{4000, 3000},
		{3000, 4000},
		{400, 800},
		{1536, 1024},
	}
	for _, tc := range cases {
		img := image.NewRGBA(image.Rect(0, 0, tc.w, tc.h))
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		out, err := PrepareJPEG(buf.Bytes())
		if err != nil {
			t.Fatalf("%dx%d: %v", tc.w, tc.h, err)
		}
		got, err := jpeg.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("%dx%d decode: %v", tc.w, tc.h, err)
		}
		w, h := got.Bounds().Dx(), got.Bounds().Dy()
		long, short := w, h
		if h > w {
			long, short = h, w
		}
		if long != modelEdge {
			t.Fatalf("%dx%d → %dx%d, long edge want %d", tc.w, tc.h, w, h, modelEdge)
		}
		wantShort := tc.h * modelEdge / tc.w
		if tc.h > tc.w {
			wantShort = tc.w * modelEdge / tc.h
		}
		if abs(short-wantShort) > 1 {
			t.Fatalf("%dx%d → %dx%d, short edge want ~%d", tc.w, tc.h, w, h, wantShort)
		}
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

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
