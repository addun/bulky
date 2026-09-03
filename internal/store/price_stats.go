package store

import (
	"time"

	"github.com/shopspring/decimal"
)

type PricePoint struct {
	BoughtOn string
	Price    decimal.Decimal
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
