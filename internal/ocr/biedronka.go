package ocr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
)

// Tx is the loyalty-list metadata for one Biedronka purchase.
type Tx struct {
	ID         string
	Date       string
	StoreName  string
	ReceiptNum string
	TotalPrice float64
}

var shopNumber = regexp.MustCompile(`\d{3,5}`)

// BillFromBiedronka maps a fiscal e-receipt (or loyalty details) to a Bulkly bill.
func BillFromBiedronka(raw []byte, tx Tx) (Bill, error) {
	lines := extractBiedronkaLines(raw)
	if len(lines) == 0 {
		return Bill{}, ErrNoLines
	}
	scale := moneyScale(lines, tx.TotalPrice)
	var bill Bill
	bill.BoughtOn = strings.TrimSpace(tx.Date)
	bill.StoryName = strings.TrimSpace(tx.StoreName)
	if bill.StoryName == "" {
		bill.StoryName = "Biedronka"
	}
	if n := shopNumber.FindString(bill.StoryName); n != "" {
		bill.ExternalID = n
	}
	if num := strings.TrimSpace(tx.ReceiptNum); num != "" {
		bill.Notes = "Receipt " + num
	}
	var current int
	current = -1
	for _, item := range lines {
		if sell, ok := item["sellLine"].(map[string]any); ok {
			if truthy(sell["isStorno"]) {
				current = -1
				continue
			}
			line := Line{
				ReceiptName: strings.TrimSpace(asString(sell["name"])),
				Quantity:    formatQty(asFloat(sell["quantity"])),
				UnitPrice:   formatMoney(asFloat(sell["price"]) / scale),
				Amount:      formatMoney(asFloat(sell["total"]) / scale),
				VatType:     asString(sell["vatId"]),
			}
			if line.ReceiptName == "" {
				continue
			}
			bill.Lines = append(bill.Lines, line)
			current = len(bill.Lines) - 1
			continue
		}
		if disc, ok := item["discountLine"].(map[string]any); ok {
			if current < 0 || truthy(disc["isPercent"]) || truthy(disc["isStorno"]) {
				continue
			}
			add := asFloat(disc["value"]) / scale
			if add == 0 {
				continue
			}
			sum := asFloat(bill.Lines[current].Discount) + math.Abs(add)
			bill.Lines[current].Discount = formatMoney(sum)
		}
	}
	if len(bill.ProductLines()) == 0 {
		return Bill{}, ErrNoLines
	}
	payload, err := json.Marshal(bill)
	if err != nil {
		return Bill{}, err
	}
	return parseBill(payload)
}

func extractBiedronkaLines(raw []byte) []map[string]any {
	var payload any
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	return walkBiedronkaLines(payload)
}

func walkBiedronkaLines(payload any) []map[string]any {
	switch v := payload.(type) {
	case []any:
		if looksLikeTillLines(v) {
			return asObjectSlice(v)
		}
		for _, item := range v {
			if found := walkBiedronkaLines(item); len(found) > 0 {
				return found
			}
		}
	case map[string]any:
		for _, key := range []string{"lines", "receiptLines"} {
			if arr, ok := v[key].([]any); ok {
				return asObjectSlice(arr)
			}
		}
		for _, key := range []string{"receipt", "data", "payload", "json"} {
			if found := walkBiedronkaLines(v[key]); len(found) > 0 {
				return found
			}
		}
		if items, ok := v["items"].([]any); ok {
			return linesFromDetails(items)
		}
	}
	return nil
}

func looksLikeTillLines(items []any) bool {
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if _, ok := obj["sellLine"]; ok {
			return true
		}
		if _, ok := obj["discountLine"]; ok {
			return true
		}
		if _, ok := obj["sumInCurrency"]; ok {
			return true
		}
	}
	return false
}

func asObjectSlice(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if obj, ok := item.(map[string]any); ok {
			out = append(out, obj)
		}
	}
	return out
}

func linesFromDetails(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		sell := map[string]any{}
		if name := asString(obj["name"]); name != "" {
			sell["name"] = name
		}
		if _, ok := obj["price"]; ok {
			sell["price"] = obj["price"]
		} else if _, ok := obj["unit_price"]; ok {
			sell["price"] = obj["unit_price"]
		}
		if _, ok := obj["total"]; ok {
			sell["total"] = obj["total"]
		} else if _, ok := obj["total_price"]; ok {
			sell["total"] = obj["total_price"]
		}
		if _, ok := obj["quantity"]; ok {
			sell["quantity"] = obj["quantity"]
		}
		if _, ok := obj["vatId"]; ok {
			sell["vatId"] = obj["vatId"]
		}
		if len(sell) == 0 {
			continue
		}
		out = append(out, map[string]any{"sellLine": sell})
	}
	return out
}

func moneyScale(lines []map[string]any, listTotal float64) float64 {
	var sum float64
	for _, item := range lines {
		sell, ok := item["sellLine"].(map[string]any)
		if !ok || truthy(sell["isStorno"]) {
			continue
		}
		sum += asFloat(sell["total"])
	}
	if listTotal > 0 && sum > 0 {
		ratio := sum / listTotal
		if ratio > 50 && ratio < 150 {
			return 100
		}
	}
	return 1
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		n, _ := t.Float64()
		return n
	case string:
		s := strings.ReplaceAll(strings.TrimSpace(t), ",", ".")
		n, _ := strconv.ParseFloat(s, 64)
		return n
	case bool:
		return 0
	default:
		return 0
	}
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case json.Number:
		return t.String()
	case float64:
		if t == math.Trunc(t) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	default:
		return ""
	}
}

func truthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		return s == "true" || s == "1"
	case float64:
		return t != 0
	default:
		return false
	}
}

func formatMoney(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return ""
	}
	return decimal.NewFromFloat(v).Round(2).StringFixed(2)
}

func formatQty(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) || v == 0 {
		return ""
	}
	d := decimal.NewFromFloat(v)
	if d.Equal(d.Truncate(0)) {
		return d.Truncate(0).String()
	}
	return d.String()
}

func BillSlipText(bill Bill, tx Tx) string {
	var b strings.Builder
	b.WriteString("Biedronka e-receipt\n")
	if tx.StoreName != "" {
		b.WriteString(tx.StoreName)
		b.WriteByte('\n')
	}
	if tx.Date != "" {
		b.WriteString(tx.Date)
		b.WriteByte('\n')
	}
	if tx.ReceiptNum != "" {
		fmt.Fprintf(&b, "Receipt %s\n", tx.ReceiptNum)
	}
	b.WriteByte('\n')
	for _, line := range bill.ProductLines() {
		name := line.ReceiptName
		if name == "" {
			name = line.ProductName
		}
		fmt.Fprintf(&b, "%s  %s x %s  %s\n", name, line.Quantity, line.UnitPrice, line.Amount)
	}
	return b.String()
}
