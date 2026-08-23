package web

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxImageBytes = 5 << 20

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

	head := make([]byte, 512)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", err
	}
	head = head[:n]
	ext, ok := imageExt(head)
	if !ok {
		return "", fmt.Errorf("image must be jpeg, png, webp, or gif")
	}

	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	name := hex.EncodeToString(id[:]) + ext
	dest := filepath.Join(s.store.ImagesDir(), name)
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err := out.Write(head); err != nil {
		os.Remove(dest)
		return "", err
	}
	if _, err := io.Copy(out, io.LimitReader(f, maxImageBytes+1-int64(n))); err != nil {
		os.Remove(dest)
		return "", err
	}
	return name, nil
}

func imageExt(b []byte) (string, bool) {
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
