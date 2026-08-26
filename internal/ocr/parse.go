package ocr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
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
		bill.Lines[i].Quantity = normalizeNumber(bill.Lines[i].Quantity)
		bill.Lines[i].Amount = normalizeNumber(bill.Lines[i].Amount)
		bill.Lines[i].SkipReason = strings.TrimSpace(bill.Lines[i].SkipReason)
	}
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
	ReceiptName string  `json:"receipt_name"`
	ProductName string  `json:"product_name"`
	ProductID   flexInt `json:"product_id"`
	UnitID      flexInt `json:"unit_id"`
	UnitName    string  `json:"unit_name"`
	Quantity    flexNum `json:"quantity"`
	Amount      flexNum `json:"amount"`
	Skip        bool    `json:"skip"`
	SkipReason  string  `json:"skip_reason"`
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
			ReceiptName: line.ReceiptName,
			ProductName: line.ProductName,
			ProductID:   int64(line.ProductID),
			UnitID:      int64(line.UnitID),
			UnitName:    line.UnitName,
			Quantity:    string(line.Quantity),
			Amount:      string(line.Amount),
			Skip:        line.Skip,
			SkipReason:  line.SkipReason,
		}
	}
	return nil
}
