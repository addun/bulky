package ocr

import (
	"bytes"
	"fmt"
	"net/http"
)

type fileKind int

const (
	fileUnknown fileKind = iota
	fileImage
	filePDF
)

func sniffFile(b []byte) fileKind {
	if isPDF(b) {
		return filePDF
	}
	if sniffImage(b) {
		return fileImage
	}
	return fileUnknown
}

func isPDF(b []byte) bool {
	if http.DetectContentType(b) == "application/pdf" {
		return true
	}
	n := len(b)
	if n > 1024 {
		n = 1024
	}
	return bytes.Contains(b[:n], []byte("%PDF-"))
}

// PreviewJPEG turns an uploaded bill into a JPEG for the confirm screen.
// Photos are compressed as before. A PDF stacks every
// rasterized page (up to maxPDFPages) when pdftoppm is available, otherwise
// a text slip.
func PreviewJPEG(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return nil, ErrNoImage
	}
	if len(raw) > MaxImageBytes {
		return nil, fmt.Errorf("file must be 10 MB or smaller")
	}
	switch sniffFile(raw) {
	case filePDF:
		return previewPDF(raw)
	case fileImage:
		return PrepareJPEG(raw)
	default:
		return nil, fmt.Errorf("file must be jpeg, png, webp, gif, or pdf")
	}
}
