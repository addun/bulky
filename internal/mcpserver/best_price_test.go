package mcpserver

import (
	"testing"
	"time"

	"github.com/adrian/bulkly/internal/store"
	"github.com/shopspring/decimal"
)

func TestBestPriceRequiresQuery(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := BestPrice(st, "  ", time.Now(), "PLN"); err == nil {
		t.Fatal("blank query should fail")
	}
}

func TestBestPriceMatchesAndFallback(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	units, err := st.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	flour, err := st.CreateProduct("Cake flour", units[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateAlias(flour.ID, 0, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	if _, err := st.CreatePurchase(flour.ID, 0, "2026-06-01", decimal.RequireFromString("1"), decimal.RequireFromString("3.5"), store.KindPurchase); err != nil {
		t.Fatal(err)
	}

	out, err := BestPrice(st, "tortova", now, "PLN")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Name != "Cake flour" {
		t.Fatalf("match: %#v", out)
	}
	if out.Matches[0].Window != store.WindowLastRecord || out.Matches[0].Price != "3.5" || out.Matches[0].BoughtOn != "2026-06-01" {
		t.Fatalf("quote: %#v", out.Matches[0])
	}

	miss, err := BestPrice(st, "bananas", now, "PLN")
	if err != nil {
		t.Fatal(err)
	}
	if len(miss.Matches) != 0 || miss.Hint == "" {
		t.Fatalf("miss: %#v", miss)
	}
}
