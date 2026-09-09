package store

import (
	"testing"
	"time"
)

func TestSearchProductQuotesRanksAndQuotes(t *testing.T) {
	s, _, flour, rice, lidl, _ := aliasFixture(t)
	if _, err := s.CreateAlias(flour.ID, lidl.ID, 0, "Mąka tortowa 1kg"); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	if _, err := s.CreatePurchase(flour.ID, 0, "2026-09-01", mustDec(t, "1"), mustDec(t, "5"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(rice.ID, 0, "2026-06-01", mustDec(t, "1"), mustDec(t, "3"), KindPurchase); err != nil {
		t.Fatal(err)
	}

	got, err := s.SearchProductQuotes("tortova", now, 10)
	if err != nil || len(got) != 1 || got[0].Product.ID != flour.ID {
		t.Fatalf("alias: %v %#v", err, got)
	}
	if got[0].Quote == nil || got[0].Quote.Window != WindowLast30Days || !got[0].Quote.Price.Equal(mustDec(t, "5")) {
		t.Fatalf("flour quote: %#v", got[0].Quote)
	}

	got, err = s.SearchProductQuotes("Rice", now, 10)
	if err != nil || len(got) != 1 || got[0].Product.ID != rice.ID {
		t.Fatalf("rice: %v %#v", err, got)
	}
	if got[0].Quote == nil || got[0].Quote.Window != WindowLastRecord || !got[0].Quote.Price.Equal(mustDec(t, "3")) {
		t.Fatalf("rice fallback: %#v", got[0].Quote)
	}

	got, err = s.SearchProductQuotes("bananas", now, 10)
	if err != nil || len(got) != 0 {
		t.Fatalf("miss: %v %#v", err, got)
	}
	got, err = s.SearchProductQuotes("  ", now, 10)
	if err != nil || got != nil {
		t.Fatalf("blank: %v %#v", err, got)
	}
}

func TestListProductsQuotesBestRecent(t *testing.T) {
	s, _, flour, rice, _, _ := aliasFixture(t)
	now := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	if _, err := s.CreatePurchase(flour.ID, 0, "2026-09-01", mustDec(t, "2"), mustDec(t, "10"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(flour.ID, 0, "2026-07-01", mustDec(t, "1"), mustDec(t, "1"), KindPurchase); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePurchase(rice.ID, 0, "2026-06-01", mustDec(t, "1"), mustDec(t, "3"), KindPurchase); err != nil {
		t.Fatal(err)
	}

	got, err := s.listProducts("", now, 0)
	if err != nil || len(got) != 2 {
		t.Fatalf("list: %v %#v", err, got)
	}
	byID := map[int64]ProductListItem{}
	for _, it := range got {
		byID[it.ID] = it
	}
	fq := byID[flour.ID].Quote
	if fq == nil || fq.Window != WindowLast30Days || !fq.Price.Equal(mustDec(t, "5")) {
		t.Fatalf("flour quote: %#v", fq)
	}
	rq := byID[rice.ID].Quote
	if rq == nil || rq.Window != WindowLastRecord || !rq.Price.Equal(mustDec(t, "3")) {
		t.Fatalf("rice quote: %#v", rq)
	}
}
