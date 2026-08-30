package ocr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/shopspring/decimal"
)

func parseBill(raw []byte) (Bill, error) {
	payload, err := extractJSON(raw)
	if err != nil {
		return Bill{}, err
	}
	var bill Bill
	if err := json.Unmarshal(payload, &bill); err != nil {
		return Bill{}, fmt.Errorf("model returned invalid JSON")
	}
	bill.Notes = strings.TrimSpace(bill.Notes)
	bill.BoughtOn = normalizeDate(bill.BoughtOn)
	for i := range bill.Lines {
		bill.Lines[i].ReceiptName = strings.TrimSpace(bill.Lines[i].ReceiptName)
		bill.Lines[i].ProductName = strings.TrimSpace(bill.Lines[i].ProductName)
		if bill.Lines[i].ProductName == "" {
			bill.Lines[i].ProductName = bill.Lines[i].ReceiptName
		}
		bill.Lines[i].UnitName = strings.TrimSpace(bill.Lines[i].UnitName)
		bill.Lines[i].PackageCount = normalizeNumber(bill.Lines[i].PackageCount)
		bill.Lines[i].PackageSize = normalizeNumber(bill.Lines[i].PackageSize)
		bill.Lines[i].Quantity = normalizeNumber(bill.Lines[i].Quantity)
		bill.Lines[i].Amount = normalizeNumber(bill.Lines[i].Amount)
		bill.Lines[i].SkipReason = strings.TrimSpace(bill.Lines[i].SkipReason)
		fixWeighedKg(&bill.Lines[i])
	}
	bill.Lines = mergeRepeatScans(bill.Lines)
	return bill, nil
}

func extractJSON(raw []byte) ([]byte, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" {
		return nil, fmt.Errorf("empty model response")
	}
	if i := strings.Index(s, "```"); i >= 0 {
		s = s[i+3:]
		s = strings.TrimSpace(strings.TrimPrefix(s, "json"))
		if j := strings.Index(s, "```"); j >= 0 {
			s = s[:j]
		}
		s = strings.TrimSpace(s)
	}
	start := strings.IndexByte(s, '{')
	end := strings.LastIndexByte(s, '}')
	if start < 0 || end < start {
		return nil, fmt.Errorf("model response was not JSON")
	}
	return []byte(s[start : end+1]), nil
}

func normalizeDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "\u00a0", " ")
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.Format("2006-01-02")
	}
	for _, layout := range []string{
		"02.01.2006",
		"2.01.2006",
		"02.1.2006",
		"2.1.2006",
		"02/01/2006",
		"2/1/2006",
		"02-01-2006",
		"2006/01/02",
		"2006.01.02",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02")
		}
	}
	return s
}

func normalizeNumber(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\u00a0", "")
	s = strings.ReplaceAll(s, " ", "")
	s = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || r == '%' {
			return -1
		}
		return r
	}, s)
	s = strings.ReplaceAll(s, ",", ".")
	if strings.Count(s, ".") > 1 {
		parts := strings.Split(s, ".")
		s = strings.Join(parts[:len(parts)-1], "") + "." + parts[len(parts)-1]
	}
	return s
}

// fixWeighedKg maps "1 pack of 1.450 kg" (old OCR rule) to "1.450 × 1 kg"
// when the size looks like a till scale reading (three decimal places).
func fixWeighedKg(line *Line) {
	if !strings.EqualFold(line.UnitName, "kg") {
		return
	}
	if !isOne(line.PackageCount) {
		return
	}
	if !looksLikeScaleKg(line.PackageSize) {
		return
	}
	line.PackageCount = line.PackageSize
	line.PackageSize = "1"
}

func isOne(s string) bool {
	switch s {
	case "1", "1.0", "1.00", "1.000":
		return true
	}
	return false
}

func looksLikeScaleKg(s string) bool {
	i := strings.IndexByte(s, '.')
	if i < 0 {
		return false
	}
	frac := s[i+1:]
	if len(frac) < 3 {
		return false
	}
	return strings.TrimRight(frac, "0") != ""
}

