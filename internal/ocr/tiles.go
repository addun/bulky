package ocr

import (
	"bytes"
	"fmt"
	"image"

	"github.com/disintegration/imaging"
)

const (
	sliceWidth   = 1417
	sliceHeight  = 2500
	sliceMaxH    = 2200
	sliceOverlap = 125
)

func splitReceipt(jpeg []byte) ([][]byte, error) {
	img, err := imaging.Decode(bytes.NewReader(jpeg))
	if err != nil {
		return nil, fmt.Errorf("could not read the prepared photo")
	}
	if img.Bounds().Dx() > sliceWidth {
		img = imaging.Resize(img, sliceWidth, 0, imaging.Lanczos)
	}
	b := img.Bounds()
	rects := tileRects(b.Dx(), b.Dy())
	tiles := make([][]byte, 0, len(rects))
	for _, r := range rects {
		crop := imaging.Crop(img, r.Add(b.Min))
		out, err := encodeJPEG(crop)
		if err != nil {
			return nil, err
		}
		tiles = append(tiles, out)
	}
	if len(tiles) == 0 {
		return nil, fmt.Errorf("could not slice the photo")
	}
	return tiles, nil
}

func tileRects(w, h int) []image.Rectangle {
	if w < 1 || h < 1 {
		return nil
	}
	if h <= sliceMaxH {
		return []image.Rectangle{image.Rect(0, 0, w, h)}
	}
	var out []image.Rectangle
	y := 0
	for y < h {
		y1 := y + sliceHeight
		if y1 > h {
			y1 = h
		}
		if y1 < h && h-y <= sliceMaxH {
			y1 = h
		}
		out = append(out, image.Rect(0, y, w, y1))
		if y1 >= h {
			break
		}
		next := y1 - sliceOverlap
		if next <= y {
			break
		}
		y = next
	}
	return out
}
