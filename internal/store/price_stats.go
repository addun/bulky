package store

import (
	"time"

	"github.com/shopspring/decimal"
)

const (
	WindowLast30Days = "last_30_days"
	WindowLastRecord = "last_record"
)

type PricePoint struct {
	BoughtOn string
	Price    decimal.Decimal
}

// QuotedPrice is the lookup/MCP price: lowest in the last 30 days, else the
// newest recorded unit price.
type QuotedPrice struct {
	PricePoint
	Window string
}

func (q QuotedPrice) IsLast30Days() bool {
	return q.Window == WindowLast30Days
}

func unitPriceOf(p Purchase) (decimal.Decimal, bool) {
	if p.Quantity.IsZero() {
		return decimal.Zero, false
	}
	return p.Amount.Div(p.Quantity), true
}

func onOrAfter(boughtOn string, day string) bool {
	d := BoughtOnDate(boughtOn)
	return d != "" && d >= day
}

func onOrBefore(boughtOn string, day string) bool {
	d := BoughtOnDate(boughtOn)
	return d != "" && d <= day
}

// LastUnitPrice is the newest valid unit price. Purchases are newest-first.
func LastUnitPrice(purchases []Purchase) *PricePoint {
	for _, p := range purchases {
		price, ok := unitPriceOf(p)
		if !ok {
			continue
		}
		return &PricePoint{BoughtOn: p.BoughtOn, Price: price}
	}
	return nil
}

// LowestSince is the lowest unit price on or after since (date part only).
func LowestSince(purchases []Purchase, since time.Time) *PricePoint {
	day := since.Format(boughtOnDate)
	var best *PricePoint
	for _, p := range purchases {
		if !onOrAfter(p.BoughtOn, day) {
			continue
		}
		price, ok := unitPriceOf(p)
		if !ok {
			continue
		}
		if best == nil || price.LessThan(best.Price) {
			pt := PricePoint{BoughtOn: p.BoughtOn, Price: price}
			best = &pt
		}
	}
	return best
}

// BestRecentPrice is the lowest unit price on or after 30 days before now.
// If the window is empty, it is the newest recorded unit price.
func BestRecentPrice(purchases []Purchase, now time.Time) *QuotedPrice {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if low := LowestSince(purchases, today.AddDate(0, 0, -30)); low != nil {
		return &QuotedPrice{PricePoint: *low, Window: WindowLast30Days}
	}
	if last := LastUnitPrice(purchases); last != nil {
		return &QuotedPrice{PricePoint: *last, Window: WindowLastRecord}
	}
	return nil
}

func quotesByProduct(buys []Purchase, now time.Time) map[int64]QuotedPrice {
	byProduct := map[int64][]Purchase{}
	for _, p := range buys {
		byProduct[p.ProductID] = append(byProduct[p.ProductID], p)
	}
	out := map[int64]QuotedPrice{}
	for id, list := range byProduct {
		if q := BestRecentPrice(list, now); q != nil {
			out[id] = *q
		}
	}
	return out
}

// PricesBetween is chronological unit prices from..to inclusive (date part only).
func PricesBetween(purchases []Purchase, from, to time.Time) []PricePoint {
	fromDay := from.Format(boughtOnDate)
	toDay := to.Format(boughtOnDate)
	var out []PricePoint
	for i := len(purchases) - 1; i >= 0; i-- {
		p := purchases[i]
		if !onOrAfter(p.BoughtOn, fromDay) || !onOrBefore(p.BoughtOn, toDay) {
			continue
		}
		price, ok := unitPriceOf(p)
		if !ok {
			continue
		}
		out = append(out, PricePoint{BoughtOn: p.BoughtOn, Price: price})
	}
	return out
}
