package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

const SettingOCRModel = "ocr_model"

func (s *Store) GetSetting(key string) (string, error) {
	value, err := s.q.GetSetting(ctx(), key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (s *Store) SetSetting(key, value string) error {
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	if key == "" || value == "" {
		return ErrInvalidSetting
	}
	return s.q.UpsertSetting(ctx(), sqlc.UpsertSettingParams{Key: key, Value: value})
}