func mergeRepeatScans(lines []Line) []Line {
	if len(lines) < 2 {
		return lines
	}
	type acc struct {
		idx    int
		count  decimal.Decimal
		amount decimal.Decimal
	}
	seen := map[string]*acc{}
	out := make([]Line, 0, len(lines))
	for _, line := range lines {
		if line.Skip {
			out = append(out, line)
			continue
		}
		key, count, amount, ok := repeatScanKey(line)
		if !ok {
			out = append(out, line)
			continue
		}
		if g, hit := seen[key]; hit {
			g.count = g.count.Add(count)
			g.amount = g.amount.Add(amount)
			out[g.idx].PackageCount = g.count.String()
			out[g.idx].Amount = g.amount.String()
			continue
		}
		idx := len(out)
		out = append(out, line)
		seen[key] = &acc{idx: idx, count: count, amount: amount}
	}
	return out
}

func repeatScanKey(line Line) (key string, count, amount decimal.Decimal, ok bool) {
	name := strings.ToLower(strings.Join(strings.Fields(line.ReceiptName), " "))
	if name == "" {
		return "", decimal.Zero, decimal.Zero, false
	}
	count, err := decimal.NewFromString(line.PackageCount)
	if err != nil || count.IsZero() {
		return "", decimal.Zero, decimal.Zero, false
	}
	amount, err = decimal.NewFromString(line.Amount)
	if err != nil {
		return "", decimal.Zero, decimal.Zero, false
	}
	size, err := decimal.NewFromString(line.PackageSize)
	if err != nil {
		size = decimal.Zero
	}
	unit := strings.ToLower(line.UnitName)
	key = name + "\x1f" + unit + "\x1f" + size.String() + "\x1f" + count.String() + "\x1f" + amount.String()
	return key, count, amount, true
}

type flexInt int64

func (n *flexInt) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if len(b) == 0 || bytes.Equal(b, []byte("null")) {
		*n = 0
		return nil
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		s = strings.TrimSpace(s)
		if s == "" {
			*n = 0
			return nil
		}
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			*n = 0
			return nil
		}
		*n = flexInt(v)
		return nil
	}
	var v float64
	if err := json.Unmarshal(b, &v); err != nil {
		*n = 0
		return nil
	}
	*n = flexInt(v)
	return nil
}

type flexNum string

func (n *flexNum) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if len(b) == 0 || bytes.Equal(b, []byte("null")) {
		*n = ""
		return nil
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*n = flexNum(s)
		return nil
	}
	*n = flexNum(bytes.TrimSpace(b))
	return nil
}

type rawBill struct {
	BoughtOn string    `json:"bought_on"`
	Notes    string    `json:"notes"`
	NotABill bool      `json:"not_a_bill"`
	Lines    []rawLine `json:"lines"`
}

type rawLine struct {
	ReceiptName  string  `json:"receipt_name"`
	ProductName  string  `json:"product_name"`
	ProductID    flexInt `json:"product_id"`
	UnitID       flexInt `json:"unit_id"`
	UnitName     string  `json:"unit_name"`
	PackageCount flexNum `json:"package_count"`
	PackageSize  flexNum `json:"package_size"`
	Quantity     flexNum `json:"quantity"`
	Amount       flexNum `json:"amount"`
	Skip         bool    `json:"skip"`
	SkipReason   string  `json:"skip_reason"`
}

func (b *Bill) UnmarshalJSON(data []byte) error {
	var raw rawBill
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	b.BoughtOn = raw.BoughtOn
	b.Notes = raw.Notes
	b.NotABill = raw.NotABill
	b.Lines = make([]Line, len(raw.Lines))
	for i, line := range raw.Lines {
		b.Lines[i] = Line{
			ReceiptName:  line.ReceiptName,
			ProductName:  line.ProductName,
			ProductID:    int64(line.ProductID),
			UnitID:       int64(line.UnitID),
			UnitName:     line.UnitName,
			PackageCount: string(line.PackageCount),
			PackageSize:  string(line.PackageSize),
			Quantity:     string(line.Quantity),
			Amount:       string(line.Amount),
			Skip:         line.Skip,
			SkipReason:   line.SkipReason,
		}
	}
	return nil
}
