package web

import (
	"fmt"
	"html/template"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store"
)

func templateFuncs(symbol string) template.FuncMap {
	return template.FuncMap{
		"money": func(d decimal.Decimal) string {
			return formatMoney(d, symbol)
		},
		"qty": formatQuantity,
		"date": func(iso string) string {
			if len(iso) >= 10 {
				return iso[:10]
			}
			return iso
		},
		"datetime":  store.FormatBoughtOn,
		"dateValue": store.BoughtOnDate,
		"timeValue": store.BoughtOnTime,
		"unitPrice": func(amount, quantity decimal.Decimal) string {
			if quantity.IsZero() {
				return "—"
			}
			return formatMoney(amount.Div(quantity), symbol)
		},
		"extraQuotes": func(quote *store.QuotedPrice, p store.Product) []store.UnitQuote {
			if quote == nil {
				return nil
			}
			all := store.UnitQuotes(*quote, p)
			if len(all) <= 1 {
				return nil
			}
			return all[1:]
		},
		"qtyIn": func(qty decimal.Decimal, conv store.ProductConversion) decimal.Decimal {
			return store.QtyIn(qty, conv)
		},
		"hasImage": func(path string) bool {
			return strings.TrimSpace(path) != ""
		},
		"add": func(a, b int) int { return a + b },
	}
}

func formatQuantity(d decimal.Decimal) string {
	s := d.String()
	if strings.Contains(s, ".") {
		s = strings.TrimRight(s, "0")
		s = strings.TrimRight(s, ".")
	}
	return strings.ReplaceAll(s, ".", ",")
}

func formatMoney(d decimal.Decimal, symbol string) string {
	return formatGrouped(d, 2) + " " + symbol
}

func formatMoneyPerUnit(d decimal.Decimal, symbol, unit string) string {
	return formatMoney(d, symbol) + " / " + unit
}

func formatGrouped(d decimal.Decimal, places int32) string {
	neg := d.IsNegative()
	if neg {
		d = d.Abs()
	}
	s := d.StringFixed(places)
	parts := strings.SplitN(s, ".", 2)
	intPart := parts[0]
	var b strings.Builder
	n := len(intPart)
	for i, c := range intPart {
		if i > 0 && (n-i)%3 == 0 {
			b.WriteRune('\u00a0')
		}
		b.WriteRune(c)
	}
	out := b.String()
	if len(parts) == 2 {
		out += "," + parts[1]
	}
	if neg {
		out = "−" + out
	}
	return out
}

func parseDecimal(raw string, maxFrac int, allowZero bool) (decimal.Decimal, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.ReplaceAll(raw, "\u00a0", "")
	raw = strings.ReplaceAll(raw, " ", "")
	raw = strings.ReplaceAll(raw, ",", ".")
	if raw == "" {
		return decimal.Zero, fmt.Errorf("required")
	}
	if strings.Count(raw, ".") > 1 {
		return decimal.Zero, fmt.Errorf("invalid number")
	}
	if i := strings.IndexByte(raw, '.'); i >= 0 && len(raw)-i-1 > maxFrac {
		return decimal.Zero, fmt.Errorf("at most %d decimal places", maxFrac)
	}
	d, err := decimal.NewFromString(raw)
	if err != nil {
		return decimal.Zero, fmt.Errorf("invalid number")
	}
	if d.IsNegative() {
		return decimal.Zero, fmt.Errorf("must not be negative")
	}
	if d.IsZero() && !allowZero {
		return decimal.Zero, fmt.Errorf("must be greater than zero")
	}
	return d, nil
}
