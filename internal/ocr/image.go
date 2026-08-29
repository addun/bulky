package ocr

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"net/http"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const (
	MaxImageBytes = 10 << 20
	// maxPreparedBytes is the cap after JPEG quality. Dimensions stay as
	// photographed unless the file is still over this size.
	maxPreparedBytes = 3 << 19 // 1.5 MiB
	jpegQuality      = 82
	shrinkAttempts   = 16
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
	img = flattenWhite(img)
	return fitJPEG(img, maxPreparedBytes)
}

func flattenWhite(img image.Image) image.Image {
	flat := imaging.New(img.Bounds().Dx(), img.Bounds().Dy(), color.White)
	return imaging.OverlayCenter(flat, img, 1)
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, imaging.JPEG, imaging.JPEGQuality(jpegQuality)); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func fitJPEG(img image.Image, maxBytes int) ([]byte, error) {
	out, err := encodeJPEG(img)
	if err != nil {
		return nil, err
	}
	if len(out) <= maxBytes {
		return out, nil
	}

	origW := img.Bounds().Dx()
	origH := img.Bounds().Dy()
	scale := 1.0
	for i := 0; i < shrinkAttempts && len(out) > maxBytes; i++ {
		ratio := math.Sqrt(float64(maxBytes) / float64(len(out)))
		if ratio > 0.95 {
			ratio = 0.95
		}
		scale *= ratio
		w := int(math.Round(float64(origW) * scale))
		h := int(math.Round(float64(origH) * scale))
		if w < 1 {
			w = 1
		}
		if h < 1 {
			h = 1
		}
		out, err = encodeJPEG(imaging.Resize(img, w, h, imaging.Lanczos))
		if err != nil {
			return nil, err
		}
	}
	if len(out) > maxBytes {
		return nil, fmt.Errorf("could not compress the image under 1.5 MB")
	}
	return out, nil
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
