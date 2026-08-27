package web

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
)

var receiptImageID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (s *Server) receiptImageDir() string {
	return filepath.Join(s.store.DataDir(), "ocr")
}

func (s *Server) saveReceiptImage(jpeg []byte) (string, error) {
	if err := os.MkdirAll(s.receiptImageDir(), 0o755); err != nil {
		return "", err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	name := hex.EncodeToString(id[:])
	path := filepath.Join(s.receiptImageDir(), name+".jpg")
	if err := os.WriteFile(path, jpeg, 0o644); err != nil {
		return "", err
	}
	return name, nil
}

func (s *Server) receiptImagePath(id string) (string, bool) {
	if !receiptImageID.MatchString(id) {
		return "", false
	}
	return filepath.Join(s.receiptImageDir(), id+".jpg"), true
}

func (s *Server) deleteReceiptImage(id string) {
	path, ok := s.receiptImagePath(id)
	if !ok {
		return
	}
	_ = os.Remove(path)
}
