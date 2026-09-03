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

func (s *Server) saveReceiptFiles(raw, jpeg []byte) (string, error) {
	if err := os.MkdirAll(s.receiptImageDir(), 0o755); err != nil {
		return "", err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	name := hex.EncodeToString(id[:])
	jpgPath := filepath.Join(s.receiptImageDir(), name+".jpg")
	if err := os.WriteFile(jpgPath, jpeg, 0o644); err != nil {
		return "", err
	}
	srcPath := filepath.Join(s.receiptImageDir(), name+".bin")
	if err := os.WriteFile(srcPath, raw, 0o644); err != nil {
		_ = os.Remove(jpgPath)
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

func (s *Server) receiptSourcePath(id string) (string, bool) {
	if !receiptImageID.MatchString(id) {
		return "", false
	}
	return filepath.Join(s.receiptImageDir(), id+".bin"), true
}

func (s *Server) loadReceiptSource(id string) ([]byte, error) {
	path, ok := s.receiptSourcePath(id)
	if !ok {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(path)
}

func (s *Server) deleteReceiptFiles(id string) {
	if path, ok := s.receiptImagePath(id); ok {
		_ = os.Remove(path)
	}
	if path, ok := s.receiptSourcePath(id); ok {
		_ = os.Remove(path)
	}
}
