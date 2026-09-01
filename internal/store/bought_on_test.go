package store

import "testing"

func TestJoinAndSplitBoughtOn(t *testing.T) {
	if got := JoinBoughtOn("2026-08-18", "14:32"); got != "2026-08-18 14:32" {
		t.Fatalf("join: %q", got)
	}
	if got := JoinBoughtOn("2026-08-18", ""); got != "2026-08-18" {
		t.Fatalf("date only: %q", got)
	}
	if got := JoinBoughtOn("2026-08-18 09:00", "14:32"); got != "2026-08-18 14:32" {
		t.Fatalf("override clock: %q", got)
	}
	date, clock := SplitBoughtOn("2026-08-18T14:32:05")
	if date != "2026-08-18" || clock != "14:32" {
		t.Fatalf("split: %q %q", date, clock)
	}
}

func TestNormalizeBoughtOn(t *testing.T) {
	got, err := NormalizeBoughtOn("2026-08-18 14:32")
	if err != nil || got != "2026-08-18 14:32" {
		t.Fatalf("got %q %v", got, err)
	}
	got, err = NormalizeBoughtOn("2026-08-18")
	if err != nil || got != "2026-08-18" {
		t.Fatalf("date: %q %v", got, err)
	}
	if _, err := NormalizeBoughtOn("18.08.2026"); err == nil {
		t.Fatal("expected invalid date")
	}
}
