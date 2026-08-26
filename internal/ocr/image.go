package ocr

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const (
	MaxImageBytes = 10 << 20
	// modelEdge is the long side sent to the vision model. Receipts stay
	// readable, payloads stay small, and every photo lands at the same scale.
	modelEdge   = 1536
	jpegQuality = 82
)

func PrepareJPEG(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return nil, ErrNoImage
	}
	if len(raw) > MaxImageBytes {
		return nil, fmt.Errorf("image must be 10 MB or smaller")
	}
	if !sniffImage(raw) {
		return nil, fmt.Errorf("image must be jpeg, png, webp, or gif")
	}
	img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("could not read the image")
	}
	img = normalizeLongEdge(img, modelEdge)
	flat := imaging.New(img.Bounds().Dx(), img.Bounds().Dy(), color.White)
	img = imaging.OverlayCenter(flat, img, 1)

	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, imaging.JPEG, imaging.JPEGQuality(jpegQuality)); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func normalizeLongEdge(img image.Image, edge int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 || edge <= 0 {
		return img
	}
	long := w
	if h > w {
		long = h
	}
	if long == edge {
		return img
	}
	if w >= h {
		return imaging.Resize(img, edge, 0, imaging.Lanczos)
	}
	return imaging.Resize(img, 0, edge, imaging.Lanczos)
}

func sniffImage(b []byte) bool {
	if len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return true
	}
	switch http.DetectContentType(b) {
	case "image/jpeg", "image/png", "image/gif":
		return true
	}
	return false
}
