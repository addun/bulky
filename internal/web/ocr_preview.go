package web

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
)

var ocrPreviewID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (s *Server) ocrDir() string {
	return filepath.Join(s.store.DataDir(), "ocr")
}

func (s *Server) saveOCRPreview(jpeg []byte) (string, error) {
	if err := os.MkdirAll(s.ocrDir(), 0o755); err != nil {
		return "", err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	name := hex.EncodeToString(id[:])
	path := filepath.Join(s.ocrDir(), name+".jpg")
	if err := os.WriteFile(path, jpeg, 0o644); err != nil {
		return "", err
	}
	return name, nil
}

func (s *Server) ocrPreviewPath(id string) (string, bool) {
	if !ocrPreviewID.MatchString(id) {
		return "", false
	}
	return filepath.Join(s.ocrDir(), id+".jpg"), true
}

func (s *Server) deleteOCRPreview(id string) {
	path, ok := s.ocrPreviewPath(id)
	if !ok {
		return
	}
	_ = os.Remove(path)
}
