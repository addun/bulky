package store

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestLastUnitPriceSkipsZeroQtyAndIncludesPriceKind(t *testing.T) {
	got := LastUnitPrice([]Purchase{
		{BoughtOn: "2026-09-01", Quantity: decimal.Zero, Amount: mustDec(t, "9"), Kind: KindPurchase},
		{BoughtOn: "2026-08-20 15:04", Quantity: mustDec(t, "2"), Amount: mustDec(t, "5"), Kind: KindPrice},
		{BoughtOn: "2026-01-01", Quantity: mustDec(t, "1"), Amount: mustDec(t, "3"), Kind: KindPurchase},
	})
	if got == nil || got.BoughtOn != "2026-08-20 15:04" || !got.Price.Equal(mustDec(t, "2.5")) {
		t.Fatalf("last: %#v", got)
	}
}

func TestLastUnitPriceEmpty(t *testing.T) {
	if got := LastUnitPrice(nil); got != nil {
		t.Fatalf("empty: %#v", got)
	}
}

func TestLowestSinceWindow(t *testing.T) {
	since := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	purchases := []Purchase{
		{BoughtOn: "2026-09-02", Quantity: mustDec(t, "1"), Amount: mustDec(t, "8"), Kind: KindPurchase},
		{BoughtOn: "2026-08-10", Quantity: mustDec(t, "2"), Amount: mustDec(t, "6"), Kind: KindPrice},
		{BoughtOn: "2026-08-03", Quantity: mustDec(t, "1"), Amount: mustDec(t, "4"), Kind: KindPurchase},
		{BoughtOn: "2026-08-02", Quantity: mustDec(t, "1"), Amount: mustDec(t, "1"), Kind: KindPurchase},
		{BoughtOn: "2026-08-20", Quantity: decimal.Zero, Amount: mustDec(t, "0.5"), Kind: KindPurchase},
	}
	got := LowestSince(purchases, since)
	if got == nil || got.BoughtOn != "2026-08-10" || !got.Price.Equal(mustDec(t, "3")) {
		t.Fatalf("low: %#v", got)
	}
}

func TestLowestSinceNoneInWindow(t *testing.T) {
	since := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	got := LowestSince([]Purchase{
		{BoughtOn: "2026-07-31", Quantity: mustDec(t, "1"), Amount: mustDec(t, "2"), Kind: KindPurchase},
	}, since)
	if got != nil {
		t.Fatalf("want none: %#v", got)
	}
}

func TestBestRecentPricePrefers30DayLow(t *testing.T) {
	now := time.Date(2026, 9, 8, 15, 0, 0, 0, time.UTC)
	got := BestRecentPrice([]Purchase{
		{BoughtOn: "2026-09-08", Quantity: mustDec(t, "1"), Amount: mustDec(t, "9"), Kind: KindPurchase},
		{BoughtOn: "2026-08-20", Quantity: mustDec(t, "2"), Amount: mustDec(t, "8"), Kind: KindPrice},
		{BoughtOn: "2026-07-01", Quantity: mustDec(t, "1"), Amount: mustDec(t, "1"), Kind: KindPurchase},
	}, now)
	if got == nil || got.Window != WindowLast30Days || got.BoughtOn != "2026-08-20" || !got.Price.Equal(mustDec(t, "4")) {
		t.Fatalf("30-day: %#v", got)
	}
}

func TestBestRecentPriceFallsBackToLastRecord(t *testing.T) {
	now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	got := BestRecentPrice([]Purchase{
		{BoughtOn: "2026-07-31", Quantity: mustDec(t, "1"), Amount: mustDec(t, "2"), Kind: KindPurchase},
		{BoughtOn: "2026-06-01", Quantity: mustDec(t, "1"), Amount: mustDec(t, "1"), Kind: KindPurchase},
	}, now)
	if got == nil || got.Window != WindowLastRecord || got.BoughtOn != "2026-07-31" || !got.Price.Equal(mustDec(t, "2")) {
		t.Fatalf("last: %#v", got)
	}
}

func TestBestRecentPriceEmpty(t *testing.T) {
	if got := BestRecentPrice(nil, time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)); got != nil {
		t.Fatalf("empty: %#v", got)
	}
}

func TestPricesBetweenChronologicalLast365(t *testing.T) {
	from := time.Date(2025, 9, 2, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	got := PricesBetween([]Purchase{
		{BoughtOn: "2026-09-02", Quantity: mustDec(t, "1"), Amount: mustDec(t, "5"), Kind: KindPurchase},
		{BoughtOn: "2025-09-02", Quantity: mustDec(t, "2"), Amount: mustDec(t, "4"), Kind: KindPrice},
		{BoughtOn: "2025-09-01", Quantity: mustDec(t, "1"), Amount: mustDec(t, "1"), Kind: KindPurchase},
		{BoughtOn: "2026-01-15", Quantity: decimal.Zero, Amount: mustDec(t, "9"), Kind: KindPurchase},
	}, from, to)
	if len(got) != 2 {
		t.Fatalf("len %d: %#v", len(got), got)
	}
	if got[0].BoughtOn != "2025-09-02" || !got[0].Price.Equal(mustDec(t, "2")) {
		t.Fatalf("first %#v", got[0])
	}
	if got[1].BoughtOn != "2026-09-02" || !got[1].Price.Equal(mustDec(t, "5")) {
		t.Fatalf("last %#v", got[1])
	}
}

func TestUnitQuotesConvertsExtras(t *testing.T) {
	p := Product{
		UnitName: "szt",
		Conversions: []ProductConversion{
			{UnitID: 2, UnitName: "l", Factor: mustDec(t, "1.5")},
		},
	}
	got := UnitQuotes(QuotedPrice{PricePoint: PricePoint{Price: mustDec(t, "5")}}, p)
	if len(got) != 2 {
		t.Fatalf("len %d: %#v", len(got), got)
	}
	if got[0].UnitName != "szt" || !got[0].Price.Equal(mustDec(t, "5")) {
		t.Fatalf("primary %#v", got[0])
	}
	if got[1].UnitName != "l" || !got[1].Price.Equal(mustDec(t, "10").Div(mustDec(t, "3"))) {
		t.Fatalf("extra %#v", got[1])
	}
	if !got[1].Price.Round(2).Equal(mustDec(t, "3.33")) {
		t.Fatalf("extra rounded: %s", got[1].Price)
	}
}
