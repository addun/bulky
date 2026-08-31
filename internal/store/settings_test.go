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
