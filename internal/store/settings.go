package store

import (
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

const (
	SettingOCRModel     = "ocr_model"
	SettingPieceUnitID  = "piece_unit_id"
	SettingWeightUnitID = "weight_unit_id"
)

type UnitDefaults struct {
	PieceID  int64
	WeightID int64
}

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

func (s *Store) UnitDefaults() (UnitDefaults, error) {
	piece, err := s.settingUnitID(SettingPieceUnitID)
	if err != nil {
		return UnitDefaults{}, err
	}
	weight, err := s.settingUnitID(SettingWeightUnitID)
	if err != nil {
		return UnitDefaults{}, err
	}
	return UnitDefaults{PieceID: piece, WeightID: weight}, nil
}

func (s *Store) SetUnitDefaults(d UnitDefaults) error {
	if err := s.setSettingUnitID(SettingPieceUnitID, d.PieceID); err != nil {
		return err
	}
	return s.setSettingUnitID(SettingWeightUnitID, d.WeightID)
}

func (s *Store) settingUnitID(key string) (int64, error) {
	raw, err := s.GetSetting(key)
	if err != nil || raw == "" {
		return 0, err
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, nil
	}
	if _, err := s.GetUnit(id); err != nil {
		if errors.Is(err, ErrNotFound) {
			return 0, nil
		}
		return 0, err
	}
	return id, nil
}

func (s *Store) setSettingUnitID(key string, id int64) error {
	if id == 0 {
		return s.q.DeleteSetting(ctx(), key)
	}
	if _, err := s.GetUnit(id); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrInvalidUnit
		}
		return err
	}
	return s.SetSetting(key, strconv.FormatInt(id, 10))
}
