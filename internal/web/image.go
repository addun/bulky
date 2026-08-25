package web

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const (
	maxImageBytes = 5 << 20
	// 2× the 120px product photo so it stays sharp on retina.
	imageEdge   = 240
	jpegQuality = 82
)

func (s *Server) saveImage(fh *multipart.FileHeader) (string, error) {
	if fh == nil || fh.Size == 0 {
		return "", nil
	}
	if fh.Size > maxImageBytes {
		return "", fmt.Errorf("image must be 5 MB or smaller")
	}
	f, err := fh.Open()
	if err != nil {
		return "", err
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil {
		return "", err
	}
	if int64(len(raw)) > maxImageBytes {
		return "", fmt.Errorf("image must be 5 MB or smaller")
	}
	if len(raw) == 0 {
		return "", nil
	}
	if _, ok := sniffImage(raw); !ok {
		return "", fmt.Errorf("image must be jpeg, png, webp, or gif")
	}

	img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
	if err != nil {
		return "", fmt.Errorf("could not read the image")
	}

	img = imaging.Fill(img, imageEdge, imageEdge, imaging.Center, imaging.Lanczos)
	flat := imaging.New(imageEdge, imageEdge, color.White)
	img = imaging.OverlayCenter(flat, img, 1)

	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	name := hex.EncodeToString(id[:]) + ".jpg"
	dest := filepath.Join(s.store.ImagesDir(), name)
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if err := imaging.Encode(out, img, imaging.JPEG, imaging.JPEGQuality(jpegQuality)); err != nil {
		os.Remove(dest)
		return "", err
	}
	return name, nil
}

func sniffImage(b []byte) (string, bool) {
	if len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return ".webp", true
	}
	switch http.DetectContentType(b) {
	case "image/jpeg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/gif":
		return ".gif", true
	}
	return "", false
}

func (s *Server) deleteImage(name string) {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == "/" {
		return
	}
	_ = os.Remove(filepath.Join(s.store.ImagesDir(), name))
}
