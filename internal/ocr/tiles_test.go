package ocr

import (
	"bytes"
	"image"
	"image/jpeg"
	"testing"
)

func TestTileRectsShortIsOne(t *testing.T) {
	got := tileRects(1417, 1600)
	if len(got) != 1 || got[0] != image.Rect(0, 0, 1417, 1600) {
		t.Fatalf("%v", got)
	}
}

func TestTileRectsAtMaxIsOne(t *testing.T) {
	got := tileRects(800, sliceMaxH)
	if len(got) != 1 || got[0].Dy() != sliceMaxH {
		t.Fatalf("%v", got)
	}
}

func TestTileRectsLongSplitsWithOverlap(t *testing.T) {
	w, h := 1417, 4000
	got := tileRects(w, h)
	if len(got) < 2 {
		t.Fatalf("tiles %d: %v", len(got), got)
	}
	if got[0] != image.Rect(0, 0, w, sliceHeight) {
		t.Fatalf("first %v", got[0])
	}
	if got[len(got)-1].Max.Y != h {
		t.Fatalf("last does not reach end: %v", got)
	}
	for i := 1; i < len(got); i++ {
		overlap := got[i-1].Max.Y - got[i].Min.Y
		if overlap < 100 || overlap > 150 {
			t.Fatalf("overlap %d between %v and %v", overlap, got[i-1], got[i])
		}
		if got[i].Dy() > sliceMaxH {
			t.Fatalf("tile %d taller than %d: %v", i, sliceMaxH, got[i])
		}
	}
}

func TestTileRectsCoversHeight(t *testing.T) {
	for _, h := range []int{2201, 2500, 5000, 6000} {
		got := tileRects(1417, h)
		if len(got) < 2 {
			t.Fatalf("h=%d expected split, got %v", h, got)
		}
		if got[0].Min.Y != 0 || got[len(got)-1].Max.Y != h {
			t.Fatalf("h=%d coverage %v", h, got)
		}
		for i := 1; i < len(got); i++ {
			overlap := got[i-1].Max.Y - got[i].Min.Y
			if overlap < 100 || overlap > 150 {
				t.Fatalf("h=%d overlap %d at %d: %v", h, overlap, i, got)
			}
		}
	}
}

func TestSplitReceiptScalesWideImage(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 3000, 4000))
	jpegBytes, err := encodeJPEG(img)
	if err != nil {
		t.Fatal(err)
	}
	tiles, err := splitReceipt(jpegBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(tiles) != 1 {
		t.Fatalf("wide 4:3 should be one tile after width scale, got %d", len(tiles))
	}
	got, err := jpeg.Decode(bytes.NewReader(tiles[0]))
	if err != nil {
		t.Fatal(err)
	}
	if got.Bounds().Dx() != sliceWidth {
		t.Fatalf("width %d", got.Bounds().Dx())
	}
}

func TestSplitReceiptTallKeepsWidth(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 1417, 4000))
	jpegBytes, err := encodeJPEG(img)
	if err != nil {
		t.Fatal(err)
	}
	tiles, err := splitReceipt(jpegBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(tiles) != len(tileRects(1417, 4000)) {
		t.Fatalf("got %d tiles", len(tiles))
	}
	for i, tile := range tiles {
		got, err := jpeg.Decode(bytes.NewReader(tile))
		if err != nil {
			t.Fatal(err)
		}
		w, h := got.Bounds().Dx(), got.Bounds().Dy()
		if w != 1417 {
			t.Fatalf("tile %d width %d", i, w)
		}
		if h > sliceMaxH {
			t.Fatalf("tile %d %dx%d", i, w, h)
		}
	}
}
