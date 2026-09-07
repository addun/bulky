package store

import (
	"errors"
	"testing"
)

func TestSettingGetSet(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	got, err := s.GetSetting(SettingOCRModel)
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("missing setting: got %q", got)
	}

	if err := s.SetSetting(SettingOCRModel, "  gpt-4o-mini  "); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetSetting(SettingOCRModel)
	if err != nil {
		t.Fatal(err)
	}
	if got != "gpt-4o-mini" {
		t.Fatalf("got %q", got)
	}

	if err := s.SetSetting(SettingOCRModel, "gpt-4.1"); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetSetting(SettingOCRModel)
	if err != nil {
		t.Fatal(err)
	}
	if got != "gpt-4.1" {
		t.Fatalf("upsert: got %q", got)
	}

	if err := s.SetSetting(SettingOCRModel, "  "); !errors.Is(err, ErrInvalidSetting) {
		t.Fatalf("empty: %v", err)
	}
	got, err = s.GetSetting(SettingOCRModel)
	if err != nil {
		t.Fatal(err)
	}
	if got != "gpt-4.1" {
		t.Fatalf("empty save should not clear: got %q", got)
	}
}

func TestUnitDefaults(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	got, err := s.UnitDefaults()
	if err != nil || got != (UnitDefaults{}) {
		t.Fatalf("empty: %v %#v", err, got)
	}

	szt, err := s.CreateUnit("szt")
	if err != nil {
		t.Fatal(err)
	}
	kg, err := s.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}

	if err := s.SetUnitDefaults(UnitDefaults{PieceID: szt.ID, WeightID: kg.ID}); err != nil {
		t.Fatal(err)
	}
	got, err = s.UnitDefaults()
	if err != nil || got.PieceID != szt.ID || got.WeightID != kg.ID {
		t.Fatalf("saved: %v %#v", err, got)
	}

	if err := s.SetUnitDefaults(UnitDefaults{}); err != nil {
		t.Fatal(err)
	}
	got, err = s.UnitDefaults()
	if err != nil || got != (UnitDefaults{}) {
		t.Fatalf("cleared: %v %#v", err, got)
	}

	if err := s.SetUnitDefaults(UnitDefaults{PieceID: 999}); !errors.Is(err, ErrInvalidUnit) {
		t.Fatalf("missing unit: %v", err)
	}
}
